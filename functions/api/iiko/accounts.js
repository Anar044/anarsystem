import { clean, iikoJson } from './_lib/iiko-client.js';

function corsHeaders(){return {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};}
function jsonResponse(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...corsHeaders()}});}
function asArray(payload){if(Array.isArray(payload))return payload;for(const k of ["items","accounts","data","rows"]){if(Array.isArray(payload?.[k]))return payload[k];}return [];}
function normalize(item){if(!item||typeof item!=="object")return null;const id=item.id??item.Id??item.ID;if(id==null||String(id).trim()==="")return null;return {id:String(id),accountParentId:item.accountParentId??item.parentId??null,parentCorporateId:item.parentCorporateId??null,code:String(item.code??""),deleted:item.deleted===true,name:String(item.name??item.code??id),type:String(item.type??""),system:item.system===true,customTransactionsAllowed:item.customTransactionsAllowed===true,rootType:String(item.rootType??"Account"),balance:null,balanceSource:""};}
function localTimestamp(){const d=new Date();const pad=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;}
function normalizeTimestamp(value){const fallback=localTimestamp();if(!value)return fallback;const s=String(value).trim();if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s))return s;const d=new Date(s);if(Number.isNaN(d.getTime()))return fallback;const pad=n=>String(n).padStart(2,"0");return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;}
function balanceDepartmentId(item){
  for(const value of [
    item?.departmentId,item?.departmentID,item?.departmentGuid,item?.departmentGUID,(typeof item?.department==="string"?item.department:null),item?.department?.id,item?.department?.uuid,
    item?.organizationId,item?.organisationId,item?.restaurantId,item?.organization?.id,item?.restaurant?.id
  ]){
    const id=clean(value);
    if(id)return id;
  }
  return "";
}
async function fetchBalances(connection,timestamp,departmentIds=[]){
  const ts=normalizeTimestamp(timestamp);
  const q=new URLSearchParams({timestamp:ts});
  for(const id of departmentIds)q.append("department",id);
  const path=`/resto/api/v2/reports/balance/counteragents?${q.toString()}`;
  const r=await iikoJson(connection,path);
  if(!r.ok)throw new Error(`SH Server вернул HTTP ${r.status} для API балансов счетов${r.text?`: ${r.text.slice(0,500)}`:""}`);
  if(!r.payload)throw new Error("API балансов счетов вернул не JSON");

  let list=asArray(r.payload);
  const detectedDepartmentIds=[...new Set(list.map(balanceDepartmentId).filter(Boolean))];

  if(departmentIds.length&&detectedDepartmentIds.length){
    const wanted=new Set(departmentIds.map(String));
    list=list.filter(item=>wanted.has(balanceDepartmentId(item)));
  }

  const balances={};
  for(const item of list){
    const id=item?.account??item?.accountId??item?.Account;
    if(id==null)continue;
    const sum=Number(item?.sum??item?.balance??item?.amount??0);
    if(!Number.isFinite(sum))continue;
    const key=String(id);
    balances[key]=(balances[key]||0)+sum;
  }

  return {
    balances,
    timestamp:ts,
    endpoint:"/resto/api/v2/reports/balance/counteragents",
    rows:list.length,
    detectedDepartmentIds,
    authCacheHit:Boolean(r.auth?.cacheHit)
  };
}
async function fetchAccounts(connection,includeDeleted){const query=`includeDeleted=${includeDeleted?"true":"false"}`;const endpoints=[`/resto/api/v2/entities/accounts/list?${query}&revisionFrom=-1`,`/resto/api/v2/entities/accounts/list?${query}`];let lastStatus=0,lastText="";for(const path of endpoints){const r=await iikoJson(connection,path,{headers:{Accept:"application/json, application/xml, text/xml"}});if(r.ok){if(!r.payload)return {ok:false,status:502,message:"API счетов вернул XML вместо JSON. Нужен JSON-ответ для этого endpoint.",rawPreview:r.text.slice(0,1000)};return {ok:true,payload:r.payload,endpoint:path.split("?")[0],authCacheHit:Boolean(r.auth?.cacheHit)};}lastStatus=r.status;lastText=r.text;}return {ok:false,status:502,message:`SH Server вернул HTTP ${lastStatus} для API счетов`,details:lastText.slice(0,1500),triedEndpoints:endpoints.map(x=>x.split("?")[0])};}
export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()});}
export async function onRequestPost(context){try{const body=await context.request.json();const connection={ip:clean(body.ip),port:clean(body.port),login:clean(body.login),password:String(body.password||"")};if(!connection.ip||!connection.port||!connection.login||!connection.password)return jsonResponse({success:false,message:"Заполните IP, порт, логин и пароль SH Server"},400);const includeDeleted=body.includeDeleted===true;
const departmentIds=Array.isArray(body.departmentIds)?body.departmentIds.map(String).filter(Boolean):[];
const allowedIds=Array.isArray(body?.chainScope?.allowedDepartmentIds)?body.chainScope.allowedDepartmentIds.map(String).filter(Boolean):[];
const subsetRequested=String(body?.chainScope?.mode||"").toUpperCase()==="CHAIN"&&departmentIds.length>0&&allowedIds.length>departmentIds.length;
const [accountResult,balanceResult]=await Promise.all([fetchAccounts(connection,includeDeleted),fetchBalances(connection,body.timestamp,departmentIds)]);if(!accountResult.ok)return jsonResponse({success:false,message:accountResult.message,rawPreview:accountResult.rawPreview,details:accountResult.details,triedEndpoints:accountResult.triedEndpoints},accountResult.status||502);const normalizedAccounts=asArray(accountResult.payload).map(normalize).filter(Boolean);const accounts=normalizedAccounts.filter(a=>includeDeleted||a.deleted!==true);const deletedFiltered=normalizedAccounts.length-accounts.length;const counts={};for(const a of accounts){counts[a.type]=(counts[a.type]||0)+1;a.balance=Object.prototype.hasOwnProperty.call(balanceResult.balances,a.id)?balanceResult.balances[a.id]:0;a.balanceSource="iiko Server: reports/balance/counteragents";}return jsonResponse({success:true,source:"sh-server",endpoint:accountResult.endpoint,balanceEndpoint:balanceResult.endpoint,balanceTimestamp:balanceResult.timestamp,balanceRows:balanceResult.rows,count:accounts.length,accounts,typeCounts:counts,includeDeleted,meta:{accountAuthCacheHit:accountResult.authCacheHit,balanceAuthCacheHit:balanceResult.authCacheHit,departmentIds,detectedDepartmentIds:balanceResult.detectedDepartmentIds,departmentScopeApplied:departmentIds.length>0,scopeSource:"balance/counteragents department filter",deletedAccountsFiltered:deletedFiltered}});}catch(error){return jsonResponse({success:false,code:error?.code||undefined,message:error?.message||"Ошибка получения счетов SH Server"},Number(error?.status)||502);}}