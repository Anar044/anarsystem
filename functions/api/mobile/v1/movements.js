import { mobileContext, response, errorResponse, MobileError, ownerBrokerContext } from "../_lib/context.js";
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
    id:clean(m.id),type:clean(m.type),label:clean(m.label),
    date:clean(m.date),documentId:clean(m.documentId),
    documentNumber:clean(m.documentNumber),status:clean(m.status),
    comment:clean(m.comment),
    productId:clean(m.productId),productName:clean(m.productName),
    storeId:clean(m.storeId),storeName:clean(m.storeName),
    fromStoreId:clean(m.fromStoreId),fromStoreName:clean(m.fromStoreName),
    toStoreId:clean(m.toStoreId),toStoreName:clean(m.toStoreName),
    unit:clean(m.unit),
    quantity:m.type==="inventory"&&(m.signedAmount===null||m.signedAmount===undefined)
      ?null:safeNumber(m.signedAmount??m.amount),
    value:safeNumber(m.value),
    actualAmount:safeNumber(m.actualAmount),
    accountingAmount:safeNumber(m.accountingAmount),
    differenceAmount:safeNumber(m.differenceAmount)
  }));
  // A failure in one document type must not disguise all other verified
  // warehouse movements as empty. Label any partial result explicitly.
  const sourceStatus=payload.sourceStatus||{};
  const missingSources=Object.entries(sourceStatus)
    .filter(([,status])=>status?.ok!==true).map(([kind])=>kind);
  const complete=Object.keys(sourceStatus).length>0&&missingSources.length===0;
  const summary={};
  for(const [type,status] of Object.entries(sourceStatus)){
    const typed=rows.filter(row=>row.type===type);
    summary[type]=status?.ok!==true||typed.some(row=>row.value===null)
      ?null:typed.reduce((sum,row)=>sum+row.value,0);
  }
  return {
    success:true,rows:rows.slice(0,500),count:rows.length,
    truncated:rows.length>500,currency:"AZN",
    partial:!complete,missingSources,
    sourceStatus:Object.fromEntries(Object.entries(sourceStatus).map(([type,status])=>[
      type,{ok:status?.ok===true,
        count:rows.filter(row=>row.type===type).length,
        sourceDocumentCount:Number(status?.count||0),
        attempts:Array.isArray(status?.attempts)?status.attempts.map(a=>({
          path:clean(a.path),status:a.status,count:a.count,
          range:a.range||undefined,validResponse:a.validResponse
        })):[]}
    ])),
    summary,selectedDepartmentIds:selectedIds,source:"SH STOCK MOVEMENTS"
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
  const source=await sourceMovements({request:internal,...ownerBrokerContext(ctx,env)});
  if(!source.ok)throw new MobileError("MOVEMENTS_SOURCE_FAILED","SH Server не вернул движения товаров.",502);
  const payload=await source.json().catch(()=>null);
  const statuses=Object.values(payload?.sourceStatus||{});
  if(!statuses.length || statuses.every(s=>s?.ok!==true))
    throw new MobileError("MOVEMENTS_SOURCE_UNAVAILABLE",
      "SH Server не подтвердил ни один источник складских документов.",502);
  return response({...scopedMovements(payload,scope.storeIds,ctx.selectedIds),from,to});
 }catch(e){return errorResponse(e);}
}
