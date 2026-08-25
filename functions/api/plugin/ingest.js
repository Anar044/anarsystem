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
  return errors;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const envelope = normalizeEnvelope(body);
    const errors = validate(envelope);

    if (errors.length) {
      return jsonResponse({ success: false, accepted: false, errors }, 400);
    }

    // Persistence will be connected after the real plugin payload is confirmed.
    // For now this endpoint is intentionally a safe contract/validation layer.
    return jsonResponse({
      success: true,
      accepted: true,
      stored: false,
      message: "Plugin event accepted by API contract; persistence is not enabled yet",
      routing: {
        departmentId: envelope.departmentId,
        event: envelope.event
      },
      normalized: envelope
    }, 202);
  } catch (error) {
    return jsonResponse({ success: false, accepted: false, errors: [error?.message || "Invalid JSON"] }, 400);
  }
}
