import test from "node:test";
import assert from "node:assert/strict";
import { classifyPosAlert,posAlertDetails,ALERT_KINDS }
  from "../functions/api/mobile/_lib/pos-alerts.js";
import { validPushKinds,deviceIdForToken }
  from "../functions/api/mobile/_lib/push-devices.js";
test("only explicit discount apply and remove events produce alerts",()=>{
 assert.equal(classifyPosAlert("AddDiscountSurchargeItem",{isDiscount:true}).kind,"DISCOUNT_APPLIED");
 assert.equal(classifyPosAlert("AddDiscountSurchargeItem",{isDiscount:false}),null);
 assert.equal(classifyPosAlert("RemovingDiscount",{}).kind,"DISCOUNT_REMOVED");
 assert.equal(classifyPosAlert("ClosingOrder",{}),null);
});
test("precheck cancellation and receipt storno are separate from printing",()=>{
 assert.equal(classifyPosAlert("CancelGuestBill",{}).kind,"PRECHECK_CANCELLED");
 assert.equal(classifyPosAlert("PrintGuestBill",{}),null);
 assert.equal(classifyPosAlert("ReceiptStorno",{}).kind,"RECEIPT_STORNO");
 assert.equal(classifyPosAlert("Payment",{}),null);
});
test("deleting printed dish is alertable, not ordinary bill update",()=>{
 assert.equal(classifyPosAlert("DeletionOfPrintedItem",{}).kind,"ITEM_REMOVED");
 assert.equal(classifyPosAlert("OrderGuestsBill",{}),null);
 const payload=posAlertDetails({departmentId:"r1",departmentName:"SC White City",
  pluginId:"p1",event:"DeletionOfPrintedItem",eventId:"e1",
  data:{orderNum:"202",productName:"Пицца"}});
 assert.equal(payload.kind,"ITEM_REMOVED");
 assert.equal(payload.orderNum,"202");
 assert.ok(payload.body.includes("SC White City"));
});
test("notification preferences accept only the five requested POS alerts",()=>{
 assert.equal(ALERT_KINDS.length,5);
 assert.deepEqual(validPushKinds(["ITEM_REMOVED","ITEM_REMOVED",
   "ORDER_OPENED","DISCOUNT_REMOVED"]),["ITEM_REMOVED","DISCOUNT_REMOVED"]);
});
test("device key is deterministic without exposing the FCM token",async()=>{
 const token="very-long-token-11111111111111111111";
 const a=await deviceIdForToken(token);
 const b=await deviceIdForToken(token);
 assert.equal(a,b);
 assert.equal(a.length,64);
 assert.ok(!a.includes(token));
});


test("real VPS order-history shape classifies verified 10% discount for order 45",()=>{
 const payload={
   pluginEventType:"AddDiscountSurchargeItem",
   eventId:"discount-order45-1",
   receivedAt:"2026-10-19T15:26:00+04:00",
   departmentId:"restaurant-1",departmentName:"Тестовый ресторан",
   pluginId:"pos-1",orderNum:"45",
   data:{isDiscount:true,discountName:"Endirim 10%",employeeName:"TEST HR"}
 };
 const result=posAlertDetails(payload);
 assert.equal(result.kind,"DISCOUNT_APPLIED");
 assert.equal(result.eventId,"discount-order45-1");
 assert.equal(result.orderNum,"45");
 assert.equal(result.occurredAt,"2026-10-19T15:26:00+04:00");
 assert.ok(result.body.includes("заказ №45"));
});

test("existing ingest envelope retains compatibility with confirmed discount",()=>{
 const result=posAlertDetails({
   event:"AddDiscountSurchargeItem",timestamp:"2026-10-19T15:26:00Z",
   eventId:"evt-2",departmentId:"rest-1",pluginId:"plug-1",
   data:{isDiscount:"True",orderNumber:"45"}
 });
 assert.equal(result.kind,"DISCOUNT_APPLIED");
 assert.equal(result.eventId,"evt-2");
 assert.equal(result.orderNum,"45");
});

test("discount changes without explicit confirmation never trigger applied alert",()=>{
 for(const value of [false,"false",null,"unknown",0]){
   assert.equal(classifyPosAlert("AddDiscountSurchargeItem",
      value===null?{}:{isDiscount:value}),null);
 }
 assert.equal(classifyPosAlert("DiscountChanged",{}),null);
 assert.equal(posAlertDetails({
   eventType:"AddDiscountSurchargeItem",data:{isDiscount:false},
   receivedAt:"2026-10-19T15:26:00Z"
 }),null);
});

// iikoFront plugin EnumPluginEventType uses the exact wire types
// addingDiscount, removingDiscount, addingSurcharge and removingSurcharge.
test("real plugin discount events never confuse a surcharge for a discount", () => {
 const discount={pluginEventType:"addingDiscount",uuid:"f169ca36-322b-4438-8c89-71f6e72a9620",
  departmentId:"c44d9d6f-2990-40ea-b072-2f61b3f5dcea",
  departmentName:"Ресторан",pluginId:"pos-1",
  data:{name:"Endirim 10%",orderNum:45,valuePercent:10,waiter:"TEST HR"}};
 const applied=posAlertDetails(discount);
 assert.equal(applied.kind,"DISCOUNT_APPLIED");
 assert.equal(applied.orderNum,"45");
 assert.ok(applied.body.includes("Endirim 10%"));
 const removed=posAlertDetails({...discount,pluginEventType:"removingDiscount"});
 assert.equal(removed.kind,"DISCOUNT_REMOVED");
 assert.equal(classifyPosAlert("addingSurcharge",discount.data),null);
 assert.equal(classifyPosAlert("removingSurcharge",discount.data),null);
 assert.equal(classifyPosAlert("addingDiscount",{}).kind,"DISCOUNT_APPLIED");
 assert.equal(classifyPosAlert("removingDiscount",{}).kind,"DISCOUNT_REMOVED");
});
