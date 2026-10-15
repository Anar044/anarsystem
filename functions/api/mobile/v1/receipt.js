import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { clean, safeNumber } from "../_lib/query-helpers.js";
import { getOlapFields, iikoJson } from "../../iiko/_lib/iiko-client.js";
import { findOlapField } from "./report.js";
import { resolveOlapCashShiftField } from "../../iiko/_lib/operational-day.js";

// Item details require an exact restaurant, receipt number, date and globally
// unique shift/order identity. No raw iiko responses or connection secrets
// are ever sent to the phone.
export const receiptFields=fields=>{
  const field=names=>findOlapField(fields,names);
  return {
    number:field(["OrderNum","OrderNumber","Order.Number"]),
    date:field(["OpenDate.Typed","OpenDate"]),
    department:field(["Department.Id","DepartmentId","Department.ID"]),
    session:resolveOlapCashShiftField(fields),
    orderId:field(["Order.Id","OrderId","Order.Guid","OrderUUID"]),
    dish:field(["DishName","Dish.Name","DishFullName","Dish"]),
    qty:field(["DishAmountInt","DishAmount","Dish.Count"]),
    value:field(["DishDiscountSumInt","DishSumInt"])
  };
};
const cell=(row,field,fields)=>{
  if(!field)return null;
  const title=fields.find(f=>f.name===field)?.title;
  return row?.[field]??(title?row?.[title]:null);
};
const validDate=date=>/^\d{4}-\d{2}-\d{2}$/.test(date) &&
  !Number.isNaN(Date.parse(date+"T00:00:00Z")) &&
  new Date(date+"T00:00:00Z").toISOString().slice(0,10)===date;

export function normalizeReceiptRows(rows,meta,requested,fields) {
  if(!Array.isArray(rows))throw new MobileError(
    "RECEIPT_BAD_RESPONSE","SH OLAP не вернул строки чека.",502);
  if(!meta.number||!meta.dish||!meta.value||!meta.department||
      !(requested.shiftId&&meta.session || requested.orderId&&meta.orderId))
    throw new MobileError("RECEIPT_IDENTITY_UNAVAILABLE",
      "Не удалось однозначно определить чек и его блюда.",409);
  const positions=[];
  for(const row of rows){
    const number=clean(cell(row,meta.number,fields));
    const dep=clean(cell(row,meta.department,fields));
    const shift=clean(cell(row,meta.session,fields));
    const orderId=clean(cell(row,meta.orderId,fields));
    if(number!==requested.number||dep!==requested.departmentId||
       (requested.shiftId&&shift!==requested.shiftId)||
       (requested.orderId&&orderId!==requested.orderId))
      throw new MobileError("RECEIPT_SCOPE_MISMATCH",
        "SH OLAP вернул данные другого чека или ресторана.",409);
    const name=clean(cell(row,meta.dish,fields));
    if(!name)throw new MobileError("RECEIPT_ITEMS_INCOMPLETE",
      "SH OLAP не вернул название блюда в чеке.",502);
    positions.push({
      name, quantity:meta.qty?safeNumber(cell(row,meta.qty,fields)):null,
      amount:safeNumber(cell(row,meta.value,fields))
    });
  }
  return {positions,total:positions.length,
    itemsTotal:positions.length && positions.every(p=>p.amount!==null)
      ?positions.reduce((sum,p)=>sum+p.amount,0):null};
}

// Number-only OLAP IncludeValues is not reliable on every iiko version:
// OrderNum may be an INTEGER dimension. The server queries one authorized
// restaurant, shift and business date, then matches the receipt number
// server-side. Unrelated orders are never returned to the mobile device.
export function buildReceiptOlapRequest(meta, requested, {quantity=true}={}) {
  const dimensions=[meta.number,meta.department,meta.dish,
    ...(requested.shiftId?[meta.session]:[]),
    ...(requested.orderId?[meta.orderId]:[])];
  if(dimensions.some(x=>!x) || !meta.value ||
      !(requested.shiftId&&meta.session || requested.orderId&&meta.orderId))
    throw new MobileError("RECEIPT_FIELDS_UNAVAILABLE",
      "SH OLAP не позволяет проверить ресторан, чек и кассовую смену.",409);
  const filters={
    "OpenDate.Typed":{filterType:"DateRange",periodType:"CUSTOM",
      from:requested.date,to:requested.date,includeLow:true,includeHigh:true},
    [meta.department]:{filterType:"IncludeValues",values:[requested.departmentId]},
    DeletedWithWriteoff:{filterType:"IncludeValues",values:["NOT_DELETED"]},
    OrderDeleted:{filterType:"IncludeValues",values:["NOT_DELETED"]}
  };
  if(requested.shiftId)filters[meta.session]={
    filterType:"IncludeValues",values:[requested.shiftId]};
  if(requested.orderId)filters[meta.orderId]={
    filterType:"IncludeValues",values:[requested.orderId]};
  return {
    reportType:"SALES",buildSummary:false,
    groupByRowFields:[...new Set(dimensions)],
    groupByColFields:[],
    aggregateFields:[meta.value,...(quantity&&meta.qty?[meta.qty]:[])],
    filters
  };
}

