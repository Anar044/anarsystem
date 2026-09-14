// Shared iiko Server client for AnarSystem Cloudflare Functions.
// Keeps authentication, timeouts, retry logic and OLAP metadata caching in one place.

const tokenCache = new Map();
const olapFieldsCache = new Map();

const DEFAULT_TIMEOUT_MS = 20000;
const TOKEN_TTL_MS = 4 * 60 * 1000;
const OLAP_FIELDS_TTL_MS = 15 * 60 * 1000;

export const clean = value => String(value ?? "").trim();

export async function sha1(text) {
  const data = new TextEncoder().encode(String(text ?? ""));
  const hash = await crypto.subtle.digest("SHA-1", data);
  return Array.from(new Uint8Array(hash))
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeConnection(connection) {
  const c = connection && typeof connection === "object" ? connection : {};
  const ip = clean(c.ip);
  const port = clean(c.port);
  const login = clean(c.login);
  const password = String(c.password ?? "");
  if (!ip || !port || !login || !password) {
    throw new Error("Заполните IP, порт, логин и пароль iiko");
  }
  return { ip, port, login, password, serverUrl: `http://${ip}:${port}` };
}

async function connectionKey(connection) {
  const c = normalizeConnection(connection);
  const passwordHash = await sha1(c.password);
  return `${c.serverUrl}|${c.login}|${passwordHash}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`iiko не ответил за ${Math.round(timeoutMs / 1000)} секунд`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function authenticate(connection, force = false) {
  const c = normalizeConnection(connection);
  const key = await connectionKey(c);
  const cached = tokenCache.get(key);
  const now = Date.now();
  if (!force && cached?.token && cached.expiresAt > now) {
    return { serverUrl: c.serverUrl, token: cached.token, cacheHit: true, connectionKey: key };
  }

  const passwordHash = await sha1(c.password);
  const url = `${c.serverUrl}/resto/api/auth?login=${encodeURIComponent(c.login)}&pass=${passwordHash}`;
  const response = await fetchWithTimeout(url, { method: "GET", cache: "no-store" });
  const token = (await response.text()).trim();
  if (!response.ok || !token) {
    tokenCache.delete(key);
    throw new Error(`Ошибка авторизации iiko Server: HTTP ${response.status}`);
  }

  tokenCache.set(key, { token, expiresAt: now + TOKEN_TTL_MS });
  return { serverUrl: c.serverUrl, token, cacheHit: false, connectionKey: key };
}

export async function iikoFetch(connection, path, options = {}) {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retryAuth = true,
    cache = "no-store"
  } = options;

  async function execute(forceAuth = false) {
    const auth = await authenticate(connection, forceAuth);
    const separator = path.includes("?") ? "&" : "?";
    const url = `${auth.serverUrl}${path}${separator}key=${encodeURIComponent(auth.token)}`;
    const response = await fetchWithTimeout(url, { method, headers, body, cache }, timeoutMs);
    return { response, auth };
  }

  let result = await execute(false);
  if (retryAuth && (result.response.status === 401 || result.response.status === 403)) {
    result = await execute(true);
  }
  return result;
}

export async function iikoText(connection, path, options = {}) {
  const { response, auth } = await iikoFetch(connection, path, options);
  const text = (await response.text()).trim();
  return { ok: response.ok, status: response.status, text, auth };
}

export async function iikoJson(connection, path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  const result = await iikoText(connection, path, { ...options, headers });
  let payload = null;
  try { payload = JSON.parse(result.text || "{}"); } catch (_) {}
  return { ...result, payload };
}

function extractFields(raw) {
  const out = [];
  const seen = new Set();
  const add = (name, meta = {}) => {
    name = clean(name);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      name,
      title: clean(meta.title || meta.caption || meta.label || meta.displayName || meta.name || name),
      type: clean(meta.type || meta.dataType || meta.kind || "unknown")
    });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") add(item);
      else if (item && typeof item === "object") add(item.technicalName || item.field || item.key || item.code || item.id || item.name, item);
    }
  } else if (raw && typeof raw === "object") {
    for (const key of ["fields", "columns", "dimensions", "measures"]) {
      if (!Array.isArray(raw[key])) continue;
      for (const item of raw[key]) {
        if (typeof item === "string") add(item);
        else if (item) add(item.technicalName || item.field || item.key || item.code || item.id || item.name, item);
      }
    }
    for (const [key, value] of Object.entries(raw)) {
      if (["fields", "columns", "dimensions", "measures", "data", "items"].includes(key)) continue;
      if (value && typeof value === "object" && !Array.isArray(value)) add(key, value);
    }
  }
  return out;
}

export async function getOlapFields(connection, reportType, options = {}) {
  const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : OLAP_FIELDS_TTL_MS;
  const baseKey = await connectionKey(connection);
  const cacheKey = `${baseKey}|fields|${clean(reportType).toUpperCase()}`;
  const cached = olapFieldsCache.get(cacheKey);
  const now = Date.now();
  if (!options.force && cached?.fields?.length && cached.expiresAt > now) {
    return { fields: cached.fields, cacheHit: true };
  }

  const type = clean(reportType).toUpperCase();
  const result = await iikoJson(connection, `/resto/api/v2/reports/olap/columns?reportType=${encodeURIComponent(type)}`);
  if (!result.ok || !result.payload) {
    throw new Error(`iiko OLAP columns HTTP ${result.status}: ${result.text.slice(0, 1000)}`);
  }
  const fields = extractFields(result.payload);
  if (!fields.length) throw new Error("iiko не вернул OLAP-поля");
  olapFieldsCache.set(cacheKey, { fields, expiresAt: now + ttlMs });
  return { fields, cacheHit: false };
}

export function clearIikoClientCache() {
  tokenCache.clear();
  olapFieldsCache.clear();
}
