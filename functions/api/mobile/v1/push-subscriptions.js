import { mobileContext,response,errorResponse,MobileError } from "../_lib/context.js";
import { ALERT_KINDS } from "../_lib/pos-alerts.js";
import { configuredFcm } from "../_lib/fcm.js";
import { upsertPushDevice,unregisterPushDevice,pushDeviceState,
  validPushKinds } from "../_lib/push-devices.js";
// Device tokens are never exposed in responses, URL parameters, client logs,
// or Cloudflare logs. Authenticated register/unregister actions are scoped to
// the verified mobile workspace and selected restaurants.
const clean=v=>String(v??"").trim();
export async function onRequestPost({request,env}){
 try{
  const ctx=await mobileContext(request,env);
  const body=await request.json().catch(()=>({}));
  const action=clean(body.action);
  const token=clean(body.token);
  if(token.length<32||token.length>4096||!/^[a-z0-9:_.-]+$/i.test(token))
    throw new MobileError("INVALID_DEVICE_TOKEN","Недействительный токен устройства.",400);
  const key={workspaceId:ctx.access.workspace.id,userId:ctx.auth.user.id,token};
  if(action==="unregister"){
    const result=await unregisterPushDevice(env.DB,key);
    return response({success:true,...result});
  }
  if(action==="status"){
    const result=await pushDeviceState(env.DB,key);
    return response({success:true,configured:configuredFcm(env),...result});
  }
  if(action!=="register")
    throw new MobileError("INVALID_PUSH_ACTION","Неизвестное действие подписки.",400);
  if(!configuredFcm(env))
    throw new MobileError("PUSH_NOT_CONFIGURED",
      "Для push-уведомлений ещё не настроен Firebase Cloud Messaging.",503);
  const kinds=body.kinds===undefined?ALERT_KINDS:validPushKinds(body.kinds);
  if(kinds.length===0)throw new MobileError("NO_ALERT_TYPES",
    "Выберите хотя бы один тип уведомлений.",400);
  const result=await upsertPushDevice(env.DB,{
    ...key,departmentIds:ctx.selectedIds,kinds
  });
  return response({success:true,configured:true,enabled:true,
    kinds:result.kinds,departmentCount:ctx.selectedIds.length});
 }catch(error){return errorResponse(error)}
}
