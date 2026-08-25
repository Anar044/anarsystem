function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
  });
}

export async function onRequestGet(context) {
  const env = context.env || {};
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || "";
  const kind = key.startsWith("sb_secret_") ? "sb_secret" : (/^eyJ[^.]+\.[^.]+\.[^.]+$/.test(key) ? "jwt" : key ? "other" : "missing");
  return json({
    supabaseUrlConfigured: Boolean(env.SUPABASE_URL || env.SUPABASE_PROJECT_URL),
    supabaseKeyConfigured: Boolean(key),
    keyKind: kind,
    keyLength: key.length
  });
}
