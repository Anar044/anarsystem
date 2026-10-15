import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { mobilePeriod, clean, safeNumber } from "../_lib/query-helpers.js";
import { getOlapFields, iikoJson } from "../../iiko/_lib/iiko-client.js";
import { findOlapField } from "./report.js";
import { getCurrentOperatingShifts, resolveOlapCashShiftField, operatingToday
} from "../../iiko/_lib/operational-day.js";

const cell=(row,field,fields)=>{
  if(!field)return null;
  const title=fields.find(f=>f.name===field)?.title;
  return row?.[field]??(title?row?.[title]:null);
};

export function normalizeMobileOrders(payload, selectedIds) {
  if(!payload?.success || !Array.isArray(payload.orders))
    throw new MobileError("CHECKS_UNAVAILABLE","Список чеков недоступен.",502);
  if(payload.meta?.departmentScopeApplied!==true ||
      !Array.isArray(payload.meta?.departmentIds) ||
      payload.meta.departmentIds.length!==selectedIds.length ||
      selectedIds.some(id=>!payload.meta.departmentIds.includes(id)))
    throw new MobileError("CHECKS_SCOPE_UNVERIFIED",
      "Невозможно подтвердить область ресторанов списка чеков.",409);
  const allowed=new Set(selectedIds);
  if(payload.orders.some(o=>!allowed.has(o.departmentId)))
    throw new MobileError("CHECKS_RESTAURANT_MISMATCH",
      "В отчёт попал чек другого ресторана.",409);
  return {
    success:true,from:payload.from,to:payload.to,
    mode:payload.mode||"calendar",
    orders:payload.orders.slice(0,500).map(o=>({
      number:clean(o.number),date:clean(o.date),
      departmentId:clean(o.departmentId),shiftId:clean(o.shiftId),
      orderId:clean(o.orderId),
      table:clean(o.table),waiter:clean(o.waiter),
      status:clean(o.status),amount:safeNumber(o.amount),
      detailsAvailable:!!(o.shiftId||o.orderId)
    })),
    count:payload.orders.length,truncated:payload.orders.length>500,
    currency:"AZN",source:"SH SALES OLAP",
    selectedDepartmentIds:selectedIds
  };
}

export async function onRequestGet({request,env}) {
  try {
    const {from,to}=mobilePeriod(request,32);
    const ctx=await mobileContext(request,env,{connectionRequired:true});
    const fields=(await getOlapFields(ctx.connection,"SALES")).fields||[];
    const field=(names)=>findOlapField(fields,names);
    const order=field(["OrderNum","OrderNumber","Order.Number"]);
    const date=field(["OpenDate.Typed","OpenDate"]);
    const department=field(["Department.Id","DepartmentId","Department.ID"]);
    const revenue=field(["DishDiscountSumInt","DishSumInt"]);
    const shift=resolveOlapCashShiftField(fields);
    const orderId=field(["Order.Id","OrderId","Order.Guid","OrderUUID"]);
    const table=field(["TableName","Table.Name","Table"]);
    const waiter=field(["WaiterName","Waiter.Name","EmployeeName","Waiter"]);
    const status=field(["OrderStatus","Order.Status"]);
    if(!order||!date||!department||!revenue)
      throw new MobileError("CHECK_FIELDS_UNAVAILABLE",
        "SH OLAP не передал необходимые поля заказа, суммы или ресторана.",409);
    const mode=new URL(request.url).searchParams.get("mode")==="operational"
      ?"operational":"calendar";
    let operating=null;
    if(mode==="operational"){
      if(from!==to||to!==operatingToday())throw new MobileError(
        "CHECKS_OPERATING_DATE_INVALID",
        "Операционные чеки доступны для периода «Сегодня».",400);
      if(!shift)throw new MobileError("CHECK_SHIFT_ID_UNAVAILABLE",
        "SH OLAP не передаёт идентификатор кассовой смены.",409);
      operating=await getCurrentOperatingShifts(ctx.connection,ctx.selectedIds);
    }
    const grouping=[order,date,department];
    // A cash-shift UUID distinguishes equal receipt numbers from two POS.
    // Never use UniqOrderId: it is an OLAP aggregate, not an order identifier.
    for(const optional of [shift,orderId,table,waiter,status]){
      if(optional&&!grouping.includes(optional) &&
          fields.find(f=>f.name===optional)?.groupingAllowed!==false)
        grouping.push(optional);
    }
    const filters={
      "OpenDate.Typed":{filterType:"DateRange",periodType:"CUSTOM",
        from:operating?.from||from,to:operating?.to||to,
        includeLow:true,includeHigh:true},
      [department]:{filterType:"IncludeValues",values:ctx.selectedIds},
      DeletedWithWriteoff:{filterType:"IncludeValues",values:["NOT_DELETED"]},
      OrderDeleted:{filterType:"IncludeValues",values:["NOT_DELETED"]}
    };
    if(operating)filters[shift]={
      filterType:"IncludeValues",values:operating.shiftIds};
    const upstream=await iikoJson(ctx.connection,"/resto/api/v2/reports/olap",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({reportType:"SALES",buildSummary:false,
        groupByRowFields:grouping,groupByColFields:[],
        aggregateFields:[revenue],filters}),timeoutMs:60000
    });
    const rows=Array.isArray(upstream.payload?.data)?upstream.payload.data:
      Array.isArray(upstream.payload)?upstream.payload:null;
    if(!upstream.ok||!rows)throw new MobileError("CHECKS_SOURCE_FAILED",
      "SH OLAP не вернул проверенный список чеков.",502);
    const allowed=new Set(ctx.selectedIds);
    const orders=rows.map(row=>({
      number:clean(cell(row,order,fields)),date:clean(cell(row,date,fields)).slice(0,10),
      departmentId:clean(cell(row,department,fields)),
      shiftId:grouping.includes(shift)?clean(cell(row,shift,fields)):"",
      orderId:grouping.includes(orderId)?clean(cell(row,orderId,fields)):"",
      table:clean(cell(row,table,fields)),waiter:clean(cell(row,waiter,fields)),
      status:clean(cell(row,status,fields)),
      amount:safeNumber(cell(row,revenue,fields))
    })).filter(o=>o.number);
    if(orders.some(o=>!allowed.has(o.departmentId) || !o.date))
      throw new MobileError("CHECKS_SCOPE_UNVERIFIED",
        "SH OLAP не подтвердил ресторан и дату каждого чека.",409);
    return response(normalizeMobileOrders({success:true,
      from:operating?.from||from,to:operating?.to||to,mode,orders,
      meta:{departmentScopeApplied:true,departmentIds:ctx.selectedIds}
    },ctx.selectedIds));
  }catch(error){return errorResponse(error);}
}
