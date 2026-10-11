import test from "node:test";
import assert from "node:assert/strict";
import {assessInternalShipmentRoute,UNSUPPORTED_STORE_BUYER_MESSAGE} from "../functions/api/_lib/internal-order-route.js";
const order={central_department_id:"central-rms",destination_department_id:"rms1",
 central_store_id:"central-store",destination_store_id:"rms1-store"};
const mapping={source_store_id:"central-store",destination_store_id:"rms1-store",
 outgoing_buyer_id:"rms1-supplier",incoming_supplier_id:"central-supplier",
 evidence_outgoing_id:"uuid-out",evidence_incoming_id:"uuid-in",
 evidence_outgoing_number:"50001",evidence_incoming_number:"10001"};
const host="feature-internal-orders-rms.smarthoreca.pages.dev";
test("cross-RMS route is not enabled merely by supplying an RMS destination",()=>{
 const r=assessInternalShipmentRoute(order);
 assert.equal(r.supported,false);
 assert.equal(r.code,"TEST_PREVIEW_ONLY");
});
test("main deployment or other hosts can never invoke this test stock write",()=>{
 for(const site of ["smarthoreca.pages.dev","anarsystem.pages.dev","feature-internal-orders-rms.anarsystem.pages.dev",""]){
  const r=assessInternalShipmentRoute(order,{host:site,mapping});
  assert.equal(r.supported,false);
  assert.equal(r.code,"TEST_PREVIEW_ONLY");
 }
});
test("only exact confirmed 50001-10001 pair enables the test invoice importer",()=>{
 const r=assessInternalShipmentRoute(order,{host,mapping});
 assert.equal(r.supported,true);assert.equal(r.testOnly,true);
 assert.equal(r.code,"CONFIRMED_TEST_ROUTE");
});
test("unmapped or wrong RMS or unverified reference pair fails closed",()=>{
 const candidates=[null,{...mapping,destination_store_id:"other"},
   {...mapping,evidence_incoming_number:"10002"},
   {...mapping,outgoing_buyer_id:"rms1-store"},
   {...mapping,incoming_supplier_id:"central-store"},
   {...mapping,evidence_outgoing_id:""}];
 for(const m of candidates){
  const r=assessInternalShipmentRoute(order,{host,mapping:m});
  assert.equal(r.supported,false);assert.equal(r.code,"TEST_ROUTE_NOT_CONFIRMED");
 }
});
test("same RMS and undefined source are still forbidden",()=>{
 for(const o of [{...order,destination_department_id:"central-rms"},{...order,central_department_id:""}]){
  assert.equal(assessInternalShipmentRoute(o,{host,mapping}).supported,false);
 }
});
test("legacy invalid warehouse as User message still describes previous attempt",()=>{
 assert.match(UNSUPPORTED_STORE_BUYER_MESSAGE,/Store/);
 assert.match(UNSUPPORTED_STORE_BUYER_MESSAGE,/связанной приходной/);
});
