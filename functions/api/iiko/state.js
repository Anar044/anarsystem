const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8"
};

const SUPABASE_URL = "https://izytdfkdpbhmyuizuuut.supabase.co";
const SUPABASE_KEY = "sb_publishable_OODMzFTaHq6DIoorXb85nQ_2FfwBXAS";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: HEADERS });
}

async function getUser(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  if (!token) return null;

  const response = await fetch(`${env.SUPABASE_URL || SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY || SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) return null;
  const user = await response.json();
  return user?.id ? user : null;
}

async function ensureTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS iiko_connections (
    user_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  )`).run();
}

function sanitizeConnection(input) {
  const x = input && typeof input === "object" ? input : {};
  return {
    ip: String(x.ip || "").trim(),
    port: String(x.port || "").trim(),
    login: String(x.login || "").trim(),
    password: String(x.password || ""),
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
    if (!env.DB) return json({ success: false, message: "D1 binding DB не настроен." }, 503);
    const user = await getUser(request, env);
    if (!user) return json({ success: false, message: "Необходима авторизация." }, 401);

    await ensureTable(env.DB);
    const row = await env.DB.prepare(`SELECT state_json, updated_at FROM iiko_connections WHERE user_id=?1 LIMIT 1`).bind(user.id).first();
    if (!row) return json({ success: true, found: false, state: null });

    let state = {};
    try { state = JSON.parse(row.state_json || "{}"); } catch (_) {}
    return json({ success: true, found: true, state, updatedAt: row.updated_at });
  } catch (error) {
    return json({ success: false, message: error?.message || "Ошибка загрузки подключения iiko." }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ success: false, message: "D1 binding DB не настроен." }, 503);
    const user = await getUser(request, env);
    if (!user) return json({ success: false, message: "Необходима авторизация." }, 401);

    const body = await request.json();
    const connection = sanitizeConnection(body?.connection);
    const identity = sanitizeIdentity(body?.identity);

    if (!connection.ip || !connection.port || !connection.login || !connection.password) {
      return json({ success: false, message: "Для сохранения нужны IP, порт, логин и пароль iiko Server." }, 400);
    }

    const state = { connection, identity, savedAt: new Date().toISOString() };
    const stateJson = JSON.stringify(state);
    if (stateJson.length > 1900000) return json({ success: false, message: "Данные iiko слишком большие для одного D1 snapshot." }, 413);

    await ensureTable(env.DB);
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO iiko_connections(user_id,state_json,updated_at) VALUES(?1,?2,?3) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`).bind(user.id, stateJson, now).run();

    return json({ success: true, updatedAt: now, state });
  } catch (error) {
    return json({ success: false, message: error?.message || "Ошибка сохранения подключения iiko." }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  try {
    if (!env.DB) return json({ success: false, message: "D1 binding DB не настроен." }, 503);
    const user = await getUser(request, env);
    if (!user) return json({ success: false, message: "Необходима авторизация." }, 401);
    await ensureTable(env.DB);
    await env.DB.prepare(`DELETE FROM iiko_connections WHERE user_id=?1`).bind(user.id).run();
    return json({ success: true });
  } catch (error) {
    return json({ success: false, message: error?.message || "Ошибка удаления подключения iiko." }, 500);
  }
}
