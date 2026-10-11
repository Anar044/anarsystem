import test from "node:test";
import assert from "node:assert/strict";
import {buildInternalDispatchPreview} from "../functions/api/_lib/internal-order-dispatch-preview.js";
const route={valid:true,outgoing:{defaultStoreId:"central-store",counteragentId:"rms1-buyer",counteragentName:"RMS 1"},
expectedIncoming:{recipientStoreId:"rms1-store",supplierId:"central-supplier",supplierName:"Mərkəzi Anbar"}};
const args={status:"READY",route,documentDate:"2026-10-11",approved:[{productId:"potato",productName:"Kartof",unit:"kg",quantity:10}],
existing:[],requested:[{productId:"potato",amount:1}],costQuotes:[{productId:"potato",unitCost:0.6,available:10,verified:true,costTimestamp:"2026-10-11T23:59:59"}]};
test("preview is safe and based on sender's verified cost",()=>{
 const v=buildInternalDispatchPreview(args);
 assert.equal(v.valid,true);assert.equal(v.readOnly,true);assert.equal(v.canDispatch,false);
 assert.equal(v.stockOperation,false);assert.equal(v.totalAZN,0.6);
 assert.equal(v.quantityLines[0].quantity,1);assert.equal(v.quantityLines[0].unitCost,0.6);
 assert.equal(v.buyerId,"rms1-buyer");assert.equal(v.recipientStoreId,"rms1-store");
});
test("unconfirmed routes cannot be previewed",()=>{
 const v=buildInternalDispatchPreview({...args,route:{valid:false}});
 assert.equal(v.valid,false);assert.equal(v.canDispatch,false);
});
test("never permit new preview when earlier shipment might have reached iiko",()=>{
 for(const status of ["CHECK_REQUIRED","PROCESSING","IMPORTING"]){
  const v=buildInternalDispatchPreview({...args,existing:[{status,lines:[]}]});
  assert.equal(v.code,"PREVIOUS_SHIPMENT_UNCERTAIN");
 }
});
test("already reserved quantity cannot be offered again",()=>{
 const v=buildInternalDispatchPreview({...args,existing:[{status:"IIKO_PROCESSED",lines:[{productId:"potato",amount:10}]}]});
 assert.equal(v.valid,false);assert.equal(v.code,"COST_OR_QUANTITY_INVALID");
});
test("missing stock, cost, or order approval is blocked",()=>{
 assert.equal(buildInternalDispatchPreview({...args,status:"APPROVED"}).code,"ORDER_NOT_READY");
 assert.equal(buildInternalDispatchPreview({...args,costQuotes:[]}).valid,false);
 assert.equal(buildInternalDispatchPreview({...args,requested:[{productId:"potato",amount:11}]}).valid,false);
});
