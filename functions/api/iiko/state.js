import {
  SERVER_PASSWORD_MARKER,
  getUser,
  sessionCookie,
  ensureIikoStateTable,
  loadPrivateIikoState,
  savePrivateIikoState,
  publicState,
  isServerPasswordMarker
} from "./_lib/user-state.js";
import { resolveAccessForUser, hasPermission, updateWorkspaceName } from "../access/_lib/access-control.js";

const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...HEADERS, ...extraHeaders } });
}

function sanitizeConnection(input, fallbackPassword = "") {
  const x = input && typeof input === "object" ? input : {};
  const incomingPassword = String(x.password || "");
  const password = (!incomingPassword || isServerPasswordMarker(incomingPassword))
    ? String(fallbackPassword || "")
    : incomingPassword;
  return {
    ip: String(x.ip || "").trim(),
    port: String(x.port || "").trim(),
    login: String(x.login || "").trim(),
    password,
    connectionType: x.connectionType === "CHAIN" ? "CHAIN" : "RMS",
    isChain: x.isChain === true,
    detectedMode: String(x.detectedMode || x.connectionType || "RMS").toUpperCase(),
    organizationId: String(x.organizationId || ""),
    displayName: String(x.displayName || ""),
    networkName: String(x.networkName || ""),
    restaurantName: String(x.restaurantName || ""),
    connectedAt: String(x.connectedAt || new Date().toISOString())
  };
}

function clean(v){return String(v??"").trim()}
async function accessContext(request,env){
  const auth=await getUser(request,env);
  if(!auth)return{error:json({success:false,message:"Необходима авторизация."},401)};
  const access=await resolveAccessForUser(env.DB,auth.user,{claimInvite:true,request});
  if(!access.allowed)return{error:json({success:false,message:"Доступ к Smart Horeca не назначен.",reason:access.reason},403)};
  return{auth,access,storageUserId:access.storageUserId||access.ownerUserId||auth.user.id};
}
function stateForAccess(state,access){
  const out=publicState(state);
  if(!out||access?.isOwner||access?.scope?.mode!=="SELECTED")return out;
  const ids=new Set((access.scope.departmentIds||[]).map(clean).filter(Boolean));
  const codes=new Set((access.scope.departmentCodes||[]).map(clean).filter(Boolean));
  const identity=out.identity&&typeof out.identity==="object"?{...out.identity}:{};
  const departments=(Array.isArray(identity.departments)?identity.departments:[]).filter(x=>ids.has(clean(x?.id))||codes.has(clean(x?.code)));
  const allowedIds=new Set(departments.map(x=>clean(x.id)).filter(Boolean));
  for(const id of ids)allowedIds.add(id);
  identity.departments=departments;
  identity.organizations=(Array.isArray(identity.organizations)?identity.organizations:[]).filter(x=>allowedIds.has(clean(x?.id))||codes.has(clean(x?.code)));
  identity.departmentIds=[...allowedIds];
  const groups=(Array.isArray(identity.groups)?identity.groups:[]).filter(x=>allowedIds.has(clean(x?.departmentId)));
  const groupIds=new Set(groups.map(x=>clean(x?.id)).filter(Boolean));
  identity.groups=groups;
  const points=(Array.isArray(identity.pointsOfSale)?identity.pointsOfSale:[]).filter(x=>groupIds.has(clean(x?.groupId)));
  const pointIds=new Set(points.map(x=>clean(x?.id)).filter(Boolean));
  identity.pointsOfSale=points;
  identity.restaurantSections=(Array.isArray(identity.restaurantSections)?identity.restaurantSections:[]).filter(x=>groupIds.has(clean(x?.groupId))||pointIds.has(clean(x?.pointOfSaleId)));
  identity.hierarchy=(Array.isArray(identity.hierarchy)?identity.hierarchy:[]).filter(x=>allowedIds.has(clean(x?.id))||allowedIds.has(clean(x?.departmentId))||groupIds.has(clean(x?.id))||groupIds.has(clean(x?.groupId)));
  out.identity=identity;
  return out;
}

