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
    // Preserve the caller's Department filter when proxying to the VPS.
    // Without this, the VPS receives /api/plugin/data without departmentIds
    // and can return plugins belonging to other iiko Servers.
    const incoming = new URL(context.request.url);
    const upstreamUrl = `${VPS_API}/api/plugin/data${incoming.search}`;

    const response = await fetch(upstreamUrl, {
      method: "GET",
      headers: {
        "Accept": "application/json"
      }
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

    const requested=[...new Set((incoming.searchParams.get("departmentIds")||"").split(",").map(x=>x.trim()).filter(Boolean))];
    if(requested.length){
      const allowed=new Set(requested);
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

    return jsonResponse(data, response.status);
  } catch (error) {
    return jsonResponse({
      success: false,
      error: error?.message || "Unable to reach VPS"
    }, 502);
  }
}
