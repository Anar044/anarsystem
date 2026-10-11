# Smart Horeca — Internal RMS stock orders (phase 1)

**Branch**: feature/internal-orders-rms-v1
**Scope**: goods and ingredients only. Central production, recipes, ingredient write-offs and manufacturing plans are NOT part of this phase.

## Confirmed iikoChain 9.2 behavior
From the user's official iikoChain 9.2 PDFs, topics 1007 (internal orders) and 89 (shipment):
- Different legal entities: linked outgoing + incoming invoices; incoming created only after outgoing is processed.
- Same legal entity: internal transfer.
- \`accounting-only-in-chain=true\`: transfer irrespective of legal entity; some cross-RMS transfers do not replicate to RMS.
- Shipment documents generated as **unprocessed**. They are formed per receiver store and per raw-material order group.
- iiko order statuses: posted, ready for shipment, shipped and received. Do not map our READY to iiko SHIPPED.
- Topic 1007 focuses on production/distribution centers; this first phase covers only stocked goods. Do not create iiko native production orders.

## Implemented in phase 1
- Separate page \`/internal-orders.html\`, linked from Procurement sidebar; no external PO logic is changed.
- Optional centrally configured default sending RMS and warehouse, validated against the corporation's actual RMS warehouse directory.
- Restaurant request: sender RMS/store (central warehouse OR any other RMS in the network), destination RMS/store, delivery date, items and packaging, own document number IO-..., DRAFT. Same-RMS routes rejected: use an internal transfer for those.
- SUBMITTED, APPROVED/REJECTED (review reason), PICKING, READY workflow.
- Authorized staff of the **sending RMS** can reduce approved quantities, not increase them. The sender may be the central warehouse or another restaurant.
- Server-side authorization per workspace role and restaurant scope (CHAIN) for recipient requests and sender-side fulfillment; scoped managers cannot see unrelated RMS orders.
- Audit events for create, status transitions and central RMS setup.
- Database persists orders in dedicated D1 tables keyed by server_scope.
- No inventory writes or fictitious debt created in D1.

## Shipment workflow: implementation in phase 1.5

- New endpoint `/api/internal-order-shipments` manages priced **partial** shipments per READY internal order, with a stable UUID and a unique outgoing invoice number per shipment.
- Sender-side fulfillment permissions and same connected server scope are verified on every action. Destination-side users may view but cannot modify.
- Approval quantities are reserved across prepared, sent, and ambiguous shipments. Duplicate reservations are blocked with order revision CAS.
- Recipient counterparty is automatically mapped to the **receiving RMS warehouse** (iiko internal buyer). Outgoing line price is now calculated from the sender warehouse's reported inventory cost with zero markup; never manually entered.
- `save-iiko-draft` imports the stable draft document using `/resto/api/documents/import/outgoingInvoice` **without `PROCESSED`**. Before import, existing document numbers are checked; repeated requests are blocked.
- If iiko gives an ambiguous failure, shipment is locked in `CHECK_REQUIRED`: **do not resend automatically**. The operator must verify iiko first to avoid a duplicate.
- `verify-iiko` performs read-only verification of number, document ID, sending store, counteragent, product IDs, quantities, item prices and sums, plus actual iiko status.
- Read-back of processed outgoing is **not** equivalent to recipient acceptance. Incoming document linkage, legal-person mapping and tax invoice must still be verified.
- Works for central RMS → restaurant and restaurant A → restaurant B with **different VÖEN**.
- Existing external PR/RFQ/PO/GRN flows remain untouched.

## Intentionally NOT yet implemented / blocked on integration verification
1. Automatic **posting** (PROCESSED) of the outgoing invoice, after testing iikoChain 9.2 legal-person and `accounting-only-in-chain` settings. Draft outgoing document generation is now implemented.
2. Verify authoritative Chain-created linked incoming invoice in recipient RMS.
3. Full receipt verification, mismatch resolution, shipment-to-order final status, and authoritative partial receipt quantities. Partial outgoing drafts and read-only outgoing verification are now implemented.
4. Automatic internal prices, electronic tax invoice (e-qaimə), verified counterparty mapping to legal persons, VAT, payment and balances between different VÖEN. Automatic source-warehouse valuation and buyer mapping to the receiver STORE are implemented for unprocessed outgoing drafts.
5. Production orders, consolidated manufacturing plans, recipes/semifinished products.

**Never mark a real shipment complete based on D1 workflow flags.** Verify outgoing and corresponding incoming through iiko's document APIs and preserve unique document IDs before changing stock-related status.

## Acceptance tests before a production merge
- Use a test central RMS and restaurant RMS with different VÖEN.
- Verify department list / store ownership resolution for at least two restaurants.
- Verify both central RMS → restaurant and restaurant A → restaurant B with DIFFERENT VÖEN. Requester can select source RMS without gaining control of that RMS.
- Check requester cannot approve a request originating from another RMS; only fulfillment role bound to sending RMS can do it.
- Test requester role cannot see another restaurant; central warehouse only sees its own network orders.
- Verify packaging calculation with a non-unit pack.
- Confirm no changes to stock balances from draft/approval/ready transitions.
- Run node --test tests/internal-orders-core.test.mjs.

## iiko document integration caveat
For different legal entities the official iikoChain 9.2 shipment manual describes an outgoing invoice in the source RMS and a linked incoming invoice in the recipient RMS. However `accounting-only-in-chain=true` changes this to an internal transfer even across legal entities, with known replication limitations. This service deliberately does not make stock-affecting requests until server settings and a real test invoice have been verified. Legal-person/VÖEN mapping is not yet persisted in this phase.

## New tests
Run `node --test tests/internal-shipment-core.test.mjs`; it checks package/base-unit amounts, partial reservation, AZN price precision and unprocessed outgoing XML. GitHub Actions also runs previous RMS department scope and outgoing document read-back tests.

**Manual test needed:** open an already READY internal order (e.g. IO-20261011-06E974), supply a valid iiko counteragent ID for the recipient VÖEN and prices, create an outgoing shipment, then deliberately save the **unprocessed** document to the test iiko installation and confirm it appears exactly once. Only after that should processing and the Chain-created linked incoming be connected.

## Warehouse-cost pricing and RMS buyer mapping (October 2026)

- **Sender:** chosen source RMS and source warehouse, persisted with the order, e.g. Mərkəzi Anbar.
- **Receiver / iiko buyer:** chosen receiving RMS STORE, e.g. RMS 1 / RMS 1 METBEX. iikoChain guide "Перемещение двумя документами" instructs selecting the receiving **warehouse as the buyer**, with the "Использовать для внутренних перемещений" flag enabled in corporation settings.
- **No manual customer ID or price fields:** `internal-orders.js` displays the selected sender and receiver by name and loads read-only warehouse cost.
- **Price:** server requests `/resto/api/v2/reports/balance/stores?timestamp=YYYY-MM-DDT23:59:59&store=<source_store_id>&department=<source_rms_id>`, computes `unitCost = sum / amount` only from matching source warehouse rows, preserves six decimal places, applies **zero markup**. Missing/zero valuation or insufficient stock blocks preparation.
- **Anti-spoofing:** `prepare` ignores prices and counterparty IDs sent by the browser; it re-queries iiko and derives buyer from `sh_internal_orders.destination_store_id`. `save-iiko-draft` checks the destination-store buyer again; any older manually-priced drafts are blocked and must be recreated.
- **Valuation disclaimer:** inventory value is the current iiko valuation for the warehouse and selected date; recalculation of past operations can change the actual write-off cost. We must not claim a fixed historic FIFO cost from `balance/stores`.
- **Do not bypass real Chain posting/replication:** iiko outgoing invoice is still saved only as `NEW`. Before enabling `PROCESSED` and automatic linked incoming, test actual cross-legal-person route and verify the warehouse is configured for internal transfers. Tax treatment between separate VÖEN still requires verification.


## Explicit shipment posting after verification (October 2026)

- The initial READY order is **not** an outgoing invoice. The old 'verify an arbitrary invoice number' button was removed from this step.
- A persisted shipment can be in PREPARED, DRAFT_SAVED, DRAFT_VERIFIED, PROCESSING, CHECK_REQUIRED or IIKO_PROCESSED. An iiko HTTP 500 during import is ambiguous and leaves CHECK_REQUIRED locked.
- Verification now tries /outgoingInvoice/byNumber and falls back to the working /outgoingInvoice export with dates, matching by exact document number. Never treat one failing endpoint as proof that an invoice does not exist.
- The **Отгрузить** button is shown only for DRAFT_VERIFIED, after iiko confirmed the outgoing document exists and is NEW with the correct UUID, source warehouse, buyer warehouse, products, amounts, prices and sums. The user explicitly confirms the stock-changing action.
- Processing uses the exact document UUID with status PROCESSED, locks D1 state to PROCESSING before issuing the write, and re-verifies iiko reports PROCESSED before marking IIKO_PROCESSED. Ambiguous results remain locked and require manual read-back (no silent retry).
- A processed outgoing is still **not** received by the destination RMS. Linked incoming and receipt status are not yet automated.
- Current test order IO-20261011-06E974 / outgoing IO-20261011-06E974-S01 was reported CHECK_REQUIRED (iiko import HTTP 500). Do not attempt to post or recreate this invoice without confirming actual iiko state.

## One-click dispatch UX (October 2026)

- Operator-facing workflow: choose source/destination and products during the order, then at READY choose actual quantities and click **Отгрузить** once. There is NO required manual sequence of draft save → verify → post.
- Server \`dispatch\` atomically reserves a shipment UUID/number, confirms the source RMS warehouse and receiver STORE, re-reads source warehouse costing, checks if the outgoing number exists, and issues a single \`PROCESSED\` outgoing import. A read-only iiko check verifies the same UUID, store, counterparty, amounts, prices and PROCESSED status before Smart Horeca marks the shipment dispatched.
- The incoming invoice must be created via iikoChain's normal cross-RMS mechanism (subject to iikoChain accounting-only and legal-entity settings). It is **NOT manually created** by Smart Horeca. Automatic identification and acceptance of the linked incoming invoice are NOT YET completed.
- Ambiguous error/HTTP 500: shipment stays locked as CHECK_REQUIRED; read-only reconciliation is performed automatically when the order is opened. No second POST and no manual operator-level 'Сверить' button. A blocked order needs diagnosis if the document still cannot be found.
- Older PREPARED shipments can be dispatched from their list; older DRAFT_VERIFIED shipments can be posted after automatic confirmation. The test record IO-20261011-06E974-S01 was previously CHECK_REQUIRED after HTTP 500 and must **NOT** be blindly resent.

## Confirmed REST buyer type mismatch (2026-10-11)
- Test shipment IO-20261011-DF4D8D-S01 to RMS 2 METBEX returned HTTP 500 java.lang.ClassCastException: expected resto.front.User but encountered resto.back.store.Store.
- iikoChain's UI supports STORE as the buyer of an outgoing invoice that automatically creates a paired incoming. The tested REST /documents/import/outgoingInvoice appears to coerce counteragentId to User. These are not interchangeable interfaces.
- NEVER replace the recipient Store with a random external company or employee User: it risks creating a separate sale without the linked incoming invoice.
- New server guard assessInternalShipmentRoute rejects unverified cross-RMS Store-buyer outgoing imports for dispatch, dispatch-existing, save-iiko-draft and process-iiko BEFORE any stock write. The GET returns canDispatch:false with clear reason; the UI removes unsafe dispatch controls.
- Previously attempted CHECK_REQUIRED S01 stays locked and cannot be sent again until its actual iiko state is verified by read-only reconciliation.
- Next investigation: vendor-approved iikoChain 9.x API method or a successful real outgoing/incoming invoice pair made in iikoChain and exported using GET, to confirm account/legal entity mapping and native internal shipment linkage.
- v2 internalTransfer is not an automatic substitute for two-invoice transfer between separate enterprises: no switch until accounting-only-in-chain and legal entity configuration are known.
