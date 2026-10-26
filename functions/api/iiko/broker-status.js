import { loadRequestIikoState, hasPrivateConnection, privateConnection } from "./_lib/user-state.js";
import { hasPermission } from "../access/_lib/access-control.js";
import { isIikoBrokerPilot } from "./_lib/iiko-client.js";

function reply(status, data) {
  return new Response(JSON.stringify(data), { status,
    headers: { "content-type":"application/json; charset=utf-8", "cache-control":"no-store" } });
}

// An administrator-only readiness probe. It never sends a request to iiko.
// It sends only the D1-stored connection to the private main broker over
// Cloudflare Service binding and returns configuration booleans, no credentials.
export async function onRequestGet({request,env}) {
  try {
    if (!env.DB) return reply(503,{success:false,code:"DB_UNAVAILABLE"});
    const state=await loadRequestIikoState(request,env);
    if (!state) return reply(401,{success:false,code:"UNAUTHENTICATED"});
    if (state.accessDenied || !hasPermission(state.access,"settings.manage"))
      return reply(403,{success:false,code:"ACCESS_DENIED"});
    const workspaceId=String(state.access?.workspace?.id||"").trim();
    if (!workspaceId) return reply(403,{success:false,code:"WORKSPACE_REQUIRED"});
    const selected=isIikoBrokerPilot(env,"workspace:"+workspaceId);
    const bindingPresent=Boolean(env.IIKO_SESSION_BROKER);
    const secretPresent=Boolean(env.IIKO_BROKER_SERVICE_SECRET);
    const details={success:true,workspaceSelected:selected,
      serviceBindingPresent:bindingPresent,serviceSecretPresent:secretPresent,
      workerReady:false,readyForActivation:false,code:"NOT_CONFIGURED"};
    if (!state.found || !hasPrivateConnection(state.state))
      return reply(200,{...details,code:"PRIVATE_IIKO_CONNECTION_REQUIRED"});
    if (!bindingPresent || !secretPresent) return reply(200,details);
    const c=privateConnection(state.state);
    let response;
    try {
      response=await env.IIKO_SESSION_BROKER.fetch("https://broker.internal/request",{
        method:"POST",
        headers:{"content-type":"application/json",
          "x-sh-broker-secret":String(env.IIKO_BROKER_SERVICE_SECRET)},
        body:JSON.stringify({
          action:"status",tenantId:"workspace:"+workspaceId,
          connection:{ip:c.ip,port:c.port,login:c.login,password:c.password}
        })
      });
    } catch {
      return reply(200,{...details,code:"BROKER_UNREACHABLE"});
    }
    const report=await response.json().catch(()=>null);
    if (response.ok && report?.code==="BROKER_READY")
      return reply(200,{...details,workerReady:true,readyForActivation:true,
        code:selected?"BROKER_ACTIVE":"BROKER_READY_NOT_SELECTED"});
    const safe=new Set(["FORBIDDEN","CONFIG_MISSING",
      "ENCRYPTION_CONFIG_INVALID","TARGET_DENIED","BAD_REQUEST"]);
    return reply(200,{...details,code:safe.has(report?.code)?report.code:"BROKER_NOT_READY"});
  } catch {
    return reply(503,{success:false,code:"BROKER_STATUS_UNAVAILABLE"});
  }
}
