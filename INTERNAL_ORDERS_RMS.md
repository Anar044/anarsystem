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
- For separate legal entities, the sender enters the iiko counteragent ID of the **recipient company** and a positive sale price per base unit. No implicit markup or VAT assumptions.
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
4. Automatic internal prices, electronic tax invoice (e-qaimə), verified counterparty mapping to legal persons, VAT, payment and balances between different VÖEN. Manually entered per-line sale prices and iiko counteragent identifiers are implemented for outgoing drafts.
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
