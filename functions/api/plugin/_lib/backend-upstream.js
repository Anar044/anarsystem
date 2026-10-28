// All functions here run on the server. Never include the proxy key in browser JS.
const clean = value => String(value ?? "").trim();
export function pluginBackendUrl(env, path, legacyBase = "http://68-233-120-197.nip.io") {
  const base = new URL(clean(env?.SH_BACKEND_API_URL) || legacyBase);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password)
    throw new Error("SH_BACKEND_API_URL must be a trusted http(s) origin");
  return new URL(path, base.origin).toString();
}
export function pluginBackendHeaders(env, headers = {}) {
  const token = clean(env?.SH_BACKEND_PROXY_TOKEN);
  return { ...headers, ...(token ? { "X-SH-Backend-Token": token } : {}) };
}
