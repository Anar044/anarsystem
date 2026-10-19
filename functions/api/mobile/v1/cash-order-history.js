import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { loadPosSnapshots } from "../_lib/cash-snapshots.js";

// Read-only, verified POS audit log. It uses the SAME upstream event history
// that the web Cash interface already displays. Do not derive/fabricate audit
// entries by diffing periodic order snapshots.
const DEFAULT_VPS="http://68-233-120-197.nip.io";
const clean=v=>String(v??"").trim();
const first=(obj,keys)=>{
  if(!obj||typeof obj!=="object")return null;
  for(const key of keys){
    const value=obj[key];
    if(value!==undefined&&value!==null&&value!=="")return value;
  }
  return null;
};
const object=v=>{
  if(!v)return {};
  if(typeof v==="string"){
    try{return object(JSON.parse(v));}catch{return {};}
  }
  return v&&typeof v==="object"&&!Array.isArray(v)?v:{};
};
const rowsFrom=v=>{
  const data=typeof v==="string"?(()=>{try{return JSON.parse(v)}catch{return null}})():v;
  if(Array.isArray(data))return data;
  for(const key of ["plugins","data","items"]){
    if(Array.isArray(data?.[key]))return data[key];
  }
  return [];
};
const numeric=v=>{
  if(v===null||v===undefined||v==="")return null;
  const n=Number(String(v).replace(/\s/g,"").replace(",","."));
  return Number.isFinite(n)?n:null;
};
async function fetchSource(url,{timeoutMs=9000}={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch(url,{headers:{Accept:"application/json"},
      signal:controller.signal});
    const payload=await r.json().catch(()=>null);
    if(!r.ok||payload===null||payload?.success===false)
      throw new MobileError("CASH_HISTORY_SOURCE_UNAVAILABLE",
        "Журнал событий кассы временно недоступен.",502);
    return payload;
  }finally{clearTimeout(timer);}
}

/**
 * Actual legacy POS plugin wire names are documented in
 * EnumPluginEventType.cs.  Never render unknown English identifiers as the
 * customer-facing label; retain rawType only for diagnostics.
 */
