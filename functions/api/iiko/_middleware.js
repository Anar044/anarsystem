import {
  getUser,
  loadPrivateIikoState,
  privateConnection,
  hasPrivateConnection,
  isServerPasswordMarker
} from "./_lib/user-state.js";
import { resolveRestaurantScope, applyDepartmentScopeToBody } from "./_lib/restaurant-scope.js";
import { resolveAccessForUser, hasPermission } from "../access/_lib/access-control.js";

const REPORTS_DEPARTMENTS_COOKIE = "sh_reports_departments";
const OLAP_DEFAULT_FILTERS = {
  DeletedWithWriteoff: { filterType: "IncludeValues", values: ["NOT_DELETED"] },
  OrderDeleted: { filterType: "IncludeValues", values: ["NOT_DELETED"] }
};

function accessDenied(message,status=403,code="ACCESS_DENIED"){
  return new Response(JSON.stringify({success:false,code,message}),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
}
function routePermissions(path,body=null){
  const p=String(path||"").toLowerCase();
  if(p.endsWith("/abc"))return["reports.abc_xyz"];
  if(p.endsWith("/food-cost"))return["reports.food_cost"];
  if(p.endsWith("/pnl")||p.endsWith("/pnl-mapping"))return["reports.pnl"];
  if(p.endsWith("/supplier-balances"))return["reports.supplier_balances","procurement.sourcing","procurement.analytics"];
  if(p.endsWith("/waiter-performance"))return["reports.waiters"];
  if(p.endsWith("/olap")||p.endsWith("/sales"))return["reports.olap"];
  if(p.endsWith("/dashboard")||p.endsWith("/dashboard-summary"))return["dashboard.view"];
  if(p.endsWith("/cash-shifts")||p.endsWith("/cash-shift-detail"))return["cash_shifts.view"];
  if(p.endsWith("/stock-balances"))return["inventory.stock.view","procurement.request.create","procurement.norms.manage","procurement.receive"];
  if(p.endsWith("/stock-movements"))return["inventory.movements.view"];
  if(p.endsWith("/incoming-invoices"))return["inventory.incoming.view","inventory.incoming.manage","procurement.receive"];
  if(p.endsWith("/outgoing-invoices"))return["inventory.outgoing.view","inventory.outgoing.manage"];
  if(p.endsWith("/documents")||p.endsWith("/document-by-number"))return["inventory.incoming.view","inventory.outgoing.view","inventory.writeoff.view","inventory.transfer.view","procurement.receive"];
  if(p.endsWith("/invoice-reference-data")||p.endsWith("/references"))return["inventory.nomenclature.view","inventory.incoming.view","inventory.incoming.manage","procurement.request.create","procurement.sourcing","procurement.receive","procurement.norms.manage"];
  if(p.endsWith("/nomenclature")){
    const action=String(body?.action||"").toLowerCase();
    const mutating=/save|update|delete|restore/.test(action);
    return[mutating?"inventory.nomenclature.manage":"inventory.nomenclature.view"];
  }
  if(p.endsWith("/document-action")){
    const type=String(body?.type||"").toLowerCase();
    if(type==="incoming")return["inventory.incoming.manage","procurement.receive"];
    if(type==="outgoing")return["inventory.outgoing.manage"];
    return["inventory.incoming.manage","inventory.outgoing.manage"];
  }
  if(p.endsWith("/accounts")||p.endsWith("/account-postings")||p.endsWith("/contractors")||p.endsWith("/finance-data"))return["finance.view"];
  if(p.endsWith("/orders"))return["cash.view","reports.olap"];
  if(p.endsWith("/qr-image")||p.endsWith("/qr-menu"))return["qr.manage"];
  if(p.endsWith("/connect")||p.endsWith("/connection")||p.endsWith("/chain")||p.endsWith("/debug"))return["settings.manage"];
  return[];
}
function anyPermission(access,list){
  if(!list||!list.length)return true;
  return list.some(x=>hasPermission(access,x));
}
function restrictStateToAccess(state,access){
  if(!state||access?.isOwner||access?.scope?.mode!=="SELECTED")return state;
  const out=structuredClone(state),identity=out.identity&&typeof out.identity==="object"?out.identity:{},connection=out.connection&&typeof out.connection==="object"?out.connection:{};
  const ids=new Set((access.scope.departmentIds||[]).map(String).map(x=>x.trim()).filter(Boolean));
  const codes=new Set((access.scope.departmentCodes||[]).map(String).map(x=>x.trim()).filter(Boolean));
  const filterRows=list=>(Array.isArray(list)?list:[]).filter(x=>ids.has(String(x?.id||"").trim())||codes.has(String(x?.code||"").trim()));
  const departments=filterRows(identity.departments);
  const organizations=filterRows(identity.organizations);
  const allowedIds=new Set([...ids,...departments.map(x=>String(x?.id||"").trim()),...organizations.map(x=>String(x?.id||"").trim())].filter(Boolean));
  identity.departments=departments;identity.organizations=organizations;identity.departmentIds=[...allowedIds];
  connection.departments=filterRows(connection.departments);connection.organizations=filterRows(connection.organizations);connection.departmentIds=[...allowedIds];
  const groups=(Array.isArray(identity.groups)?identity.groups:[]).filter(x=>allowedIds.has(String(x?.departmentId||"").trim()));
  const groupIds=new Set(groups.map(x=>String(x?.id||"").trim()).filter(Boolean));identity.groups=groups;
  const points=(Array.isArray(identity.pointsOfSale)?identity.pointsOfSale:[]).filter(x=>groupIds.has(String(x?.groupId||"").trim()));
  const pointIds=new Set(points.map(x=>String(x?.id||"").trim()).filter(Boolean));identity.pointsOfSale=points;
  identity.restaurantSections=(Array.isArray(identity.restaurantSections)?identity.restaurantSections:[]).filter(x=>groupIds.has(String(x?.groupId||"").trim())||pointIds.has(String(x?.pointOfSaleId||"").trim()));
  out.identity=identity;out.connection=connection;return out;
}

function isJsonRequest(request) {
  return (request.headers.get("content-type") || "").toLowerCase().includes("application/json");
}

function needsServerCredentials(body) {
  const c = body?.connection && typeof body.connection === "object" ? body.connection : body;
  if (!c || typeof c !== "object") return false;
  return isServerPasswordMarker(c.password) || !c.password || !c.ip || !c.port || !c.login;
}

function injectConnection(body, storedConnection) {
  const nextBody = body && typeof body === "object" ? { ...body } : {};
  if (nextBody.connection && typeof nextBody.connection === "object") {
    nextBody.connection = { ...nextBody.connection, ...storedConnection };
  } else {
    nextBody.ip = storedConnection.ip;
    nextBody.port = storedConnection.port;
    nextBody.login = storedConnection.login;
    nextBody.password = storedConnection.password;
  }
  return nextBody;
}

function parseCookies(request) {
  const result = {};
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const raw = part.slice(index + 1).trim();
    if (!key) continue;
    try { result[key] = decodeURIComponent(raw); } catch { result[key] = raw; }
  }
  return result;
}

