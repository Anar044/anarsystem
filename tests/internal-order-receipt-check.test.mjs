import test from "node:test";
import assert from "node:assert/strict";
import {validateShipmentOutgoingForReceipt} from "../functions/api/_lib/internal-order-receipt-check.js";
const shipment={
 number:"IO-ABC-S01",iiko_document_id:"out-uid",
 source_store_id:"CENTRAL",counteragent_id:"BUYER-SUPPLIER",
 lines_json:JSON.stringify([{productId:"POTATO",amount:10,unitPrice:0.6,sumCents:600}])
};
const outgoing={id:"out-uid",number:"IO-ABC-S01",status:"PROCESSED",storeId:"CENTRAL",
 counteragentId:"BUYER-SUPPLIER",itemsCount:1,
 items:[{productId:"POTATO",amount:10,price:0.6,sum:6}]};
const check=(s=shipment,o=outgoing)=>validateShipmentOutgoingForReceipt(s,o,"BUYER-SUPPLIER");
test("verified outgoing can be used to search incoming read-only",()=>{
 const result=check();
 assert.equal(result.valid,true);
 assert.equal(result.code,"OUTGOING_VERIFIED");
});
test("the example 50001 cannot be linked to an unrelated Smart Horeca shipment",()=>{
 assert.equal(check(shipment,{...outgoing,number:"50001"}).code,"DOCUMENT_NUMBER_MISMATCH");
});
test("different UUID or status cannot verify an outgoing",()=>{
 assert.equal(check(shipment,{...outgoing,id:"other"}).code,"DOCUMENT_ID_MISMATCH");
 assert.equal(check(shipment,{...outgoing,status:"NEW"}).code,"OUTGOING_NOT_PROCESSED");
});
test("recipient counterparty must be the confirmed internal supplier",()=>{
 assert.equal(check(shipment,{...outgoing,counteragentId:"STORE"}).code,"BUYER_MISMATCH");
 assert.equal(validateShipmentOutgoingForReceipt(shipment,outgoing,"OTHER-BUYER").code,"BUYER_MISMATCH");
});
test("source warehouse, quantity, price and sum all need matching evidence",()=>{
 assert.equal(check(shipment,{...outgoing,storeId:"OTHER"}).code,"SOURCE_STORE_MISMATCH");
 assert.equal(check(shipment,{...outgoing,items:[{productId:"POTATO",amount:11,price:0.6,sum:6.6}]}).code,"QUANTITY_MISMATCH");
 assert.equal(check(shipment,{...outgoing,items:[{productId:"POTATO",amount:10,price:0.8,sum:6}]}).code,"PRICE_MISMATCH");
 assert.equal(check(shipment,{...outgoing,items:[{productId:"POTATO",amount:10,price:0.6,sum:7}]}).code,"SUM_MISMATCH");
});
test("truncated/extra items, broken persisted lines cannot confirm receipt",()=>{
 assert.equal(check(shipment,{...outgoing,itemsCount:31}).code,"LINE_COUNT_MISMATCH");
 assert.equal(check({...shipment,lines_json:"<broken>"},outgoing).code,"INVALID_SHIPMENT_LINES");
});
