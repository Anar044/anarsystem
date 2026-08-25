// Authenticated read endpoint for the plugin event monitor.
// The browser sends the Supabase access token; the server uses the service key only for the database read.

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() }
  });
}

async function getAuthenticatedUser(env, accessToken) {
  const url = env?.SUPABASE_URL || env?.SUPABASE_PROJECT_URL;
  const key = env?.SUPABASE_PUBLISHABLE_KEY || env?.SUPABASE_ANON_KEY || env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SERVICE_KEY;
  if (!url || !key || !accessToken) return null;

  const response = await fetch(`${url.replace(/\/$/, "")}/auth/v1/user`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${accessToken}`
    }
  });
  if (!response.ok) return null;
  return response.json();
}

async function readEvents(env, request) {
  const url = env?.SUPABASE_URL || env?.SUPABASE_PROJECT_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error("Supabase server credentials are not configured");

  const requestUrl = new URL(request.url);
  const limitRaw = Number(requestUrl.searchParams.get("limit") || "100");
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? Math.trunc(limitRaw) : 100, 1), 200);
  const eventType = requestUrl.searchParams.get("event") || "";
  const pluginId = requestUrl.searchParams.get("pluginId") || "";
  const departmentId = requestUrl.searchParams.get("departmentId") || "";

  const params = new URLSearchParams({
    select: "id,event_id,event_type,event_timestamp,received_at,department_id,department_name,plugin_id,plugin_version,server_url,currency_code,group_id,group_name,payload",
    order: "received_at.desc",
    limit: String(limit)
  });
  if (eventType) params.set("event_type", `eq.${eventType}`);
  if (pluginId) params.set("plugin_id", `eq.${pluginId}`);
  if (departmentId) params.set("department_id", `eq.${departmentId}`);

  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/plugin_events?${params}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase read failed (${response.status}): ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  try {
    const authHeader = context.request.headers.get("Authorization") || "";
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match) return jsonResponse({ success: false, error: "Authentication required" }, 401);

    const user = await getAuthenticatedUser(context.env, match[1]);
    if (!user?.id) return jsonResponse({ success: false, error: "Invalid or expired session" }, 401);

    const events = await readEvents(context.env, context.request);
    return jsonResponse({ success: true, events, count: events.length });
  } catch (error) {
    return jsonResponse({ success: false, error: error?.message || "Unable to read plugin events" }, 500);
  }
}