function sanitizeIdentity(input) {
  const x = input && typeof input === "object" ? input : {};
  return {
    mode: x.mode === "CHAIN" ? "CHAIN" : "RMS",
    detectedMode: String(x.detectedMode || x.mode || "RMS").toUpperCase(),
    organizationId: String(x.organizationId || ""),
    displayName: String(x.displayName || ""),
    networkName: String(x.networkName || ""),
    restaurantName: String(x.restaurantName || ""),
    departmentIds: Array.isArray(x.departmentIds) ? x.departmentIds.map(String).filter(Boolean) : [],
    departments: Array.isArray(x.departments) ? x.departments : [],
    organizations: Array.isArray(x.organizations) ? x.organizations : [],
    hierarchy: Array.isArray(x.hierarchy) ? x.hierarchy : [],
    groups: Array.isArray(x.groups) ? x.groups : [],
    pointsOfSale: Array.isArray(x.pointsOfSale) ? x.pointsOfSale : [],
    restaurantSections: Array.isArray(x.restaurantSections) ? x.restaurantSections : [],
    server: x.server && typeof x.server === "object" ? {
      ip: String(x.server.ip || ""),
      port: String(x.server.port || "")
    } : null,
    checkedAt: String(x.checkedAt || new Date().toISOString())
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: HEADERS });
}

export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return json({ success: false, message: "D1 binding DB не настроен." }, 503);
    const c=await accessContext(request,env);if(c.error)return c.error;
    const stored = await loadPrivateIikoState(env.DB, c.storageUserId, env);
    const cookie = sessionCookie(c.auth.token);
    if (!stored.found) return json({ success: true, found: false, state: null, access:{permissions:c.access.permissions,scope:c.access.scope} }, 200, { "Set-Cookie": cookie });

    return json({
      success: true,
      found: true,
      state: stateForAccess(stored.state,c.access),
      access:{permissions:c.access.permissions,scope:c.access.scope,isOwner:c.access.isOwner},
      updatedAt: stored.updatedAt,
      storageEncrypted: stored.encrypted === true
    }, 200, { "Set-Cookie": cookie });
  } catch (error) {
    return json({ success: false, message: error?.message || "Ошибка загрузки подключения Smart Horeca Server." }, error?.status||500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ success: false, message: "D1 binding DB не настроен." }, 503);
    const c=await accessContext(request,env);if(c.error)return c.error;
    if(!hasPermission(c.access,"settings.manage"))return json({success:false,message:"Недостаточно прав для изменения подключения."},403);
    // Platform-managed organizations have a stable synthetic storage owner.
    // Their connection settings can only be provisioned by Platform Admin
    // (future dedicated API). Restaurant SYSADMIN cannot alter server binding.
    if(String(c.access?.ownerUserId||'').startsWith('platform-org:')){
      return json({success:false,message:"Подключением Smart Horeca Server управляет администратор платформы."},403);
    }


    const body = await request.json();
    const existing = await loadPrivateIikoState(env.DB, c.storageUserId, env);
    const existingPassword = existing?.state?.connection?.password || "";
    const connection = sanitizeConnection(body?.connection, existingPassword);
    const identity = sanitizeIdentity(body?.identity);

    if (!connection.ip || !connection.port || !connection.login || !connection.password) {
      return json({ success: false, message: "Для сохранения нужны IP, порт, логин и пароль iiko Server." }, 400);
    }

    const state = { connection, identity, savedAt: new Date().toISOString() };
    const saved = await savePrivateIikoState(env.DB, c.storageUserId, state, env);
    if(c.access?.isOwner&&c.access?.workspace?.id){
      const workspaceName=identity.networkName||connection.networkName||identity.displayName||connection.displayName||identity.restaurantName||connection.restaurantName;
      if(workspaceName)await updateWorkspaceName(env.DB,c.access.workspace.id,workspaceName);
    }

    return json({
      success: true,
      updatedAt: saved.updatedAt,
      storageEncrypted: saved.encrypted === true,
      state: publicState(state)
    }, 200, { "Set-Cookie": sessionCookie(c.auth.token) });
  } catch (error) {
    return json({ success: false, message: error?.message || "Ошибка сохранения подключения iiko." }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    if (!env.DB) return json({ success: false, message: "D1 binding DB не настроен." }, 503);
    const c=await accessContext(request,env);if(c.error)return c.error;
    if(!hasPermission(c.access,"settings.manage"))return json({success:false,message:"Недостаточно прав для удаления подключения."},403);
    // Platform-managed organizations have a stable synthetic storage owner.
    // Their connection settings can only be provisioned by Platform Admin
    // (future dedicated API). Restaurant SYSADMIN cannot alter server binding.
    if(String(c.access?.ownerUserId||'').startsWith('platform-org:')){
      return json({success:false,message:"Подключением Smart Horeca Server управляет администратор платформы."},403);
    }


    await ensureIikoStateTable(env.DB);
    await env.DB.prepare(`DELETE FROM iiko_connections WHERE user_id=?1`).bind(c.storageUserId).run();
    return json({ success: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  } catch (error) {
    return json({ success: false, message: error?.message || "Ошибка удаления подключения iiko." }, 500);
  }
}

export { SERVER_PASSWORD_MARKER };
