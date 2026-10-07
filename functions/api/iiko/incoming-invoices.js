import { syncAiReferences } from "./references.js";
import { getIikoAuth, iikoText, iikoJson } from "./_lib/iiko-client.js";
import { loadCachedReferenceMaps } from "./_lib/reference-cache.js";
import { resolveStoreScope } from "./_lib/store-scope.js";
import { getIikoSuppliers } from "./_lib/iiko-suppliers.js";

function corsHeaders(){return {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization","Content-Type":"application/json; charset=utf-8"};}
function jsonResponse(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders(),"Cache-Control":"no-store"}});}
function xmlDecode(value){return String(value??"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");}
function tag(block,name){const m=String(block||"").match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`,`i`));return m?xmlDecode(m[1].trim()):"";}
function nullableTag(block,name){const v=tag(block,name);return ["","null","undefined","nil","none"].includes(String(v||"").trim().toLowerCase())?null:v;}
function blocks(source,name){const out=[];const re=new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`,`gi`);let m;while((m=re.exec(String(source||""))))out.push(m[0]);return out;}
function number(v){const n=Number(String(v??"").replace(/\\s/g,"").replace(",","."));return Number.isFinite(n)?n:null;}
function parseItems(block){return blocks(block,"item").map((b,i)=>({num:tag(b,"num")||String(i+1),amount:number(tag(b,"amount")),actualAmount:number(tag(b,"actualAmount")),productId:tag(b,"product"),productArticle:tag(b,"productArticle"),supplierProduct:tag(b,"supplierProduct"),supplierProductArticle:tag(b,"supplierProductArticle"),amountUnit:tag(b,"amountUnit"),containerId:tag(b,"containerId"),actualUnitWeight:number(tag(b,"actualUnitWeight")),price:number(tag(b,"price")),priceWithoutVat:number(tag(b,"priceWithoutVat")),sum:number(tag(b,"sum")),sumWithoutNds:number(tag(b,"sumWithoutNds"))??number(tag(b,"sumWithoutVat")),vatPercent:number(tag(b,"vatPercent")||tag(b,"ndsPercent")),vatSum:number(tag(b,"vatSum")),storeId:tag(b,"store")}));}
function parseDocuments(xml){const source=String(xml||"");let list=blocks(source,"document");if(!list.length)list=blocks(source,"incomingInvoice");if(!list.length)list=blocks(source,"incomingInvoiceDocument");return list.map((b,i)=>{const items=parseItems(b);const itemTotal=items.reduce((s,x)=>s+(Number.isFinite(x.sum)?x.sum:0),0);const vatTotal=items.reduce((s,x)=>s+(x.vatSum||0),0);const documentSum=number(tag(b,"sum"))??number(tag(b,"totalSum"))??number(tag(b,"amount"));const sum=itemTotal>0?itemTotal:(documentSum??null);return {id:tag(b,"id")||null,documentNumber:tag(b,"documentNumber")||tag(b,"number")||null,dateIncoming:tag(b,"dateIncoming")||tag(b,"date")||null,incomingDate:tag(b,"incomingDate")||null,invoice:tag(b,"invoice")||null,incomingDocumentNumber:tag(b,"incomingDocumentNumber")||null,transportInvoiceNumber:tag(b,"transportInvoiceNumber")||null,supplierId:tag(b,"supplier")||tag(b,"supplierId")||null,storeId:tag(b,"defaultStore")||tag(b,"store")||tag(b,"storeId")||null,dueDate:nullableTag(b,"dueDate"),status:tag(b,"status")||null,comment:nullableTag(b,"comment"),conception:tag(b,"conception")||null,employeeId:tag(b,"employeePassToAccount")||null,sum,documentSum,vatSum:vatTotal||number(tag(b,"vatSum")),itemsCount:items.length,items,rawIndex:i};}).filter(d=>d.documentNumber||d.id||d.dateIncoming||d.itemsCount);}
function allDigits(s){return String(s||"").length>0&&String(s).split("").every(ch=>ch>="0"&&ch<="9");}
function dateParts(value){const s=String(value||"").trim();if(s.length===10&&s[4]==="-"&&s[7]==="-"){const p=s.split("-");if(p.length===3&&p.every(allDigits))return {y:p[0],m:p[1],d:p[2],iso:s};}if(s.length===10&&s[2]==="."&&s[5]==="."){const p=s.split(".");if(p.length===3&&p.every(allDigits))return {y:p[2],m:p[1],d:p[0],iso:`${p[2]}-${p[1]}-${p[0]}`};}return null;}
function dateFormats(value){const p=dateParts(value);if(!p)return [];return [String(value).trim(),`${p.d}.${p.m}.${p.y}`];}
function dateKey(value){const p=dateParts(value);return p?p.iso:"";}
function filterByRange(docs,from,to){const a=dateKey(from),b=dateKey(to);if(!a||!b)return docs;return docs.filter(d=>{const k=dateKey(d.dateIncoming||d.incomingDate);return !k||(k>=a&&k<=b);});}
async function requestXml(connection,path){return iikoText(connection,path,{headers:{Accept:"application/xml,text/xml,*/*"}});}
function key(v){return String(v??"").trim().replace(/^\{+|\}+$/g,"").toLowerCase();}
function collectBalanceWarehouses(payload){
  const map=new Map();
  const add=(id,name)=>{
    const k=key(id),label=String(name??"").trim();
    if(k&&label&&!map.has(k))map.set(k,label);
  };
  const walk=v=>{
    if(Array.isArray(v)){v.forEach(walk);return;}
    if(!v||typeof v!=="object")return;
    const store=v.store??v.storeId??v.warehouse??v.warehouseId;
    const storeName=v.storeName??v.warehouseName;
    if(store&&typeof store==="object"){
      add(store.id??store.uuid??store.entityId??store.storeId??store.warehouseId,
          store.name??store.title??store.description??storeName);
    }else if(store){
      add(store,storeName);
    }
    Object.values(v).forEach(x=>{if(x&&typeof x==="object")walk(x);});
  };
  walk(payload);
  return map;
}
async function getBalanceWarehouses(connection){
  const timestamp=new Date().toISOString().slice(0,19);
  const r=await iikoJson(connection,"/resto/api/v2/reports/balance/stores?timestamp="+encodeURIComponent(timestamp),{timeoutMs:60000});
  return {map:r.ok&&r.payload?collectBalanceWarehouses(r.payload):new Map(),status:r.status,ok:r.ok};
}

