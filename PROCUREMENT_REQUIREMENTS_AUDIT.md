# Smart Horeca — procurement requirements audit (2026-10-09)

Source: `Texniki teklif _ Procurment Operation.docx`, sections “Satınalma hissəsindən” and “Mal Qəbulu və Anbar Inteqrasiyası”.

## Confirmed by functional tests in Preview (screenshots / manual tests, Oct 9)

- PR → RFQ → supplier quotation → PO: creation and navigation tested.
- GRN independent of iiko incoming invoice: tested, including PO = 27.5 kg and GRN = 27.5 kg.
- iiko invoice packaging: 5 × 5.5 kg = 27.5 kg; price/pack preserved; iiko Office verified.
- Matching PO → GRN → invoice, price variance: 29.50 vs 32.50 AZN observed.
- Partial receipts: two GRNs 11 + 16.5 kg; two separate invoices 11.80 + 17.70 AZN; final matched 27.5 kg.
- One previously drafted invoice posted in iiko, and the posting status was reflected by Smart Horeca.

## Newly coded, needs manual Preview tests (do not mark complete yet)

- Supplier invoice quantity can differ from physical GRN quantity. Editing draft quantity changes only invoice, not GRN.
- Display mismatch in quantity / packaging and price. Save draft but block automatic save-and-process for mismatches.
- Authorized `procurement.approve` role may approve/reject a mismatch with a written reason; save reviewer and timestamp; audit log.
- Procurement-linked import through Smart Horeca document-action rejects unapproved mismatches; re-checks after invoice edits. Native actions inside iikoOffice are outside the scope of this guard.
- Separate physical receipt progress from invoice matching and iiko posting status.
- D1 schema migrations for variance status; ensure D1 migrations execute successfully on Preview before real use.

## Original procurement specification: gaps / remaining acceptance criteria

| Requirement | Assessment | Work left |
| --- | --- | --- |
| Automatic PR at min inventory | Partially implemented | E2E test min/max calculation, user notifications, scheduling |
| Production-plan-triggered PR | Not verified | Define and integrate production plan / demand source |
| PR submitted by department managers, scoped by location | Partially implemented | End-to-end CHAIN rights / manager-approval testing |
| Approval flow / who approves then executes | Partially implemented | Test multi-tier approvals, routing, auditing |
| Nomenclature management | Exists in separate Stock module | Verify shared product IDs, packaging and permissions |
| Vendor master: tax ID, contacts, payment terms, contracts | Implemented UI/API | Test create/edit, branch scope |
| RFQ sending / comparison | Implemented UI/API | Test supplier links, expiration, multi-vendor comparison |
| PR to PO, Draft/Approved/Sent/Delivered/Closed | Partially implemented | Align business-facing statuses and closure semantics |
| Independent GRN and quantity variance alert | Implemented | Manual review/negative-path tests |
| Inventory updated in real time | Via posted iiko invoice | Verify delays, cached stock, no double-counting of GRN |
| Invoice registration + PO/GRN reconciliation | Implemented | Review flow, quantity variance and approval tests |
| Payment approvals and payment history | Not verified | Design payment confirmation and integration with supplier balances |
| Monthly / chronological purchasing analytics | Partial | Compare to source report expectations |
| Supplier/location/group purchase trends | Partial | Validate multi-location and supplier/group slicing |
| Top-product price trends / stock turnover | Not verified | Design/validate calculation and graphs |
| Roles and permissions by location | Implemented infrastructure | Test owner, manager, accountant, receiver, procurement roles in CHAIN |
| Mobile or web PR approval / PO view | Web supported | Verify mobile layout and reviewer journey |
| Automatic reminders for approvals and delays | Not verified | Notification scheduling and delivery rules |

## Security and accounting constraints

1. Never silently overwrite GRN quantities from supplier invoices.
2. Do not automatically post a mismatched invoice from procurement before approval.
3. Approvals must have reviewer, reason and timestamp, invalidate when quantities/prices change.
4. Matching PO/GRN/invoice is separate from iiko invoice posting and actual warehouse movement.
5. iikoOffice direct changes/processing are outside the Smart Horeca API guard; reconciliation must identify them.
6. Do not merge into `main` before manual tests for variance, migration, permission checks and document-action guard.

## Next manual test

PO 27.5 kg, GRN 11 kg, invoice 5.5 kg, draft `NEW`, `INVOICE_QTY_MISMATCH`, review `PENDING`, prohibit posting, approve with reason (authorized role), verify audit trail, then post from invoice management and verify correct posting / reconciliation.

## Resolution implementation (2026-10-09, feature/procurement-next-v1)

Implemented in Preview:
- Independent invoice quantity vs immutable GRN; quantity and price variance comparison.
- Authorized approval/rejection and audit reason.
- Resolution plan (supplier correction, supplemental invoice, or externally documented GRN correction), status IN_PROGRESS.
- Supplemental invoice allowed only for previously approved shortage with a plan; no extra GRN quantity is created.
- Supplemental invoices cannot exceed recorded GRN quantities.
- Closure requires cumulative invoice quantities to equal the GRN and server-side re-read of all invoices in iiko by document number, checking PROCESSED status, item quantities and prices. Client-supplied status alone is not trusted.
- Original GRN is not edited by the resolution workflow. For actual erroneous physical count, a separately authorized correction document/process remains necessary; the planning option does NOT silently change stock.
- Draft-only behavior on mismatch; approved variance and source invoice processing do not by themselves mark the reconciliation as closed.

Automated code/unit-scenario checks: 13/13 for variance and resolution conditions; three targeted checks for live-iiko XML parsing and changed-document rejection. Cloudflare preview status tracked separately.

Remaining before production/main: authenticated browser acceptance of a resolution plan and a supplemental invoice on existing test PO; validate by-number XML responses against the user's actual iiko version; confirm posted flags and desired stock-accounting treatment (an external GRN adjustment is not implemented here). Existing main remains unchanged.
