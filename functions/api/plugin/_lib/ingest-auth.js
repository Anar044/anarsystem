import {pluginBackendUrl,pluginBackendHeaders} from "./backend-upstream.js";
const REGISTRY_CACHE_TTL_MS=60000;
const registryCache=new Map();

function clean(v){return String(v??"").trim()}
function pluginRows(data){
  if(Array.isArray(data))return data;
  if(Array.isArray(data?.plugins))return data.plugins;
  if(Array.isArray(data?.data))return data.data;
  if(Array.isArray(data?.items))return data.items;
  return [];
}
async function sha256(value){
  const bytes=new TextEncoder().encode(String(value??""));
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,"0")).join("");
}
async function sameSecret(a,b){
  if(!a||!b)return false;
  const [ha,hb]=await Promise.all([sha256(a),sha256(b)]);
  return ha===hb;
}
function suppliedToken(request){
  const auth=request.headers.get("Authorization")||"";
  if(/^Bearer\s+/i.test(auth))return auth.replace(/^Bearer\s+/i,"").trim();
  return clean(request.headers.get("X-Plugin-Token"));
}
async function fetchRegistry(departmentId,env){
  const key=clean(departmentId).toLowerCase();
  const cached=registryCache.get(key);
  if(cached&&cached.expiresAt>Date.now())return cached.rows;
  const url=new URL(pluginBackendUrl(env, "/api/plugin/data"));
  url.searchParams.set("departmentIds",departmentId);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),10000);
  try{
    const r=await fetch(url.toString(),{headers:pluginBackendHeaders(env,{Accept:"application/json"}),signal:controller.signal});
    const data=await r.json().catch(()=>null);
    if(!r.ok||!data)throw new Error(`Plugin registry HTTP ${r.status}`);
    const rows=pluginRows(data).map(item=>item?.data&&typeof item.data==="object"?{...item,...item.data}:item);
    registryCache.set(key,{rows,expiresAt:Date.now()+REGISTRY_CACHE_TTL_MS});
    return rows;
  }finally{clearTimeout(timer)}
}

// Existing API callers retain PLUGIN_INGEST_TOKEN. QR Bridge passes its own
// server-only secret as the fourth argument, so a test till does not need the
// global plugin ingestion credential or affect other plugin connections.
export async function verifyPluginIngress(request,env,{pluginId,departmentId}={},dedicatedToken=null){
  const dedicated=dedicatedToken!==null;
  const expected=clean(dedicated?dedicatedToken:env?.PLUGIN_INGEST_TOKEN);
  if(!expected){
    const e=new Error(dedicated?"QR_POS_INGRESS_TOKEN не настроен.":"PLUGIN_INGEST_TOKEN не настроен.");
    e.status=503;
    e.code=dedicated?"QR_POS_INGRESS_TOKEN_NOT_CONFIGURED":"PLUGIN_INGEST_TOKEN_NOT_CONFIGURED";
    throw e;
  }
  const supplied=suppliedToken(request);
  if(!(await sameSecret(supplied,expected))){
    const e=new Error("Неверный plugin token.");
    e.status=401;e.code="PLUGIN_TOKEN_INVALID";throw e;
  }
  const pid=clean(pluginId),did=clean(departmentId);
  if(!pid||!did){
    const e=new Error("pluginId и departmentId обязательны для проверки.");
    e.status=400;e.code="PLUGIN_IDENTITY_REQUIRED";throw e;
  }
  let rows;
  try{rows=await fetchRegistry(did,env)}
  catch(error){
    const e=new Error("Не удалось проверить plugin registry: "+(error?.message||error));
    e.status=502;e.code="PLUGIN_REGISTRY_UNAVAILABLE";throw e;
  }
  const match=rows.some(row=>clean(row?.pluginId)===pid&&clean(row?.departmentId)===did);
  if(!match){
    const e=new Error("Plugin не зарегистрирован за указанным departmentId.");
    e.status=403;e.code="PLUGIN_DEPARTMENT_MISMATCH";throw e;
  }
  return{verified:true,pluginId:pid,departmentId:did};
}