function entityList(payload){
  if(Array.isArray(payload))return payload;
  if(Array.isArray(payload?.items))return payload.items;
  if(Array.isArray(payload?.data))return payload.data;
  if(Array.isArray(payload?.response))return payload.response;
  if(Array.isArray(payload?.results))return payload.results;
  return [];
}
function accountNameMap(payload,wantedIds=[]){
  const wanted=new Set((wantedIds||[]).map(key).filter(Boolean));
  const map=new Map();
  const add=v=>{
    if(!v||typeof v!=="object")return;
    const id=key(v.id??v.uuid??v.entityId??v.accountId);
    const name=String(v.name??v.title??v.description??v.fullName??"").trim();
    if(id&&name&&(!wanted.size||wanted.has(id))&&!map.has(id))map.set(id,name);
  };
  const walk=v=>{
    if(Array.isArray(v)){v.forEach(walk);return;}
    if(!v||typeof v!=="object")return;
    add(v);
    Object.values(v).forEach(x=>{if(x&&typeof x==="object")walk(x);});
  };
  walk(payload);
  return map;
}
async function getAccountNames(connection,wantedIds=[]){
  const r=await iikoJson(connection,"/resto/api/v2/entities/list?rootType=Account&includeDeleted=false",{timeoutMs:60000});
  return {map:r.ok&&r.payload?accountNameMap(r.payload,wantedIds):new Map(),status:r.status,ok:r.ok};
}

