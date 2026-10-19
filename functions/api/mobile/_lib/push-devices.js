import { ALERT_KINDS } from "./pos-alerts.js";
const clean=x=>String(x??"").trim();
const setup=new WeakMap();
export async function ensurePushTables(db){
 if(!db)throw Error("PUSH_D1_UNAVAILABLE");
 const previous=setup.get(db);if(previous)return previous;
 const pending=(async()=>{
   await db.batch([
     db.prepare('CREATE TABLE IF NOT EXISTS sh_owner_push_devices(device_id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,user_id TEXT NOT NULL,device_token TEXT NOT NULL,department_ids_json TEXT NOT NULL,event_types_json TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)'),
     db.prepare('CREATE INDEX IF NOT EXISTS idx_sh_owner_push_workspace ON sh_owner_push_devices(workspace_id,enabled)'),
     db.prepare('CREATE TABLE IF NOT EXISTS sh_owner_push_deliveries(event_key TEXT NOT NULL,device_id TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(event_key,device_id))')
   ]);
 })();
 setup.set(db,pending);
 try{await pending;return pending}
 catch(e){setup.delete(db);throw e}
}
export async function deviceIdForToken(token){
 const raw=new TextEncoder().encode(clean(token));
 const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",raw));
 return [...hash].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export function validPushKinds(values){
 const supplied=Array.isArray(values)?values:ALERT_KINDS;
 return [...new Set(supplied.map(clean).filter(k=>ALERT_KINDS.includes(k)))];
}
export async function upsertPushDevice(db,{workspaceId,userId,token,
  departmentIds,kinds=ALERT_KINDS}){
 await ensurePushTables(db);
 const did=await deviceIdForToken(token);
 const now=new Date().toISOString();
 const ids=[...new Set((departmentIds||[]).map(clean).filter(Boolean))];
 await db.prepare('INSERT INTO sh_owner_push_devices(device_id,workspace_id,user_id,device_token,department_ids_json,event_types_json,enabled,created_at,updated_at) VALUES (?1,?2,?3,?4,?5,?6,1,?7,?7) ON CONFLICT(device_id) DO UPDATE SET workspace_id=excluded.workspace_id,user_id=excluded.user_id,device_token=excluded.device_token,department_ids_json=excluded.department_ids_json,event_types_json=excluded.event_types_json,enabled=1,updated_at=excluded.updated_at')
  .bind(did,clean(workspaceId),clean(userId),clean(token),
   JSON.stringify(ids),JSON.stringify(validPushKinds(kinds)),now).run();
 return {deviceId:did,enabled:true,departmentIds:ids,
   kinds:validPushKinds(kinds)};
}
export async function unregisterPushDevice(db,{workspaceId,userId,token}){
 await ensurePushTables(db);
 const id=await deviceIdForToken(token);
 await db.prepare('DELETE FROM sh_owner_push_devices WHERE device_id=?1 AND workspace_id=?2 AND user_id=?3')
   .bind(id,clean(workspaceId),clean(userId)).run();
 return {enabled:false};
}
export async function pushDeviceState(db,{workspaceId,userId,token}){
 await ensurePushTables(db);
 const id=await deviceIdForToken(token);
 const row=await db.prepare('SELECT enabled,event_types_json,updated_at FROM sh_owner_push_devices WHERE device_id=?1 AND workspace_id=?2 AND user_id=?3 LIMIT 1')
   .bind(id,clean(workspaceId),clean(userId)).first();
 if(!row)return {enabled:false,kinds:ALERT_KINDS};
 let kinds;try{kinds=validPushKinds(JSON.parse(row.event_types_json))}
 catch{kinds=ALERT_KINDS}
 return {enabled:row.enabled===1||row.enabled===true,
   kinds,updatedAt:row.updated_at};
}
// Recheck ACTIVE workspace, ACTIVE membership and assigned Admin role on
// every dispatch; devices are never trusted as authorization on their own.
export async function authorizedPushRecipients(db,departmentId,kind){
 await ensurePushTables(db);
 const query='SELECT d.*,w.server_owner_user_id,w.owner_user_id FROM sh_owner_push_devices d JOIN sh_workspaces w ON w.id=d.workspace_id AND UPPER(w.status)=\'ACTIVE\' JOIN sh_access_members m ON m.owner_user_id=w.owner_user_id AND m.user_id=d.user_id AND UPPER(m.status)=\'ACTIVE\' WHERE d.enabled=1 AND EXISTS(SELECT 1 FROM json_each(d.department_ids_json) ids WHERE ids.value=?1) AND EXISTS(SELECT 1 FROM json_each(d.event_types_json) types WHERE types.value=?2) AND (m.owner_user_id=m.user_id OR EXISTS(SELECT 1 FROM sh_access_member_roles mr JOIN sh_access_roles role ON role.id=mr.role_id AND role.owner_user_id=mr.owner_user_id WHERE mr.owner_user_id=w.owner_user_id AND mr.member_id=m.id AND role.code=\'ADMIN\' AND role.is_system=1)) LIMIT 100';
 const result=await db.prepare(query).bind(clean(departmentId),clean(kind)).all();
 return result.results||[];
}
export async function claimPushDelivery(db,eventKey,deviceId){
 const result=await db.prepare("INSERT OR IGNORE INTO sh_owner_push_deliveries(event_key,device_id,created_at,status) VALUES(?1,?2,?3,'SENDING')")
  .bind(eventKey,deviceId,new Date().toISOString()).run();
 return Number(result?.meta?.changes||0)>0;
}
export async function settlePushDelivery(db,eventKey,deviceId,status){
 await db.prepare('UPDATE sh_owner_push_deliveries SET status=?3 WHERE event_key=?1 AND device_id=?2')
   .bind(eventKey,deviceId,status).run();
}
export async function disablePushDevice(db,deviceId){
 await db.prepare('UPDATE sh_owner_push_devices SET enabled=0,updated_at=?2 WHERE device_id=?1')
  .bind(deviceId,new Date().toISOString()).run();
}
