import { getUser, loadPrivateIikoState, privateConnection, hasPrivateConnection } from "./iiko/_lib/user-state.js";
import { resolveRestaurantScope, cookieDepartmentIds } from "./iiko/_lib/restaurant-scope.js";
import { resolveAccessForUser, hasPermission } from "./access/_lib/access-control.js";
import { serverScopeFromConnection, logAuditEvent } from "./_lib/audit-log.js";

// Private D1-backed document archive: small supplier price lists and receipt
// scans. Files are never public URLs. Metadata and byte chunks are restricted
// to the selected workspace, iiko server, restaurant and document lineage.
const LIMIT_BYTES=6*1024*1024,CHUNK_BYTES=96*1024,MAX_FILES=30,QUOTA_BYTES=96*1024*1024;
const HEADERS={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Authorization, Content-Type","Access-Control-Allow-Methods":"GET, POST, OPTIONS"};
const typeCodes=["PR","RFQ","QUOTE","PO","GRN","INVOICE"];
const clean=x=>String(x??"").trim();
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:HEADERS});
const fail=(m,status=400)=>Object.assign(new Error(m),{status});
const id=()=>crypto.randomUUID();
const unique=xs=>[...new Set((xs||[]).map(clean).filter(Boolean))];
const parse=x=>{try{return JSON.parse(x||"[]")||[]}catch{return []}};
const wants=x=>["1","true"].includes(String(x));
const PERMISSIONS={
  PR:["procurement.request.view_own","procurement.request.view_all","procurement.approve","procurement.sourcing","procurement.po.manage"],
  RFQ:["procurement.sourcing","procurement.approve"],
  QUOTE:["procurement.sourcing","procurement.approve","procurement.prices.view","sensitive.cost.view"],
  PO:["procurement.po.manage","procurement.receive","procurement.approve"],
  GRN:["procurement.receive","procurement.approve"],
  INVOICE:["procurement.receive","procurement.approve"]
};
const WRITE={
  PR:["procurement.request.create","procurement.sourcing","procurement.approve"],
  RFQ:["procurement.sourcing"],QUOTE:["procurement.sourcing"],PO:["procurement.po.manage"],
  GRN:["procurement.receive"],INVOICE:["procurement.receive"]
};
const mimeByExt={
  pdf:"application/pdf",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",webp:"image/webp",
  xlsx:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls:"application/vnd.ms-excel",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc:"application/msword",csv:"text/csv",txt:"text/plain"
};
let initialized;
async function ensure(db){
  if(!initialized)initialized=(async()=>{
    const exists=await db.prepare("SELECT name FROM sqlite_master WHERE name='sh_proc_attachments' AND type='table'").first();
    if(exists)return;
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS sh_proc_attachments(
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,server_scope TEXT NOT NULL,
        entity_type TEXT NOT NULL,entity_id TEXT NOT NULL, filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,created_by TEXT NOT NULL,created_by_name TEXT NOT NULL,
        supplier_id TEXT NOT NULL DEFAULT '',supplier_name TEXT NOT NULL DEFAULT '')`),
      db.prepare(`CREATE TABLE IF NOT EXISTS sh_proc_attachment_chunks(
        attachment_id TEXT NOT NULL,seq INTEGER NOT NULL,body_base64 TEXT NOT NULL,
        PRIMARY KEY(attachment_id,seq))`),
      db.prepare("CREATE INDEX IF NOT EXISTS sh_proc_files_entity ON sh_proc_attachments(workspace_id,server_scope,entity_type,entity_id,created_at DESC)")
    ]);
  })().catch(e=>{initialized=null;throw e});
  return initialized;
}
async function context(request,env){
  if(!env.DB)throw fail("Не настроена D1.",503);
  const auth=await getUser(request,env);
  if(!auth)throw fail("Требуется авторизация.",401);
  const access=await resolveAccessForUser(env.DB,auth.user,{claimInvite:true,request});
  if(!access.allowed)throw fail("Нет доступа к Smart Horeca.",403);
  const stored=await loadPrivateIikoState(env.DB,access.storageUserId||access.ownerUserId,env);
  if(!stored?.found||!hasPrivateConnection(stored.state))throw fail("Сервер Smart Horeca не подключён.",409);
  const server=await serverScopeFromConnection(privateConnection(stored.state));
  const workspace=clean(access.workspace?.id);
  if(!workspace||!server)throw fail("Не определена организация или сервер.",403);
  const base=resolveRestaurantScope({state:stored.state,request,strict:true});
  let scope=base;
  if(!access.isOwner&&access.scope?.mode==="SELECTED"){
    const allowed=new Set((access.scope.departmentIds||[]).map(clean));
    const codes=new Set((access.scope.departmentCodes||[]).map(clean));
    const permitted=(base.allRestaurants||[]).filter(x=>allowed.has(clean(x.id))||codes.has(clean(x.code)));
    const ids=unique(permitted.map(x=>x.id));
    if(!ids.length)throw fail("Подразделения пользователя не найдены.",403);
    const requested=cookieDepartmentIds(request);
    if(requested.some(x=>!ids.includes(x)))throw fail("Подразделение недоступно.",403);
    scope=resolveRestaurantScope({state:stored.state,requestedIds:requested.length?requested:ids,strict:true});
  }
  await ensure(env.DB);
  return {db:env.DB,auth,access,scope,workspace,server,request,env};
}
function allowRow(c,doc){
  const assigned=unique(parse(doc.restaurant_ids_json));
  const selected=new Set((c.scope.selectedDepartmentIds||[]).map(clean));
  if(c.scope.isChain&&(!assigned.length||!assigned.every(x=>selected.has(x))))throw fail("Документ другого подразделения.",403);
  if(!c.scope.isChain&&assigned.length&&!assigned.every(x=>selected.has(x)))throw fail("Документ другого подразделения.",403);
  const warehouseIds=unique(c.access.scope?.warehouseIds||[]);
  if(warehouseIds.length&&!warehouseIds.includes(clean(doc.warehouse_id)))throw fail("Склад документа недоступен.",403);
}
function authorized(c,type,doc,write){
  const permits=(write?WRITE:PERMISSIONS)[type]||[];
  if(!permits.some(x=>hasPermission(c.access,x)))throw fail("Нет доступа к файлам этого этапа.",403);
  if(type==="PR"&&!write&&!hasPermission(c.access,"procurement.request.view_all")&&
    !hasPermission(c.access,"procurement.sourcing")&&!hasPermission(c.access,"procurement.approve")&&
    !hasPermission(c.access,"procurement.po.manage")&&clean(doc.created_by)!==clean(c.auth.user.id))
    throw fail("Заявка создана другим сотрудником.",403);
}
async function validateDocument(c,type,entityId,write=false){
  if(!typeCodes.includes(type)||!entityId)throw fail("Некорректный тип или ID документа.");
  const sql={
    PR:"SELECT * FROM procurement_requisitions WHERE id=?1 AND server_scope=?2",
    RFQ:"SELECT r.*,q.id AS scoped_id FROM procurement_rfqs q JOIN procurement_requisitions r ON r.id=q.requisition_id AND r.server_scope=q.server_scope WHERE q.id=?1 AND q.server_scope=?2",
    QUOTE:"SELECT r.*,q.supplier_id,q.supplier_name FROM procurement_quotes q JOIN procurement_requisitions r ON r.id=q.requisition_id AND r.server_scope=q.server_scope WHERE q.id=?1 AND q.server_scope=?2",
    PO:"SELECT * FROM procurement_orders WHERE id=?1 AND server_scope=?2",
    GRN:"SELECT o.restaurant_ids_json,o.warehouse_id,g.supplier_id,g.supplier_name FROM procurement_grns g JOIN procurement_orders o ON o.id=g.order_id AND o.server_scope=g.server_scope WHERE g.id=?1 AND g.server_scope=?2",
    INVOICE:"SELECT o.restaurant_ids_json,o.warehouse_id,o.supplier_id,o.supplier_name FROM procurement_receipts v JOIN procurement_orders o ON o.id=v.order_id AND o.server_scope=v.server_scope WHERE v.id=?1 AND v.server_scope=?2"
  };
  const doc=await c.db.prepare(sql[type]+" LIMIT 1").bind(entityId,c.server).first();
  if(!doc)throw fail("Документ не найден.",404);
  allowRow(c,doc);authorized(c,type,doc,write);
  return doc;
}
function describe(row){
  return {id:row.id,entityType:row.entity_type,entityId:row.entity_id,
    name:row.filename,type:row.mime_type,size:row.size_bytes,createdAt:row.created_at,
    by:row.created_by_name,supplierName:row.supplier_name};
}
function toBase64(bytes){
  let s="";for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromBase64(v){
  const s=atob(v),bytes=new Uint8Array(s.length);
  for(let i=0;i<s.length;i++)bytes[i]=s.charCodeAt(i);
  return bytes;
}
function checkSignature(data,ext){
  if(["txt","csv"].includes(ext))return !data.slice(0,256).includes(0);
  if(ext==="pdf")return data[0]===37&&data[1]===80&&data[2]===68&&data[3]===70;
  if(["jpg","jpeg"].includes(ext))return data[0]===255&&data[1]===216;
  if(ext==="png")return [137,80,78,71,13,10,26,10].every((x,i)=>data[i]===x);
  if(ext==="webp")return String.fromCharCode(...data.slice(0,4))==="RIFF"&&String.fromCharCode(...data.slice(8,12))==="WEBP";
  if(["xlsx","docx"].includes(ext))return data[0]===80&&data[1]===75;
  if(["xls","doc"].includes(ext))return [208,207,17,224,161,177,26,225].every((x,i)=>data[i]===x);
  return false;
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:HEADERS})}
export async function onRequestGet({request,env}){
  try{
    const c=await context(request,env),url=new URL(request.url),fileId=clean(url.searchParams.get("fileId"));
    if(fileId){
      const meta=await c.db.prepare("SELECT * FROM sh_proc_attachments WHERE id=?1 AND workspace_id=?2 AND server_scope=?3 LIMIT 1").bind(fileId,c.workspace,c.server).first();
      if(!meta)throw fail("Файл не найден.",404);
      await validateDocument(c,meta.entity_type,meta.entity_id);
      const parts=(await c.db.prepare("SELECT seq,body_base64 FROM sh_proc_attachment_chunks WHERE attachment_id=?1 ORDER BY seq").bind(fileId).all()).results||[];
      const total=new Uint8Array(meta.size_bytes);let offset=0;
      for(const part of parts){const bytes=fromBase64(part.body_base64);if(offset+bytes.length>total.length)throw fail("Повреждённый файл.",500);total.set(bytes,offset);offset+=bytes.length;}
      if(offset!==total.length)throw fail("Не все части файла доступны.",500);
      const safe=meta.filename.replace(/[^a-zA-Z0-9_.-]+/g,"_").slice(0,110)||"attachment";
      return new Response(total,{status:200,headers:{
        "Content-Type":meta.mime_type,"Content-Length":String(total.byteLength),
        "Content-Disposition": "attachment; filename=\"" + safe + "\"; filename*=UTF-8''" + encodeURIComponent(meta.filename),
        "Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff",
        "Content-Security-Policy":"sandbox"
      }});
    }
    const type=clean(url.searchParams.get("entityType")).toUpperCase(),entityId=clean(url.searchParams.get("entityId"));
    await validateDocument(c,type,entityId);
    const rows=(await c.db.prepare(`SELECT * FROM sh_proc_attachments
      WHERE workspace_id=?1 AND server_scope=?2 AND entity_type=?3 AND entity_id=?4
      ORDER BY created_at DESC LIMIT 30`).bind(c.workspace,c.server,type,entityId).all()).results||[];
    return json({success:true,files:rows.map(describe)});
  }catch(e){return json({success:false,message:e.message||String(e)},e.status||500)}
}
export async function onRequestPost({request,env}){
  try{
    const c=await context(request,env);
    const mime=request.headers.get("content-type")||"";
    if(!mime.includes("multipart/form-data"))throw fail("Отправьте файл через форму multipart/form-data.");
    const form=await request.formData();
    const type=clean(form.get("entityType")).toUpperCase(),entityId=clean(form.get("entityId"));
    const doc=await validateDocument(c,type,entityId,true);
    const file=form.get("file");
    if(!(file instanceof File))throw fail("Выберите файл.");
    const filename=clean(file.name).replace(/[\r\n\u0000-\u001f]/g,"").slice(0,160);
    const ext=filename.toLowerCase().split(".").pop();
    if(!filename||!Object.hasOwn(mimeByExt,ext))throw fail("Поддерживаются PDF, фото JPG/PNG/WEBP, Excel, Word, CSV и TXT.");
    if(file.size<1||file.size>LIMIT_BYTES)throw fail("Файл должен быть не более 6 МБ.",413);
    const bytes=new Uint8Array(await file.arrayBuffer());
    if(!checkSignature(bytes,ext))throw fail("Содержимое файла не соответствует его типу.",415);
    const rows=await c.db.prepare(`SELECT COUNT(*) AS count,COALESCE(SUM(size_bytes),0) AS sum
      FROM sh_proc_attachments WHERE workspace_id=?1 AND server_scope=?2 AND entity_type=?3 AND entity_id=?4`)
      .bind(c.workspace,c.server,type,entityId).first();
    if(Number(rows?.count)>=MAX_FILES)throw fail("Лимит: 30 вложений на документ.",409);
    const quota=await c.db.prepare(`SELECT COALESCE(SUM(size_bytes),0) AS used
      FROM sh_proc_attachments WHERE workspace_id=?1 AND server_scope=?2`).bind(c.workspace,c.server).first();
    if(Number(quota?.used)+file.size>QUOTA_BYTES)throw fail("Место для документов организации заполнено (96 МБ).",409);
    const digest=await crypto.subtle.digest("SHA-256",bytes);
    const sha256=[...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
    const fileId=id(),at=new Date().toISOString(),actor=clean(c.access.displayName)||clean(c.auth.user.email);
    const ops=[c.db.prepare(`INSERT INTO sh_proc_attachments
      (id,workspace_id,server_scope,entity_type,entity_id,filename,mime_type,size_bytes,sha256,
        created_at,created_by,created_by_name,supplier_id,supplier_name)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)`)
      .bind(fileId,c.workspace,c.server,type,entityId,filename,mimeByExt[ext],file.size,sha256,
        at,c.auth.user.id,actor,clean(doc.supplier_id),clean(doc.supplier_name))];
    for(let i=0,seq=0;i<bytes.length;i+=CHUNK_BYTES,seq++){
      ops.push(c.db.prepare("INSERT INTO sh_proc_attachment_chunks(attachment_id,seq,body_base64) VALUES(?1,?2,?3)")
        .bind(fileId,seq,toBase64(bytes.subarray(i,i+CHUNK_BYTES))));
    }
    await c.db.batch(ops);
    await logAuditEvent({request,env,connection:privateConnection((await loadPrivateIikoState(c.db,c.access.storageUserId||c.access.ownerUserId,env)).state),
      action:"UPLOAD",entityType:"PROCUREMENT_ATTACHMENT",entityId:fileId,entityLabel:filename,
      before:null,after:{entityType:type,entityId,size:file.size,sha256},metadata:{entityType:type,entityId,size:file.size,sha256}});
    return json({success:true,file:{id:fileId,name:filename,size:file.size,entityId,entityType:type}},201);
  }catch(e){return json({success:false,message:e.message||String(e)},e.status||500)}
}
