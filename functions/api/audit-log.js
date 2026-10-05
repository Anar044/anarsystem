import { getUser, loadPrivateIikoState, privateConnection } from "./iiko/_lib/user-state.js";
import { ensureAuditTable, serverScopeFromConnection } from "./_lib/audit-log.js";

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
    const auth=await getUser(request,env);
    if(!auth)return json({success:false,message:"Необходима авторизация."},401);
    if(!env.DB)return json({success:false,message:"D1 binding DB не настроен."},503);
    const stored=await loadPrivateIikoState(env.DB,auth.user.id,env);
    const connection=privateConnection(stored?.state);
    const serverScope=await serverScopeFromConnection(connection);
    if(!serverScope)return json({success:true,events:[],total:0,actors:[],message:"Нет активного подключения Smart Horeca."});
    await ensureAuditTable(env.DB);

    const q=new URL(request.url).searchParams;
    const from=clean(q.get("from")),to=clean(q.get("to")),actor=clean(q.get("actor")),entityType=clean(q.get("entityType")),action=clean(q.get("action")),search=clean(q.get("search"));
    const limit=Math.max(1,Math.min(200,Number(q.get("limit")||100)||100));
    const offset=Math.max(0,Number(q.get("offset")||0)||0);
    const where=["server_scope=?"];
    const args=[serverScope];
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
    const actors=await env.DB.prepare(`SELECT user_id,MAX(actor_name) actor_name,MAX(actor_email) actor_email,MAX(created_at) last_at FROM audit_log WHERE server_scope=? GROUP BY user_id ORDER BY actor_name`).bind(serverScope).all();
    const eventRows=(rows.results||[]).map(r=>({
      id:r.id,createdAt:r.created_at,userId:r.user_id,actorEmail:r.actor_email||"",actorName:r.actor_name||r.actor_email||r.user_id,
      action:r.action,entityType:r.entity_type,entityId:r.entity_id||"",entityLabel:r.entity_label||"",documentNumber:r.document_number||"",
      restaurantIds:parseJson(r.restaurant_ids_json,[]),restaurantNames:parseJson(r.restaurant_names_json,[]),
      sourcePath:r.source_path||"",before:parseJson(r.before_json,null),after:parseJson(r.after_json,null),
      changes:parseJson(r.changes_json,[]),metadata:parseJson(r.metadata_json,{})
    }));
    return json({success:true,total:Number(countRow?.total||0),limit,offset,events:eventRows,actors:actors.results||[]});
  }catch(error){
    return json({success:false,message:error?.message||"Ошибка загрузки журнала действий."},500);
  }
}
