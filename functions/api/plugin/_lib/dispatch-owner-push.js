import { posAlertDetails } from "../../mobile/_lib/pos-alerts.js";
import { configuredFcm, sendFcmAlert } from "../../mobile/_lib/fcm.js";
import { authorizedPushRecipients,claimPushDelivery,
  settlePushDelivery,disablePushDevice } from "../../mobile/_lib/push-devices.js";
import { loadPrivateIikoState } from "../../iiko/_lib/user-state.js";
import { allowedDepartmentIds } from "../../iiko/_lib/restaurant-scope.js";
const clean=v=>String(v??"").trim();
async function digest(text){
 const bytes=new TextEncoder().encode(text);
 const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
 return [...hash].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export async function dispatchOwnerPosPush(env,envelope){
 const alert=posAlertDetails(envelope);
 if(!alert)return {matched:false,sent:0};
 if(!env?.DB||!configuredFcm(env))
   return {matched:true,configured:false,sent:0};
 const devices=await authorizedPushRecipients(env.DB,alert.departmentId,alert.kind);
 if(!devices.length)return {matched:true,configured:true,sent:0};
 const identity=alert.eventId ||
   JSON.stringify({event:envelope.event,time:envelope.timestamp,
     data:envelope.data});
 const eventKey=await digest(JSON.stringify([
    alert.departmentId,alert.pluginId,identity
 ]));
 let sent=0,failed=0,skipped=0;
 const allowedWorkspaces=new Map();
 for(const row of devices){
   const workspace=clean(row.workspace_id);
   if(!allowedWorkspaces.has(workspace)){
     try{
       const key=clean(row.server_owner_user_id)||clean(row.owner_user_id);
       const stored=await loadPrivateIikoState(env.DB,key,env);
       const allowed=allowedDepartmentIds(stored?.state||{});
       allowedWorkspaces.set(workspace,new Set(allowed.map(clean)));
     }catch{allowedWorkspaces.set(workspace,new Set())}
   }
   if(!allowedWorkspaces.get(workspace).has(alert.departmentId)){
     skipped++;continue;
   }
   if(!await claimPushDelivery(env.DB,eventKey,row.device_id)){
     skipped++;continue;
   }
   try{
     await sendFcmAlert(env,row.device_token,alert);
     await settlePushDelivery(env.DB,eventKey,row.device_id,"SENT");
     sent++;
   }catch(e){
     failed++;
     await settlePushDelivery(env.DB,eventKey,row.device_id,"FAILED")
       .catch(()=>{});
     if(["UNREGISTERED","SENDER_ID_MISMATCH"].includes(clean(e?.code)))
       await disablePushDevice(env.DB,row.device_id).catch(()=>{});
   }
 }
 return {matched:true,configured:true,sent,failed,skipped};
}
