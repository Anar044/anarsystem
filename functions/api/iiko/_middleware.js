import {
  getUser,
  loadPrivateIikoState,
  privateConnection,
  hasPrivateConnection,
  isServerPasswordMarker
} from "./_lib/user-state.js";

const REPORTS_DEPARTMENTS_COOKIE = "sh_reports_departments";
const OLAP_DEFAULT_FILTERS = {
  DeletedWithWriteoff: { filterType: "IncludeValues", values: ["NOT_DELETED"] },
  OrderDeleted: { filterType: "IncludeValues", values: ["NOT_DELETED"] }
};

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
  const scope = selected.length ? selected : allowed;

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

  // /state owns authentication/session-cookie handling itself.
  if (url.pathname === "/api/iiko/state" || request.method === "OPTIONS") {
    return context.next();
  }

  if (request.method === "GET" || request.method === "HEAD" || !isJsonRequest(request)) {
    return context.next();
  }

  let body;
  try {
    body = await request.clone().json();
  } catch {
    return context.next();
  }

  let storedState = null;
  let storedConnection = null;

  if (env.DB) {
    const auth = await getUser(request, env);
    if (auth) {
      const stored = await loadPrivateIikoState(env.DB, auth.user.id, env);
      if (stored.found) {
        storedState = stored.state;
        if (hasPrivateConnection(stored.state)) storedConnection = privateConnection(stored.state);
      }
    }
  }

  let rewrittenBody = applyOlapPolicy(body, storedState, request);

  // Settings discovery may intentionally use a brand-new unsaved connection.
  // If a real password is supplied, preserve it. For saved connections the
  // real password is injected only inside Cloudflare.
  if (needsServerCredentials(rewrittenBody) && storedConnection) {
    rewrittenBody = injectConnection(rewrittenBody, storedConnection);
  }

  const rewritten = requestWithJsonBody(request, rewrittenBody);
  const response = await context.next(rewritten);
  return normalizeOlapFieldsResponse(response, url.pathname, rewrittenBody);
}
