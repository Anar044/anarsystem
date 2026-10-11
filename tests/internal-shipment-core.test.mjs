import test from "node:test";
import assert from "node:assert/strict";
import {prepareInternalShipment,shipmentXml,parseIikoValidation} from "../functions/api/_lib/internal-shipment-core.js";
import {warehouseCostRows,costQuote} from "../functions/api/_lib/internal-shipment-cost.js";

const approved=[{productId:"A",productName:"Pomidor çəhrayı",unit:"кг",quantity:5},{productId:"B",productName:"Xiyar patron",unit:"кг",quantity:3}];
const quotes=[{productId:"A",verified:true,available:10,unitCost:1.13},{productId:"B",verified:true,available:10,unitCost:2.9}];
const shipment=(items,existing=[],q=quotes)=>prepareInternalShipment(approved,existing,items,q);
test("prices come exclusively from warehouse iiko quotes, never from browser",()=>{
  const r=shipment([{productId:"A",amount:5,unitPrice:99999},{productId:"B",amount:3,unitPrice:0}]);
  assert.equal(r.totalCents,1435);
  assert.equal(r.lines[0].sumCents,565);
  assert.equal(r.lines[0].unitPrice,1.13);
  assert.equal(r.lines[1].sumCents,870);
});
test("partial shipments cannot reserve more than approved",()=>{
 const first=shipment([{productId:"A",amount:2}]);
 const second=shipment([{productId:"A",amount:3}],[{status:"PREPARED",lines:first.lines}]);
 assert.equal(second.lines[0].amount,3);
 assert.throws(()=>shipment([{productId:"A",amount:4}],[{status:"DRAFT_SAVED",lines:first.lines}]),/превышает/);
});
test("cancelled reservations are excluded",()=>{
 const first=shipment([{productId:"A",amount:5}]);
 assert.equal(shipment([{productId:"A",amount:5}],[{status:"CANCELLED",lines:first.lines}]).totalCents,565);
});
test("reject unknown, zero-cost, missing iiko cost, insufficient stock and bad precision",()=>{
 assert.throws(()=>shipment([{productId:"extra",amount:1}]),/не согласован/);
 assert.throws(()=>shipment([{productId:"A",amount:1}],[],[{productId:"A",verified:true,available:5,unitCost:0}]),/себестоимость/);
 assert.throws(()=>shipment([{productId:"A",amount:1}],[],[]),/себестоимость/);
 assert.throws(()=>shipment([{productId:"A",amount:3}],[],[{productId:"A",verified:true,available:2,unitCost:1.13}]),/Недостаточный/);
 assert.throws(()=>shipment([{productId:"A",amount:1.0001}]),/точность/);
});
test("iiko outgoing XML must target receiving warehouse and use its source warehouse's cost",()=>{
 const r=shipment([{productId:"A",amount:5}]);
 const x=shipmentXml({id:"unique-uuid",number:"IO-1-S01",date:"2026-10-11",storeId:"central-store",counteragentId:"rms1-kitchen-store",comment:"Smart Horeca",lines:r.lines});
 assert.match(x,/<id>unique-uuid<\/id>/);
 assert.match(x,/<counteragentId>rms1-kitchen-store<\/counteragentId>/);
 assert.match(x,/<defaultStoreId>central-store<\/defaultStoreId>/);
 assert.match(x,/<price>1\.130000<\/price>/);
 assert.match(x,/<sum>5\.65<\/sum>/);
 assert.match(x,/<amount>5<\/amount>/);
 assert.match(x,/<status>NEW<\/status>/);
 assert.doesNotMatch(x,/<status>PROCESSED<\/status>/);
});
test("iiko XML escapes text values",()=>{
 const r=shipment([{productId:"A",amount:1}]);
 const x=shipmentXml({id:"id",number:"N",date:"2026-10-11",storeId:"S",counteragentId:"C",comment:"A & B <test>",lines:r.lines});
 assert.match(x,/A &amp; B &lt;test&gt;/);
});
test("parse iiko server validation",()=>{
 assert.equal(parseIikoValidation("<result><valid>true</valid><documentNumber>INV-01</documentNumber></result>").documentNumber,"INV-01");
 assert.equal(parseIikoValidation("<result><valid>false</valid><errorMessage>Problem</errorMessage></result>").valid,"false");
});
test("warehouse report valuation is scoped to source store, not same product in another RMS",()=>{
 const payload={rows:[
   {store:"central",product:"A",amount:10,sum:30},
   {store:"restaurant",product:"A",amount:10,sum:400},
   {store:"central",product:"B",amount:3,sum:15},
   {store:"central",product:"C",amount:10,sum:100}
 ]};
 const rows=warehouseCostRows(payload,"central",["A","B"]);
 assert.deepEqual(rows.map(x=>x.productId).sort(),["a","b"]);
 assert.equal(rows.find(x=>x.productId==="a").unitCost,3);
 const q=costQuote(approved,rows,"2026-10-11");
 assert.equal(q[0].unitCost,3);
 assert.equal(q[0].available,10);
 assert.equal(q[1].unitCost,5);
});
test("invalid missing cost must not be silently replaced by zero",()=>{
 const payload={data:[{storeId:"central",productId:"A",amount:10},{storeId:"restaurant",productId:"B",amount:20,sum:100}]};
 const rows=warehouseCostRows(payload,"central",["A","B"]);
 assert.equal(rows.length,0);
 const q=costQuote(approved,rows,"2026-10-11");
 assert.equal(q[0].verified,false);
 assert.equal(q[0].unitCost,null);
});
