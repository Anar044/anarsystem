import test from "node:test";
import assert from "node:assert/strict";
import {normalizePosAuditEvents}
  from "../functions/api/mobile/v1/cash-order-history.js";

test("POS audit history uses only real event timestamps and sorts oldest first",()=>{
  const events=[
    {eventId:"paid",eventType:"ClosingOrder",receivedAt:"2026-10-16T10:12:00Z",
      data:{paymentTypeName:"Карта"}},
    {eventId:"food",eventType:"AddOrderItem",receivedAt:"2026-10-16T10:02:00Z",
      data:{productName:"Плов",quantity:2}},
    {eventId:"start",eventType:"NewOrder",receivedAt:"2026-10-16T10:00:00Z"}
  ];
  const rows=normalizePosAuditEvents({events},"#23");
  assert.deepEqual(rows.map(x=>x.kind),["ORDER_OPENED","ITEM_ADDED","ORDER_CLOSED"]);
  assert.equal(rows[1].itemName,"Плов");
  assert.equal(rows[1].quantity,2);
});
test("unverified events and other order numbers are never fabricated or shown",()=>{
 const rows=normalizePosAuditEvents({events:[
    {type:"GuestBillPrinted",receivedAt:"2026-10-16T10:04:00Z",orderNum:"777"},
    {type:"GuestBillPrinted",receivedAt:"2026-10-16T10:04:00Z",orderNum:"23"},
    {type:"NewOrder",orderNum:"23"}
 ]},"23");
 assert.equal(rows.length,1);
 assert.equal(rows[0].kind,"PRECHECK_PRINTED");
});
test("discount, surcharge and deleted dish are distinct verified POS events",()=>{
 const source=[
  {type:"AddDiscountSurchargeItem",receivedAt:"2026-10-16T12:00:00Z",
    data:{isDiscount:true}},
  {type:"AddDiscountSurchargeItem",receivedAt:"2026-10-16T12:02:00Z",
    data:{isDiscount:false}},
  {type:"DeletionOfPrintedItem",receivedAt:"2026-10-16T12:03:00Z",
    data:{productName:"Чай"}},
  {type:"OrderGuestsBill",receivedAt:"2026-10-16T12:04:00Z"},
 ];
 const rows=normalizePosAuditEvents({data:{events:source}},"21");
 assert.deepEqual(rows.map(e=>e.kind),[
   "DISCOUNT_APPLIED","SURCHARGE_APPLIED","ITEM_REMOVED","BILL_CREATED"
 ]);
 assert.equal(rows[2].itemName,"Чай");
});
