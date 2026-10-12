import test from "node:test";
import assert from "node:assert/strict";
import {assessInternalShipmentRoute,UNSUPPORTED_STORE_BUYER_MESSAGE} from "../functions/api/_lib/internal-order-route.js";
const order={central_department_id:"sender-rms",destination_department_id:"recipient-rms",
  central_store_id:"sender-store",destination_store_id:"recipient-store"};
const mapping={source_store_id:"sender-store",destination_store_id:"recipient-store",
  outgoing_buyer_id:"recipient-counterparty",incoming_supplier_id:"sender-counterparty",
  evidence_outgoing_id:"example-out",evidence_incoming_id:"example-in",
  evidence_outgoing_number:"50001",evidence_incoming_number:"10001"};
test("no mapping never permits a stock-affecting route",()=>{
  const r=assessInternalShipmentRoute(order);
  assert.equal(r.supported,false);
  assert.equal(r.code,"ROUTE_MAPPING_REQUIRED");
});
test("confirmed mapping permits a supported shipment without preview-host gating",()=>{
  for(const host of ["smarthoreca.pages.dev","feature-internal-orders-rms.smarthoreca.pages.dev",""]){
    const r=assessInternalShipmentRoute(order,{mapping,host});
    assert.equal(r.supported,true);
    assert.equal(r.code,"CONFIRMED_RMS_ROUTE");
  }
});
test("new verified invoice pairs can authorize a different RMS route",()=>{
  const alternative={...mapping,evidence_outgoing_number:"9855",evidence_incoming_number:"4344"};
  const r=assessInternalShipmentRoute(order,{mapping:alternative});
  assert.equal(r.supported,true);
});
test("unrelated stores or missing authoritative evidence are refused",()=>{
  for(const m of [null,{...mapping,destination_store_id:"wrong"},
    {...mapping,source_store_id:"wrong"},
    {...mapping,outgoing_buyer_id:"recipient-store"},
    {...mapping,incoming_supplier_id:"sender-store"},
    {...mapping,evidence_incoming_id:""},
    {...mapping,evidence_outgoing_number:""}]){
    assert.equal(assessInternalShipmentRoute(order,{mapping:m}).supported,false);
  }
});
test("sender and recipient RMS must be different and have distinct stores",()=>{
  for(const o of [{...order,destination_department_id:"sender-rms"},
    {...order,destination_store_id:"sender-store"},
    {...order,central_department_id:""}]){
    assert.equal(assessInternalShipmentRoute(o,{mapping}).supported,false);
  }
});
test("mapping never confuses iiko buyer counterparty with destination Store ID",()=>{
  assert.match(UNSUPPORTED_STORE_BUYER_MESSAGE,/ID склада RMS/);
  assert.match(UNSUPPORTED_STORE_BUYER_MESSAGE,/контрагента/);
});
