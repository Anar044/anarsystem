const VPS_API = "http://68-233-120-197.nip.io";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders()
    }
  });
}

function normalizeRequestBody(input) {
  const body = input && typeof input === "object" ? { ...input } : {};
  const action = String(body.action || "").toLowerCase();

  // Older cash UI builds nested the order number under params while the
  // Resto.Front plugin expects the request-detail aliases at the root level.
  // Normalize this on the server so no browser-wide fetch monkey patch is
  // needed and all callers get the same request contract.
  if ((action === "order" || action === "get_order") && body.params && typeof body.params === "object") {
    const params = body.params;
    const orderNumber =
      params.RequestDetail ??
      params.requestDetail ??
      params.orderNum ??
      params.orderNumber;

    if (orderNumber !== undefined && orderNumber !== null && orderNumber !== "") {
      const value = String(orderNumber);
      body.RequestDetail = body.RequestDetail ?? value;
      body.requestDetail = body.requestDetail ?? value;
      body.orderNum = body.orderNum ?? value;
      body.orderNumber = body.orderNumber ?? value;
    }
    delete body.params;
  }

  return body;
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

export async function onRequestPost(context) {
  try {
    const body = normalizeRequestBody(await context.request.json());

    if (!body?.action) {
      return jsonResponse({
        success: false,
        error: "action is required"
      }, 400);
    }

    const response = await fetch(`${VPS_API}/api/plugin/request`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return jsonResponse({
        success: false,
        error: "VPS returned invalid JSON",
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        raw: text.slice(0, 500)
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