function applyNames(docs,refs){return docs.map(d=>{const supplierName=refs.suppliers.get(key(d.supplierId))||d.supplierId||"—";const storeName=refs.warehouses.get(key(d.storeId))||d.storeId||"—";const items=Array.isArray(d.items)?d.items.map(x=>({...x,productName:refs.products.get(key(x.productId))||x.productId||"—",storeName:refs.warehouses.get(key(x.storeId))||x.storeId||"—"})):d.items;return {...d,supplierName,storeName,items};});}
function supplierDebug(docs,maps){const ids=[...new Set(docs.map(d=>key(d.supplierId)).filter(Boolean))];const resolved=ids.filter(id=>maps.suppliers.has(id));return {invoiceSupplierIds:ids,resolvedSupplierIds:resolved,unresolvedSupplierIds:ids.filter(id=>!maps.suppliers.has(id)),supplierReferenceCount:maps.suppliers.size};}
async function getReferences(env,auth,neededSupplierIds=[]){try{
  const cached=await loadCachedReferenceMaps(env,auth.serverUrl,neededSupplierIds,{
    ttlMs:6*60*60*1000,
    allowStale:true,
    requiredKeys:["suppliers","warehouses","products"]
  });
  if(cached)return {...cached,diagnostics:{cache:{hit:true,stale:cached.stale===true,ageMs:cached.ageMs,ttlMs:cached.ttlMs}}};
  const synced=await syncAiReferences(env,auth.serverUrl,auth.token);
  return {...synced,cacheHit:false};
}catch(e){return {maps:{suppliers:new Map(),warehouses:new Map(),products:new Map(),groups:new Map(),categories:new Map()},cacheHit:false,diagnostics:{error:String(e?.message||e)}};}}
async function getInvoices(connection,from,to){const attempts=[];const seen=new Set();const fromFormats=dateFormats(from),toFormats=dateFormats(to);const tryRequest=async(label,path)=>{const result=await requestXml(connection,path);const docs=result.ok?parseDocuments(result.text):[];attempts.push({label,status:result.status,ok:result.ok,length:result.text.length,contentType:result.contentType,documents:docs.length,preview:result.text.slice(0,800)});return {result,docs};};for(const f of fromFormats)for(const t of toFormats){const k=`${f}|${t}`;if(seen.has(k))continue;seen.add(k);const params=new URLSearchParams({from:f,to:t});const a=await tryRequest(`${f} → ${t}`,`/resto/api/documents/export/incomingInvoice?${params.toString()}`);if(a.result.ok&&a.docs.length)return {docs:a.docs,from:f,to:t,attempts};}const fallback=await tryRequest("без фильтра дат","/resto/api/documents/export/incomingInvoice");if(fallback.result.ok&&fallback.docs.length)return {docs:filterByRange(fallback.docs,from,to),from,to,attempts,serverDocuments:fallback.docs.length};return {docs:[],from,to,attempts};}
export async function onRequestOptions(){return new Response(null,{status:204,headers:{...corsHeaders()}});}
export async function onRequestPost(context){try{const b=await context.request.json();const connection={ip:String(b.ip||"").trim(),port:String(b.port||"").trim(),login:String(b.login||"").trim(),password:String(b.password||"")};if(!connection.ip||!connection.port||!connection.login||!connection.password)return jsonResponse({success:false,message:"Заполните IP, порт, логин и пароль SH Server"},400);const fromFormats=dateFormats(b.from),toFormats=dateFormats(b.to);if(!fromFormats.length||!toFormats.length)return jsonResponse({success:false,message:"Укажите период в формате даты"},400);if(dateKey(b.to)<dateKey(b.from))return jsonResponse({success:false,message:"Дата «По» раньше даты «С»"},400);const result=await getInvoices(connection,b.from,b.to);
const bodyDepartmentIds=Array.isArray(b.departmentIds)?b.departmentIds:[];
const scopeDepartmentIds=Array.isArray(b?.chainScope?.selectedDepartmentIds)?b.chainScope.selectedDepartmentIds:[];
const departmentIds=[...new Set((bodyDepartmentIds.length?bodyDepartmentIds:scopeDepartmentIds).map(String).filter(Boolean))];
const allowedIds=Array.isArray(b?.chainScope?.allowedDepartmentIds)?b.chainScope.allowedDepartmentIds.map(String).filter(Boolean):departmentIds;
const chainMode=String(b?.chainScope?.mode||"").toUpperCase()==="CHAIN"||allowedIds.length>1||departmentIds.length>1;
const subsetRequested=chainMode&&departmentIds.length>0&&allowedIds.length>departmentIds.length;
let scopedDocs=result.docs;
let storeScope=null;
if(subsetRequested){
  storeScope=await resolveStoreScope(connection,departmentIds);
  if(!storeScope.resolved||!storeScope.storeIds.length){
    return jsonResponse({
      success:false,
      code:"DOCUMENT_STORE_SCOPE_UNAVAILABLE",
      message:"Не удалось определить склады выбранного подразделения. Накладные не показаны, чтобы не смешивать рестораны.",
      meta:{departmentIds,storeScope:storeScope?.diagnostics||null}
    },409);
  }
  const wantedStores=new Set(storeScope.storeIds.map(key));
  scopedDocs=result.docs.filter(d=>{
    const ids=[d.storeId,...(Array.isArray(d.items)?d.items.map(x=>x.storeId):[])].map(key).filter(Boolean);
    return ids.some(id=>wantedStores.has(id));
  });
}
result.docs=scopedDocs;
const auth=await getIikoAuth(connection);
const neededSupplierIds=[...new Set(result.docs.map(d=>key(d.supplierId)).filter(Boolean))];
const refs=await getReferences(context.env,auth,neededSupplierIds);
const maps=refs.maps||refs;
maps.suppliers=maps.suppliers||new Map();
const missingSupplierIds=neededSupplierIds.filter(id=>!maps.suppliers.has(id));
let supplierResult={rows:[],status:0,format:refs.cacheHit?"d1-cache":"",recordsFound:maps.suppliers.size,namedRecords:maps.suppliers.size,authCacheHit:true};
if(!maps.suppliers.size||missingSupplierIds.length){
  supplierResult=await getIikoSuppliers(connection);
  for(const x of supplierResult.rows||[]){
    const id=key(x.id),name=String(x.name||"").trim();
    if(id&&name&&!maps.suppliers.has(id))maps.suppliers.set(id,name);
  }
}
const supplierMap=maps.suppliers;
const unresolvedStoreIds=[...new Set(result.docs.flatMap(d=>[d.storeId,...(d.items||[]).map(x=>x.storeId)]).map(key).filter(id=>id&&!maps.warehouses.has(id)))];
let balanceWarehouseResult={map:new Map(),status:0,ok:false};
let accountWarehouseResult={map:new Map(),status:0,ok:false};
if(unresolvedStoreIds.length){
  balanceWarehouseResult=await getBalanceWarehouses(connection);
  for(const [id,name] of balanceWarehouseResult.map)if(!maps.warehouses.has(id))maps.warehouses.set(id,name);

  const stillMissing=unresolvedStoreIds.filter(id=>!maps.warehouses.has(id));
  if(stillMissing.length){
    accountWarehouseResult=await getAccountNames(connection,stillMissing);
    for(const [id,name] of accountWarehouseResult.map)if(!maps.warehouses.has(id))maps.warehouses.set(id,name);
  }
}
const debug=supplierDebug(result.docs,maps);const documents=applyNames(result.docs,maps);return jsonResponse({success:true,count:documents.length,from:b.from,to:b.to,requestedFrom:b.from,requestedTo:b.to,documents,referenceSource:refs.cacheHit?"d1-cache":(supplierResult.rows?.length?"iiko-suppliers+light-sync":"light-sync+d1"),referenceCounts:{suppliers:maps.suppliers.size,warehouses:maps.warehouses.size,products:maps.products.size},supplierDebug:debug,warehouseDebug:{unresolvedBefore:unresolvedStoreIds,balanceStatus:balanceWarehouseResult.status,balanceOk:balanceWarehouseResult.ok,balanceWarehouses:[...balanceWarehouseResult.map.entries()].map(([id,name])=>({id,name})),accountStatus:accountWarehouseResult.status,accountOk:accountWarehouseResult.ok,accountWarehouses:[...accountWarehouseResult.map.entries()].map(([id,name])=>({id,name}))},referenceDiagnostics:{references:refs.diagnostics||null,supplierSource:{endpoint:"/resto/api/suppliers?revisionFrom=-1",status:supplierResult.status,format:supplierResult.format,recordsFound:supplierResult.recordsFound,namedRecords:supplierResult.namedRecords}},attempts:result.attempts,serverDocuments:result.serverDocuments||result.docs.length,meta:{sharedIikoClient:true,authCacheHit:auth.cacheHit===true,supplierAuthCacheHit:supplierResult.authCacheHit===true,referenceCacheHit:refs.cacheHit===true,referenceCacheStale:refs.stale===true,referenceCacheAgeMs:refs.ageMs??null,departmentIds,allowedDepartmentIds:allowedIds,chainMode,departmentScopeApplied:subsetRequested,storeIds:storeScope?.storeIds||[]}});}catch(e){return jsonResponse({success:false,message:e?.message||"Ошибка получения приходных накладных"},502);}}