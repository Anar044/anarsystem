import { buildOwnerFcmMessage } from '../functions/api/mobile/_lib/fcm.js';
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

test("FCM includes explicit APNs alert and Android priority for every authorized cash event",()=>{
  const msg=buildOwnerFcmMessage("device_token",{
    title:"Кассовое событие",body:"Изменён чек",
    kind:"ITEM_REMOVED",departmentId:"department-1",orderNum:"456"
  });
  assert.equal(msg.apns.headers["apns-push-type"],"alert");
  assert.equal(msg.apns.headers["apns-priority"],"10");
  assert.equal(msg.apns.payload.aps.sound,"default");
  assert.equal(msg.android.priority,"HIGH");
  assert.equal(msg.data.departmentId,"department-1");
  assert.equal(msg.data.kind,"ITEM_REMOVED");
});
