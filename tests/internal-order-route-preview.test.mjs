import test from "node:test";
import assert from "node:assert/strict";
import {previewConfirmedInternalRoute} from "../functions/api/_lib/internal-order-route-preview.js";
import {shipmentXml} from "../functions/api/_lib/internal-shipment-core.js";

const order={central_department_id:"central",destination_department_id:"rms1",central_store_id:"central-store",destination_store_id:"rms1-store"};
const pair={source_store_id:"central-store",destination_store_id:"rms1-store",outgoing_buyer_id:"rms1-supplier",incoming_supplier_id:"central-supplier",evidence_outgoing_id:"out-1",evidence_incoming_id:"in-1",evidence_outgoing_number:"50001",evidence_incoming_number:"10001",confirmed_at:"2026-10-11"};
const suppliers=[{id:"rms1-supplier",name:"RMS 1 METBEX"},{id:"central-supplier",name:"Mərkəzi Anbar"}];

test("read-only preview chooses mapped supplier instead of destination Store",()=>{
 const r=previewConfirmedInternalRoute(order,pair,suppliers);
 assert.equal(r.valid,true);
 assert.equal(r.outgoing.defaultStoreId,"central-store");
 assert.equal(r.outgoing.counteragentId,"rms1-supplier");
 assert.notEqual(r.outgoing.counteragentId,order.destination_store_id);
 assert.equal(r.expectedIncoming.supplierId,"central-supplier");
 assert.equal(r.readOnly,true);
 assert.equal(r.canDispatch,false);
});
test("no persisted mapping never falls back to a store ID",()=>{
 const r=previewConfirmedInternalRoute(order,null,suppliers);
 assert.equal(r.valid,false);
 assert.equal(r.code,"MAPPING_NOT_CONFIRMED");
 assert.equal(r.canDispatch,false);
});
test("reject mismatched warehouse mapping",()=>{
 const r=previewConfirmedInternalRoute(order,{...pair,destination_store_id:"other-store"},suppliers);
 assert.equal(r.code,"MAPPING_MISMATCH");
});
test("reject stale buyer record",()=>{
 const r=previewConfirmedInternalRoute(order,pair,[suppliers[1]]);
 assert.equal(r.code,"SUPPLIER_NOT_FOUND");
});
test("reject a mapping that substitutes destination Store for supplier",()=>{
 const r=previewConfirmedInternalRoute(order,{...pair,outgoing_buyer_id:"rms1-store"},suppliers);
 assert.equal(r.code,"INVALID_COUNTERPARTY");
});
test("reject missing source or identical RMS departments",()=>{
 const r=previewConfirmedInternalRoute({...order,destination_department_id:"central"},pair,suppliers);
 assert.equal(r.code,"INVALID_WAREHOUSE_PAIR");
});
test("requires evidence of the known linked pair",()=>{
 const r=previewConfirmedInternalRoute(order,{...pair,evidence_incoming_number:""},suppliers);
 assert.equal(r.code,"MISSING_PAIR_EVIDENCE");
});

test("the candidate outgoing XML separates source warehouse from mapped buyer supplier",()=>{
 const candidate=previewConfirmedInternalRoute(order,pair,suppliers);
 assert.equal(candidate.valid,true);
 const xml=shipmentXml({
   id:"dry-run-only",number:"PREVIEW-ONLY",date:"2026-10-11",
   storeId:candidate.outgoing.defaultStoreId,
   counteragentId:candidate.outgoing.counteragentId,
   accountToCode:"",revenueAccountCode:"",
   comment:"TEST ONLY",lines:[{productId:"potato",amount:2,unitPrice:0.6,sumCents:120}],
   status:"NEW"
 });
 assert.match(xml,/<defaultStoreId>central-store<\/defaultStoreId>/);
 assert.match(xml,/<counteragentId>rms1-supplier<\/counteragentId>/);
 assert.doesNotMatch(xml,/<counteragentId>rms1-store<\/counteragentId>/);
});