function eventName(type,data){
  const key=clean(type).toLowerCase().replace(/[\\s_-]/g,"");
  const known={
    neworder:["ORDER_OPENED","Заказ открыт"],
    deletionofnotprinteditem:["ITEM_REMOVED","Удалено нераспечатанное блюдо"],
    deletionofprinteditem:["ITEM_REMOVED","Удалено распечатанное блюдо"],
    addingdiscount:["DISCOUNT_APPLIED","Добавлена скидка"],
    removingdiscount:["DISCOUNT_REMOVED","Удалена скидка"],
    addingsurcharge:["SURCHARGE_APPLIED","Добавлена надбавка"],
    removingsurcharge:["SURCHARGE_REMOVED","Удалена надбавка"],
    orderguestbill:["PRECHECK_PRINTED","Распечатан пречек"],
    cancellationofguestbill:["PRECHECK_CANCELLED","Отменён пречек"],
    closingorder:["ORDER_CLOSED","Заказ закрыт"],
    voidreceipt:["RECEIPT_STORNO","Чек сторнирован (возврат)"],
    deletinganorder:["ORDER_CANCELLED","Заказ удалён"],
    deleteanemptyorder:["ORDER_CANCELLED","Пустой заказ удалён"],
    orderinthestatusofthebillforalongtime:
      ["PRECHECK_OVERDUE","Заказ долго находится в статусе «Пречек»"],
    theperiodbetweenguestbillandcheckistoolong:
      ["PRECHECK_OVERDUE","Долгое ожидание после пречека"],
    ordertablehasbeenchanged:["TABLE_CHANGED","Изменён стол"],
    orderswaiterhaschanged:["WAITER_CHANGED","Изменён официант"],
    paymenttypechanged:["PAYMENT_CHANGED","Изменён тип оплаты"],
    changepaymenttype:["PAYMENT_CHANGED","Изменён тип оплаты"],
    changeoftypeofpayment:["PAYMENT_CHANGED","Изменён тип оплаты"],
    paymentchanged:["PAYMENT_CHANGED","Изменена оплата"],
  };
  if(Object.prototype.hasOwnProperty.call(known,key)){
    const [kind,label]=known[key];
    return {kind,label};
  }
  // Compatibility with older POS plugin builds using variant event names.
  if(/printprecheck|precheckprinted|printguestbill|guestbillprinted|billprinted/.test(key))
    return {kind:"PRECHECK_PRINTED",label:"Распечатан пречек"};
  if(/cancelguestbill|guestbillcancel|cancelprecheck|precheckcancel/.test(key))
    return {kind:"PRECHECK_CANCELLED",label:"Отменён пречек"};
  if(/cancelorder|ordercancelled|cancelledorder/.test(key))
    return {kind:"ORDER_CANCELLED",label:"Заказ отменён"};
  if(/deletionofprinteditem|deleteprinteditem|deletedprinteditem/.test(key))
    return {kind:"ITEM_REMOVED",label:"Удалено распечатанное блюдо"};
  if(/deletionofnotprinteditem|deletenotprinteditem/.test(key))
    return {kind:"ITEM_REMOVED",label:"Удалено нераспечатанное блюдо"};
  if(/deletingsurcharge|removingsurcharge|removesurcharge/.test(key))
    return {kind:"SURCHARGE_REMOVED",label:"Удалена надбавка"};
  if(/removediscount|deletingdiscount|removingdiscount/.test(key))
    return {kind:"DISCOUNT_REMOVED",label:"Удалена скидка"};
  if(/adddiscountsurchargeitem|adddiscountsurcharge/.test(key)){
    const isDiscount=first(data,["isDiscount","IsDiscount"]);
    if(isDiscount===true)return {kind:"DISCOUNT_APPLIED",label:"Добавлена скидка"};
    if(isDiscount===false)return {kind:"SURCHARGE_APPLIED",label:"Добавлена надбавка"};
    return {kind:"PRICE_ADJUSTMENT",label:"Изменено условие расчёта"};
  }
  if(/neworder|ordercreated/.test(key))
    return {kind:"ORDER_OPENED",label:"Заказ открыт"};
  if(/closingorder|closedorder|orderclosed|closeorder/.test(key))
    return {kind:"ORDER_CLOSED",label:"Заказ закрыт"};
  if(/orderguestsbill|guestbill|orderbill/.test(key))
    return {kind:"PRECHECK_PRINTED",label:"Распечатан пречек"};
  if(/storno|voidreceipt|receiptrefund|refund/.test(key))
    return {kind:"RECEIPT_STORNO",label:"Чек сторнирован (возврат)"};
  if(/payment.*chang|chang.*payment/.test(key))
    return {kind:"PAYMENT_CHANGED",label:"Изменён тип оплаты"};
  if(/payment|pay/.test(key))
    return {kind:"PAYMENT",label:"Оплата заказа"};
  if(/add.*item|item.*add|addeditem/.test(key))
    return {kind:"ITEM_ADDED",label:"Добавлено блюдо"};
  if(/remove.*item|item.*remove|delete.*item/.test(key))
    return {kind:"ITEM_REMOVED",label:"Удалено блюдо"};
  if(/discount/.test(key))
    return {kind:"DISCOUNT_APPLIED",label:"Операция со скидкой"};
  if(/surcharge|increase/.test(key))
    return {kind:"SURCHARGE_APPLIED",label:"Операция с надбавкой"};
  if(/tablechanged/.test(key))return {kind:"TABLE_CHANGED",label:"Изменён стол"};
  if(/waiterchanged/.test(key))return {kind:"WAITER_CHANGED",label:"Изменён официант"};
  return {kind:"OTHER",label:"Другое событие заказа"};
}
const value=(root,data,keys)=>first(data,keys)??first(root,keys);
const textScalar=v=>{
  if(v&&typeof v==="object")
    return clean(first(v,["name","Name","title","Title","label","Label"]));
  return clean(v);
};
const writeOffData=(root,data)=>{
  const writeOffFlag=value(root,data,[
    "withWriteOff","WithWriteOff","isWriteOff","IsWriteOff",
    "isWrittenOff","IsWrittenOff","writeOff","WriteOff",
  ]);
  const reason=textScalar(value(root,data,["reasonWriteOff","ReasonWriteOff",
    "writeOffReason","WriteOffReason"]));
  const comment=textScalar(value(root,data,["reasonComment","ReasonComment",
    "writeOffComment","WriteOffComment"]));
  const noWriteOff=/^(без списания|безсписания|without\\s*write.?off|no\\s*write.?off|не списывать|none)$/i;
  let writeOffStatus="UNKNOWN";
  if(writeOffFlag===true||writeOffFlag==="true"||writeOffFlag===1)
    writeOffStatus="WITH_WRITE_OFF";
  else if(writeOffFlag===false||writeOffFlag==="false"||writeOffFlag===0)
    writeOffStatus="WITHOUT_WRITE_OFF";
  else if(reason&&noWriteOff.test(reason))
    writeOffStatus="WITHOUT_WRITE_OFF";
  else if(reason)
    writeOffStatus="WITH_WRITE_OFF";
  return {
    writeOffStatus,
    writeOffLabel:writeOffStatus==="WITH_WRITE_OFF"?"Со списанием":
      writeOffStatus==="WITHOUT_WRITE_OFF"?"Без списания":
      "Касса не передала тип списания",
    ...(reason?{writeOffReason:reason}:{}),
    ...(comment?{writeOffComment:comment}:{}),
  };
};

