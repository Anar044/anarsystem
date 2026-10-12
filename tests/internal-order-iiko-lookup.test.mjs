import test from "node:test";
import assert from "node:assert/strict";
import {findOutgoingInvoices} from "../functions/api/_lib/internal-order-iiko-lookup.js";
import {shipmentXml} from "../functions/api/_lib/internal-shipment-core.js";

const doc='<root><document><id>uuid-123</id><documentNumber>IO-20261011-06E974-S01</documentNumber><status>NEW</status><defaultStoreId>central</defaultStoreId><counteragentId>rms-kitchen</counteragentId><items><item><productId>P1</productId><storeId>central</storeId><amount>5</amount><price>1.500000</price><sum>7.50</sum></item></items></document></root>';
test("fallback to regular iiko export when /byNumber returns HTTP 500",async()=>{
 const paths=[];
 const r=await findOutgoingInvoices({},"IO-20261011-06E974-S01","2026-10-11",{request:async(_c,path)=>{
   paths.push(path);
   if(path.includes("byNumber"))return {ok:false,status:500,text:"Internal Server Error"};
   return {ok:true,status:200,text:doc};
 }});
 assert.equal(paths.length,2);
 assert.equal(r.checked,true);
 assert.equal(r.documents.length,1);
 assert.equal(r.documents[0].status,"NEW");
});
test("only failed iiko responses cannot prove document absence",async()=>{
 const r=await findOutgoingInvoices({},"IO-20261011-06E974-S01","2026-10-11",{request:async()=>({ok:false,status:500,text:""})});
 assert.equal(r.checked,false);
 assert.equal(r.documents.length,0);
});
test("document is absent only when regular export succeeds and finds nothing",async()=>{
 const r=await findOutgoingInvoices({},"IO-20261011-06E974-S01","2026-10-11",{request:async(_c,path)=>({ok:!path.includes("byNumber"),status:200,text:"<root></root>"})});
 assert.equal(r.checked,true);
 assert.equal(r.documents.length,0);
});
test("posted XML uses PROCESSED only on explicit action",()=>{
 const payload={id:"doc",number:"IO-20261011-06E974-S01",date:"2026-10-11",storeId:"central",counteragentId:"rms-kitchen",
 lines:[{productId:"P1",amount:5,unitPrice:1.5,sumCents:750}]};
 const draft=shipmentXml(payload),posted=shipmentXml({...payload,status:"PROCESSED"});
 assert.match(draft,/<status>NEW<\/status>/);
 assert.match(posted,/<status>PROCESSED<\/status>/);
 assert.equal(draft.match(/<id>doc<\/id>/)?.[0],posted.match(/<id>doc<\/id>/)?.[0]);
 assert.throws(()=>shipmentXml({...payload,status:"WHATEVER"}),/Недопустимый/);
});