// Fail closed if the scoped iiko response includes a foreign department,
// shift or order ID; rows from other receipt numbers are expected because
// some versions reject direct OLAP filtering of an integer OrderNum.
export function selectReceiptRows(rows,meta,requested,fields) {
  if(!Array.isArray(rows))throw new MobileError("RECEIPT_BAD_RESPONSE",
    "SH OLAP не вернул проверенные строки чеков.",502);
  for(const row of rows){
    const dep=clean(cell(row,meta.department,fields));
    const shift=clean(cell(row,meta.session,fields));
    const order=clean(cell(row,meta.orderId,fields));
    if(dep!==requested.departmentId ||
       (requested.shiftId&&shift!==requested.shiftId) ||
       (requested.orderId&&order!==requested.orderId))
      throw new MobileError("RECEIPT_SCOPE_MISMATCH",
        "SH OLAP вернул данные другого ресторана, смены или заказа.",409);
  }
  return rows.filter(row=>
    clean(cell(row,meta.number,fields))===requested.number);
}

export async function onRequestGet({request,env}) {
  try {
    const url=new URL(request.url);
    const requested={
      number:clean(url.searchParams.get("number")),
      date:clean(url.searchParams.get("date")),
      departmentId:clean(url.searchParams.get("departmentId")),
      shiftId:clean(url.searchParams.get("shiftId")),
      orderId:clean(url.searchParams.get("orderId"))
    };
    if(!requested.number||requested.number.length>80||
       !validDate(requested.date)||!requested.departmentId||
       requested.shiftId.length>200||requested.orderId.length>200||
       (!requested.shiftId&&!requested.orderId))
      throw new MobileError("INVALID_RECEIPT_REF",
        "Выберите чек с подтверждённым идентификатором.",400);
    const ctx=await mobileContext(request,env,{connectionRequired:true});
    if(!ctx.selectedIds.includes(requested.departmentId))
      throw new MobileError("RECEIPT_FORBIDDEN",
        "Нет доступа к ресторану этого чека.",403);
    const fields=(await getOlapFields(ctx.connection,"SALES")).fields||[];
    const meta=receiptFields(fields);
    const keys=[meta.number,meta.department,meta.dish,
      ...(requested.shiftId?[meta.session]:[]),
      ...(requested.orderId?[meta.orderId]:[])];
    if(keys.some(x=>!x)||!meta.value || keys.some(x=>
      fields.find(f=>f.name===x)?.groupingAllowed===false))
      throw new MobileError("RECEIPT_FIELDS_UNAVAILABLE",
        "SH OLAP не позволяет получить подтверждённый состав чека.",409);
    const hasQuantity=!!meta.qty &&
      fields.find(f=>f.name===meta.qty)?.aggregationAllowed!==false;
    const run=async quantity=>iikoJson(ctx.connection,
      "/resto/api/v2/reports/olap",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(buildReceiptOlapRequest(meta,requested,{quantity})),
        timeoutMs:60000
      });
    const reportRows=reply=>reply?.ok &&
      reply.payload?.success!==false &&
      !reply.payload?.errorCode && !reply.payload?.errorMessage
      ? (Array.isArray(reply.payload?.data)?reply.payload.data:
         Array.isArray(reply.payload)?reply.payload:null) : null;
    let reply=await run(hasQuantity);
    let rows=reportRows(reply);
    // Some versions reject a second aggregate even when /columns marks it
    // supported; retry once with the proven discounted-amount measure only.
    if(!rows && hasQuantity && ![401,403,429,503,504].includes(reply.status)){
      reply=await run(false);
      rows=reportRows(reply);
      if(rows)meta.qty=null;
    }
    if(!rows)throw new MobileError("RECEIPT_SOURCE_FAILED",
      "SH OLAP отклонил отчёт по блюдам (HTTP " +
      String(reply?.status||"без ответа") +
      "). Нужна проверка формата запроса на сервере.",502);
    const matched=selectReceiptRows(rows,meta,requested,fields);
    const normalized=normalizeReceiptRows(matched,meta,requested,fields);
    if(!normalized.positions.length)throw new MobileError(
      "RECEIPT_ITEMS_NOT_FOUND",
      "SH OLAP не нашёл позиции указанного чека.",404);
    return response({
      success:true,number:requested.number,date:requested.date,
      departmentId:requested.departmentId,currency:"AZN",
      ...normalized,source:"SH SALES OLAP",
      paymentsAvailable:false,
      paymentNote:"Способы оплаты не подтверждены отдельным источником.",
      updatedAt:new Date().toISOString()
    });
  }catch(error){return errorResponse(error);}
}
