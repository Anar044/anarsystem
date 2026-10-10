import {
  SERVER_PASSWORD_MARKER,
  getUser,
  sessionCookie,
  loadPrivateIikoState,
  publicState
} from "./_lib/user-state.js";
import { resolveAccessForUser } from "../access/_lib/access-control.js";

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

// SH Server provisioning belongs exclusively to Platform Admin.
// The existing GET remains available because analytics/HR modules need the
// organization connection identity; no organization user may change it here.
export async function onRequestPost({request,env}) {
  try {
    if (!env.DB) return json({success:false,message:"D1 binding DB не настроен."},503);
    const c=await accessContext(request,env);
    if(c.error)return c.error;
    return json({success:false,code:"PLATFORM_MANAGED_CONNECTION",
      message:"Подключением SH Server управляет только администратор платформы."},403);
  } catch (error) {
    return json({success:false,message:"Не удалось проверить разрешения."},500);
  }
}

export async function onRequestDelete({request,env}) {
  try {
    if (!env.DB) return json({success:false,message:"D1 binding DB не настроен."},503);
    const c=await accessContext(request,env);
    if(c.error)return c.error;
    return json({success:false,code:"PLATFORM_MANAGED_CONNECTION",
      message:"Подключением SH Server управляет только администратор платформы."},403);
  } catch (error) {
    return json({success:false,message:"Не удалось проверить разрешения."},500);
  }
}

export { SERVER_PASSWORD_MARKER };
