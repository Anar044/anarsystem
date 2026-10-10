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
- Centrally configured sending RMS and warehouse, validated against the corporation's actual RMS warehouse directory.
- Restaurant request: destination RMS/store, delivery date, items and packaging, own document number IO-..., DRAFT.
- SUBMITTED, APPROVED/REJECTED (review reason), PICKING, READY workflow.
- Central warehouse can reduce approved quantities, not increase them.
- Server-side authorization per workspace role and restaurant scope (CHAIN) for requests and central fulfillment.
- Audit events for create, status transitions and central RMS setup.
- Database persists orders in dedicated D1 tables keyed by server_scope.
- No inventory writes or fictitious debt created in D1.

## Intentionally NOT yet implemented / blocked on integration verification
1. Automatic outgoing-invoice document creation/processing in central RMS for cross-legal-entity orders.
2. Verify authoritative Chain-created linked incoming invoice in recipient RMS.
3. Shipment / receipt quantities, partial shipments, mismatch processing, and final status only after live iiko confirmation.
4. Internal prices, electronic tax invoice (e-qaimə), supplier/customer account mapping and settlement between different VÖEN.
5. Production orders, consolidated manufacturing plans, recipes/semifinished products.

**Never mark a real shipment complete based on D1 workflow flags.** Verify outgoing and corresponding incoming through iiko's document APIs and preserve unique document IDs before changing stock-related status.

## Acceptance tests before a production merge
- Use a test central RMS and restaurant RMS with different VÖEN.
- Verify department list / store ownership resolution for at least two restaurants.
- Test requester role cannot see another restaurant; central warehouse only sees its own network orders.
- Verify packaging calculation with a non-unit pack.
- Confirm no changes to stock balances from draft/approval/ready transitions.
- Run node --test tests/internal-orders-core.test.mjs.
