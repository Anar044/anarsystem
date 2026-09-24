const DEFAULT_SUPABASE_URL = "https://izytdfkdpbhmyuizuuut.supabase.co";
const DEFAULT_SUPABASE_KEY = "sb_publishable_OODMzFTaHq6DIoorXb85nQ_2FfwBXAS";

export const SERVER_PASSWORD_MARKER = "__SH_SERVER_STORED__";
export const IIKO_SESSION_COOKIE = "sh_iiko_session";
export const SMART_HORECA_STATE_ENCRYPTION_ENV = "SMART_HORECA_STATE_ENCRYPTION_KEY";

const ENCRYPTED_STATE_MARKER = "SH_IKO_STATE_AES_GCM";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)));
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function encryptionSecret(env) {
  return clean(env?.[SMART_HORECA_STATE_ENCRYPTION_ENV]);
}

async function encryptionKey(secret) {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

function stateAad(userId) {
  return textEncoder.encode(`anarsystem:iiko-state:${String(userId || "")}`);
}

export async function encodeStoredIikoState(state, userId, env = {}) {
  const plain = JSON.stringify(state && typeof state === "object" ? state : {});
  const secret = encryptionSecret(env);
  if (!secret) return { value: plain, encrypted: false };

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: stateAad(userId) },
    key,
    textEncoder.encode(plain)
  );

  return {
    value: JSON.stringify({
      marker: ENCRYPTED_STATE_MARKER,
      version: 1,
      algorithm: "AES-GCM",
      iv: bytesToBase64(iv),
      ciphertext: bytesToBase64(new Uint8Array(encrypted))
    }),
    encrypted: true
  };
}

export async function decodeStoredIikoState(rawValue, userId, env = {}) {
  const raw = String(rawValue || "{}");
  let outer;
  try { outer = JSON.parse(raw); } catch { return { state: {}, encrypted: false }; }

  if (outer?.marker !== ENCRYPTED_STATE_MARKER) {
    return { state: outer && typeof outer === "object" ? outer : {}, encrypted: false };
  }

  const secret = encryptionSecret(env);
  if (!secret) {
    throw new Error(`${SMART_HORECA_STATE_ENCRYPTION_ENV} не настроен, но сохранённое подключение iiko зашифровано.`);
  }

  try {
    const key = await encryptionKey(secret);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(outer.iv),
        additionalData: stateAad(userId)
      },
      key,
      base64ToBytes(outer.ciphertext)
    );
    const parsed = JSON.parse(textDecoder.decode(decrypted) || "{}");
    return { state: parsed && typeof parsed === "object" ? parsed : {}, encrypted: true };
  } catch (error) {
    throw new Error(`Не удалось расшифровать подключение iiko. Проверьте ${SMART_HORECA_STATE_ENCRYPTION_ENV}.`);
  }
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
  return `${IIKO_SESSION_COOKIE}=${encodeURIComponent(token || "")}; Path=/api; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.max(0, Number(maxAge) || 0)}`;
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

export async function savePrivateIikoState(db, userId, state, env = {}) {
  await ensureIikoStateTable(db);
  const encoded = await encodeStoredIikoState(state, userId, env);
  if (encoded.value.length > 1900000) {
    throw new Error("Данные iiko слишком большие для одного D1 snapshot.");
  }
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO iiko_connections(user_id,state_json,updated_at) VALUES(?1,?2,?3) ON CONFLICT(user_id) DO UPDATE SET state_json=excluded.state_json, updated_at=excluded.updated_at`)
    .bind(userId, encoded.value, now)
    .run();
  return { updatedAt: now, encrypted: encoded.encrypted };
}

export async function loadPrivateIikoState(db, userId, env = {}) {
  await ensureIikoStateTable(db);
  const row = await db.prepare(`SELECT state_json, updated_at FROM iiko_connections WHERE user_id=?1 LIMIT 1`).bind(userId).first();
  if (!row) return { found: false, state: null, updatedAt: null, encrypted: false };

  const decoded = await decodeStoredIikoState(row.state_json || "{}", userId, env);
  let updatedAt = row.updated_at || null;
  let encrypted = decoded.encrypted;

  // Transparently migrate legacy plaintext snapshots after the encryption
  // secret is configured. Until then, legacy rows remain readable.
  if (!encrypted && encryptionSecret(env)) {
    const migrated = await savePrivateIikoState(db, userId, decoded.state, env);
    updatedAt = migrated.updatedAt;
    encrypted = migrated.encrypted;
  }

  return { found: true, state: decoded.state, updatedAt, encrypted };
}

export async function loadRequestIikoState(request, env) {
  const auth = await getUser(request, env);
  if (!auth) return null;
  const stored = await loadPrivateIikoState(env.DB, auth.user.id, env);
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
