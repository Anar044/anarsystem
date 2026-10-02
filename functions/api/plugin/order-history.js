import { resolvePluginChainScope } from "./_lib/chain-scope.js";
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

function pluginRows(data){
  if(Array.isArray(data))return data;
  if(Array.isArray(data?.plugins))return data.plugins;
  if(Array.isArray(data?.data))return data.data;
  if(Array.isArray(data?.items))return data.items;
  return [];
}
async function pluginAllowed(scoped,pluginId){
  if(!pluginId)return true;
  const url=new URL(`${VPS_API}/api/plugin/data`);
  if(scoped.departmentIds.length)url.searchParams.set("departmentIds",scoped.departmentIds.join(","));
  if(scoped.serverUrl)url.searchParams.set("serverUrl",scoped.serverUrl);
  const r=await fetch(url.toString(),{headers:{Accept:"application/json"}});
  const data=await r.json().catch(()=>null);
  if(!r.ok||!data)return false;
  return pluginRows(data).some(item=>{
    const row=item?.data&&typeof item.data==="object"?{...item,...item.data}:item;
    return String(row?.pluginId??"")===String(pluginId);
  });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet(context) {
  try {
    const scoped=await resolvePluginChainScope(context.request,context.env);
    const incoming = new URL(context.request.url);
    const orderNum = incoming.searchParams.get("orderNum");
    const pluginId = incoming.searchParams.get("pluginId");

    if (!orderNum) {
      return jsonResponse({ success: false, error: "orderNum is required" }, 400);
    }

    if(pluginId&&!(await pluginAllowed(scoped,pluginId))){
      return jsonResponse({success:false,code:"PLUGIN_SCOPE_FORBIDDEN",error:"Выбранная касса не относится к текущему ресторану."},403);
    }

    const target = new URL(`${VPS_API}/api/plugin/order-history`);
    target.searchParams.set("orderNum", orderNum);
    if (pluginId) target.searchParams.set("pluginId", pluginId);
    if (scoped.departmentIds.length) target.searchParams.set("departmentIds", scoped.departmentIds.join(","));
    if (scoped.serverUrl) target.searchParams.set("serverUrl", scoped.serverUrl);

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
      success:false,
      code:error?.code||"PLUGIN_ORDER_HISTORY_ERROR",
      error:error?.message||"Unable to reach VPS"
    },Number(error?.status)||502);
  }
}
