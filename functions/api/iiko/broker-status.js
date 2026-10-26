import {
  loadRequestIikoState, hasPrivateConnection, privateConnection
} from "./_lib/user-state.js";
import { hasPermission } from "../access/_lib/access-control.js";
import { isIikoBrokerPilot } from "./_lib/iiko-client.js";

function result(payload,status=200){
  return new Response(JSON.stringify(payload),{status,headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store"
  }});
}
const error=(code,status)=>result({success:false,code},status);

/**
 * Authenticated administrator-only readiness of the existing Production broker.
 * Never contacts iiko, calls /auth, changes tenant state or reveals credentials.
 * The private Worker checks its own secrets, SQLite Durable Object binding,
 * encryption key and exact saved iiko target. Its status never contains a token.
 */
export async function onRequestGet({request,env}){
  try {
    if(!env.DB)return error("DB_UNAVAILABLE",503);
    const auth=await loadRequestIikoState(request,env);
    if(!auth)return error("UNAUTHENTICATED",401);
    if(auth.accessDenied || !hasPermission(auth.access,"settings.manage"))
      return error("ACCESS_DENIED",403);
    const workspaceId=String(auth.access?.workspace?.id||"").trim();
    if(!workspaceId)return error("WORKSPACE_REQUIRED",403);
    const selected=isIikoBrokerPilot(env,"workspace:"+workspaceId);
    const bound=Boolean(env.IIKO_SESSION_BROKER);
    const serviceSecret=Boolean(env.IIKO_BROKER_SERVICE_SECRET);
    const status={success:true,workspaceSelected:selected,
      serviceBindingPresent:bound,serviceSecretPresent:serviceSecret,
      workerReady:false,readyForActivation:false,code:"NOT_CONFIGURED"};
    if(!auth.found || !hasPrivateConnection(auth.state)){
      return result({...status,code:"PRIVATE_IIKO_CONNECTION_REQUIRED"});
    }
    if(!bound || !serviceSecret)return result(status);
    const connection=privateConnection(auth.state);
    let upstream;
    try{
      upstream=await env.IIKO_SESSION_BROKER.fetch("https://broker.internal/request",{
        method:"POST",
        headers:{"content-type":"application/json",
          "x-sh-broker-secret":String(env.IIKO_BROKER_SERVICE_SECRET)},
        body:JSON.stringify({
          action:"status",
          tenantId:"workspace:"+workspaceId,
          connection:{ip:connection.ip,port:connection.port,
            login:connection.login,password:connection.password}
        })
      });
    } catch {
      return result({...status,code:"BROKER_UNREACHABLE"});
    }
    const probe=await upstream.json().catch(()=>null);
    if(upstream.ok && probe?.code==="BROKER_READY"){
      return result({...status,workerReady:true,readyForActivation:true,
        code:selected?"BROKER_ACTIVE":"BROKER_READY_NOT_SELECTED"});
    }
    const safeCodes=new Set([
      "FORBIDDEN","CONFIG_MISSING","ENCRYPTION_CONFIG_INVALID",
      "TARGET_DENIED","BAD_REQUEST"
    ]);
    const code=safeCodes.has(probe?.code)?probe.code:"BROKER_NOT_READY";
    return result({...status,code});
  } catch {
    return error("BROKER_STATUS_UNAVAILABLE",503);
  }
}
