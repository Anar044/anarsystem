import { clean, getOlapFields, iikoJson } from "./_lib/iiko-client.js";
import { getCurrentOperatingShifts, resolveOlapCashShiftField } from "./_lib/operational-day.js";

function corsHeaders(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};}
function jsonResponse(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...corsHeaders()}});}
function fieldName(fields,candidates){const norm=s=>clean(s).toLowerCase().replace(/[\s._()-]+/g,"");for(const c of candidates){const x=fields.find(f=>norm(f.name)===norm(c)||norm(f.title)===norm(c));if(x)return x.name}for(const c of candidates){const q=norm(c),x=fields.find(f=>norm(f.name).includes(q)||norm(f.title).includes(q));if(x)return x.name}return null;}
async function query(connection,{dateField,revenueField,orderField,profitField,discountField,surchargeField,costField,departmentField,from,to,departmentIds,shiftField,shiftIds}){const filters={};filters["OpenDate.Typed"]={filterType:"DateRange",periodType:"CUSTOM",from,to,includeLow:true,includeHigh:true};if(departmentIds.length&&departmentField)filters[departmentField]={filterType:"IncludeValues",values:[...new Set(departmentIds)]};if(shiftField&&shiftIds?.length)filters[shiftField]={filterType:"IncludeValues",values:shiftIds};filters.DeletedWithWriteoff={filterType:"IncludeValues",values:["NOT_DELETED"]};filters.OrderDeleted={filterType:"IncludeValues",values:["NOT_DELETED"]};const aggregateFields=[...new Set([revenueField,orderField,profitField,discountField,surchargeField,costField].filter(Boolean))];const req={reportType:"SALES",buildSummary:true,groupByRowFields:[dateField],groupByColFields:[],aggregateFields,filters};const r=await iikoJson(connection,"/resto/api/v2/reports/olap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(req)});if(!r.ok || r.payload?.success===false || r.payload?.error===true ||
    r.payload?.errorCode || r.payload?.errorMessage ||
    !(Array.isArray(r.payload)||Array.isArray(r.payload?.data))){
    const reason=String(r.payload?.message||r.payload?.errorMessage||
      r.payload?.errorCode||"OLAP data missing").slice(0,200);
    return {success:false,error:`SH OLAP не вернул подтверждённые строки (HTTP ${r.status}): ${reason}`,
      request:req,report:null,authCacheHit:r.auth?.cacheHit===true};
  }
  return{success:true,request:req,report:r.payload,authCacheHit:r.auth?.cacheHit===true};}
export function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()});}
export async function onRequestPost(context){try{const b=await context.request.json();const connection={ip:clean(b.ip),port:clean(b.port),login:clean(b.login),password:String(b.password??"")};if(!connection.ip||!connection.port||!connection.login||!connection.password)return jsonResponse({success:false,message:"Заполните IP, порт, логин и пароль iiko"},400);const from=clean(b.from).slice(0,10),to=clean(b.to||b.from).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return jsonResponse({success:false,message:"Укажите корректный период"},400);const fieldResult=await getOlapFields(connection,"SALES");const fields=fieldResult.fields;const dateField=fieldName(fields,["OpenDate.Typed","OpenDate"]),revenueField=fieldName(fields,["DishDiscountSumInt","DishSumInt","Sales"]),orderField=fieldName(fields,["UniqOrderId","UniqOrderId.Id"]),profitField=fieldName(fields,["ProductCostBase.Profit","Profit"]),discountField=fieldName(fields,["DiscountSumInt","DiscountSum","DiscountAmountInt","DiscountAmount","DiscountSumWithoutTax","DiscountAmountWithoutTax"]),surchargeField=fieldName(fields,["IncreaseSumInt","IncreaseSum","IncreaseAmountInt","IncreaseAmount","SurchargeSumInt","SurchargeSum","ExtraChargeSum"]),costField=fieldName(fields,["ProductCostBase.Cost","ProductCostBase.Sum","ProductCostBase.CostSum","ProductCostBase.CostAmount","ProductCostBase.IngredientCost"]),departmentField=fieldName(fields,["Department.Id","DepartmentId","Department.ID"]);if(!dateField||!revenueField)throw new Error("Не найдены необходимые OLAP-поля");const departmentIds=Array.isArray(b.departmentIds)?[...new Set(b.departmentIds.map(clean).filter(Boolean))]:[];if(departmentIds.length&&!departmentField)throw new Error("Не найдено OLAP-поле Department.Id — нельзя безопасно ограничить Dashboard выбранным рестораном");const mode=clean(b.mode).toLowerCase()==="operational"?"operational":"calendar";
if(mode==="operational"&&!departmentIds.length)return jsonResponse({
  success:false,code:"OPERATING_SCOPE_REQUIRED",message:"Выберите рестораны для расчёта по кассовым сменам."
},409);
let operating=null,shiftField=null;
let effectiveFrom=from,effectiveTo=to;
if(mode==="operational"){
  try{operating=await getCurrentOperatingShifts(connection,departmentIds);}
  catch(e){return jsonResponse({success:false,code:e?.code||"OPERATING_SHIFTS_FAILED",
    message:e?.message||"Не удалось определить кассовые смены."},e?.status||502);}
  shiftField=resolveOlapCashShiftField(fields);
  if(!shiftField)return jsonResponse({
    success:false,code:"OLAP_SHIFT_FIELD_UNAVAILABLE",
    message:"SH OLAP не предоставил поле идентификатора кассовой смены. Показывать календарные продажи как операционные нельзя."
  },409);
  effectiveFrom=operating.from;effectiveTo=operating.to;
}
const daily=await query(connection,{dateField,revenueField,orderField,profitField,discountField,surchargeField,costField,
  departmentField,from:effectiveFrom,to:effectiveTo,departmentIds,shiftField,
  shiftIds:operating?.shiftIds});return jsonResponse({success:true,from:effectiveFrom,to:effectiveTo,departmentIds,fields,
  revenueField,orderField,profitField,discountField,surchargeField,costField,departmentField,reports:{daily},
  mode,operatingDay:operating?{
    from:operating.from,to:operating.to,activeShiftCount:operating.activeShiftCount,
    shiftCount:operating.shiftCount,departments:operating.departments,
    field:shiftField,precision:"SHIFT_IDS_VERIFIED"
  }:null,
  meta:{sharedIikoClient:true,authCacheHit:daily.authCacheHit===true,
    olapFieldsCacheHit:fieldResult.cacheHit===true,
    departmentScopeApplied:departmentIds.length>0}});}catch(e){return jsonResponse({success:false,message:e?.message||"Ошибка Dashboard Summary"},502);}}
