import { pluginVpsBase, upstreamHeaders } from "./_lib/upstream.js";

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
      "Cache-Control": "no-store",
      ...corsHeaders()
    }
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

export async function onRequestGet(context) {
  try {
    const VPS_API = pluginVpsBase(context.env);
    const response = await fetch(`${VPS_API}/api/plugin/status`, {
      method: "GET",
      headers: upstreamHeaders(context.env, {
        "Accept": "application/json"
      })
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