function requestedDepartmentIds(request) {
  const raw = parseCookies(request)[REPORTS_DEPARTMENTS_COOKIE] || "";
  return [...new Set(raw.split(",").map(x => x.trim()).filter(Boolean))];
}

function allowedDepartmentIds(state) {
  const identity = state?.identity && typeof state.identity === "object" ? state.identity : {};
  const connection = state?.connection && typeof state.connection === "object" ? state.connection : {};
  const values = [
    ...(Array.isArray(identity.departmentIds) ? identity.departmentIds : []),
    ...(Array.isArray(identity.departments) ? identity.departments.map(x => x?.id) : []),
    ...(Array.isArray(identity.organizations) ? identity.organizations.map(x => x?.id) : []),
    identity.organizationId,
    connection.organizationId
  ];
  return [...new Set(values.map(String).map(x => x.trim()).filter(x => x && x !== "undefined" && x !== "null"))];
}

function addArrayPolicyFilter(filters, field, values) {
  const next = Array.isArray(filters) ? filters.map(item => ({ ...item })) : [];
  const index = next.findIndex(item => String(item?.field || "").toLowerCase() === field.toLowerCase());
  const entry = { field, operator: "IncludeList", values: [...values] };
  if (index >= 0) next[index] = entry;
  else next.push(entry);
  return next;
}

