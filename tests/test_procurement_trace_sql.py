"""Executable SQLite contract tests for the real Cloudflare D1 trace ledger DDL.

Run: python -m unittest discover -s tests -p 'test_procurement_trace_sql.py'
No external services required. The test reads actual migration statements from the
endpoint, rather than copying potentially divergent SQL into fixtures.
"""
import re
import sqlite3
import unittest
from pathlib import Path

ENDPOINT = Path(__file__).resolve().parents[1] / "functions/api/procurement-trace.js"


def schema():
    source = ENDPOINT.read_text(encoding="utf-8")
    statements = re.findall(
        r"db\.prepare\(`(CREATE (?:TABLE|INDEX|UNIQUE INDEX|TRIGGER)\b.*?)`\)",
        source,
        re.S,
    )
    if len(statements) < 10:
        raise AssertionError(f"Expected D1 tables, indexes and triggers; found {len(statements)}")
    db = sqlite3.connect(":memory:")
    for statement in statements:
        db.executescript(statement + ";")
    return db


class TraceLedgerTests(unittest.TestCase):
    def setUp(self):
        self.db = schema()
        for ident, warehouse, workspace in [
            ("cold", "rms1", "tenantA"),
            ("kitchen", "rms1", "tenantA"),
            ("rms2", "rms2", "tenantA"),
            ("foreign", "rms1", "tenantB"),
        ]:
            self.db.execute(
                """INSERT INTO proc_trace_locations
                (id,workspace_id,server_scope,warehouse_id,name,created_at,created_by)
                VALUES (?,?,?,?,?,?,?)""",
                (ident, workspace, "server1", warehouse, ident, "2026-10-20", "owner"),
            )
        self.db.execute(
            """INSERT INTO proc_trace_grn_items
            (workspace_id,server_scope,grn_id,product_id,accepted_qty)
            VALUES ('tenantA','server1','grn1','beef',30)"""
        )
        self.db.commit()

    def tearDown(self):
        self.db.close()

    def lot(self, ident="lot1", amount=22, code="BR001", expires="2099-01-01"):
        self.db.execute(
            """INSERT INTO proc_trace_lots
            (id,workspace_id,server_scope,request_id,grn_id,order_id,warehouse_id,
             product_id,product_name,lot_code,expires_on,received_qty,created_at,created_by)
             VALUES (?,'tenantA','server1',?,'grn1','order1','rms1',
                     'beef','Говядина',?,?,?,'2026-10-20','receiver')""",
            (ident, "create-"+ident, code, expires, amount),
        )

    def move(self, action, amount, ident, src="", dest="", lot="lot1", workspace="tenantA"):
        self.db.execute(
            """INSERT INTO proc_trace_moves
            (id,workspace_id,server_scope,request_id,lot_id,action,
             from_location_id,to_location_id,quantity,actor_id,created_at)
             VALUES (?,?,?,?,?,?,?,?,?,'receiver','2026-10-20')""",
            (ident, workspace, "server1", ident, lot, action, src, dest, amount),
        )

    def remaining(self, where):
        row = self.db.execute(
            "SELECT quantity FROM proc_trace_balances WHERE lot_id='lot1' AND location_id=?",
            (where,),
        ).fetchone()
        return row[0] if row else 0

    def test_receipt_transfer_kitchen_consume_and_writeoff(self):
        self.lot()
        self.move("RECEIVE", 22, "receive1", dest="cold")
        self.assertEqual(self.remaining("cold"), 22)
        self.move("TRANSFER", 8, "transfer1", src="cold", dest="kitchen")
        self.assertEqual(self.remaining("cold"), 14)
        self.assertEqual(self.remaining("kitchen"), 8)
        self.move("CONSUME", 5, "consume1", src="kitchen")
        self.move("WRITE_OFF", 3, "waste1", src="cold")
        self.assertEqual(self.remaining("cold"), 11)
        self.assertEqual(self.remaining("kitchen"), 3)
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM proc_trace_moves").fetchone()[0], 4
        )

    def test_grn_qty_never_exceeded_by_multiple_lots(self):
        self.lot()
        self.move("RECEIVE", 22, "receive1", dest="cold")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "LOT_EXCEEDS_GRN"):
            self.lot("lot2", 9, "BR002")
        self.assertEqual(
            self.db.execute("SELECT registered_qty FROM proc_trace_grn_items").fetchone()[0],
            22,
        )

    def test_insufficient_balance_is_atomic(self):
        self.lot()
        self.move("RECEIVE", 22, "receive1", dest="cold")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "INSUFFICIENT_LOT_BALANCE"):
            self.move("TRANSFER", 23, "too-much", src="cold", dest="kitchen")
        self.assertEqual(self.remaining("cold"), 22)
        self.assertEqual(
            self.db.execute("SELECT COUNT(*) FROM proc_trace_moves").fetchone()[0], 1
        )

    def test_quarantine_blocks_issue_until_authorized_release(self):
        self.lot()
        self.move("RECEIVE", 22, "receive1", dest="cold")
        self.move("HOLD", 0, "hold1")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "LOT_ON_HOLD"):
            self.move("ISSUE", 5, "blocked", src="cold")
        self.move("WRITE_OFF", 2, "waste1", src="cold")
        self.move("RELEASE", 0, "release1")
        self.move("ISSUE", 4, "issue1", src="cold")
        self.assertEqual(self.remaining("cold"), 16)

    def test_expired_lot_may_only_be_quarantined_or_written_off(self):
        self.lot(expires="2000-01-01")
        self.move("RECEIVE", 22, "receive1", dest="cold")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "LOT_EXPIRED"):
            self.move("TRANSFER", 1, "blocked", src="cold", dest="kitchen")
        self.move("HOLD", 0, "hold1")
        self.move("WRITE_OFF", 2, "waste1", src="cold")
        self.assertEqual(self.remaining("cold"), 20)

    def test_cannot_transfer_across_warehouses_or_workspaces(self):
        self.lot()
        self.move("RECEIVE", 22, "receive1", dest="cold")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "DESTINATION_SCOPE_MISMATCH"):
            self.move("TRANSFER", 1, "to-another-rms", src="cold", dest="rms2")
        with self.assertRaisesRegex(sqlite3.IntegrityError, "LOT_SCOPE_MISMATCH"):
            self.move("ISSUE", 1, "from-other-tenant", src="cold", workspace="tenantB")
        self.assertEqual(self.remaining("cold"), 22)

    def test_auto_register_from_grn_has_exact_sql_column_binding_contract(self):
        # This SQL is used by SYNC_GRN, which is invoked immediately after the
        # physical receipt is saved. Prevent a broken D1 INSERT from passing
        # schema-only tests.
        source = ENDPOINT.read_text(encoding="utf-8")
        section = source.split('if (action === "SYNC_GRN")', 1)[1].split(
            'if (action === "REGISTER_LOT")', 1
        )[0]
        match = re.search(
            r"INSERT INTO proc_trace_lots\((.*?)\) VALUES\((.*?)\)",
            section, re.S,
        )
        self.assertIsNotNone(match, "SYNC_GRN must insert a real lot")
        columns = [c.strip() for c in match.group(1).split(",")]
        binds = re.findall(r"\?(\d+)", match.group(2))
        self.assertEqual(len(columns), 19)
        self.assertEqual(binds, [str(i) for i in range(1, len(columns) + 1)])

    def test_location_is_optional_in_grn_and_not_sent_in_iiko_payload(self):
        root = ENDPOINT.parents[2]
        procurement_api = (root / "functions/api/procurement.js").read_text("utf-8")
        procurement_ui = (root / "procurement.js").read_text("utf-8")
        self.assertIn("const locationId=clean(place.locationId)", procurement_api)
        self.assertIn("loadReceiptLocations(o.warehouseId)", procurement_ui)
        # The iiko invoice mapper must still explicitly whitelist accounting
        # attributes instead of forwarding the GRN line object.
        invoice_section = procurement_ui.split("const incomingDocument=", 1)[1].split(
            "documentTotal:", 1
        )[0]
        self.assertNotIn("locationId:", invoice_section)
        self.assertNotIn("lotCode:", invoice_section)
        self.assertNotIn("expiresOn:", invoice_section)

    def test_repeated_request_is_not_applied_twice(self):
        self.lot()
        self.move("RECEIVE", 22, "receive1", dest="cold")
        self.move("ISSUE", 2, "idempotent1", src="cold")
        with self.assertRaises(sqlite3.IntegrityError):
            self.move("ISSUE", 2, "idempotent1", src="cold")
        self.assertEqual(self.remaining("cold"), 20)


if __name__ == "__main__":
    unittest.main()
