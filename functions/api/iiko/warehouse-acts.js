import { iikoText, iikoJson, bindWorkspaceIikoBroker } from "./_lib/iiko-client.js";
import { getUser, loadPrivateIikoState, hasPrivateConnection, privateConnection } from "./_lib/user-state.js";
import { resolveAccessForUser, hasPermission } from "../access/_lib/access-control.js";
import { resolveStoreScope } from "./_lib/store-scope.js";
import { logAuditEvent } from "../_lib/audit-log.js";

const clean=v=>String(v??"").trim();
const id=v=>clean(v).replace(/^\{+|\}+$/g,"").toLowerCase();
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const respond=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const allowedStatus=s=>["NEW","PROCESSED"].includes(s);
const esc=v=>clean(v).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
const elem=(k,v)=>v===null||v===undefined||clean(v)===""?"":`<${k}>${esc(v)}</${k}>`;
const toRows=payload=>{
 if(Array.isArray(payload))return payload;
 for(const key of ["response","items","data","rows","accounts","products","stores","documents"])
   if(Array.isArray(payload?.[key]))return payload[key];
 return [];
};
const failure=(message,status=400,code="DOCUMENT_INVALID")=>Object.assign(new Error(message),{status,code});

async function authorized(request,env,kind,write=false){
 if(!env?.DB)throw failure("Серверная база доступа недоступна.",503,"DB_MISSING");
 const auth=await getUser(request,env);
 if(!auth)throw failure("Необходим вход в Smart Horeca.",401,"UNAUTHENTICATED");
 const access=await resolveAccessForUser(env.DB,auth.user,{claimInvite:true,request});
 if(!access?.allowed||!clean(access?.workspace?.id))throw failure("Нет доступа к рабочей области.",403,"WORKSPACE_REQUIRED");
 const permission=kind==="writeoff"?(write?"inventory.writeoff.manage":"inventory.writeoff.view"):(write?"inventory.outgoing.manage":"inventory.outgoing.view");
 if(!hasPermission(access,permission))throw failure("Недостаточно прав: "+permission,403,"ACCESS_DENIED");
 const stored=await loadPrivateIikoState(env.DB,access.storageUserId||access.ownerUserId||auth.user.id,env);
 if(!stored?.found||!hasPrivateConnection(stored.state))throw failure("Подключите iiko Server в настройках.",409,"IIKO_NOT_CONNECTED");
 const connection=bindWorkspaceIikoBroker(privateConnection(stored.state),env,access);
 return{access,auth,connection,workspaceId:clean(access.workspace.id)};
}
function departmentSelection(body,access) {
 const selected=Array.isArray(body?.departmentIds)?[...new Set(body.departmentIds.map(id).filter(Boolean))]:[];
 // A restricted manager may only access the departments assigned by RBAC,
 // irrespective of which department IDs a browser claims to have selected.
 if(access.scope?.mode==="SELECTED"){
   const allowed=[...(access.scope.departmentIds||[]),...(access.scope.departmentCodes||[])].map(id).filter(Boolean);
   const ids=new Set(allowed);
   if(!ids.size)throw failure("Нет доступных подразделений.",403,"DEPARTMENT_FORBIDDEN");
   if(selected.some(x=>!ids.has(x)))throw failure("Подразделение вне разрешённой области.",403,"DEPARTMENT_FORBIDDEN");
   return selected.length?selected:allowed;
 }
 if(!selected.length)throw failure("Выберите ресторан для документа.",400,"DEPARTMENT_REQUIRED");
 return selected;
}
async function scopedStores(connection,departmentIds){
 const scope=await resolveStoreScope(connection,departmentIds);
 if(!scope.resolved||!scope.storeIds?.length)throw failure("Не удалось определить склады выбранного ресторана. Создание заблокировано.",409,"STORE_SCOPE_UNAVAILABLE");
 return scope;
}
async function lookup(connection,path){
 const r=await iikoJson(connection,path,{headers:{Accept:"application/json"},timeoutMs:20000});
 if(!r.ok||!r.payload)throw failure("Не удалось получить справочник iiko: HTTP "+r.status,502,"IIKO_REFERENCE_FAILED");
 return toRows(r.payload);
}
function normalizeProducts(rows){
 return rows.map(x=>({id:id(x.id??x.uuid??x.productId),name:clean(x.name??x.title??x.fullName),code:clean(x.num??x.code??x.article),type:clean(x.type??x.productType),unit:clean(x.mainUnit?.name??x.measureUnit?.name??x.unitName??x.unit)}))
  .filter(x=>UUID.test(x.id)&&x.name).filter(x=>!["SERVICE","RATE"].includes(x.type.toUpperCase())).sort((a,b)=>a.name.localeCompare(b.name,"ru"));
}
function normalizeAccounts(rows){
 return rows.map(x=>({id:id(x.id??x.uuid),code:clean(x.code),name:clean(x.name),deleted:x.deleted===true}))
  .filter(x=>UUID.test(x.id)&&!x.deleted).sort((a,b)=>a.code.localeCompare(b.code,"ru",{numeric:true}));
}
async function bootstrap(ctx,body,kind){
 const departments=departmentSelection(body,ctx.access);
 const scope=await scopedStores(ctx.connection,departments);
 const [products,accounts]=await Promise.all([
   lookup(ctx.connection,"/resto/api/v2/entities/products/list?includeDeleted=false"),
   lookup(ctx.connection,"/resto/api/v2/entities/accounts/list?includeDeleted=false")
 ]);
 const storeIds=new Set(scope.storeIds.map(id));
 const stores=(scope.stores||[]).filter(s=>storeIds.has(id(s.id))).map(s=>({id:id(s.id),name:clean(s.name)||"Склад "+id(s.id).slice(-6)}));
 for(const storeId of storeIds)if(!stores.some(x=>x.id===storeId))stores.push({id:storeId,name:"Склад "+storeId.slice(-6)});
 return respond({success:true,kind,departments,stores,products:normalizeProducts(products),accounts:normalizeAccounts(accounts)});
}
function validate(body,kind,allowedStores){
 const input=body?.document||{};
 const status=clean(input.status||"NEW").toUpperCase();
 if(!allowedStatus(status))throw failure("Разрешены только статусы NEW и PROCESSED.");
 const dateIncoming=clean(input.dateIncoming);
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(dateIncoming))throw failure("Укажите дату документа в формате YYYY-MM-DDTHH:mm.");
 const d=new Date(dateIncoming);
 if(Number.isNaN(d.getTime()))throw failure("Неверная дата документа.");
 const storeId=id(input.storeId);
 if(!UUID.test(storeId)||!allowedStores.has(storeId))throw failure("Выбран склад другого подразделения или склад не определён.",403,"STORE_FORBIDDEN");
 const documentNumber=clean(input.documentNumber)||(kind==="sales"?"SH-SALE-"+Date.now().toString(36)+"-"+crypto.randomUUID().slice(0,6):"");
 if(documentNumber.length>80)throw failure("Слишком длинный номер документа.");
 const comment=clean(input.comment);
 if(comment.length>2000)throw failure("Комментарий слишком длинный.");
 const items=Array.isArray(input.items)?input.items:[];
 if(!items.length||items.length>250)throw failure("В документе должна быть от 1 до 250 позиций.");
 const normalized=items.map((row,index)=>{
   const productId=id(row.productId),amount=Number(row.amount);
   if(!UUID.test(productId))throw failure("Строка "+(index+1)+": выберите товар.");
   if(!Number.isFinite(amount)||amount<=0||amount>10000000)throw failure("Строка "+(index+1)+": количество должно быть больше нуля.");
   const result={productId,amount};
   if(kind==="sales"){
     const sum=Number(row.sum),discountSum=Number(row.discountSum||0);
     if(!Number.isFinite(sum)||sum<0||sum>100000000)throw failure("Строка "+(index+1)+": укажите сумму без скидки.");
     if(!Number.isFinite(discountSum)||discountSum<0||discountSum>sum)throw failure("Строка "+(index+1)+": скидка больше суммы.");
     result.sum=Math.round(sum*100)/100;
     result.discountSum=Math.round(discountSum*100)/100;
     if(row.vatPercent!==undefined&&clean(row.vatPercent)!==""){
       const vat=Number(row.vatPercent);
       if(!Number.isFinite(vat)||vat<0||vat>100)throw failure("Строка "+(index+1)+": неверный НДС.");
       result.vatPercent=vat;
     }
   }
   return result;
 });
 const accountId=id(input.accountId);
 if(kind==="writeoff"&&!UUID.test(accountId))throw failure("Укажите счёт списания.");
 const accountToCode=clean(input.accountToCode),revenueAccountCode=clean(input.revenueAccountCode);
 if(kind==="sales"&&(!accountToCode||!revenueAccountCode||accountToCode.length>60||revenueAccountCode.length>60))throw failure("Выберите расходный и доходный счета.");
 return {dateIncoming,status,storeId,accountId,documentNumber,comment,accountToCode,revenueAccountCode,items:normalized};
}
function saleXml(doc){
 const rows=doc.items.map(x=>`<item>${elem("amount",x.amount)}${elem("storeId",doc.storeId)}${elem("productId",x.productId)}${elem("sum",x.sum)}${elem("discountSum",x.discountSum)}${elem("vatPercent",x.vatPercent)}</item>`).join("");
 return `<?xml version="1.0" encoding="UTF-8"?><document>${elem("status",doc.status)}${elem("accountToCode",doc.accountToCode)}${elem("revenueAccountCode",doc.revenueAccountCode)}${elem("documentNumber",doc.documentNumber)}${elem("dateIncoming",doc.dateIncoming)}<items>${rows}</items></document>`;
}
function tag(xml,name){
 const match=String(xml||"").match(new RegExp("<"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)<\\/"+name+">","i"));
 return match?match[1].replace(/<[^>]+>/g,"").trim():"";
}
async function salesTable(db){
 await db.prepare(`CREATE TABLE IF NOT EXISTS sh_sales_act_imports(
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, document_number TEXT NOT NULL,
 date_incoming TEXT NOT NULL, store_id TEXT NOT NULL, status TEXT NOT NULL,
 items_json TEXT NOT NULL, accounts_json TEXT NOT NULL, actor_id TEXT NOT NULL,
 created_at TEXT NOT NULL)`).run();
}
async function localSalesList(ctx,body){
 await salesTable(ctx.env.DB);
 const deps=departmentSelection(body,ctx.access),scope=await scopedStores(ctx.connection,deps);
 const allowed=new Set(scope.storeIds.map(id));
 const from=clean(body.from),to=clean(body.to);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))throw failure("Укажите период.");
 const rows=await ctx.env.DB.prepare(`SELECT * FROM sh_sales_act_imports WHERE workspace_id=?1 AND substr(date_incoming,1,10)>=?2 AND substr(date_incoming,1,10)<=?3 ORDER BY created_at DESC LIMIT 200`).bind(ctx.workspaceId,from,to).all();
 const documents=(rows.results||[]).filter(x=>allowed.has(id(x.store_id))).map(x=>({
   id:x.id,documentNumber:x.document_number,dateIncoming:x.date_incoming,
   storeId:x.store_id,storeName:(scope.stores||[]).find(s=>id(s.id)===id(x.store_id))?.name||"Склад",status:x.status,
   items:JSON.parse(x.items_json||"[]"),source:"Smart Horeca → iiko"
 }));
 return respond({success:true,documents,count:documents.length,scope:"Workspace",note:"Показаны акты реализации, созданные через Smart Horeca."});
}
async function create(ctx,body,kind){
 const departments=departmentSelection(body,ctx.access),scope=await scopedStores(ctx.connection,departments);
 const doc=validate(body,kind,new Set(scope.storeIds.map(id)));
 // Reject spoofed account codes/IDs before sending any write to iiko.
 const [accountRows,productRows]=await Promise.all([
   lookup(ctx.connection,"/resto/api/v2/entities/accounts/list?includeDeleted=false"),
   lookup(ctx.connection,"/resto/api/v2/entities/products/list?includeDeleted=false")
 ]);
 const accounts=normalizeAccounts(accountRows),products=normalizeProducts(productRows);
 const productNames=new Map(products.map(x=>[x.id,x.name]));
 if(doc.items.some(x=>!productNames.has(x.productId)))throw failure("В документе есть товар, отсутствующий в активной номенклатуре iiko.");
 if(kind==="writeoff"&&!accounts.some(a=>a.id===doc.accountId))throw failure("Счёт списания отсутствует в справочнике iiko.");
 if(kind==="sales"&&(!accounts.some(a=>a.code===doc.accountToCode)||!accounts.some(a=>a.code===doc.revenueAccountCode)))
   throw failure("Выбранного расходного или доходного счёта нет в iiko.");
 const path=kind==="writeoff"?"/resto/api/v2/documents/writeoff":"/resto/api/documents/import/salesDocument";
 const payload=kind==="writeoff" ? {
   dateIncoming:doc.dateIncoming,status:doc.status,storeId:doc.storeId,accountId:doc.accountId,
   ...(doc.documentNumber?{documentNumber:doc.documentNumber}:{}),...(doc.comment?{comment:doc.comment}:{}),
   items:doc.items.map(({productId,amount})=>({productId,amount}))
 } : saleXml(doc);
 const result=await iikoText(ctx.connection,path,{method:"POST",headers:{
    "Content-Type":kind==="writeoff"?"application/json; charset=utf-8":"application/xml; charset=utf-8",
    Accept:kind==="writeoff"?"application/json, */*":"application/xml,text/xml,*/*"
 },body:kind==="writeoff"?JSON.stringify(payload):payload,timeoutMs:30000});
 let response=null;try{response=JSON.parse(result.text)}catch{}
 if(!result.ok)throw failure("iiko Server HTTP "+result.status+": "+clean(result.text).slice(0,400),502,"IIKO_DOCUMENT_REJECTED");
 let documentId="",documentNumber=doc.documentNumber;
 if(kind==="writeoff"){
   if(response?.result!=="SUCCESS"||!response?.response?.id||Array.isArray(response?.errors)&&response.errors.length)
     throw failure("iiko не подтвердил создание акта списания: "+clean(JSON.stringify(response?.errors||response)).slice(0,350),422,"IIKO_VALIDATION");
   documentId=clean(response.response.id);
   documentNumber=clean(response.response.documentNumber||documentNumber);
 } else {
   const valid=tag(result.text,"valid"),warning=tag(result.text,"warning"),err=tag(result.text,"errorMessage"),additional=tag(result.text,"additionalInfo");
   if(valid!=="true")throw failure("iiko отклонил акт реализации: "+(err||additional||"не получено подтверждение valid=true"),422,"IIKO_VALIDATION");
   documentNumber=tag(result.text,"documentNumber")||doc.documentNumber;
   documentId=crypto.randomUUID();
   if(!documentNumber)throw failure("iiko подтвердил акт, но не вернул номер. Проверьте документ перед повторной отправкой.",409,"SALES_NUMBER_UNKNOWN");
 }
 let registrySaved=true;
 if(kind==="sales"){
   try{
     await salesTable(ctx.env.DB);
     await ctx.env.DB.prepare(`INSERT INTO sh_sales_act_imports
      (id,workspace_id,document_number,date_incoming,store_id,status,items_json,accounts_json,actor_id,created_at)
      VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`).bind(
       documentId,ctx.workspaceId,documentNumber,doc.dateIncoming,doc.storeId,doc.status,
       JSON.stringify(doc.items.map(x=>({...x,productName:productNames.get(x.productId)||"Товар"}))),JSON.stringify({accountToCode:doc.accountToCode,revenueAccountCode:doc.revenueAccountCode}),
       clean(ctx.auth.user.id),new Date().toISOString()).run();
   }catch(error){registrySaved=false;console.error("[SALES-ACT-REGISTRY]",error);}
 }
 try{
   await logAuditEvent({request:ctx.request,env:ctx.env,connection:ctx.connection,
     action:doc.status==="PROCESSED"?"CREATE_AND_PROCESS":"CREATE",
     entityType:kind==="writeoff"?"WRITEOFF_DOCUMENT":"SALES_DOCUMENT",
     entityId:documentId,entityLabel:(kind==="writeoff"?"Акт списания":"Акт реализации")+" №"+(documentNumber||documentId),
     documentNumber,before:null,after:{...doc,items:doc.items},restaurantIds:departments,
     metadata:{source:"Smart Horeca",iikoStatus:result.status}});
 }catch(e){console.warn("[WAREHOUSE-ACT-AUDIT]",e)}
 return respond({success:true,kind,status:doc.status,documentId,documentNumber,registrySaved,message:(kind==="writeoff"?"Акт списания":"Акт реализации")+" "+(doc.status==="PROCESSED"?"проведён":"создан как черновик")+" в iiko.",warning:registrySaved?null:"Акт создан в iiko, но не записан в локальный журнал. Не отправляйте повторно."});
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:{"Allow":"POST, OPTIONS"}});}
export async function onRequestPost(context){
 try{
   const body=await context.request.json();
   const kind=clean(body.kind).toLowerCase();
   if(!["writeoff","sales"].includes(kind))throw failure("Неизвестный тип акта.");
   const action=clean(body.action||"bootstrap").toLowerCase();
   if(!["bootstrap","create","list"].includes(action))throw failure("Неизвестная операция.");
   if(action==="list"&&kind!=="sales")throw failure("Список списаний доступен в /api/iiko/documents.");
   const ctx=await authorized(context.request,context.env,kind,action==="create");
   ctx.request=context.request;ctx.env=context.env;
   if(action==="bootstrap")return await bootstrap(ctx,body,kind);
   if(action==="list")return await localSalesList(ctx,body);
   return await create(ctx,body,kind);
 }catch(error){
   return respond({success:false,code:error.code||"WAREHOUSE_ACT_ERROR",message:error.message||"Ошибка работы с актом"},error.status||502);
 }
}
