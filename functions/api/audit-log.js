import { loadRequestIikoState, privateConnection, hasPrivateConnection } from "./iiko/_lib/user-state.js";
import { ensureAuditTable, auditScopeFromConnection } from "./_lib/audit-log.js";
import { hasPermission } from "./access/_lib/access-control.js";
import { scopeStateForAssistant } from "./iiko/_lib/ai-assistant-context.js";
import { resolveRestaurantScope, allowedDepartmentIds } from "./iiko/_lib/restaurant-scope.js";

const HEADERS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type, Authorization",
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store"
};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:HEADERS});}
function parseJson(v,fallback){try{return JSON.parse(String(v||""))}catch{return fallback}}
function clean(v){return String(v??"").trim();}
export async function onRequestOptions(){return new Response(null,{status:204,headers:HEADERS});}
export async function onRequestGet({request,env}){
  try{
    if(!env.DB)return json({success:false,message:"D1 binding DB не настроен."},503);
    const stored=await loadRequestIikoState(request,env);
    if(!stored)return json({success:false,code:"UNAUTHENTICATED",message:"Необходима авторизация."},401);
    if(stored.accessDenied||!stored.access?.allowed)return json({success:false,code:stored.access?.reason||"WORKSPACE_ACCESS_DENIED",message:"Нет доступа к организации."},403);
    if(!hasPermission(stored.access,"audit.view"))return json({success:false,code:"AUDIT_PERMISSION_DENIED",message:"Нет права на просмотр журнала действий."},403);
    if(!stored.found||!hasPrivateConnection(stored.state))return json({success:false,code:"AUDIT_SERVER_NOT_CONFIGURED",message:"Подключение Smart Horeca Server для организации не найдено."},409);
    const state=scopeStateForAssistant(stored.state,stored.access);
    const scope=resolveRestaurantScope({state,request,strict:true});
    const connection=privateConnection(stored.state);
    const serverScope=await auditScopeFromConnection(connection,stored.storageUserId);
    if(!serverScope)return json({success:false,code:"AUDIT_WORKSPACE_SCOPE_UNAVAILABLE",message:"Не удалось определить организацию журнала."},409);
    await ensureAuditTable(env.DB);

    const q=new URL(request.url).searchParams;
    const from=clean(q.get("from")),to=clean(q.get("to")),actor=clean(q.get("actor")),entityType=clean(q.get("entityType")),action=clean(q.get("action")),search=clean(q.get("search"));
    const limit=Math.max(1,Math.min(200,Number(q.get("limit")||100)||100));
    const offset=Math.max(0,Number(q.get("offset")||0)||0);
    const where=["server_scope=?"];
    const args=[serverScope];
    const fullDepartmentIds=allowedDepartmentIds(stored.state);
    const restricted=scope.isChain&&(stored.access.scope?.mode==="SELECTED"||
      scope.selectedDepartmentIds.length<fullDepartmentIds.length);
    if(restricted){
      const selected=scope.selectedDepartmentIds||[];
      if(!selected.length)return json({success:true,total:0,limit,offset,events:[],actors:[]});
      where.push(`EXISTS(SELECT 1 FROM json_each(audit_log.restaurant_ids_json) WHERE value IN (${selected.map(()=>"?").join(",")}))`);
      args.push(...selected);
    }
    if(from){where.push("created_at>=?");args.push(from.length===10?from+"T00:00:00.000Z":from);}
    if(to){where.push("created_at<=?");args.push(to.length===10?to+"T23:59:59.999Z":to);}
    if(actor){where.push("(user_id=? OR actor_email=? OR actor_name=?)");args.push(actor,actor,actor);}
    if(entityType){where.push("entity_type=?");args.push(entityType);}
    if(action){where.push("action=?");args.push(action);}
    if(search){
      where.push("(entity_label LIKE ? OR document_number LIKE ? OR entity_id LIKE ? OR actor_name LIKE ? OR actor_email LIKE ? OR changes_json LIKE ?)");
      const like=`%${search}%`;args.push(like,like,like,like,like,like);
    }

    const sqlWhere=where.join(" AND ");
    const countRow=await env.DB.prepare(`SELECT COUNT(*) AS total FROM audit_log WHERE ${sqlWhere}`).bind(...args).first();
    const rows=await env.DB.prepare(`SELECT * FROM audit_log WHERE ${sqlWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?`).bind(...args,limit,offset).all();
    const actors=await env.DB.prepare(`SELECT user_id,MAX(actor_name) actor_name,MAX(actor_email) actor_email,MAX(created_at) last_at FROM audit_log WHERE ${restricted?where.slice(0,2).join(" AND "):"server_scope=?"} GROUP BY user_id ORDER BY actor_name`).bind(...(restricted?args.slice(0,1+scope.selectedDepartmentIds.length):[serverScope])).all();
    const canViewPrices=hasPermission(stored.access,"procurement.prices.view")||hasPermission(stored.access,"sensitive.cost.view");
    const protectedProcurementTypes=new Set(["PURCHASE_REQUISITION","PURCHASE_ORDER","SUPPLIER_QUOTE","SUPPLIER_PROFILE","SUPPLIER_CONTRACT","PURCHASE_RECEIPT","GOODS_RECEIPT"]);
    const eventRows=(rows.results||[]).map(r=>({
      id:r.id,createdAt:r.created_at,userId:r.user_id,actorEmail:r.actor_email||"",actorName:r.actor_name||r.actor_email||r.user_id,
      action:r.action,entityType:r.entity_type,entityId:r.entity_id||"",entityLabel:r.entity_label||"",documentNumber:r.document_number||"",
      restaurantIds:parseJson(r.restaurant_ids_json,[]),restaurantNames:parseJson(r.restaurant_names_json,[]),
      sourcePath:r.source_path||"",before:parseJson(r.before_json,null),after:parseJson(r.after_json,null),
      changes:parseJson(r.changes_json,[]),metadata:parseJson(r.metadata_json,{})
    }));
    // Audit snapshots contain line prices and totals. Do not disclose them
    // to users with audit.view but without an explicit cost-view permission.
    const safeEvents=canViewPrices?eventRows:eventRows.map(event=>
      protectedProcurementTypes.has(event.entityType)
        ? {...event,before:null,after:null,changes:[],metadata:{}}
        : event
    );
    return json({success:true,total:Number(countRow?.total||0),limit,offset,events:safeEvents,actors:actors.results||[]});
  }catch(error){
    return json({success:false,code:error?.code||"AUDIT_ERROR",message:error?.message||"Ошибка загрузки журнала действий."},error?.status||500);
  }
}
