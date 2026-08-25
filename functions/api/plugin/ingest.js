// ANAR plugin ingest endpoint. Deployment marker: 2026-08-25-supabase-secret-v2

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Plugin-Token"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders() }
  });
}

const stringOrNull = value => value == null ? null : String(value);

function normalizeEnvelope(body) {
  const source = body && typeof body === "object" ? body : {};
  const data = source.data && typeof source.data === "object" ? source.data : source;
  return {
    event: stringOrNull(source.event || source.eventType || source.type),
    eventId: stringOrNull(source.eventId || source.id),
    timestamp: stringOrNull(source.timestamp || source.createdAt || source.time),
    departmentId: stringOrNull(source.departmentId || source.organizationId || data.departmentId),
    departmentName: stringOrNull(source.departmentName || data.departmentName),
    pluginId: stringOrNull(source.pluginId || source.pluginID || data.pluginId),
    pluginVersion: stringOrNull(source.pluginVersion || source.version || data.version),
    serverUrl: stringOrNull(source.serverUrl || data.serverUrl),
    currencyCode: stringOrNull(source.currencyCode || data.currencyCode),
    groupId: stringOrNull(source.groupId || data.groupId),
    groupName: stringOrNull(source.groupName || data.groupName),
    data
  };
}

function validate(envelope) {
  const errors = [];
  if (!envelope.departmentId) errors.push("departmentId is required");
  if (!envelope.event) errors.push("event is required");
  if (!envelope.data || typeof envelope.data !== "object") errors.push("data must be an object");
  if (envelope.departmentId && !/^[0-9a-fA-F-]{36}$/.test(envelope.departmentId)) errors.push("departmentId must be a UUID");
  if (envelope.timestamp && Number.isNaN(Date.parse(envelope.timestamp))) errors.push("timestamp is invalid");
  return errors;
}

async function persistEvent(envelope, env) {
  const url = env?.SUPABASE_URL || env?.SUPABASE_PROJECT_URL;
  const key = env?.SUPABASE_SERVICE_ROLE_KEY || env?.SUPABASE_SERVICE_KEY;
  if (!url || !key) return { stored: false, reason: "Supabase server credentials are not configured" };

  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/plugin_events`, {
    method: "POST",
    headers: {
      "apikey": key,
      "Content-Type": "application/json",
      "Prefer": "return=minimal,resolution=ignore-duplicates"
    },
    body: JSON.stringify({
      event_id: envelope.eventId,
      event_type: envelope.event,
      event_timestamp: envelope.timestamp,
      department_id: envelope.departmentId,
      department_name: envelope.departmentName,
      plugin_id: envelope.pluginId,
      plugin_version: envelope.pluginVersion,
      server_url: envelope.serverUrl,
      currency_code: envelope.currencyCode,
      group_id: envelope.groupId,
      group_name: envelope.groupName,
      payload: envelope.data
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase storage failed (${response.status}): ${text.slice(0, 300)}`);
  }
  return { stored: true };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const envelope = normalizeEnvelope(body);
    const errors = validate(envelope);
    if (errors.length) return jsonResponse({ success: false, accepted: false, errors }, 400);

    const storage = await persistEvent(envelope, context.env);
    return jsonResponse({
      success: storage.stored,
      accepted: storage.stored,
      stored: storage.stored,
      storageReason: storage.reason || null,
      routing: { departmentId: envelope.departmentId, event: envelope.event },
      eventId: envelope.eventId
    }, storage.stored ? 202 : 503);
  } catch (error) {
    return jsonResponse({ success: false, accepted: false, errors: [error?.message || "Invalid request"] }, 400);
  }
}
