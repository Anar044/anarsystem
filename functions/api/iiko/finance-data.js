import { clean, iikoJson } from './_lib/iiko-client.js';

function corsHeaders(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};}
function jsonResponse(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...corsHeaders()}});}
function parseDate(v){const m=String(v||"").trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return null;const d=new Date(Date.UTC(+m[1],+m[2]-1,+m[3]));return d.getUTCFullYear()===+m[1]&&d.getUTCMonth()===+m[2]-1&&d.getUTCDate()===+m[3]?d:null;}
function iso(d){return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,"0")}-${String(d.getUTCDate()).padStart(2,"0")}`;}
function extractList(p){if(Array.isArray(p))return p;for(const k of ["items","sessions","cashShifts","cashSessions","data","rows"])if(Array.isArray(p?.[k]))return p[k];return[];}
function sid(x){return String(x?.id??x?.sessionId??x?.sessionID??x?.uuid??x?.UUID??"").trim();}
function shiftDate(x,f){for(const k of ["businessDate","operatingDay","operationalDay","date","openDate","openedAt","openTime","startDate","startTime"]){const v=x?.[k];const m=String(v??"").match(/(\d{4})[-.](\d{2})[-.](\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;}return f;}
function normalizeShift(x,date,status){return x&&typeof x==="object"?{...x,_sessionId:sid(x),_dateKey:shiftDate(x,date),_requestedStatus:status}:null;}
function normDepartmentId(value){return String(value??"").trim().replace(/^\{+|\}+$/g,"").toLowerCase()}
function shiftDepartmentId(x){for(const v of[
  x?.departmentId,x?.departmentID,x?.department?.id,x?.department?.uuid,x?.department?.guid,x?.departmentGuid,
  x?.organizationId,x?.organisationId,x?.restaurantId,x?.organization?.id,x?.organisation?.id,x?.restaurant?.id
]){const s=String(v??"").trim();if(s)return s}return"";}
function recordsFrom(p){if(!p||typeof p!=="object")return[];const groups=[["CARD",p.cashlessRecords],["PAYIN",p.payInRecords],["PAYOUT",p.payOutRecords||p.payOuts]];const out=[];for(const [fallback,list] of groups)if(Array.isArray(list))for(const r of list){const i=r?.info||{};out.push({id:i.id??r.id??null,group:i.group??r.group??fallback,sum:i.sum??r.sum??r.actualSum??r.originalSum??null,actualSum:r.actualSum??null,originalSum:r.originalSum??i.sum??null,accountId:i.accountId??r.accountId??r.editedPayAccountId??r.originalPayAccountId??null,counteragentId:i.counteragentId??r.counteragentId??null,paymentTypeId:i.paymentTypeId??r.paymentTypeId??null,type:i.type??r.type??null,cashierId:i.cashierId??r.cashierId??null,date:i.date??r.date??null,creationDate:i.creationDate??r.creationDate??null,comment:i.comment??r.comment??r.editableComment??"",status:r.status??i.status??null});}return out;}
async function mapLimit(items,limit,worker){const result=new Array(items.length);let cursor=0;async function run(){while(true){const i=cursor++;if(i>=items.length)return;result[i]=await worker(items[i],i)}}await Promise.all(Array.from({length:Math.min(limit,items.length)},run));return result;}
async function shiftsForRange(connection,from,to,departmentId="",departmentName=""){
  const q=new URLSearchParams({openDateFrom:from,openDateTo:to,status:"ANY"});
  if(departmentId)q.set("departmentId",departmentId);
  const primary=await iikoJson(connection,`/resto/api/v2/cashshifts/list?${q.toString()}`);
  if(primary.ok){
    return{ok:true,shifts:extractList(primary.payload).map(x=>({...normalizeShift(x,from,"ANY"),_departmentId:shiftDepartmentId(x)||departmentId||"",_departmentName:String(departmentName||"").trim()})).filter(Boolean),authCacheHit:Boolean(primary.auth?.cacheHit),format:"range+ANY"};
  }
  const all=[];const errors=[];let authCacheHit=Boolean(primary.auth?.cacheHit);
  for(const status of ["OPEN","CLOSED"]){
    const fq=new URLSearchParams({openDateFrom:from,openDateTo:to,status});
    if(departmentId)fq.set("departmentId",departmentId);
    const r=await iikoJson(connection,`/resto/api/v2/cashshifts/list?${fq.toString()}`);
    authCacheHit=authCacheHit||Boolean(r.auth?.cacheHit);
    if(r.ok)all.push(...extractList(r.payload).map(x=>({...normalizeShift(x,from,status),_departmentId:shiftDepartmentId(x)||departmentId||"",_departmentName:String(departmentName||"").trim()})).filter(Boolean));
    else errors.push({status,httpStatus:r.status,message:(r.text||"").slice(0,500)});
  }
  return all.length?{ok:true,shifts:all,authCacheHit,format:"range+OPEN+CLOSED",fallback:true}:{ok:false,shifts:[],authCacheHit,error:{from,to,departmentId,httpStatus:primary.status,message:(primary.text||"").slice(0,500),fallbackErrors:errors}};
}
async function detail(connection,id){
  const sidv=encodeURIComponent(id);
  const b=await iikoJson(connection,`/resto/api/v2/cashshifts/payments/list/${sidv}?hideAccepted=false`);
  if(!b.ok)return{success:false,sessionId:id,message:`Не удалось получить оплаты смены: HTTP ${b.status}`};
  const p=b.payload&&typeof b.payload==="object"?b.payload:{};
  return{success:true,sessionId:id,shift:null,payments:recordsFrom(p),paymentsLoaded:true,paymentsStatus:b.status,operationDay:p.operationDay||null};
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()});}
export async function onRequestPost(context){try{const b=await context.request.json();const connection={ip:clean(b.ip),port:clean(b.port),login:clean(b.login),password:String(b.password||"")};if(!connection.ip||!connection.port||!connection.login||!connection.password)return jsonResponse({success:false,message:"Заполните IP, порт, логин и пароль SH Server"},400);const departmentIds=Array.isArray(b.departmentIds)?[...new Set(b.departmentIds.map(String).filter(Boolean))]:[];const mode=String(b.mode||"list").toLowerCase();if(mode==="details"){
  const ids=Array.isArray(b.sessionIds)?[...new Set(b.sessionIds.map(x=>String(x||"").trim()).filter(Boolean))]:[];
  if(!ids.length)return jsonResponse({success:false,message:"Не указаны ID кассовых смен"},400);
  if(ids.length>30)return jsonResponse({success:false,message:"За один запрос можно получить детали максимум для 30 смен"},400);
  const allowedIds=Array.isArray(b?.chainScope?.allowedDepartmentIds)?b.chainScope.allowedDepartmentIds.map(String).filter(Boolean):[];
  const subsetRequested=String(b?.chainScope?.mode||"").toUpperCase()==="CHAIN"&&departmentIds.length>0&&allowedIds.length>departmentIds.length;
  if(subsetRequested){
    const vf=parseDate(b.from),vt=parseDate(b.to);
    if(!vf||!vt)return jsonResponse({success:false,message:"Для безопасной проверки деталей смены нужен период from/to"},400);
    const scoped=await mapLimit(departmentIds,4,id=>shiftsForRange(connection,iso(vf),iso(vt),id));
    const allowedSessions=new Set(scoped.flatMap(x=>x.ok?x.shifts:[]).map(x=>sid(x)).filter(Boolean));
    const forbidden=ids.filter(id=>!allowedSessions.has(id));
    if(forbidden.length)return jsonResponse({success:false,code:"CASH_SHIFT_SCOPE_FORBIDDEN",message:"Одна или несколько кассовых смен не относятся к выбранным ресторанам.",meta:{forbiddenSessionIds:forbidden.slice(0,20)}},403);
  }
  const results=await mapLimit(ids,6,id=>detail(connection,id));
  return jsonResponse({success:true,mode,details:results,meta:{requested:ids.length,concurrency:6,departmentIds,subsetRequested}});
}
const from=parseDate(b.from),to=parseDate(b.to);
if(!from||!to)return jsonResponse({success:false,message:"Укажите корректный период дат"},400);
if(to<from)return jsonResponse({success:false,message:"Дата окончания не может быть раньше даты начала"},400);
const days=Math.round((to-from)/86400000)+1;
if(days>62)return jsonResponse({success:false,message:"Период кассовых смен ограничен 62 днями за один запрос"},400);
const allowedIds=Array.isArray(b?.chainScope?.allowedDepartmentIds)?b.chainScope.allowedDepartmentIds.map(String).filter(Boolean):[];
const explicitMode=String(b?.chainScope?.mode||"").toUpperCase();
const chainMode=explicitMode==="CHAIN"||departmentIds.length>1||allowedIds.length>1;
const subsetRequested=chainMode&&departmentIds.length>0&&allowedIds.length>departmentIds.length;
// In CHAIN always request each selected Department separately, including the
// "all restaurants" selection. This guarantees every shift can be labeled
// with its restaurant even when the cash-shift payload itself omits Department.
const departmentNames=new Map(
  (Array.isArray(b?.chainScope?.departments)?b.chainScope.departments:[])
    .map(x=>[normDepartmentId(x?.id),String(x?.name||"").trim()])
    .filter(x=>x[0]&&x[1])
);
const selectedNames=Array.isArray(b?.chainScope?.selectedDepartmentNames)?b.chainScope.selectedDepartmentNames:[];
departmentIds.forEach((id,index)=>{
  const key=normDepartmentId(id),name=String(selectedNames[index]||"").trim();
  if(key&&name&&!departmentNames.has(key))departmentNames.set(key,name);
});
const targets=chainMode&&departmentIds.length
  ? departmentIds.map(id=>({id,name:departmentNames.get(normDepartmentId(id))||""}))
  : [{id:"",name:""}];
const rangeResults=await mapLimit(targets,4,target=>shiftsForRange(connection,iso(from),iso(to),target.id,target.name));
const all=[],errors=[],formats=new Set();let authCacheHit=false;
for(const r of rangeResults){
  authCacheHit=authCacheHit||r.authCacheHit===true;
  if(r.ok){all.push(...r.shifts);if(r.format)formats.add(r.format);}
  else if(r.error)errors.push(r.error);
}
const seen=new Set();
let shifts=all.filter(x=>{const id=sid(x)||JSON.stringify(x);if(seen.has(id))return false;seen.add(id);return true;});
const detectedDepartmentIds=[...new Set(shifts.map(x=>x._departmentId||shiftDepartmentId(x)).filter(Boolean))];
if(subsetRequested){
  const wanted=new Set(departmentIds);
  shifts=shifts.filter(x=>wanted.has(String(x._departmentId||shiftDepartmentId(x)||"")));
}
return jsonResponse({
  success:true,mode:"list",from:b.from,to:b.to,count:shifts.length,shifts,errors,
  endpoint:"/resto/api/v2/cashshifts/list",
  meta:{days,rangeRequests:targets.length,formats:[...formats],departmentIds,allowedDepartmentIds:allowedIds,detectedDepartmentIds,departmentScopeApplied:chainMode&&departmentIds.length>0,subsetRequested,chainMode,restaurantNamesAttached:[...departmentNames.values()].filter(Boolean).length,authCacheHit}
});
}catch(e){return jsonResponse({success:false,message:e?.message||"Ошибка получения финансовых данных"},502);}}
