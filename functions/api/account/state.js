const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
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
  await db.prepare(`CREATE TABLE IF NOT EXISTS sh_account_state (
    user_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  )`).run();
}

function sanitizeState(input) {
  const state = input && typeof input === "object" ? input : {};
  const olap = Array.isArray(state.savedOlapReports) ? state.savedOlapReports : [];
  const qr = state.qr && typeof state.qr === "object" ? state.qr : {};

  // QR photos/design images are already persisted by the QR publish endpoint.
  // Keep only the lightweight editor metadata in the account snapshot.
  const menu = state.qrMenu && typeof state.qrMenu === "object" ? state.qrMenu : null;
  let safeMenu = null;
  if (menu) {
    safeMenu = {
      ...menu,
      dishes: Array.isArray(menu.dishes) ? menu.dishes.map(d => ({ ...d, photo: undefined })) : [],
      design: menu.design ? { ...menu.design, hero: undefined, logo: undefined } : menu.design
    };
  }

  return {
    iikoConnection: state.iikoConnection || null,
    iikoDepartmentIdentity: state.iikoDepartmentIdentity || null,
    horecaQrPublic: state.horecaQrPublic || null,
    savedOlapReports: olap.slice(0, 200),
    qr,
    qrMenu: safeMenu
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
    const row = await env.DB.prepare(`SELECT state_json, updated_at FROM sh_account_state WHERE user_id=?1 LIMIT 1`).bind(user.id).first();
    if (!row) return json({ success: true, found: false, state: null });
    let state = {};
    try { state = JSON.parse(row.state_json || "{}"); } catch (_) {}
    return json({ success: true, found: true, state, updatedAt: row.updated_at });
  } catch (error) {
    return json({ success: false, message: error?.message || "Ошибка загрузки данных аккаунта." }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) return json({ success: false, message: "D1 binding DB не настроен." }, 503);
    const user = await getUser(request, env);
    if (!user) return json({ success: false, message: "Необходима авторизация." }, 401);
    const body = await request.json();
    const state = sanitizeState(body?.state);
    const stateJson = JSON.stringify(state);
    if (stateJson.length > 1900000) return json({ success: false, message: "Данные аккаунта слишком большие для одного D1 snapshot." }, 413);

    await ensureTable(env.DB);
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO sh_account_state(user_id,state_json,updated_at) VALUES(?1,?2,?3) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`).bind(user.id, stateJson, now).run();
    return json({ success: true, updatedAt: now });
  } catch (error) {
    return json({ success: false, message: error?.message || "Ошибка сохранения данных аккаунта." }, 500);
  }
}
