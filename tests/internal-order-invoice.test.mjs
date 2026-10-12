import test from "node:test";
import assert from "node:assert/strict";
import {parseOutgoingForVerification,inspectOutgoingForOrder} from "../functions/api/_lib/internal-order-invoice.js";

const outgoing=(rows=[{id:"P1",amount:5},{id:"P2",amount:3}],options={})=>{
  const i=rows.map(r=>'<item><productId>'+r.id+'</productId><storeId>'+(r.store||"s-central")+'</storeId><amount>'+r.amount+'</amount></item>').join("");
  return '<documents><document><id>doc-01</id><documentNumber>'+(options.number||"OUT-001")+'</documentNumber><status>'+(options.status||"PROCESSED")+'</status><defaultStoreId>'+(options.store||"s-central")+'</defaultStoreId><counteragentId>destination-account</counteragentId><items>'+i+'</items></document></documents>';
};
const order={sourceStoreId:"s-central",approvedLines:[{productId:"P1",quantity:5},{productId:"P2",quantity:3}]};
const inspect=xml=>inspectOutgoingForOrder(order,parseOutgoingForVerification(xml),"OUT-001");

test("parse official iiko outgoingInvoice export XML and quantities",()=>{
  const parsed=parseOutgoingForVerification(outgoing());
  assert.equal(parsed.length,1);
  assert.equal(parsed[0].counteragentId,"destination-account");
  assert.equal(parsed[0].items[0].amount,5);
  assert.equal(parsed[0].storeId,"s-central");
});
test("matching processed outgoing does not imply confirmed receiving",()=>{
  const result=inspect(outgoing());
  assert.equal(result.valid,true);
  assert.equal(result.processed,true);
  assert.equal(result.partial,false);
  assert.equal(result.quantityMatched,true);
  assert.equal(result.counteragentId,"destination-account");
});
test("partial processed shipments are allowed for inspection only",()=>{
  const result=inspect(outgoing([{id:"P1",amount:2}]));
  assert.equal(result.valid,true);
  assert.equal(result.partial,true);
  assert.equal(result.processed,true);
  assert.equal(result.items[0].documentQty,2);
  assert.equal(result.items[1].documentQty,0);
});
test("unprocessed invoice cannot prove stock movement",()=>{
  const result=inspect(outgoing(undefined,{status:"NEW"}));
  assert.equal(result.valid,true);
  assert.equal(result.processed,false);
});
test("reject outgoing from a different RMS warehouse",()=>{
  assert.equal(inspect(outgoing(undefined,{store:"restaurant-warehouse"})).valid,false);
  assert.equal(inspect(outgoing([{id:"P1",store:"restaurant-warehouse",amount:5}])).valid,false);
});
test("reject extra products and over-shipping",()=>{
  assert.equal(inspect(outgoing([{id:"P1",amount:6},{id:"P2",amount:3}])).valid,false);
  assert.equal(inspect(outgoing([{id:"P1",amount:5},{id:"P2",amount:3},{id:"X",amount:1}])).valid,false);
});
test("reject ambiguous or wrong invoice numbers",()=>{
  const found=parseOutgoingForVerification(outgoing());
  assert.equal(inspectOutgoingForOrder(order,found,"WRONG").valid,false);
  assert.equal(inspectOutgoingForOrder(order,[...found,...found],"OUT-001").valid,false);
});
