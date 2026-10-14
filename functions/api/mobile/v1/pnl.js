import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { mobilePeriod, clean, safeNumber } from "../_lib/query-helpers.js";
import { onRequestPost as pnlSource } from "../../iiko/pnl.js";
import { restaurantDirectory } from "../../iiko/_lib/restaurant-scope.js";

export function normalizeMobilePnl(payload, selectedIds) {
  if (!payload?.success || !Array.isArray(payload.rows)) {
    throw new MobileError("PNL_UNAVAILABLE","Финансовый P&L недоступен.",502);
  }
  if (payload.meta?.departmentScopeApplied !== true ||
      payload.meta?.transactionDepartmentScopeApplied !== true ||
      payload.meta?.scopeWarning) {
    throw new MobileError("PNL_SCOPE_UNVERIFIED",
      "В SH Server не подтверждён ресторанный фильтр финансовых проводок.",409);
  }
  return {
    success:true,
    metrics:{
      revenue:safeNumber(payload.revenue), cogs:safeNumber(payload.cogs),
      grossProfit:safeNumber(payload.grossProfit),
      operatingProfit:safeNumber(payload.operatingProfit),
      netProfit:safeNumber(payload.netProfit)
    },
    rows:payload.rows.map(x=>({
      name:clean(x.name),value:safeNumber(x.value),
      kind:clean(x.kind)
    })).filter(x=>x.name).slice(0,300),
    selectedDepartmentIds:selectedIds,
    currency:"AZN",source:"SH P&L TRANSACTIONS"
  };
}
export async function onRequestGet({request,env}){
 try{
  const {from,to}=mobilePeriod(request,32);
  const ctx=await mobileContext(request,env,{connectionRequired:true});
  // Legacy P&L omits restaurant filters for all selected departments.
  // The owner mobile module must not expose server-wide postings without
  // first verifying full accounting scope with an isolated CHAIN test.
  if(ctx.selectedIds.length >= ctx.availableIds.length)
    throw new MobileError("PNL_FULL_CHAIN_REVIEW",
      "Сводный P&L по всем ресторанам ожидает проверку фильтра TRANSACTIONS.",409);
  const directory=restaurantDirectory(ctx.state);
  const selected=directory.filter(d=>ctx.selectedIds.includes(d.id));
  const hdrs=new Headers(request.headers);
  hdrs.set("Content-Type","application/json");
  const internal=new Request(request.url,{method:"POST",headers:hdrs,
    body:JSON.stringify({...ctx.connection,from,to,departmentIds:ctx.selectedIds,
      chainScope:{mode:"CHAIN",allowedDepartmentIds:ctx.availableIds,
        selectedDepartmentCodes:selected.map(x=>x.code).filter(Boolean),
        selectedDepartmentNames:selected.map(x=>x.name).filter(Boolean)}
    })});
  const upstream=await pnlSource({request:internal,env});
  if(!upstream.ok)throw new MobileError("PNL_SOURCE_FAILED",
    "SH Server не вернул финансовый P&L выбранного ресторана.",502);
  return response({...normalizeMobilePnl(await upstream.json(),ctx.selectedIds),from,to});
 }catch(error){return errorResponse(error);}
}
