import { getUser, loadPrivateIikoState } from "../iiko/_lib/user-state.js";

const INTERNAL_SCOPE_HEADER = "X-SH-Allowed-Departments";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function collectDepartmentIds(state) {
  const identity = state?.identity && typeof state.identity === "object" ? state.identity : {};
  const connection = state?.connection && typeof state.connection === "object" ? state.connection : {};
  const values = [
    ...(Array.isArray(identity.departmentIds) ? identity.departmentIds : []),
    ...(Array.isArray(identity.departments) ? identity.departments.map(x => x?.id) : []),
    ...(Array.isArray(identity.organizations) ? identity.organizations.map(x => x?.id) : []),
    ...(Array.isArray(connection.departmentIds) ? connection.departmentIds : []),
    ...(Array.isArray(connection.departments) ? connection.departments.map(x => x?.id) : []),
    ...(Array.isArray(connection.organizations) ? connection.organizations.map(x => x?.id) : []),
    identity.organizationId,
    connection.organizationId
  ];
  return [...new Set(values.map(String).map(x => x.trim()).filter(x => x && x !== "undefined" && x !== "null"))];
}

function parseList(value) {
  if (Array.isArray(value)) return [...new Set(value.map(String).map(x => x.trim()).filter(Boolean))];
  return [...new Set(String(value || "").split(",").map(x => x.trim()).filter(Boolean))];
}

function requestedFromUrl(url) {
  return [
    ...parseList(url.searchParams.get("departmentIds")),
    ...parseList(url.searchParams.get("departmentId"))
  ];
}

function validateScope(requested, allowed) {
  const allowedSet = new Set(allowed);
  const unique = [...new Set(requested)];
  const invalid = unique.filter(id => !allowedSet.has(id));
  return { invalid, selected: unique.length ? unique : allowed };
}

function rewriteRequest(request, url, body, selected) {
  const headers = new Headers(request.headers);
  headers.delete(INTERNAL_SCOPE_HEADER);
  headers.set(INTERNAL_SCOPE_HEADER, selected.join(","));

  const init = { method: request.method, headers, redirect: request.redirect };
  if (body !== undefined) {
    headers.set("Content-Type", "application/json; charset=utf-8");
    init.body = JSON.stringify(body);
  }
  return new Request(url.toString(), init);
}

function requiresRestaurantScope(pathname) {
  return pathname.endsWith("/data") ||
    pathname.endsWith("/request") ||
    pathname.endsWith("/order-history") ||
    pathname.endsWith("/events");
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  if (request.method === "OPTIONS") return context.next();

  // Plugin/connector machine endpoints use their own X-Plugin-Token.
  if (url.pathname.endsWith("/ingest") || url.pathname.endsWith("/heartbeat")) {
    return context.next();
  }

  const auth = await getUser(request, env);
  if (!auth) return json({ success: false, error: "Authentication required" }, 401);

  let allowed = [];
  if (env.DB) {
    const stored = await loadPrivateIikoState(env.DB, auth.user.id, env);
    if (stored.found) allowed = collectDepartmentIds(stored.state);
  }

  if (requiresRestaurantScope(url.pathname) && !env.DB) {
    return json({ success: false, error: "D1 binding DB is not configured" }, 503);
  }
  if (requiresRestaurantScope(url.pathname) && !allowed.length) {
    return json({ success: false, error: "No restaurants are bound to this account" }, 403);
  }

  let selected = allowed;
  let body;

  if (request.method !== "GET" && request.method !== "HEAD" &&
      (request.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    body = await request.clone().json().catch(() => ({}));
    const requested = [
      ...parseList(body?.departmentIds),
      ...parseList(body?.departmentId)
    ];
    const scoped = validateScope(requested, allowed);
    if (scoped.invalid.length) {
      return json({ success: false, error: "Requested department is not allowed for this account" }, 403);
    }
    selected = scoped.selected;
    if (url.pathname.endsWith("/request")) body.departmentIds = [...selected];
  } else {
    const scoped = validateScope(requestedFromUrl(url), allowed);
    if (scoped.invalid.length) {
      return json({ success: false, error: "Requested department is not allowed for this account" }, 403);
    }
    selected = scoped.selected;

    if (url.pathname.endsWith("/data") || url.pathname.endsWith("/order-history")) {
      url.searchParams.set("departmentIds", selected.join(","));
      url.searchParams.delete("departmentId");
    }
    if (url.pathname.endsWith("/events")) {
      if (selected.length === 1) url.searchParams.set("departmentId", selected[0]);
      else url.searchParams.delete("departmentId");
    }
  }

  return context.next(rewriteRequest(request, url, body, selected));
}
