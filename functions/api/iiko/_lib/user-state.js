const DEFAULT_SUPABASE_URL = "https://izytdfkdpbhmyuizuuut.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_OODMzFTaHq6DIoorXb85nQ_2FfwBXAS";

export const SERVER_PASSWORD_MARKER = "__SH_SERVER_STORED__";
export const IIKO_SESSION_COOKIE = "sh_iiko_session";

function clean(value) {
  return String(value ?? "").trim();
}

function parseCookies(request) {
  const raw = request.headers.get("Cookie") || "";
  const out = {};
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(value); } catch { out[key] = value; }
  }
  return out;
}

export function getAccessToken(request) {
  const auth = request.headers.get("Authorization") || "";
  if (auth.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  return parseCookies(request)[IIKO_SESSION_COOKIE] || "";
}

export function sessionCookie(token, maxAge = 3600) {
  return `${IIKO_SESSION_COOKIE}=${encodeURIComponent(token || "")}; Path=/api/iiko; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Number(maxAge) || 0)}`;
}

export async function getUser(request, env) {
  const token = getAccessToken(request);
  if (!token) return null;

  const response = await fetch(`${env.SUPABASE_URL || DEFAULT_SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_PUBLISHABLE_KEY || DEFAULT_SUPABASE_KEY,
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) return null;
  const user = await response.json().catch(() => null);
  return user?.id ? { user, token } : null;
}

export async function ensureIikoStateTable(db) {
  if (!db) throw new Error("D1 binding DB не настроен.");
  await db.prepare(`CREATE TABLE IF NOT EXISTS iiko_connections (
    user_id TEXT PRIMARY KEY,
    state_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL
  )`).run();
}

export async function loadPrivateIikoState(db, userId) {
  await ensureIikoStateTable(db);
  const row = await db.prepare(`SELECT state_json, updated_at FROM iiko_connections WHERE user_id=?1 LIMIT 1`).bind(userId).first();
  if (!row) return { found: false, state: null, updatedAt: null };
  let state = {};
  try { state = JSON.parse(row.state_json || "{}"); } catch { state = {}; }
  return { found: true, state, updatedAt: row.updated_at || null };
}

export async function loadRequestIikoState(request, env) {
  const auth = await getUser(request, env);
  if (!auth) return null;
  const stored = await loadPrivateIikoState(env.DB, auth.user.id);
  return { ...auth, ...stored };
}

export function privateConnection(state) {
  const c = state?.connection && typeof state.connection === "object" ? state.connection : {};
  return {
    ...c,
    ip: clean(c.ip),
    port: clean(c.port),
    login: clean(c.login),
    password: String(c.password || "")
  };
}

export function hasPrivateConnection(state) {
  const c = privateConnection(state);
  return Boolean(c.ip && c.port && c.login && c.password);
}

export function publicState(state) {
  if (!state || typeof state !== "object") return state || null;
  const c = state.connection && typeof state.connection === "object" ? state.connection : {};
  const hasPassword = Boolean(c.password);
  return {
    ...state,
    connection: {
      ...c,
      password: hasPassword ? SERVER_PASSWORD_MARKER : "",
      passwordStored: hasPassword,
      credentialSource: hasPassword ? "D1_SERVER" : "NONE"
    }
  };
}

export function isServerPasswordMarker(value) {
  return String(value || "") === SERVER_PASSWORD_MARKER;
}
