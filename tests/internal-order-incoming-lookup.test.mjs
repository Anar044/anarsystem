import test from "node:test";
import assert from "node:assert/strict";
import {classifyLinkedIncoming,findLinkedIncomingInvoices} from "../functions/api/_lib/internal-order-incoming-lookup.js";
const outgoing={id:"OUT-GUID",number:"50001",date:"2026-10-11",storeId:"CENTRAL",
  itemsCount:1,items:[{productId:"KARTOF",amount:10}]};
const matched={id:"IN-GUID",number:"10001",status:"NEW",storeId:"RMS1",supplierId:"CENTRAL-SUPPLIER",
  linkedOutgoingInvoiceId:"OUT-GUID",incomingDocumentNumber:"50001",
  itemsCount:1,items:[{productId:"KARTOF",amount:10}]};
const opts={recipientStoreId:"RMS1",supplierId:"CENTRAL-SUPPLIER"};
test("find linked incoming only by exact outgoing UUID and validate quantities",()=>{
 const result=classifyLinkedIncoming(outgoing,[matched],opts);
 assert.equal(result.confirmed,true);assert.equal(result.receiptPosted,false);
 assert.equal(result.incoming.number,"10001");
});
test("a matching invoice number alone is not proof of a link",()=>{
 const result=classifyLinkedIncoming(outgoing,[{...matched,linkedOutgoingInvoiceId:""}],opts);
 assert.equal(result.confirmed,false);assert.equal(result.code,"LINK_ID_UNCONFIRMED");
});
test("wrong RMS store and wrong supplier fail closed",()=>{
 assert.equal(classifyLinkedIncoming(outgoing,[{...matched,storeId:"OTHER"}],opts).code,"WRONG_RECIPIENT_STORE");
 assert.equal(classifyLinkedIncoming(outgoing,[{...matched,supplierId:"OTHER"}],opts).code,"WRONG_INCOMING_SUPPLIER");
});
test("a mismatch between items is not received",()=>{
 const result=classifyLinkedIncoming(outgoing,[{...matched,items:[{productId:"KARTOF",amount:9}]}],opts);
 assert.equal(result.confirmed,false);assert.equal(result.code,"LINE_ITEMS_MISMATCH");
});
test("multiple linked incoming documents are ambiguous, never mark receipt",()=>{
 const result=classifyLinkedIncoming(outgoing,[matched,{...matched,id:"SECOND"}],opts);
 assert.equal(result.confirmed,false);assert.equal(result.code,"MULTIPLE_LINKED_INCOMING");
});
test("a posted linked incoming can be recognized without issuing a POST",()=>{
 const result=classifyLinkedIncoming(outgoing,[{...matched,status:"PROCESSED"}],opts);
 assert.equal(result.confirmed,true);assert.equal(result.receiptPosted,true);
});
test("read-only API discovery uses incoming export and never performs remote writes",async()=>{
 const requestCalls=[];
 const request=async (_connection,path,options)=>{
   requestCalls.push({path,options});
   return {ok:true,status:200,text:
    '<documents><document><id>IN-GUID</id><documentNumber>10001</documentNumber>'+
    '<status>NEW</status><defaultStoreId>RMS1</defaultStoreId><supplier>CENTRAL-SUPPLIER</supplier>'+
    '<linkedOutgoingInvoiceId>OUT-GUID</linkedOutgoingInvoiceId><incomingDocumentNumber>50001</incomingDocumentNumber>'+
    '<items><item><productId>KARTOF</productId><amount>10</amount></item></items></document></documents>'};
 };
 const result=await findLinkedIncomingInvoices({},outgoing,{...opts,request});
 assert.equal(result.confirmed,true);
 assert.equal(result.readOnly,true);
 assert.equal(result.stockOperation,false);
 assert.equal(requestCalls.length,1);
 assert.ok(requestCalls.every(x=>x.path.includes("/documents/export/incomingInvoice")&&!x.options.method));
});
test("a server export error never claims an incoming invoice is absent",async()=>{
 const result=await findLinkedIncomingInvoices({},outgoing,{request:async()=>({ok:false,status:500,text:"error"})});
 assert.equal(result.code,"INCOMING_EXPORT_UNAVAILABLE");
 assert.equal(result.confirmed,false);
});
