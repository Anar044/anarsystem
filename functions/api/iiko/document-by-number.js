import { clean, iikoText } from './_lib/iiko-client.js';
import { resolveStoreScope } from './_lib/store-scope.js';

function corsHeaders(){return {"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization","Content-Type":"application/json; charset=utf-8"};}
function jsonResponse(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...corsHeaders(),"Cache-Control":"no-store"}});}
function dec(v){return String(v??"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&");}
function tag(b,n){const m=String(b||"").match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`,'i'));return m?dec(m[1].trim()):null;}
function nullable(v){const s=String(v??"").trim();return ["","null","undefined","nil","none"].includes(s.toLowerCase())?null:s;}
function blocks(s,n){const a=[];const re=new RegExp(`<${n}(?:\\s[^>]*)?>[\\s\\S]*?</${n}>`,'gi');let m;while((m=re.exec(String(s||""))))a.push(m[0]);return a;}
function num(v){const n=Number(String(v??'').replace(/\\s/g,'').replace(',','.'));return Number.isFinite(n)?n:null;}
function parse(type,xml){const docs=blocks(xml,'document');return docs.map(b=>{const items=blocks(b,'item').map((x,i)=>({num:tag(x,'num')||String(i+1),productId:tag(x,'productId')||tag(x,'product'),productArticle:tag(x,'productArticle'),supplierProduct:tag(x,'supplierProduct'),supplierProductArticle:tag(x,'supplierProductArticle'),storeId:tag(x,'storeId')||tag(x,'store'),storeCode:tag(x,'storeCode'),amount:num(tag(x,'amount')),actualAmount:num(tag(x,'actualAmount')),price:num(tag(x,'price')),priceWithoutVat:num(tag(x,'priceWithoutVat')),sum:num(tag(x,'sum')),discountSum:num(tag(x,'discountSum')),vatPercent:num(tag(x,'vatPercent')||tag(x,'ndsPercent')),vatSum:num(tag(x,'vatSum')),amountUnit:tag(x,'amountUnit'),containerId:tag(x,'containerId'),actualUnitWeight:num(tag(x,'actualUnitWeight'))}));return {id:tag(b,'id'),documentNumber:tag(b,'documentNumber'),dateIncoming:tag(b,'dateIncoming')||tag(b,'incomingDate'),incomingDate:tag(b,'incomingDate'),invoice:nullable(tag(b,'invoice')),incomingDocumentNumber:nullable(tag(b,'incomingDocumentNumber')),dueDate:nullable(tag(b,'dueDate')),transportInvoiceNumber:nullable(tag(b,'transportInvoiceNumber')),supplierId:tag(b,'supplier'),counteragentId:tag(b,'counteragentId'),defaultStoreId:tag(b,'defaultStore')||tag(b,'defaultStoreId'),defaultStoreCode:tag(b,'defaultStoreCode'),accountToCode:tag(b,'accountToCode'),revenueAccountCode:tag(b,'revenueAccountCode'),comment:nullable(tag(b,'comment')),status:tag(b,'status'),items,itemsCount:items.length,sum:items.reduce((s,x)=>s+(x.sum||0),0)};}).filter(d=>d.id||d.documentNumber||d.itemsCount);}
export async function onRequestOptions(){return new Response(null,{status:204,headers:{...corsHeaders()}});}
export async function onRequestPost(context){try{const b=await context.request.json(),type=String(b.type||'').toLowerCase(),raw=b.connection||b,number=String(b.number||'').trim();if(!['incoming','outgoing'].includes(type)||!number)return jsonResponse({success:false,message:'Укажите тип и номер документа'},400);const connection={ip:clean(raw.ip),port:clean(raw.port),login:clean(raw.login),password:String(raw.password||'')};if(!connection.ip||!connection.port||!connection.login||!connection.password)return jsonResponse({success:false,message:'Не найдено подключение к SH Server'},400);const p=new URLSearchParams({number,currentYear:String(b.currentYear??false)});if(String(b.currentYear??false)!=='true'){if(!b.from||!b.to)return jsonResponse({success:false,message:'Для поиска не за текущий год нужны даты from и to'},400);p.set('from',b.from);p.set('to',b.to);}const path=`/resto/api/documents/export/${type==='incoming'?'incomingInvoice':'outgoingInvoice'}/byNumber?${p}`;const r=await iikoText(connection,path,{headers:{Accept:'application/xml,text/xml,*/*'}});
let documents=r.ok?parse(type,r.text):[];
const departmentIds=Array.isArray(b.departmentIds)?[...new Set(b.departmentIds.map(String).filter(Boolean))]:[];
const allowedDepartmentIds=Array.isArray(b?.chainScope?.allowedDepartmentIds)?b.chainScope.allowedDepartmentIds.map(String).filter(Boolean):[];
const subsetRequested=String(b?.chainScope?.mode||'').toUpperCase()==='CHAIN'&&departmentIds.length>0&&allowedDepartmentIds.length>departmentIds.length;
let scopedStoreIds=[];
if(subsetRequested&&documents.length){
  const storeScope=await resolveStoreScope(connection,departmentIds);
  if(!storeScope.resolved){
    return jsonResponse({success:false,code:'DOCUMENT_SCOPE_UNAVAILABLE',message:'Не удалось определить склады выбранного ресторана. Документ не будет показан без безопасного CHAIN-фильтра.',meta:{departmentIds,storeScope:storeScope.diagnostics||null}},409);
  }
  scopedStoreIds=(storeScope.storeIds||[]).map(key).filter(Boolean);
  const allowedStores=new Set(scopedStoreIds);
  const hasUnscopedDocument=documents.some(d=>documentStoreIds(d).length===0);
  if(hasUnscopedDocument){
    return jsonResponse({success:false,code:'DOCUMENT_STORE_SCOPE_UNAVAILABLE',message:'SH Server не вернул склад для найденного документа. Нельзя безопасно определить ресторан.'},409);
  }
  documents=documents.filter(d=>documentStoreIds(d).some(id=>allowedStores.has(id)));
}
return jsonResponse({
  success:r.ok,
  count:documents.length,
  document:documents[0]||null,
  rawResponse:subsetRequested?'':r.text.slice(0,12000),
  message:r.ok?(documents.length?'OK':'Документ не найден в выбранном ресторане'):`SH Server вернул HTTP ${r.status}`,
  meta:{authCacheHit:Boolean(r.auth?.cacheHit),departmentIds,subsetRequested,departmentScopeApplied:subsetRequested,scopedStoreIds}
},r.ok?200:502);}catch(e){return jsonResponse({success:false,message:e?.message||'Ошибка поиска документа'},502);}}