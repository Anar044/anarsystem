import { getUser } from "../iiko/_lib/user-state.js";

const SENSITIVE_KEY = /(password|passwd|secret|token|authorization|api.?key|private.?key|credential|cookie)/i;
const MAX_JSON = 180000;

function clean(v){return String(v??"").trim();}
function actorName(user){
  const m=user?.user_metadata||{};
  return clean(m.full_name||m.name||m.display_name||user?.email||user?.id);
}
function safeValue(value,depth=0){
  if(depth>8)return "[max-depth]";
  if(value===null||value===undefined)return value;
  if(Array.isArray(value))return value.slice(0,500).map(x=>safeValue(x,depth+1));
  if(typeof value!=="object")return value;
  const out={};
  for(const [k,v] of Object.entries(value)){
    if(SENSITIVE_KEY.test(k)){out[k]="[REDACTED]";continue;}
    out[k]=safeValue(v,depth+1);
  }
  return out;
}
function stableJson(value){
  try{
    const text=JSON.stringify(safeValue(value));
    return text.length>MAX_JSON?JSON.stringify({truncated:true,preview:text.slice(0,MAX_JSON)}):text;
  }catch{return "{}";}
}
function same(a,b){try{return JSON.stringify(a)===JSON.stringify(b)}catch{return false}}
function diffValues(before,after,path="",out=[]){
  if(out.length>=500||same(before,after))return out;
  if(Array.isArray(before)||Array.isArray(after)){
    const a=Array.isArray(before)?before:[],b=Array.isArray(after)?after:[];
    const n=Math.max(a.length,b.length);
    for(let i=0;i<n&&out.length<500;i++)diffValues(a[i],b[i],`${path}[${i}]`,out);
    return out;
  }
  const aObj=before&&typeof before==="object";
  const bObj=after&&typeof after==="object";
  if(aObj&&bObj){
    const keys=new Set([...Object.keys(before),...Object.keys(after)]);
    for(const key of keys){
      if(SENSITIVE_KEY.test(key))continue;
      diffValues(before[key],after[key],path?`${path}.${key}`:key,out);
      if(out.length>=500)break;
    }
    return out;
  }
  out.push({field:path||"value",oldValue:safeValue(before),newValue:safeValue(after)});
  return out;
}
async function sha256(text){
  const bytes=new TextEncoder().encode(String(text||""));
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export async function serverScopeFromConnection(connection){
  const c=connection&&typeof connection==="object"?connection:{};
  const host=clean(c.ip||c.host||c.serverUrl);
  const port=clean(c.port);
  return host?await sha256(`${host.toLowerCase()}:${port}`):"";
}
export async function ensureAuditTable(db){
  if(!db)throw new Error("D1 binding DB не настроен.");
  await db.prepare(`CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    server_scope TEXT NOT NULL,
    user_id TEXT NOT NULL,
    actor_email TEXT,
    actor_name TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    entity_label TEXT,
    document_number TEXT,
    restaurant_ids_json TEXT,
    restaurant_names_json TEXT,
    source_path TEXT,
    before_json TEXT,
    after_json TEXT,
    changes_json TEXT,
    metadata_json TEXT
  )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_scope_created ON audit_log(server_scope,created_at DESC)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_scope_actor ON audit_log(server_scope,user_id,created_at DESC)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_audit_scope_entity ON audit_log(server_scope,entity_type,entity_id,created_at DESC)").run();
}
export async function logAuditEvent({request,env,connection,action,entityType,entityId="",entityLabel="",documentNumber="",before=null,after=null,restaurantIds=[],restaurantNames=[],metadata={}}){
  try{
    if(!env?.DB||!request)return {logged:false,reason:"NO_DB_OR_REQUEST"};
    const auth=await getUser(request,env);
    if(!auth)return {logged:false,reason:"NO_AUTH"};
    const scope=await serverScopeFromConnection(connection);
    if(!scope)return {logged:false,reason:"NO_SERVER_SCOPE"};
    await ensureAuditTable(env.DB);
    const changes=diffValues(safeValue(before),safeValue(after));
    const id=crypto.randomUUID(),now=new Date().toISOString();
    await env.DB.prepare(`INSERT INTO audit_log(
      id,created_at,server_scope,user_id,actor_email,actor_name,action,entity_type,entity_id,entity_label,document_number,
      restaurant_ids_json,restaurant_names_json,source_path,before_json,after_json,changes_json,metadata_json
    ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)`)
      .bind(
        id,now,scope,String(auth.user.id),clean(auth.user.email),actorName(auth.user),clean(action),clean(entityType),
        clean(entityId),clean(entityLabel),clean(documentNumber),
        stableJson(restaurantIds),stableJson(restaurantNames),new URL(request.url).pathname,
        stableJson(before),stableJson(after),stableJson(changes),stableJson(metadata)
      ).run();
    return {logged:true,id,changes:changes.length};
  }catch(error){
    console.error("AUDIT_LOG_ERROR",String(error?.message||error));
    return {logged:false,reason:String(error?.message||error)};
  }
}
export { safeValue, diffValues };
