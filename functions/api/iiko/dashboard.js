import { clean, getOlapFields, iikoJson } from "./_lib/iiko-client.js";
import { getCurrentOperatingShifts, resolveOlapCashShiftField } from "./_lib/operational-day.js";

function corsHeaders(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};}
function jsonResponse(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...corsHeaders()}});}
function fieldName(fields,candidates){const norm=s=>clean(s).toLowerCase().replace(/[\s._()-]+/g,"");for(const c of candidates){const x=fields.find(f=>norm(f.name)===norm(c)||norm(f.title)===norm(c));if(x)return x.name;}for(const c of candidates){const q=norm(c);const x=fields.find(f=>norm(f.name).includes(q)||norm(f.title).includes(q));if(x)return x.name;}return null;}
export function buildRequest(q){const rows=Array.isArray(q.rows)?q.rows.filter(Boolean):[];const cols=Array.isArray(q.columns)?q.columns.filter(Boolean):[];const measures=Array.isArray(q.measures)?q.measures.filter(Boolean):[];const from=clean(q.from).slice(0,10),to=clean(q.to||q.from).slice(0,10);const filters={...(q.filters&&typeof q.filters==="object"&&!Array.isArray(q.filters)?q.filters:{})};if(from&&to)filters["OpenDate.Typed"]={filterType:"DateRange",periodType:"CUSTOM",from,to,includeLow:true,includeHigh:true};if(Array.isArray(q.departmentIds)&&q.departmentIds.length)filters["Department.Id"]={filterType:"IncludeValues",values:[...new Set(q.departmentIds.map(String).filter(Boolean))]};if(filters.DeletedWithWriteoff===undefined)filters.DeletedWithWriteoff={filterType:"IncludeValues",values:["NOT_DELETED"]};if(filters.OrderDeleted===undefined)filters.OrderDeleted={filterType:"IncludeValues",values:["NOT_DELETED"]};return{reportType:"SALES",buildSummary:true,groupByRowFields:rows,groupByColFields:cols,aggregateFields:measures,filters};}
async function query(connection,q){const req=buildRequest(q);if(!req.groupByRowFields.length&&!req.groupByColFields.length&&!req.aggregateFields.length)return{success:false,report:{data:[],summary:[]},request:req};const r=await iikoJson(connection,"/resto/api/v2/reports/olap",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(req)});const report=r.payload;if(!r.ok)return{success:false,error:`iiko OLAP HTTP ${r.status}: ${(report?.message||report?.error||r.text).slice(0,3000)}`,request:req,report};return{success:true,request:req,report};}
export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()});}
export async function onRequestPost(context){try{const b=await context.request.json();const connection={ip:clean(b.ip),port:clean(b.port),login:clean(b.login),password:String(b.password??"")};if(!connection.ip||!connection.port||!connection.login||!connection.password)return jsonResponse({success:false,message:"Заполните IP, порт, логин и пароль iiko"},400);const from=clean(b.from).slice(0,10),to=clean(b.to||b.from).slice(0,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return jsonResponse({success:false,message:"Укажите корректный период"},400);const fieldResult=await getOlapFields(connection,"SALES");const fields=fieldResult.fields;const dateField=fieldName(fields,["OpenDate.Typed","OpenDate"]),revenueField=fieldName(fields,["DishDiscountSumInt","DishSumInt","Sales"]),orderField=fieldName(fields,["UniqOrderId","UniqOrderId.Id"]),categoryField=fieldName(fields,["DishCategory","DishCategory.Accounting","Product.Category"]),dishField=fieldName(fields,["DishName","Product.Name","Dish"]),amountField=fieldName(fields,["DishAmountInt","Amount"]),payField=fieldName(fields,["PayTypes","PayTypes.Group","PaymentType"]),hourField=fieldName(fields,["OpenHour","OpenTime.Hour","Hour","Час открытия"]),profitField=fieldName(fields,["ProductCostBase.Profit","Profit"]);if(!dateField||!revenueField)return jsonResponse({success:false,message:"Не найдены необходимые OLAP-поля OpenDate или DishDiscountSumInt",fields},502);const departmentIds=Array.isArray(b.departmentIds)?b.departmentIds.map(String).filter(Boolean):[];const mode=clean(b.mode).toLowerCase()==="operational"?"operational":"calendar";
let operating=null,shiftField=null,effectiveFrom=from,effectiveTo=to;
if(mode==="operational"){
  if(!departmentIds.length)return jsonResponse({success:false,
    code:"OPERATING_SCOPE_REQUIRED",message:"Выберите рестораны для расчёта по кассовым сменам."},409);
  try{operating=await getCurrentOperatingShifts(connection,departmentIds);}
  catch(e){return jsonResponse({success:false,code:e?.code||"OPERATING_SHIFTS_FAILED",
    message:e?.message||"Не удалось определить кассовые смены."},e?.status||502);}
  shiftField=resolveOlapCashShiftField(fields);
  if(!shiftField)return jsonResponse({success:false,
    code:"OLAP_SHIFT_FIELD_UNAVAILABLE",
    message:"SH OLAP не предоставил поле идентификатора кассовой смены. Календарные продажи нельзя выдавать за операционные."},409);
  effectiveFrom=operating.from;effectiveTo=operating.to;
}
const shiftFilters=shiftField?{
  [shiftField]:{filterType:"IncludeValues",values:operating.shiftIds}
}:{};
const queries={daily:{rows:[dateField],measures:[revenueField,...(orderField?[orderField]:[]),...(profitField?[profitField]:[])],from:effectiveFrom,to:effectiveTo,departmentIds,filters:shiftFilters},categories:categoryField?{rows:[categoryField],measures:[revenueField],from:effectiveFrom,to:effectiveTo,departmentIds,filters:shiftFilters}:null,payments:payField?{rows:[payField],measures:[revenueField],from:effectiveFrom,to:effectiveTo,departmentIds,filters:shiftFilters}:null,dishes:dishField?{rows:[dishField,...(categoryField?[categoryField]:[])],measures:[revenueField,...(amountField?[amountField]:[])],from:effectiveFrom,to:effectiveTo,departmentIds,filters:shiftFilters}:null,hours:hourField?{rows:[hourField],measures:[revenueField],from:effectiveFrom,to:effectiveTo,departmentIds,filters:shiftFilters}:null};const entries=Object.entries(queries);const results=await Promise.all(entries.map(async([key,q])=>[key,q?await query(connection,q):{success:true,report:{data:[],summary:[]}}]));const reports=Object.fromEntries(results);return jsonResponse({success:true,from:effectiveFrom,to:effectiveTo,departmentIds,
  fields,revenueField,orderField,categoryField,dishField,amountField,payField,
  hourField,profitField,reports,mode,
  operatingDay:operating?{
    from:operating.from,to:operating.to,
    activeShiftCount:operating.activeShiftCount,shiftCount:operating.shiftCount,
    departments:operating.departments,field:shiftField,
    precision:"SHIFT_IDS_VERIFIED"
  }:null,
  meta:{olapFieldsCacheHit:fieldResult.cacheHit}});}catch(e){return jsonResponse({success:false,message:e?.message||"Ошибка Dashboard OLAP"},502);}}
