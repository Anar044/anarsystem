import test from "node:test";
import assert from "node:assert/strict";
import {extractIikoInvoiceSummaries,compareIikoInvoicePair,identifyIikoPairCounteragents} from "../functions/api/_lib/internal-order-pair-probe.js";
const outgoing='<root><document><id>OUT-ID</id><documentNumber>50001</documentNumber><status>PROCESSED</status><defaultStoreId>central-store</defaultStoreId><counteragentId>buyer-user-or-store-id</counteragentId><counteragentCode>RMS1</counteragentCode><items><item><productId>KARTOF</productId><amount>10</amount><price>0.6</price><sum>6</sum></item><item><productId>XIYAR</productId><amount>5</amount><price>1.3</price><sum>6.5</sum></item><item><productId>YUMURTA</productId><amount>30</amount><price>0.17</price><sum>5.1</sum></item></items></document></root>';
const incoming='<root><document><id>IN-ID</id><documentNumber>10001</documentNumber><status>PROCESSED</status><defaultStore>rms1-kitchen</defaultStore><supplier>central-supplier</supplier><incomingDocumentNumber>50001</incomingDocumentNumber><linkedOutgoingInvoiceId>OUT-ID</linkedOutgoingInvoiceId><items><item><product>KARTOF</product><amount>10</amount><price>0.6</price><sum>6</sum></item><item><product>XIYAR</product><amount>5</amount><price>1.3</price><sum>6.5</sum></item><item><product>YUMURTA</product><amount>30</amount><price>0.17</price><sum>5.1</sum></item></items></document></root>';
test("parse real pair format including outgoing buyer ID and incoming supplier ID",()=>{
 const o=extractIikoInvoiceSummaries(outgoing,"outgoing");
 const i=extractIikoInvoiceSummaries(incoming,"incoming");
 assert.equal(o.length,1);assert.equal(i.length,1);
 assert.equal(o[0].number,"50001");assert.equal(i[0].number,"10001");
 assert.equal(o[0].counteragentId,"buyer-user-or-store-id");
 assert.equal(i[0].supplierId,"central-supplier");
 assert.equal(i[0].incomingDocumentNumber,"50001");
});
test("linked incoming and outgoing can be compared without changing stock",()=>{
 const result=compareIikoInvoicePair(extractIikoInvoiceSummaries(outgoing,"outgoing")[0],extractIikoInvoiceSummaries(incoming,"incoming")[0]);
 assert.equal(result.linkConfirmed,true);assert.equal(result.productsMatch,true);assert.equal(result.noStockOperation,true);
});
test("do not invent a connection if source XML omits reference fields",()=>{
 const i=extractIikoInvoiceSummaries(incoming.replace('<incomingDocumentNumber>50001</incomingDocumentNumber>','').replace('<linkedOutgoingInvoiceId>OUT-ID</linkedOutgoingInvoiceId>',''),"incoming")[0];
 const o=extractIikoInvoiceSummaries(outgoing,"outgoing")[0];
 assert.equal(compareIikoInvoicePair(o,i).linkConfirmed,false);
});
test("wrong products cannot be declared matching even when numbers link",()=>{
 const changed=incoming.replace('<product>XIYAR</product>','<product>OTHER</product>');
 const i=extractIikoInvoiceSummaries(changed,"incoming")[0];
 const o=extractIikoInvoiceSummaries(outgoing,"outgoing")[0];
 assert.equal(compareIikoInvoicePair(o,i).productsMatch,false);
});

test("real paired outgoing buyer is resolved by supplier reference ID, not receiving warehouse ID",()=>{
 const o=extractIikoInvoiceSummaries(outgoing,"outgoing")[0];
 const i=extractIikoInvoiceSummaries(incoming,"incoming")[0];
 const refs=[
   {id:"buyer-user-or-store-id",name:"RMS 1 METBEX",code:"RMS1"},
   {id:"central-supplier",name:"Mərkəzi Anbar",code:"CENTRAL"}
 ];
 const result=identifyIikoPairCounteragents(o,i,refs);
 assert.equal(result.outgoingBuyerSupplier?.name,"RMS 1 METBEX");
 assert.equal(result.incomingSupplierRecord?.name,"Mərkəzi Anbar");
 assert.equal(result.outgoingBuyerIsDestinationStore,false);
 assert.equal(result.incomingSupplierIsSenderStore,false);
});
test("unknown buyer cannot be silently replaced by a warehouse",()=>{
 const o=extractIikoInvoiceSummaries(outgoing,"outgoing")[0];
 const i=extractIikoInvoiceSummaries(incoming,"incoming")[0];
 const result=identifyIikoPairCounteragents(o,i,[]);
 assert.equal(result.outgoingBuyerSupplier,null);
 assert.equal(result.supplierDirectoryMatchedOutgoingBuyer,false);
 assert.equal(result.outgoingBuyerIsDestinationStore,false);
});
