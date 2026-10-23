// Shared iiko Server client for AnarSystem Cloudflare Functions.
// Keeps authentication, timeouts, retry logic and OLAP metadata caching in one place.

const tokenCache = new Map();
const authInFlight = new Map();
const requestQueue = new Map();
const olapFieldsCache = new Map();
const olapFieldsInFlight = new Map();

const DEFAULT_TIMEOUT_MS = 20000;
// Reuse iiko licensed key until HTTP 401; a timer re-login consumes slots.
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

function isUnsupportedCacheOption(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("cache") && (
    message.includes("not implemented") ||
    message.includes("unsupported cache mode") ||
    message.includes("requestinitializerdict")
  );
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const requestOptions = { ...options, signal: controller.signal };
    try {
      return await fetch(url, requestOptions);
    } catch (error) {
      // Older Cloudflare Pages/Workers compatibility dates throw when the
      // standard RequestInit `cache` option is supplied. Retry without that
      // optional hint so legacy deployments keep the same behaviour as the
      // original AnarSystem fetch() calls.
      if (Object.prototype.hasOwnProperty.call(requestOptions, "cache") && isUnsupportedCacheOption(error)) {
        const fallbackOptions = { ...requestOptions };
        delete fallbackOptions.cache;
        return await fetch(url, fallbackOptions);
      }
      throw error;
    }
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`iiko не ответил за ${Math.round(timeoutMs / 1000)} секунд`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function cloudflareDiagnostic(response, body) {
  const cfType = clean(response?.headers?.get?.("cf-error-type"));
  const text = String(body || "");
  const codeMatch = text.match(/\b(1\d{3})\b/);
  const code = cfType || codeMatch?.[1] || "";
  if (Number(response?.status) !== 530 && !code) return "";
  const suffix = code ? `, Cloudflare ${code}` : "";
  return `Cloudflare HTTP ${response?.status || 530}${suffix}: проблема DNS/origin у адреса iiko Server`;
}

// Each successful /auth consumes one licensed REST_API(2000) session.
// Never repeat an ambiguous 429/502/503/504 or timeout automatically:
// the server might already have allocated a seat before losing its response.
// Keep the documented GET /auth compatibility with the installed iiko Server.
async function performAuthentication(connection, key) {
  const c = normalizeConnection(connection);
  const passwordHash = await sha1(c.password);
  const url = `${c.serverUrl}/resto/api/auth?login=${encodeURIComponent(c.login)}&pass=${passwordHash}`;
  const reply = await fetchWithTimeout(url,{method:"GET",cache:"no-store"},12000);
  const token = (await reply.text()).trim();
  if(reply.ok && token){
    tokenCache.set(key,{token});
    return {serverUrl:c.serverUrl,token,cacheHit:false,
      connectionKey:key,authAttempts:1};
  }
  tokenCache.delete(key);
  const diagnostic=cloudflareDiagnostic(reply,token);
  if(diagnostic)throw Error(diagnostic);
  const status=Number(reply.status)||0;
  // Do not echo an upstream response: it may contain a token or credentials.
  throw Error(`iiko /auth HTTP ${status}. Automatic authentication retries disabled to protect REST_API licences.`);
}

async function authenticate(connection, force = false) {
  const c = normalizeConnection(connection);
  const key = await connectionKey(c);
  const cached = tokenCache.get(key);
  if (!force && cached?.token) {
    return { serverUrl: c.serverUrl, token: cached.token, cacheHit: true, connectionKey: key };
  }

  if (force) {
    tokenCache.delete(key);
    authInFlight.delete(key);
  } else {
    const pending = authInFlight.get(key);
    if (pending) return pending;
  }

  const pending = performAuthentication(c, key).finally(() => {
    if (authInFlight.get(key) === pending) authInFlight.delete(key);
  });
  authInFlight.set(key, pending);
  return pending;
}

export async function getIikoAuth(connection, options = {}) {
  return authenticate(connection, options.force === true);
}

export function isIikoLicenseSeatExhausted(body) {
  return /(?:REST_API\s*\(\s*2000\s*\)|license enhancement is required|no connections available for module)/i.test(String(body ?? ""));
}

// iiko recommends sequential requests. The queue is scoped to one
// server/login/password hash so unrelated customer tenants never block or
// share credentials with each other. It is isolate-local, not a cross-Worker
// distributed mutex; distributed license allocation requires separate setup.
async function sequentialIikoCall(key, task) {
  const previous=requestQueue.get(key);
  let done;
  const gate=new Promise(resolve => { done=resolve; });
  requestQueue.set(key,gate);
  if(previous) await previous;
  try { return await task(); }
  finally {
    done();
    if(requestQueue.get(key)===gate)requestQueue.delete(key);
  }
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
  const key=await connectionKey(connection);
  return sequentialIikoCall(key,async()=>{
    async function execute(forceAuth = false) {
      const auth = await authenticate(connection, forceAuth);
      const separator = path.includes("?") ? "&" : "?";
      const url = `${auth.serverUrl}${path}${separator}key=${encodeURIComponent(auth.token)}`;
      const response = await fetchWithTimeout(url,
        { method, headers, body, cache }, timeoutMs);
      return { response, auth };
    }
    let result = await execute(false);
    // A license-exhaustion 403 must NEVER cause another auth attempt.
    // Only 401 authorizes one re-login and one retry.
    if (retryAuth && result.response.status === 401) {
      result = await execute(true);
    }
    return result;
  });
}

/// Release a licensed iiko session only on explicit server disconnect or
/// credential replacement. Do not run after every request: many SH modules
/// share the authenticated session and still need its key.
export async function releaseIikoSession(connection) {
  const key=await connectionKey(connection);
  return sequentialIikoCall(key,async()=>{
    const cached=tokenCache.get(key);
    if(!cached?.token)return false;
    const serverUrl=normalizeConnection(connection).serverUrl;
    const url=`${serverUrl}/resto/api/logout?key=${encodeURIComponent(cached.token)}`;
    const reply=await fetchWithTimeout(url,
      {method:"GET",cache:"no-store"},12000);
    if(reply.ok || reply.status===401){
      tokenCache.delete(key);
      return true;
    }
    throw Error(`iiko logout failed: HTTP ${reply.status}`);
  });
}

export async function iikoText(connection, path, options = {}) {
  const { response, auth } = await iikoFetch(connection, path, options);
  const text = (await response.text()).trim();
  return {
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    text,
    auth,
    contentType: response.headers.get("content-type") || ""
  };
}

export async function iikoJson(connection, path, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  const result = await iikoText(connection, path, { ...options, headers });
  let payload = null;
  try {
    payload = JSON.parse(result.text || "{}");
  } catch (_) {}
  return { ...result, payload };
}

function extractFields(raw) {
  const out = [];
  const seen = new Set();
  const add = (name, meta = {}, source = "") => {
    name = clean(name);
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const forcedMeasure = source === "measures";
    const forcedDimension = source === "dimensions";
    out.push({
      name,
      title: clean(meta.title || meta.caption || meta.label || meta.displayName || meta.name || name),
      type: clean(meta.type || meta.dataType || meta.kind || "unknown"),
      aggregationAllowed: forcedMeasure || meta.aggregationAllowed === true || meta.aggregateAllowed === true || meta.isMeasure === true || meta.measure === true,
      groupingAllowed: forcedDimension || meta.groupingAllowed !== false,
      filteringAllowed: meta.filteringAllowed !== false,
      isMeasure: forcedMeasure || meta.isMeasure === true || meta.measure === true || meta.aggregationAllowed === true || meta.aggregateAllowed === true,
      source
    });
  };

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") add(item);
      else if (item && typeof item === "object") {
        add(item.technicalName || item.field || item.key || item.code || item.id || item.name, item);
      }
    }
  } else if (raw && typeof raw === "object") {
    for (const key of ["fields", "columns", "dimensions", "measures"]) {
      if (!Array.isArray(raw[key])) continue;
      for (const item of raw[key]) {
        if (typeof item === "string") add(item, {}, key);
        else if (item) add(item.technicalName || item.field || item.key || item.code || item.id || item.name, item, key);
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
  const type = clean(reportType).toUpperCase();
  const cacheKey = `${baseKey}|fields|${type}`;
  const cached = olapFieldsCache.get(cacheKey);
  const now = Date.now();

  if (!options.force && cached?.fields?.length && cached.expiresAt > now) {
    return { fields: cached.fields, raw: cached.raw ?? null, cacheHit: true };
  }

  if (!options.force) {
    const pending = olapFieldsInFlight.get(cacheKey);
    if (pending) return pending;
  }

  const pending = (async () => {
    const result = await iikoJson(
      connection,
      `/resto/api/v2/reports/olap/columns?reportType=${encodeURIComponent(type)}`
    );
    if (!result.ok || !result.payload) {
      throw new Error(`iiko OLAP columns HTTP ${result.status}: ${result.text.slice(0, 1000)}`);
    }
    const fields = extractFields(result.payload);
    if (!fields.length) throw new Error("iiko не вернул OLAP-поля");
    olapFieldsCache.set(cacheKey, { fields, raw: result.payload, expiresAt: Date.now() + ttlMs });
    return { fields, raw: result.payload, cacheHit: false };
  })().finally(() => {
    if (olapFieldsInFlight.get(cacheKey) === pending) olapFieldsInFlight.delete(cacheKey);
  });

  olapFieldsInFlight.set(cacheKey, pending);
  return pending;
}

export function clearIikoClientCache() {
  tokenCache.clear();
  authInFlight.clear();
  requestQueue.clear();
  olapFieldsCache.clear();
  olapFieldsInFlight.clear();
}
