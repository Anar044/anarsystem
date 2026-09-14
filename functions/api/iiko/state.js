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
    const auth = await getUser(request, env);
    if (!auth) return json({ success: false, message: "Необходима авторизация." }, 401);
    if (!env.DB) return json({ success: false, message: "D1 binding DB не настроен." }, 503);

    const stored = await loadPrivateIikoState(env.DB, auth.user.id, env);
    const cookie = sessionCookie(auth.token);
    if (!stored.found) return json({ success: true, found: false, state: null }, 200, { "Set-Cookie": cookie });

    return json({
      success: true,
      found: true,
      state: publicState(stored.state),
      updatedAt: stored.updatedAt,
      storageEncrypted: stored.encrypted === true
    }, 200, { "Set-Cookie": cookie });
  } catch (error) {
    return json({ success: false, message: error?.message || "Ошибка загрузки подключения iiko." }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const auth = await getUser(request, env);
    if (!auth) return json({ success: false, message: "Необходима авторизация." }, 401);
    if (!env.DB) return json({ success: false, message: "D1 binding DB не настроен." }, 503);

    const body = await request.json();
    const existing = await loadPrivateIikoState(env.DB, auth.user.id, env);
    const existingPassword = existing?.state?.connection?.password || "";
    const connection = sanitizeConnection(body?.connection, existingPassword);
    const identity = sanitizeIdentity(body?.identity);

    if (!connection.ip || !connection.port || !connection.login || !connection.password) {
      return json({ success: false, message: "Для сохранения нужны IP, порт, логин и пароль iiko Server." }, 400);
    }

    const state = { connection, identity, savedAt: new Date().toISOString() };
    const saved = await savePrivateIikoState(env.DB, auth.user.id, state, env);

    return json({
      success: true,
      updatedAt: saved.updatedAt,
      storageEncrypted: saved.encrypted === true,
      state: publicState(state)
    }, 200, { "Set-Cookie": sessionCookie(auth.token) });
  } catch (error) {
    return json({ success: false, message: error?.message || "Ошибка сохранения подключения iiko." }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    const auth = await getUser(request, env);
    if (!auth) return json({ success: false, message: "Необходима авторизация." }, 401);
    if (!env.DB) return json({ success: false, message: "D1 binding DB не настроен." }, 503);

    await ensureIikoStateTable(env.DB);
    await env.DB.prepare(`DELETE FROM iiko_connections WHERE user_id=?1`).bind(auth.user.id).run();
    return json({ success: true }, 200, { "Set-Cookie": sessionCookie("", 0) });
  } catch (error) {
    return json({ success: false, message: error?.message || "Ошибка удаления подключения iiko." }, 500);
  }
}

export { SERVER_PASSWORD_MARKER };
