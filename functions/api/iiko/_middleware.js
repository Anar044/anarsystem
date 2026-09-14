import {
  getUser,
  loadPrivateIikoState,
  privateConnection,
  hasPrivateConnection,
  isServerPasswordMarker
} from "./_lib/user-state.js";

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

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // /state owns authentication/session-cookie handling itself.
  if (url.pathname === "/api/iiko/state" || request.method === "OPTIONS") {
    return context.next();
  }

  if (!env.DB || request.method === "GET" || request.method === "HEAD" || !isJsonRequest(request)) {
    return context.next();
  }

  let body;
  try {
    body = await request.clone().json();
  } catch {
    return context.next();
  }

  // Settings discovery may intentionally use a brand-new unsaved connection.
  // If a real password is supplied, preserve that request unchanged.
  if (!needsServerCredentials(body)) {
    return context.next();
  }

  const auth = await getUser(request, env);
  if (!auth) return context.next();

  const stored = await loadPrivateIikoState(env.DB, auth.user.id);
  if (!stored.found || !hasPrivateConnection(stored.state)) {
    return context.next();
  }

  const connection = privateConnection(stored.state);
  const rewrittenBody = injectConnection(body, connection);
  const headers = new Headers(request.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");

  const rewritten = new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(rewrittenBody),
    redirect: request.redirect
  });

  return context.next(rewritten);
}
