const VPS_API = "http://68-233-120-197.nip.io";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      ...corsHeaders()
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  try {
    const incoming = new URL(context.request.url);
    const orderNum = incoming.searchParams.get("orderNum");
    const pluginId = incoming.searchParams.get("pluginId");

    if (!orderNum) {
      return jsonResponse({ success: false, error: "orderNum is required" }, 400);
    }

    const target = new URL(`${VPS_API}/api/plugin/order-history`);
    target.searchParams.set("orderNum", orderNum);
    if (pluginId) target.searchParams.set("pluginId", pluginId);

    const response = await fetch(target.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      redirect: "follow"
    });

    const body = await response.text();
    const contentType = response.headers.get("content-type") || "";

    let data;
    try {
      data = JSON.parse(body);
    } catch (_) {
      return jsonResponse({
        success: false,
        error: `VPS returned non-JSON response (HTTP ${response.status})`,
        contentType,
        raw: body.slice(0, 500)
      }, 502);
    }

    return jsonResponse(data, response.status);
  } catch (error) {
    return jsonResponse({
      success: false,
      error: error?.message || "Unable to reach VPS"
    }, 502);
  }
}
