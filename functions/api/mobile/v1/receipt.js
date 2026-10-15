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
    const filters={
      "OpenDate.Typed":{filterType:"DateRange",periodType:"CUSTOM",
        from:requested.date,to:requested.date,includeLow:true,includeHigh:true},
      [meta.number]:{filterType:"IncludeValues",values:[requested.number]},
      [meta.department]:{filterType:"IncludeValues",values:[requested.departmentId]},
      DeletedWithWriteoff:{filterType:"IncludeValues",values:["NOT_DELETED"]},
      OrderDeleted:{filterType:"IncludeValues",values:["NOT_DELETED"]}
    };
    if(requested.shiftId)filters[meta.session]={
      filterType:"IncludeValues",values:[requested.shiftId]};
    if(requested.orderId)filters[meta.orderId]={
      filterType:"IncludeValues",values:[requested.orderId]};
    const aggregates=[meta.value];
    if(meta.qty && fields.find(f=>f.name===meta.qty)?.aggregationAllowed!==false)
      aggregates.push(meta.qty);
    else meta.qty=null;
    const result=await iikoJson(ctx.connection,"/resto/api/v2/reports/olap",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({reportType:"SALES",buildSummary:false,
        groupByRowFields:[...new Set(keys)],groupByColFields:[],
        aggregateFields:aggregates,filters}),timeoutMs:60000
    });
    const rows=Array.isArray(result.payload?.data)?result.payload.data:
      Array.isArray(result.payload)?result.payload:null;
    if(!result.ok||!rows)throw new MobileError("RECEIPT_SOURCE_FAILED",
      "SH OLAP не вернул подтверждённый состав чека.",502);
    const normalized=normalizeReceiptRows(rows,meta,requested,fields);
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