function applyOlapPolicy(body, state, request) {
  if (!body || typeof body !== "object") return body;
  if (String(body.action || "").toLowerCase() !== "query") return body;
  if (String(body.reportType || "SALES").toUpperCase() !== "SALES") return body;

  const next = { ...body };
  const allowed = allowedDepartmentIds(state);
  const requested = requestedDepartmentIds(request);
  const selected = requested.filter(id => allowed.includes(id));
  const effective = selected.length ? selected : allowed;
  const fullSelection = allowed.length>0 && effective.length===allowed.length && effective.every(id=>allowed.includes(id));
  const scope = fullSelection ? [] : effective;

  if (Array.isArray(next.filters)) {
    let filters = next.filters.map(item => ({ ...item }));
    for (const [field, rule] of Object.entries(OLAP_DEFAULT_FILTERS)) {
      if (!filters.some(item => String(item?.field || "").toLowerCase() === field.toLowerCase())) {
        filters = addArrayPolicyFilter(filters, field, rule.values);
      }
    }
    if (scope.length) filters = addArrayPolicyFilter(filters, "Department.Id", scope);
    next.filters = filters;
  } else {
    const filters = next.filters && typeof next.filters === "object" ? { ...next.filters } : {};
    for (const [field, rule] of Object.entries(OLAP_DEFAULT_FILTERS)) {
      if (!Object.prototype.hasOwnProperty.call(filters, field)) {
        filters[field] = { filterType: rule.filterType, values: [...rule.values] };
      }
    }
    if (scope.length) {
      filters["Department.Id"] = { filterType: "IncludeValues", values: [...scope] };
    }
    next.filters = filters;
  }

  return next;
}

function requestWithJsonBody(request, body) {
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(body),
    redirect: request.redirect
  });
}

async function normalizeOlapFieldsResponse(response, pathname, body) {
  if (pathname !== "/api/iiko/olap" || String(body?.action || "").toLowerCase() !== "fields") {
    return response;
  }

  try {
    const data = await response.clone().json();
    if (!data || !Array.isArray(data.fields) || !("raw" in data)) return response;
    delete data.raw;
    const headers = new Headers(response.headers);
    headers.set("Content-Type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(data), {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  } catch {
    return response;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") return context.next();
  // /state has its own tenant-aware access handling.
  if (url.pathname === "/api/iiko/state") return context.next();

  let auth=null,access=null;
  if(env.DB){
    auth=await getUser(request,env);
    if(!auth)return accessDenied("Требуется авторизация.",401,"UNAUTHENTICATED");
    access=await resolveAccessForUser(env.DB,auth.user,{claimInvite:true});
    if(!access.allowed)return accessDenied("Доступ к Smart Horeca не назначен.",403,access.reason||"ACCESS_DENIED");
  }

  let body=null;
  const hasJsonBody=request.method!=="GET"&&request.method!=="HEAD"&&isJsonRequest(request);
  if(hasJsonBody){
    try{body=await request.clone().json()}catch{body=null}
  }

  const required=routePermissions(url.pathname,body);
  if(access&&!anyPermission(access,required)){
    return accessDenied("Недостаточно прав для этого действия.",403,"ACCESS_PERMISSION_DENIED");
  }

  // GET/HEAD requests are authenticated/authorized above. Endpoint code will
  // load tenant state through loadRequestIikoState when needed.
  if (request.method === "GET" || request.method === "HEAD" || !hasJsonBody || !body) {
    return context.next();
  }

  let storedState = null;
  let storedConnection = null;

  if (env.DB && auth && access) {
    const stored = await loadPrivateIikoState(env.DB, access.ownerUserId || auth.user.id, env);
    if (stored.found) {
      storedState = restrictStateToAccess(stored.state,access);
      if (hasPrivateConnection(stored.state)) storedConnection = privateConnection(stored.state);
    }
  }

  let rewrittenBody = body;

  if (storedState) {
    try {
      const scope=resolveRestaurantScope({state:storedState,request,strict:true});
      const bodyIds=Array.isArray(body?.departmentIds)?[...new Set(body.departmentIds.map(String).filter(Boolean))]:[];
      if(bodyIds.length){
        const selected=new Set(scope.selectedDepartmentIds||[]);
        const outsideSelection=bodyIds.filter(id=>!selected.has(id));
        if(outsideSelection.length){
          const error=new Error("Запрос содержит ресторан вне разрешённой области пользователя.");
          error.status=403;
          error.code="ACCESS_SCOPE_SELECTION_FORBIDDEN";
          error.invalidDepartmentIds=outsideSelection;
          throw error;
        }
      }
      rewrittenBody=applyDepartmentScopeToBody(rewrittenBody,scope);
    } catch (error) {
      return new Response(JSON.stringify({
        success:false,
        code:error?.code||"ACCESS_SCOPE_ERROR",
        message:error?.message||"Ошибка области ресторанов",
        invalidDepartmentIds:error?.invalidDepartmentIds||[]
      }),{
        status:Number(error?.status)||403,
        headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}
      });
    }
  }

  rewrittenBody = applyOlapPolicy(rewrittenBody, storedState, request);

  if (needsServerCredentials(rewrittenBody) && storedConnection) {
    rewrittenBody = injectConnection(rewrittenBody, storedConnection);
  }

  const rewritten = requestWithJsonBody(request, rewrittenBody);
  const response = await context.next(rewritten);
  return normalizeOlapFieldsResponse(response, url.pathname, rewrittenBody);
}
