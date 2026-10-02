import { resolvePluginChainScope, pluginScopeMeta } from "./_lib/chain-scope.js";
const VPS_API = "http://68-233-120-197.nip.io";

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

export async function onRequestGet(context) {
  try {
    const scoped=await resolvePluginChainScope(context.request,context.env);
    const incoming = new URL(context.request.url);
    const target = new URL(`${VPS_API}/api/plugin/data`);
    if(scoped.departmentIds.length)target.searchParams.set("departmentIds",scoped.departmentIds.join(","));
    if(scoped.serverUrl)target.searchParams.set("serverUrl",scoped.serverUrl);

    const response = await fetch(target.toString(), {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch {
      return jsonResponse({
        success:false,error:"VPS returned invalid JSON",status:response.status,
        contentType:response.headers.get("content-type")||"",raw:text.slice(0,500)
      },502);
    }

    if(scoped.departmentIds.length){
      const allowed=new Set(scoped.departmentIds.map(String));
      const filterList=list=>(Array.isArray(list)?list:[]).filter(item=>{
        const row=item?.data&&typeof item.data==="object"?{...item,...item.data}:item;
        return allowed.has(String(row?.departmentId??""));
      });
      if(Array.isArray(data)) data=filterList(data);
      else if(data&&typeof data==="object"){
        if(Array.isArray(data.plugins)) data={...data,plugins:filterList(data.plugins)};
        else if(Array.isArray(data.data)) data={...data,data:filterList(data.data)};
        else if(Array.isArray(data.items)) data={...data,items:filterList(data.items)};
      }
    }

    if(data&&typeof data==="object"&&!Array.isArray(data)){
      data={...data,restaurantScope:pluginScopeMeta(scoped)};
    }
    return jsonResponse(data,response.status);
  } catch (error) {
    return jsonResponse({
      success:false,
      code:error?.code||"PLUGIN_SCOPE_ERROR",
      error:error?.message||"Unable to reach VPS"
    },Number(error?.status)||502);
  }
}
