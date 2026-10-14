import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { onRequestPost as sourceMovements } from "../../iiko/stock-movements.js";
import { resolveStoreScope } from "../../iiko/_lib/store-scope.js";
import { mobilePeriod, clean, safeNumber } from "../_lib/query-helpers.js";

const key=v=>clean(v).replace(/^\{+|\}+$/g,"").toLowerCase();

export function scopedMovements(payload, selectedStoreIds, selectedIds) {
  if(!payload?.success || !Array.isArray(payload.movements)) {
    throw new MobileError("MOVEMENTS_UNAVAILABLE","Движение товаров недоступно.",502);
  }
  const stores = new Set(selectedStoreIds.map(key));
  if(!stores.size) throw new MobileError("WAREHOUSE_SCOPE_MISSING","Склады ресторанов не определены.",409);
  // Exclude any cross-restaurant document, rather than reveal external
  // warehouse metadata. Cross-department transfers require separate review.
  const rows = payload.movements.filter(m=>{
    const refs = [m.storeId,m.fromStoreId,m.toStoreId].map(key).filter(Boolean);
    return refs.length>0 && refs.every(id=>stores.has(id));
  }).map(m=>({
    id:clean(m.id), type:clean(m.type),date:clean(m.date),
    documentNumber:clean(m.documentNumber),
    productId:clean(m.productId), productName:clean(m.productName),
    storeId:clean(m.storeId),storeName:clean(m.storeName),
    unit:clean(m.unit),quantity:safeNumber(m.signedAmount??m.amount),
    value:safeNumber(m.value)
  }));
  return {
    success:true,rows:rows.slice(0,500), count:rows.length,
    truncated:rows.length>500, currency:"AZN",
    selectedDepartmentIds:selectedIds, source:"SH STOCK MOVEMENTS"
  };
}
export async function onRequestGet({request,env}) {
 try{
  const {from,to}=mobilePeriod(request,32);
  const ctx=await mobileContext(request,env,{connectionRequired:true});
  const scope=await resolveStoreScope(ctx.connection,ctx.selectedIds);
  if(!scope.resolved||!scope.storeIds?.length)throw new MobileError(
    "WAREHOUSE_SCOPE_MISSING","Нельзя подтвердить склады выбранных ресторанов.",409);
  const body={...ctx.connection,from,to,departmentIds:ctx.selectedIds,
    chainScope:{mode:"CHAIN",allowedDepartmentIds:ctx.availableIds}};
  const internal=new Request(request.url,{method:"POST",
    headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
  const source=await sourceMovements({request:internal});
  if(!source.ok)throw new MobileError("MOVEMENTS_SOURCE_FAILED","SH Server не вернул движения товаров.",502);
  const payload=await source.json().catch(()=>null);
  if(Object.values(payload?.sourceStatus||{}).some(s=>s?.ok===false))
    throw new MobileError("MOVEMENTS_PARTIAL","SH Server вернул неполные документы.",502);
  return response({...scopedMovements(payload,scope.storeIds,ctx.selectedIds),from,to});
 }catch(e){return errorResponse(e);}
}
