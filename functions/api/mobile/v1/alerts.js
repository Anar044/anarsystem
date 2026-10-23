import { mobileContext, response, errorResponse, MobileError, ownerBrokerContext } from "../_lib/context.js";
import { onRequestPost as sourceBalance } from "../../iiko/stock-balances.js";
import { clean, safeNumber, scopeMatches } from "../_lib/query-helpers.js";

export function normalizeMobileAlerts(payload, selectedIds) {
  if (!payload?.success || !Array.isArray(payload.rows)) {
    throw new MobileError("ALERT_SOURCE_FAILED","Предупреждения по складам недоступны.",502);
  }
  if (!scopeMatches(payload,selectedIds)) {
    throw new MobileError("ALERT_SCOPE_UNVERIFIED","Не подтверждена область складских предупреждений.",502);
  }
  const rows=payload.rows.filter(r=>
    (safeNumber(r.amount) !== null && safeNumber(r.amount) < 0) ||
    r.belowMin === true
  ).map(r=>({
    productId:clean(r.productId),productName:clean(r.productName),
    storeId:clean(r.storeId),storeName:clean(r.storeName),
    quantity:safeNumber(r.amount),unit:clean(r.unit),
    belowMin:r.belowMin === true,minimum:safeNumber(r.minAmount),
    severity:safeNumber(r.amount)<0 ? "NEGATIVE" : "BELOW_MIN"
  })).filter(x=>x.productId && x.storeId);
  return {
    success:true, rows:rows.slice(0,500), count:rows.length,
    truncated:rows.length>500,
    asOf:payload.timestamp, selectedDepartmentIds:selectedIds,
    source:"SH LIVE INVENTORY ALERTS", pushEnabled:false
  };
}
export async function onRequestGet({request,env}){
 try{
  const date=clean(new URL(request.url).searchParams.get("date"));
  const parsed=Date.parse(date+"T00:00:00Z");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||
     !Number.isFinite(parsed)||
     new Date(parsed).toISOString().slice(0,10)!==date)
    throw new MobileError("INVALID_DATE","Выберите правильную дату.",400);
  const ctx=await mobileContext(request,env,{connectionRequired:true});
  const internal=new Request(request.url,{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({...ctx.connection,date,time:"23:59:59",
      departmentIds:ctx.selectedIds,includeZero:false,
      chainScope:{mode:"CHAIN",allowedDepartmentIds:ctx.availableIds}
    })});
  const upstream=await sourceBalance({request:internal,...ownerBrokerContext(ctx,env)});
  if(!upstream.ok) throw new MobileError("ALERT_SOURCE_FAILED",
    "SH Server не вернул складские предупреждения.",502);
  const payload=await upstream.json().catch(()=>null);
  return response(normalizeMobileAlerts(payload,ctx.selectedIds));
 }catch(error){return errorResponse(error);}
}