export function normalizePosAuditEvents(payload,requestedOrderNum){
  const root=object(payload);
  const raw=Array.isArray(payload)?payload:
    first(root,["events","history","data"]) ?? [];
  const events=Array.isArray(raw)?raw:
    (Array.isArray(raw?.events)?raw.events:[]);
  const wanted=clean(requestedOrderNum).replace(/^#/,"");
  const seen=new Set();
  return events.slice(0,2000).flatMap((event,index)=>{
    if(!event||typeof event!=="object")return [];
    const data=object(first(event,["data","Data","details","Details"]));
    const orderNum=clean(value(event,data,
      ["orderNum","OrderNum","orderNumber","OrderNumber"])).replace(/^#/,"");
    const rawType=clean(first(event,["pluginEventType","eventType","type",
      "Type","event","Event"]));
    const {kind,label}=eventName(rawType,data);
    // A return may open a new linked transaction. Only explicitly linked
    // refund/storno events can be associated with the original order number.
    const originalNum=kind==="RECEIPT_STORNO"?
      clean(value(event,data,["originalOrderNum","OriginalOrderNum",
        "sourceOrderNum","SourceOrderNum"])).replace(/^#/,""):"";
    if(orderNum && orderNum!==wanted && originalNum!==wanted)return [];
    const occurredAt=clean(first(event,["receivedAt","ReceivedAt","occurredAt",
      "OccurredAt","timestamp","Timestamp","dateTime","DateTime"]) ??
      first(data,["updateTime","UpdateTime"]));
    // A missing source timestamp must never be replaced with a guessed time.
    if(!occurredAt||!Number.isFinite(Date.parse(occurredAt)))return [];
    const eventId=clean(first(event,["uuid","Uuid","UUID","id","Id",
      "eventId","EventId"]))||`${rawType}:${occurredAt}:${index}`;
    if(seen.has(eventId))return [];
    seen.add(eventId);
    const isItem=kind==="ITEM_ADDED"||kind==="ITEM_REMOVED";
    const product=value(event,data,["product","Product","item","Item",
      "dish","Dish","printedItem","PrintedItem","deletedItem","DeletedItem"]);
    const productName=isItem?(first(data,["productName","ProductName",
      "itemName","ItemName","dishName","DishName"]) ??
      first(object(product),["name","Name","title","Title"])):null;
    const qty=numeric(value(event,data,["quantity","Quantity","qty","Qty",
      "count","Count","itemAmount","ItemAmount"]));
    const amount=numeric(value(event,data,["resultSum","ResultSum","itemSum",
      "ItemSum","lineSum","LineSum","totalSum","TotalSum","sum","Sum"]));
    const payment=value(event,data,["paymentTypeName","PaymentTypeName",
      "paymentName","PaymentName","paymentType","PaymentType"]);
    const person=value(event,data,["userName","UserName","waiter","Waiter",
      "cashier","Cashier"]);
    const adjustment=kind==="DISCOUNT_APPLIED"||kind==="DISCOUNT_REMOVED"||
      kind==="SURCHARGE_APPLIED"||kind==="SURCHARGE_REMOVED";
    const adjustmentName=adjustment?textScalar(value(event,data,
      ["name","Name","discountName","DiscountName",
       "surchargeName","SurchargeName"])):"";
    const percent=adjustment?numeric(value(event,data,
      ["valuePercent","ValuePercent","percent","Percent"])):null;
    const billMinutes=kind==="PRECHECK_OVERDUE"?numeric(value(event,data,
      ["orderInBillTooLong","OrderInBillTooLong",
      "totalMinutesBetweenBillAndClose","TotalMinutesBetweenBillAndClose"])):null;
    const isPrintedDeletion=clean(rawType).toLowerCase()
      .replace(/[\\s_-]/g,"").includes("deletionofprinteditem");
    return [{
      id:eventId,occurredAt,kind,label,rawType,
      ...(productName?{itemName:clean(productName)}:{}),
      ...(isItem&&qty!==null?{quantity:qty}:{}),
      ...(amount!==null?{amount}:{}),
      ...(payment?{paymentType:textScalar(payment)}:{}),
      ...(person?{employee:textScalar(person)}:{}),
      ...(adjustmentName?{adjustmentName}:{}),
      ...(percent!==null?{percent}:{}),
      ...(billMinutes!==null?{billMinutes}:{}),
      ...(isPrintedDeletion?writeOffData(event,data):{}),
      ...(orderNum&&orderNum!==wanted?{linkedOrderNum:orderNum}:{}),
    }];
  }).sort((a,b)=>Date.parse(a.occurredAt)-Date.parse(b.occurredAt));
}

export async function onRequestGet({request,env}){
  try{
    const url=new URL(request.url);
    const orderNum=clean(url.searchParams.get("orderNum"));
    const pluginId=clean(url.searchParams.get("pluginId"));
    const departmentId=clean(url.searchParams.get("departmentId"));
    if(!orderNum||orderNum.length>120||!pluginId||pluginId.length>150||
      !departmentId)throw new MobileError("INVALID_ORDER_HISTORY",
      "Выберите заказ из списка своей кассы.",400);
    const ctx=await mobileContext(request,env,{connectionRequired:true});
    if(!ctx.selectedIds.includes(departmentId))throw new MobileError(
      "CASH_HISTORY_FORBIDDEN","Ресторан заказа недоступен.",403);
    const origin=String(env?.PLUGIN_VPS_API_URL||DEFAULT_VPS).replace(/\/+$/,"");
    const pluginUrl=new URL(origin+"/api/plugin/data");
    pluginUrl.searchParams.set("departmentIds",departmentId);
    if(ctx.connection.ip&&ctx.connection.port)
      pluginUrl.searchParams.set("serverUrl",
        `http://${ctx.connection.ip}:${ctx.connection.port}`);
    let allowed=false;
    try{
      const registry=await fetchSource(pluginUrl.toString());
      allowed=rowsFrom(registry).some(item=>{
        const row=item?.data&&typeof item.data==="object"
          ?{...item,...item.data}:item;
        return clean(row?.pluginId)===pluginId &&
          clean(row?.departmentId)===departmentId;
      });
    }catch(_) { /* Offline POS can be matched against a verified D1 snapshot. */ }
    if(!allowed){
      const saved=await loadPosSnapshots(env.DB,ctx.access.workspace.id,
        [departmentId]).catch(()=>[]);
      allowed=saved.some(item=>item.id===pluginId&&
        item.departmentId===departmentId);
    }
    if(!allowed)throw new MobileError("CASH_HISTORY_FORBIDDEN",
      "Касса не относится к доступному ресторану.",403);
    const target=new URL(origin+"/api/plugin/order-history");
    target.searchParams.set("orderNum",orderNum);
    target.searchParams.set("pluginId",pluginId);
    target.searchParams.set("departmentIds",departmentId);
    if(ctx.connection.ip&&ctx.connection.port)
      target.searchParams.set("serverUrl",
        `http://${ctx.connection.ip}:${ctx.connection.port}`);
    const payload=await fetchSource(target.toString(),{timeoutMs:12000});
    const events=normalizePosAuditEvents(payload,orderNum);
    return response({
      success:true,source:"SH POS Plugin Event History",
      events,historyAvailable:events.length>0,
      completeHistoryClaimed:false,
      // Events depend on POS plugin retention; do not invent earlier actions.
      message:events.length
        ?"Показаны полученные события кассы. Полнота истории зависит от журнала POS."
        :"Для заказа кассовый плагин не передал подтверждённых событий.",
      count:events.length
    });
  }catch(error){return errorResponse(error);}
}
