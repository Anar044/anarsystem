// Confirmed POS actions only. Never invent a cancellation or a storno
// from ordinary payment, close, delete-item or printing events.
const clean = x => String(x ?? "").trim();
const first = (o, keys) => {
  if (!o || typeof o !== "object") return null;
  for(const key of keys) if(o[key] != null && o[key] !== "") return o[key];
  return null;
};
const object = v => v && typeof v === "object" && !Array.isArray(v) ? v : {};
export const ALERT_KINDS = Object.freeze([
  "DISCOUNT_APPLIED","DISCOUNT_REMOVED","PRECHECK_CANCELLED",
  "ITEM_REMOVED","RECEIPT_STORNO"
]);
export function classifyPosAlert(event, data = {}) {
  const type=clean(event).toLowerCase().replace(/[\s_.-]/g,"");
  const d=object(data);
  if(!type) return null;
  if(/storno|stornir|сторн|fiscalreceiptcancel|receiptvoid|voidreceipt|receiptrefund/.test(type))
    return {kind:"RECEIPT_STORNO",title:"Сторнирование чека"};
  if(/cancelguestbill|cancellationofguestbill|guestbillcancel|cancelprecheck|precheckcancel|отменапречека/.test(type))
    return {kind:"PRECHECK_CANCELLED",title:"Отмена пречека"};
  if(/removediscount|deletingdiscount|removingdiscount|discountdeleted/.test(type))
    return {kind:"DISCOUNT_REMOVED",title:"Удалена скидка"};
  if(/deletionofprinteditem|deleteprinteditem|deletedprinteditem|removedish|deleteorderitem|removeorderitem/.test(type))
    return {kind:"ITEM_REMOVED",title:"Удалено блюдо"};
  if(/adddiscountsurchargeitem|adddiscountsurcharge/.test(type)){
    const flag=first(d,["isDiscount","IsDiscount"]);
    // VPS/iikoFront can encode JSON booleans as text; never treat
    // an absent or ambiguous discount flag as a discount.
    const confirmed = flag===true || (typeof flag==="string" &&
      flag.trim().toLowerCase()==="true");
    if(confirmed) return {kind:"DISCOUNT_APPLIED",title:"Применена скидка"};
    return null; // surcharge or ambiguous adjustment: NOT a discount
  }
  if(/addingdiscount|discountadded|applydiscount|addeddiscount|discountapplied/.test(type))
    return {kind:"DISCOUNT_APPLIED",title:"Применена скидка"};
  return null;
}
// Accept the raw VPS order-history envelope as well as the existing
// /api/plugin/ingest envelope. History viewing alone does not invoke push:
// the server still needs an independently verified incoming event feed.
export function posAlertDetails(envelope){
  const data=object(envelope?.data ?? envelope?.Data);
  const sourceType=first(envelope,["event","pluginEventType","eventType",
    "type","Type"]);
  const alert=classifyPosAlert(sourceType,data);
  if(!alert)return null;
  const order=clean(first(data,["orderNum","OrderNum","orderNumber","OrderNumber",
    "number","Number"]) ?? first(envelope,["orderNum","OrderNum",
    "orderNumber","OrderNumber"]));
  const dish=clean(first(data,["dishName","DishName","productName","ProductName","itemName","ItemName"]));
  const discountName=clean(first(data,["name","Name","discountName",
    "DiscountName"]));
  const restaurant=clean(envelope?.departmentName ?? data?.departmentName)||"Ресторан";
  const description=[
    restaurant,
    order ? "заказ №"+order : null,
    alert.kind==="DISCOUNT_APPLIED" || alert.kind==="DISCOUNT_REMOVED"
      ? (discountName || null) : null,
    alert.kind==="ITEM_REMOVED" && dish ? dish : null
  ].filter(Boolean).join(" · ");
  const sourceTime=first(envelope,["timestamp","receivedAt","ReceivedAt",
    "occurredAt","OccurredAt","dateTime","DateTime"]) ??
    first(data,["updateTime","UpdateTime","occurredAt","OccurredAt"]);
  return {...alert,departmentId:clean(envelope?.departmentId),
    pluginId:clean(envelope?.pluginId),orderNum:order,title:alert.title,
    body:description.slice(0,180),
    eventId:clean(first(envelope,["eventId","EventId","uuid","Uuid","id","Id"])),
    occurredAt:clean(sourceTime)};
}
