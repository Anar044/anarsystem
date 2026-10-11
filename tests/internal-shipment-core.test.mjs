import test from "node:test";
import assert from "node:assert/strict";
import {prepareInternalShipment,shipmentXml,parseIikoValidation} from "../functions/api/_lib/internal-shipment-core.js";

const a=[{productId:"a",productName:"Pomidor çəhrayı",unit:"кг",quantity:5},{productId:"b",productName:"Xiyar patron",unit:"кг",quantity:3}];
test("prepare full shipment with exact AZN and iiko unit quantities",()=>{
 const r=prepareInternalShipment(a,[],[{productId:"a",amount:5,unitPrice:1.13},{productId:"b",amount:3,unitPrice:2.9}]);
 assert.equal(r.totalCents,1435);assert.equal(r.lines[0].sumCents,565);assert.equal(r.lines[1].sumCents,870);
});
test("partial shipments do not exceed order even across multiple outgoing documents",()=>{
 const first=prepareInternalShipment(a,[],[{productId:"a",amount:2,unitPrice:4.5}]);
 assert.equal(first.lines[0].amount,2);
 const second=prepareInternalShipment(a,[{status:"PREPARED",lines:first.lines}],[{productId:"a",amount:3,unitPrice:4.5}]);
 assert.equal(second.lines[0].amount,3);
 assert.throws(()=>prepareInternalShipment(a,[{status:"DRAFT_SAVED",lines:first.lines}],[{productId:"a",amount:4,unitPrice:4.5}]),/превышает/);
});
test("cancelled shipments release reserved quantities",()=>{
 const first=prepareInternalShipment(a,[],[{productId:"a",amount:5,unitPrice:3}]);
 assert.equal(prepareInternalShipment(a,[{status:"CANCELLED",lines:first.lines}],[{productId:"a",amount:5,unitPrice:3}]).totalCents,1500);
});
test("invalid products, negative and zero price, wrong precision rejected",()=>{
 assert.throws(()=>prepareInternalShipment(a,[],[{productId:"extra",amount:1,unitPrice:1}]),/не согласован/);
 assert.throws(()=>prepareInternalShipment(a,[],[{productId:"a",amount:1,unitPrice:0}]),/положительную/);
 assert.throws(()=>prepareInternalShipment(a,[],[{productId:"a",amount:1.0001,unitPrice:1}]),/точность/);
 assert.throws(()=>prepareInternalShipment(a,[],[{productId:"a",amount:1,unitPrice:1.001}]),/точностью/);
});
test("correct outgoing invoice XML uses unique document ID, counteragent, warehouse, and sale price",()=>{
 const r=prepareInternalShipment(a,[],[{productId:"a",amount:5,unitPrice:1.13}]);
 const x=shipmentXml({id:"uuid-1",number:"IO-1-S01",date:"2026-10-11",storeId:"source-store",counteragentId:"receiver-entity",comment:"Smart Horeca",lines:r.lines});
 assert.match(x,/<id>uuid-1<\/id>/);
 assert.match(x,/<counteragentId>receiver-entity<\/counteragentId>/);
 assert.match(x,/<defaultStoreId>source-store<\/defaultStoreId>/);
 assert.match(x,/<price>1.13<\/price>/);
 assert.match(x,/<sum>5.65<\/sum>/);
 assert.match(x,/<amount>5<\/amount>/);
 assert.doesNotMatch(x,/<status>PROCESSED<\/status>/);
});
test("safe XML escaping prevents contamination",()=>{
 const r=prepareInternalShipment(a,[],[{productId:"a",amount:1,unitPrice:1}]);
 const x=shipmentXml({id:"id",number:"N",date:"2026-10-11",storeId:"S",counteragentId:"C",comment:"A & B <test>",lines:r.lines});
 assert.match(x,/A &amp; B &lt;test&gt;/);
});
test("read real iiko validation result",()=>{
 assert.equal(parseIikoValidation("<result><valid>true</valid><documentNumber>INV-01</documentNumber></result>").documentNumber,"INV-01");
 assert.equal(parseIikoValidation("<result><valid>false</valid><errorMessage>Problem</errorMessage></result>").valid,"false");
});
