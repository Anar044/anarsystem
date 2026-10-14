import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { onRequestPost as sourceOrders } from "../../iiko/orders.js";
import { mobilePeriod, scopeMatches, clean, safeNumber, projectionFailure } from "../_lib/query-helpers.js";

export function normalizeMobileOrders(payload, selectedIds) {
  if (!payload?.success) projectionFailure("ORDERS_UNAVAILABLE", "Список чеков недоступен.");
  if (!payload.available) throw new MobileError("CHECKS_NOT_SUPPORTED",
      "SH OLAP не предоставил номер заказа для списка чеков.", 409);
  if (!scopeMatches(payload, selectedIds) || payload.meta?.departmentScopeApplied !== true) {
    projectionFailure("CHECKS_SCOPE_UNVERIFIED", "Невозможно подтвердить ресторан для списка чеков.");
  }
  if (!Array.isArray(payload.orders)) projectionFailure("CHECKS_INVALID", "Неверный ответ списка чеков.");
  return {
    success:true, from:payload.from, to:payload.to,
    orders:payload.orders.slice(0, 500).map(o => ({
      number:clean(o.number), date:clean(o.date), table:clean(o.table),
      waiter:clean(o.waiter), status:clean(o.status),
      amount:safeNumber(o.amount)
    })),
    count:payload.orders.length,
    truncated:payload.orders.length>500,
    currency:"AZN", source:"SH SALES OLAP", selectedDepartmentIds:selectedIds
  };
}

export async function onRequestGet({request,env}) {
  try {
    const {from,to} = mobilePeriod(request, 32);
    const ctx = await mobileContext(request,env,{connectionRequired:true});
    const body = {...ctx.connection, from, to, departmentIds:ctx.selectedIds};
    const internal = new Request(request.url, {method:"POST",
      headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
    const upstream = await sourceOrders({request:internal});
    if (!upstream.ok) throw new MobileError("CHECKS_SOURCE_FAILED", "SH Server не вернул список чеков.", 502);
    const payload = await upstream.json().catch(()=>null);
    return response(normalizeMobileOrders(payload,ctx.selectedIds));
  } catch (error) { return errorResponse(error); }
}
