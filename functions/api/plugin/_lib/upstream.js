const DEFAULT_VPS_API = "https://68-233-120-197.nip.io";

function clean(value) {
  return String(value ?? "").trim();
}

export function pluginVpsBase(env = {}) {
  const raw = clean(env.PLUGIN_VPS_API || DEFAULT_VPS_API).replace(/\/+$/, "");
  if (!raw) throw new Error("PLUGIN_VPS_API не настроен.");

  let url;
  try { url = new URL(raw); }
  catch { throw new Error("PLUGIN_VPS_API содержит некорректный URL."); }

  const insecureAllowed = String(env.PLUGIN_ALLOW_INSECURE_VPS || "") === "1";
  if (url.protocol !== "https:" && !insecureAllowed) {
    throw new Error("PLUGIN_VPS_API должен использовать HTTPS.");
  }
  return raw;
}

export function upstreamHeaders(env = {}, extra = {}) {
  const headers = { ...extra };
  const serviceToken = clean(env.PLUGIN_VPS_SERVICE_TOKEN);
  if (serviceToken) headers["X-SH-Service-Token"] = serviceToken;
  return headers;
}

function timingSafeEqual(a, b) {
  const left = new TextEncoder().encode(String(a || ""));
  const right = new TextEncoder().encode(String(b || ""));
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let i = 0; i < length; i++) {
    diff |= (left[i] || 0) ^ (right[i] || 0);
  }
  return diff === 0;
}

export function verifyPluginToken(request, env = {}) {
  const expected = clean(env.PLUGIN_INGEST_TOKEN || env.PLUGIN_TOKEN);
  if (!expected) {
    return { ok: false, status: 503, message: "PLUGIN_INGEST_TOKEN не настроен." };
  }

  const supplied = clean(request.headers.get("X-Plugin-Token"));
  if (!supplied || !timingSafeEqual(supplied, expected)) {
    return { ok: false, status: 401, message: "Недействительный X-Plugin-Token." };
  }
  return { ok: true, status: 200, message: "OK" };
}
