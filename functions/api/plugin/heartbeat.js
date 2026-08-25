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

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const departmentId = body?.departmentId == null ? null : String(body.departmentId);
    const pluginId = body?.pluginId == null ? null : String(body.pluginId);

    if (!departmentId) {
      return jsonResponse({ success: false, message: "departmentId is required" }, 400);
    }

    return jsonResponse({
      success: true,
      accepted: true,
      verified: false,
      message: "Heartbeat received; plugin identity verification will run after plugin contract is confirmed",
      departmentId,
      pluginId,
      serverTime: new Date().toISOString()
    });
  } catch (error) {
    return jsonResponse({ success: false, message: error?.message || "Invalid JSON" }, 400);
  }
}
