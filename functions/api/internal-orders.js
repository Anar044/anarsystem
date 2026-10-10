// Smart Horeca: internal stock requests across separate iikoChain RMS.
// This endpoint only records workflow decisions in D1. It NEVER posts stock movements.
import {getUser,loadPrivateIikoState,privateConnection,hasPrivateConnection} from "./iiko/_lib/user-state.js";
import {restaurantDirectory,cookieDepartmentIds} from "./iiko/_lib/restaurant-scope.js";
import {resolveAccessForUser,hasPermission,requirePermission} from "./access/_lib/access-control.js";
import {resolveStoreScope} from "./iiko/_lib/store-scope.js";
import {serverScopeFromConnection,logAuditEvent} from "./_lib/audit-log.js";
import {normalizeInternalLines,validateApproval,internalNextStatus} from "./_lib/internal-order-core.js";

const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type,Authorization","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const clean=v=>String(v??"").trim();
const uniq=a=>[...new Set((a||[]).map(clean).filter(Boolean))];
const json=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
const stamp=()=>new Date().toISOString();
const actor=user=>clean(user?.user_metadata?.full_name||user?.email||user?.id);
const parse=(value,fallback)=>{try{return JSON.parse(value||"")??fallback}catch{return fallback}};
const dateValid=v=>/^\d{4}-\d\d-\d\d$/.test(clean(v))&&!Number.isNaN(Date.parse(v+"T00:00:00Z"));
async function ensure(db){
  if(!db)throw fail("D1 не подключена.",503);
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS sh_internal_order_settings (server_scope TEXT PRIMARY KEY,central_department_id TEXT NOT NULL,central_store_id TEXT NOT NULL,central_department_name TEXT NOT NULL DEFAULT '',central_store_name TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,updated_by TEXT NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sh_internal_orders (id TEXT PRIMARY KEY,server_scope TEXT NOT NULL,number TEXT NOT NULL,status TEXT NOT NULL,central_department_id TEXT NOT NULL,central_department_name TEXT NOT NULL,central_store_id TEXT NOT NULL,central_store_name TEXT NOT NULL,destination_department_id TEXT NOT NULL,destination_department_name TEXT NOT NULL,destination_store_id TEXT NOT NULL,destination_store_name TEXT NOT NULL,needed_by TEXT NOT NULL,comment TEXT NOT NULL DEFAULT '',lines_json TEXT NOT NULL,approved_lines_json TEXT NOT NULL DEFAULT '[]',review_comment TEXT NOT NULL DEFAULT '',created_by TEXT NOT NULL,created_by_name TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,submitted_at TEXT NOT NULL DEFAULT '',reviewed_at TEXT NOT NULL DEFAULT '',reviewed_by TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 0)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sh_internal_orders_scope_date ON sh_internal_orders(server_scope,created_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sh_internal_orders_destination ON sh_internal_orders(server_scope,destination_department_id,status)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sh_internal_orders_number ON sh_internal_orders(server_scope,number)")
  ]);
}
function permittedDepartments(access,departments){
  if(access?.isOwner||access?.scope?.mode!=="SELECTED")return departments;
  const ids=new Set(uniq(access.scope.departmentIds)),codes=new Set(uniq(access.scope.departmentCodes));
  return departments.filter(d=>ids.has(d.id)||codes.has(d.code));
}
function viewPermission(access){
  return ["procurement.internal.request","procurement.internal.fulfill","procurement.internal.configure"].some(p=>hasPermission(access,p));
}
function canSee(row,c){
  const allowed=new Set(c.allowed.map(d=>d.id));
  return (hasPermission(c.access,"procurement.internal.request")&&allowed.has(row.destination_department_id))
    ||(hasPermission(c.access,"procurement.internal.fulfill")&&allowed.has(row.central_department_id))
    ||(hasPermission(c.access,"procurement.internal.configure")&&
       (allowed.has(row.destination_department_id)||allowed.has(row.central_department_id)));
}
// The legacy DB column "central_department_id" means the SHIPPING RMS. It is
// preserved so existing draft orders remain readable when senders are restaurants.
function sendingStaff(c,order){
  return hasPermission(c.access,"procurement.internal.fulfill")&&c.allowed.some(d=>d.id===order.central_department_id);
}
async function context(request,env){
  const auth=await getUser(request,env);
  if(!auth)throw fail("Необходима авторизация.",401);
  const access=await resolveAccessForUser(env.DB,auth.user,{claimInvite:true,request});
  if(!access?.allowed)throw fail("Нет доступа к Smart Horeca.",403);
  const stored=await loadPrivateIikoState(env.DB,access.storageUserId||access.ownerUserId||auth.user.id,env);
  if(!stored?.found||!hasPrivateConnection(stored.state))throw fail("Подключите Smart Horeca Server.",409);
  const connection=privateConnection(stored.state),serverScope=await serverScopeFromConnection(connection);
  if(!serverScope)throw fail("Контур сервера не определён.",409);
  const directory=restaurantDirectory(stored.state),allowed=permittedDepartments(access,directory);
  if(!allowed.length)throw fail("Нет доступных подразделений RMS.",403);
  const selected=cookieDepartmentIds(request);
  if(selected.some(id=>!allowed.some(d=>d.id===id)))throw fail("Недоступное подразделение в выборе CHAIN.",403);
  await ensure(env.DB);
  return {auth,access,connection,serverScope,directory,allowed,selected,env,request};
}
function dept(c,id,all=false){
  const d=(all?c.directory:c.allowed).find(x=>x.id===clean(id));
  if(!d)throw fail("Выбранное RMS недоступно.",403);
  return d;
}
async function warehouse(c,departmentId,storeId){
  const scope=await resolveStoreScope(c.connection,[departmentId]);
  if(!scope.resolved)throw fail("Не удалось получить склады RMS из iiko. Выбор склада не подтверждён.",409);
  const s=(scope.stores||[]).find(x=>clean(x.id)===clean(storeId));
  if(!s)throw fail("Склад не принадлежит выбранному RMS.",403);
  return {id:clean(s.id),name:clean(s.name||s.code||s.id)};
}
async function getSettings(c){
  return await c.env.DB.prepare("SELECT * FROM sh_internal_order_settings WHERE server_scope=?1").bind(c.serverScope).first();
}
async function orderFor(c,id){
  const order=await c.env.DB.prepare("SELECT * FROM sh_internal_orders WHERE server_scope=?1 AND id=?2").bind(c.serverScope,clean(id)).first();
  if(!order)throw fail("Внутренний заказ не найден.",404);
  if(!canSee(order,c))throw fail("Нет доступа к этому заказу.",403);
  return order;
}
function publicOrder(x){
  return {id:x.id,number:x.number,status:x.status,sourceDepartmentId:x.central_department_id,sourceDepartmentName:x.central_department_name,sourceStoreId:x.central_store_id,sourceStoreName:x.central_store_name,centralDepartmentId:x.central_department_id,centralDepartmentName:x.central_department_name,centralStoreId:x.central_store_id,centralStoreName:x.central_store_name,destinationDepartmentId:x.destination_department_id,destinationDepartmentName:x.destination_department_name,destinationStoreId:x.destination_store_id,destinationStoreName:x.destination_store_name,neededBy:x.needed_by,comment:x.comment,lines:parse(x.lines_json,[]),approvedLines:parse(x.approved_lines_json,[]),reviewComment:x.review_comment,createdBy:x.created_by,createdByName:x.created_by_name,createdAt:x.created_at,updatedAt:x.updated_at,submittedAt:x.submitted_at,reviewedAt:x.reviewed_at,reviewedBy:x.reviewed_by,revision:x.revision};
}
async function audit(c,action,row,before,after){
  await logAuditEvent({request:c.request,env:c.env,connection:c.connection,action,entityType:"INTERNAL_ORDER",entityId:row.id,entityLabel:row.number,documentNumber:row.number,before,after,restaurantIds:[row.destination_department_id],restaurantNames:[row.destination_department_name]});
}
async function updateStatus(c,order,newStatus,extra={}){
  const time=stamp();
  const r=await c.env.DB.prepare("UPDATE sh_internal_orders SET status=?1,updated_at=?2,revision=revision+1,submitted_at=CASE WHEN ?1='SUBMITTED' THEN ?2 ELSE submitted_at END,reviewed_at=CASE WHEN ?1 IN ('APPROVED','REJECTED') THEN ?2 ELSE reviewed_at END,reviewed_by=CASE WHEN ?1 IN ('APPROVED','REJECTED') THEN ?3 ELSE reviewed_by END,approved_lines_json=CASE WHEN ?1='APPROVED' THEN ?4 ELSE approved_lines_json END,review_comment=CASE WHEN ?1 IN ('APPROVED','REJECTED') THEN ?5 ELSE review_comment END WHERE id=?6 AND server_scope=?7 AND status=?8 AND revision=?9")
    .bind(newStatus,time,clean(c.auth.user.id),JSON.stringify(extra.approvedLines||[]),clean(extra.comment),order.id,c.serverScope,order.status,order.revision).run();
  if(Number(r.meta?.changes||0)!==1)throw fail("Заказ был изменён другим пользователем. Обновите список.",409);
  await audit(c,newStatus,order,{status:order.status},{status:newStatus,...extra});
  return {success:true,status:newStatus};
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:H})}
export async function onRequestGet({request,env}){
  try{
    const c=await context(request,env);
    if(!viewPermission(c.access))throw fail("Нет доступа к внутренним заказам.",403);
    const url=new URL(request.url),action=url.searchParams.get("action")||"list";
    const settings=await getSettings(c);
    if(action==="stores"){
      const departmentId=clean(url.searchParams.get("departmentId"));
      dept(c,departmentId,true);
      // The destination/requester may ask another RMS for goods. Expose only
      // warehouse names and IDs; never stock levels or supplier costs.
      const s=await resolveStoreScope(c.connection,[departmentId]);
      if(!s.resolved){
        const d=s.diagnostics||{};
        return json({success:false,code:"INTERNAL_RMS_STORES_UNRESOLVED",message:"iikoChain не подтвердил склады выбранного RMS. Проверьте привязку складов к торговому предприятию в структуре корпорации.",diagnostics:{storeEndpointStatus:d.storeEndpointStatus,departmentEndpointStatus:d.departmentEndpointStatus,totalStores:d.totalStores,storesFromDepartmentHierarchy:d.storesFromDepartmentHierarchy,matchedStores:d.matchedStores,fallbackStoreCount:d.fallbackStoreCount}},409);
      }
      return json({success:true,stores:(s.stores||[]).map(x=>({id:clean(x.id),name:clean(x.name||x.id)}))});
    }
    if(action!=="list")throw fail("Неизвестная операция.",400);
    const data=(await env.DB.prepare("SELECT * FROM sh_internal_orders WHERE server_scope=?1 ORDER BY created_at DESC LIMIT 300").bind(c.serverScope).all()).results||[];
    const scoped=data.filter(row=>canSee(row,c));
    return json({success:true,orders:scoped.map(publicOrder),settings:settings?{centralDepartmentId:settings.central_department_id,centralDepartmentName:settings.central_department_name,centralStoreId:settings.central_store_id,centralStoreName:settings.central_store_name}:null,departments:c.allowed,sendingDepartments:c.directory,configurableDepartments:hasPermission(c.access,"procurement.internal.configure")?c.directory:[],permissions:{request:hasPermission(c.access,"procurement.internal.request"),fulfill:hasPermission(c.access,"procurement.internal.fulfill"),configure:hasPermission(c.access,"procurement.internal.configure")}});
  }catch(e){return json({success:false,message:e.message||String(e)},e.status||500)}
}
export async function onRequestPost({request,env}){
  try{
    const body=await request.json().catch(()=>({})),action=clean(body.action),c=await context(request,env);
    const db=env.DB,userId=clean(c.auth.user.id),settings=await getSettings(c);
    if(action==="save-settings"){
      requirePermission(c.access,"procurement.internal.configure");
      const cd=dept(c,body.centralDepartmentId,true),store=await warehouse(c,cd.id,body.centralStoreId),t=stamp();
      await db.prepare("INSERT INTO sh_internal_order_settings(server_scope,central_department_id,central_department_name,central_store_id,central_store_name,updated_at,updated_by) VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(server_scope) DO UPDATE SET central_department_id=excluded.central_department_id,central_department_name=excluded.central_department_name,central_store_id=excluded.central_store_id,central_store_name=excluded.central_store_name,updated_at=excluded.updated_at,updated_by=excluded.updated_by").bind(c.serverScope,cd.id,cd.name,store.id,store.name,t,userId).run();
      await logAuditEvent({request,env,connection:c.connection,action:"UPDATE_SETTINGS",entityType:"INTERNAL_ORDER_SETTINGS",entityId:c.serverScope,entityLabel:"Центральный склад",before:settings,after:{centralDepartmentId:cd.id,centralStoreId:store.id}});
      return json({success:true});
    }
    if(action==="create"){
      requirePermission(c.access,"procurement.internal.request");
      const destination=dept(c,body.destinationDepartmentId);
      // Any RMS in the connected corporation may fulfil an internal request.
      // The recipient must be in the requester's authorized restaurant scope.
      const sourceId=clean(body.sourceDepartmentId||settings?.central_department_id);
      if(!sourceId)throw fail("Выберите RMS-отправитель.",400);
      const source=dept(c,sourceId,true);
      if(source.id===destination.id)throw fail("Отправитель и получатель должны быть разными RMS. Для складов одного RMS используйте внутреннее перемещение.",400);
      const sourceStoreId=clean(body.sourceStoreId||(settings?.central_department_id===sourceId?settings.central_store_id:""));
      if(!sourceStoreId)throw fail("Выберите склад RMS-отправителя.",400);
      const sourceStore=await warehouse(c,source.id,sourceStoreId);
      const store=await warehouse(c,destination.id,body.destinationStoreId),lines=normalizeInternalLines(body.lines),neededBy=clean(body.neededBy);
      if(!dateValid(neededBy))throw fail("Укажите дату поставки.",400);
      const id=crypto.randomUUID(),number="IO-"+tKey()+"-"+id.slice(0,6).toUpperCase(),t=stamp();
      const row={id,number,destination_department_id:destination.id,destination_department_name:destination.name};
      await db.prepare("INSERT INTO sh_internal_orders(id,server_scope,number,status,central_department_id,central_department_name,central_store_id,central_store_name,destination_department_id,destination_department_name,destination_store_id,destination_store_name,needed_by,comment,lines_json,created_by,created_by_name,created_at,updated_at) VALUES(?1,?2,?3,'DRAFT',?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?17)")
        .bind(id,c.serverScope,number,source.id,source.name,sourceStore.id,sourceStore.name,destination.id,destination.name,store.id,store.name,neededBy,clean(body.comment).slice(0,2000),JSON.stringify(lines),userId,actor(c.auth.user),t).run();
      await audit(c,"CREATE",row,null,{number,status:"DRAFT",sourceDepartmentId:source.id,sourceStoreId:sourceStore.id,destinationDepartmentId:destination.id,destinationStoreId:store.id,lines});
      return json({success:true,id,number,status:"DRAFT"},201);
    }
    if(["submit","cancel","approve","reject","picking","ready"].includes(action)){
      const order=await orderFor(c,body.id);
      const requester=hasPermission(c.access,"procurement.internal.request")&&order.created_by===userId&&c.allowed.some(d=>d.id===order.destination_department_id);
      const fulfiller=sendingStaff(c,order);
      if(["submit","cancel"].includes(action)&&!requester)throw fail("Только автор заявки может отправить или отменить её.",403);
      if(["approve","reject","picking","ready"].includes(action)&&!fulfiller)throw fail("Действие разрешено только сотруднику RMS-отправителя.",403);
      const newStatus=internalNextStatus(order.status,action);
      const extra={};
      if(action==="approve")extra.approvedLines=validateApproval(parse(order.lines_json,[]),body.approvedLines);
      if(action==="reject"){
        if(clean(body.comment).length<3)throw fail("Укажите причину отклонения (минимум 3 символа).",400);
        extra.comment=clean(body.comment).slice(0,2000);
      }
      return json(await updateStatus(c,order,newStatus,extra));
    }
    throw fail("Неизвестная операция.",400);
  }catch(e){return json({success:false,message:e.message||String(e)},e.status||500)}
}
function tKey(){return new Date().toISOString().slice(0,10).replace(/-/g,"")}
