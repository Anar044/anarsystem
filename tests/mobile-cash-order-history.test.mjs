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
   "DISCOUNT_APPLIED","SURCHARGE_APPLIED","ITEM_REMOVED","PRECHECK_PRINTED"
 ]);
 assert.equal(rows[2].itemName,"Чай");
});

test("all seven real legacy plugin event names have explicit Russian labels",()=>{
  const time="2026-10-19T12:00:00Z";
  const input=[
    ["deletionOfNotPrintedItem","ITEM_REMOVED","Удалено нераспечатанное блюдо"],
    ["deletionOfPrintedItem","ITEM_REMOVED","Удалено распечатанное блюдо"],
    ["orderGuestBill","PRECHECK_PRINTED","Распечатан пречек"],
    ["cancellationOfGuestBill","PRECHECK_CANCELLED","Отменён пречек"],
    ["orderInTheStatusOfTheBillForALongTime","PRECHECK_OVERDUE",
      "Заказ долго находится в статусе «Пречек»"],
    ["addingDiscount","DISCOUNT_APPLIED","Добавлена скидка"],
    ["addingSurcharge","SURCHARGE_APPLIED","Добавлена надбавка"],
    ["voidReceipt","RECEIPT_STORNO","Чек сторнирован (возврат)"],
    ["closingOrder","ORDER_CLOSED","Заказ закрыт"]
  ];
  const rows=normalizePosAuditEvents({history:input.map(([pluginEventType],i)=>({
    uuid:"event"+i,pluginEventType,receivedAt:time,
    data:{orderNum:45,name:"Endirim 10%"}
  }))},"45");
  assert.deepEqual(rows.map(x=>[x.kind,x.label]),input.map(([,kind,label])=>[kind,label]));
});
test("printed-item removal preserves the confirmed write-off reason and comment",()=>{
  const rows=normalizePosAuditEvents({history:[
    {uuid:"r1",pluginEventType:"deletionOfPrintedItem",
      receivedAt:"2026-10-19T12:00:00Z",
      data:{orderNum:45,productName:"Стейк",reasonWriteOff:"Порча",
        reasonComment:"Передержан"}},
    {uuid:"r2",pluginEventType:"deletionOfPrintedItem",
      receivedAt:"2026-10-19T12:01:00Z",
      data:{orderNum:45,productName:"Плов",isWriteOff:false}},
    {uuid:"r3",pluginEventType:"deletionOfPrintedItem",
      receivedAt:"2026-10-19T12:02:00Z",
      data:{orderNum:45,productName:"Вода"}},
  ]},"45");
  assert.equal(rows[0].writeOffStatus,"WITH_WRITE_OFF");
  assert.equal(rows[0].writeOffReason,"Порча");
  assert.equal(rows[0].writeOffComment,"Передержан");
  assert.equal(rows[1].writeOffStatus,"WITHOUT_WRITE_OFF");
  assert.equal(rows[2].writeOffStatus,"UNKNOWN");
  assert.equal(rows[2].writeOffLabel,"Касса не передала тип списания");
});
test("raw English names are not visible; first addition has a separate name",()=>{
  const rows=normalizePosAuditEvents({events:[
    {uuid:"e1",pluginEventType:"addingDiscount",receivedAt:"2026-10-19T12:00:00Z",
      data:{orderNum:45,name:"Endirim 10%",valuePercent:10}},
    {uuid:"e2",pluginEventType:"addingSurcharge",receivedAt:"2026-10-19T12:01:00Z",
      data:{orderNum:45,name:"Servis 5%",valuePercent:5}},
    {uuid:"e3",pluginEventType:"customUnknownEnglishEvent",
      receivedAt:"2026-10-19T12:02:00Z",data:{orderNum:45}}
  ]},"45");
  assert.equal(rows[0].label,"Добавлена скидка");
  assert.equal(rows[0].adjustmentName,"Endirim 10%");
  assert.equal(rows[0].percent,10);
  assert.equal(rows[0].itemName,undefined);
  assert.equal(rows[1].label,"Добавлена надбавка");
  assert.equal(rows[2].label,"Другое событие заказа");
  assert.equal(rows[2].rawType,"customUnknownEnglishEvent");
});
test("previous confirmed audit entries are not overwritten by duplicated UUID events",()=>{
  const rows=normalizePosAuditEvents({history:[
    {uuid:"immutable-1",pluginEventType:"newOrder",receivedAt:"2026-10-19T11:00:00Z",
      data:{orderNum:45}},
    {uuid:"immutable-2",pluginEventType:"addingDiscount",receivedAt:"2026-10-19T11:01:00Z",
      data:{orderNum:45}},
    {uuid:"immutable-2",pluginEventType:"addingDiscount",receivedAt:"2026-10-19T11:01:00Z",
      data:{orderNum:45}},
    {uuid:"immutable-3",pluginEventType:"voidReceipt",receivedAt:"2026-10-19T12:00:00Z",
      data:{orderNum:45}},
  ]},"45");
  assert.deepEqual(rows.map(x=>x.id),[
    "immutable-1","immutable-2","immutable-3"
  ]);
  assert.equal(rows[0].label,"Заказ открыт");
  assert.equal(rows.at(-1).label,"Чек сторнирован (возврат)");
});
test("confirmed change of payment is retained, without fabricating absent events",()=>{
  const rows=normalizePosAuditEvents({history:[
    {uuid:"new",pluginEventType:"newOrder",receivedAt:"2026-10-19T11:00:00Z",
      data:{orderNum:45}},
    {uuid:"closed",pluginEventType:"closingOrder",receivedAt:"2026-10-19T11:10:00Z",
      data:{orderNum:45}},
    {uuid:"payment",pluginEventType:"paymentTypeChanged",receivedAt:"2026-10-19T11:12:00Z",
      data:{orderNum:45,paymentTypeName:"Карта"}}
  ]},"45");
  assert.deepEqual(rows.map(x=>x.kind),["ORDER_OPENED","ORDER_CLOSED","PAYMENT_CHANGED"]);
  assert.equal(rows[2].paymentType,"Карта");
  assert.equal(normalizePosAuditEvents({history:[]},"45").length,0);
});
test("storno explicitly linked to an original order keeps the old audit, unrelated events excluded",()=>{
  const rows=normalizePosAuditEvents({events:[
    {uuid:"start",pluginEventType:"newOrder",receivedAt:"2026-10-19T11:00:00Z",
      data:{orderNum:45}},
    {uuid:"storno",pluginEventType:"voidReceipt",receivedAt:"2026-10-19T11:15:00Z",
      data:{orderNum:55,originalOrderNum:45}},
    {uuid:"unrelated",pluginEventType:"voidReceipt",
      receivedAt:"2026-10-19T11:16:00Z",
      data:{orderNum:56}}
  ]},"45");
  assert.equal(rows.length,2);
  assert.equal(rows[1].linkedOrderNum,"55");
});
