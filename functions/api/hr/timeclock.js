import { loadRequestIikoState } from '../iiko/_lib/user-state.js';
import { resolveHrRestaurantScope, hrScopeKeys, isHrSubsetScope } from './_lib/restaurant-scope.js';
import { employeeWithinMembershipScope,visibleEmployeeMembership,mergeEmployeeMembership } from './_lib/employee-department-membership.js';
import { zktecoModelProfile,plannedDeviceRoster } from './_lib/zkteco-network-roster.js';
import { ensureZktecoAdmsTables, registerAdmsDevice, unregisterAdmsDevice, correctAdmsDeviceSerial, queueAdmsCommand } from './_lib/zkteco-adms.js';
import { ensurePilotTables, proposePilotPin, reservePilotPin, pilotCommand, PILOT_EMPLOYEE_NAME } from './_lib/zkteco-pilot.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function now(){return new Date().toISOString()}
function uid(prefix='id'){return `${prefix}_${crypto.randomUUID()}`}
function direction(v){const s=clean(v).toUpperCase();if(['IN','ENTRY','CHECKIN','BREAKIN','OTIN','0','3','4'].includes(s))return'IN';if(['OUT','EXIT','CHECKOUT','BREAKOUT','OTOUT','1','2','5'].includes(s))return'OUT';return'UNKNOWN'}
function iso(v){const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toISOString()}
async function sha256(value){const bytes=new TextEncoder().encode(String(value||''));const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('')}
function randomDeviceToken(){const bytes=crypto.getRandomValues(new Uint8Array(32));let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return `shd_${btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}`}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employees (
      user_id TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL,
      employee_code TEXT NOT NULL DEFAULT '',
      first_name TEXT NOT NULL DEFAULT '',
      middle_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      role_code TEXT NOT NULL DEFAULT '',
      role_name TEXT NOT NULL DEFAULT '',
      department_code TEXT NOT NULL DEFAULT '',
      hire_date TEXT NOT NULL DEFAULT '',
      fire_date TEXT NOT NULL DEFAULT '',
      is_deleted INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL,
      PRIMARY KEY(user_id,iiko_employee_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_devices (
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'ZKTECO',
      name TEXT NOT NULL,
      device_model TEXT NOT NULL DEFAULT '',
      restaurant_id TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      connection_mode TEXT NOT NULL DEFAULT 'LOCAL_CONNECTOR',
      timezone TEXT NOT NULL DEFAULT 'Asia/Baku',
      is_active INTEGER NOT NULL DEFAULT 1,
      last_sync_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,device_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_devices_user ON hr_devices(user_id,is_active,name)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_device_bindings (
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'ZKTECO',
      external_employee_id TEXT NOT NULL,
      external_label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,device_id,iiko_employee_id),
      UNIQUE(user_id,device_id,external_employee_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_bindings_employee ON hr_employee_device_bindings(user_id,iiko_employee_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_departments (
      user_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,department_code TEXT NOT NULL,synced_at TEXT NOT NULL,
      PRIMARY KEY(user_id,iiko_employee_id,department_code)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_attendance_events (
      user_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'ZKTECO',
      source_uid TEXT NOT NULL,
      external_employee_id TEXT NOT NULL DEFAULT '',
      iiko_employee_id TEXT NOT NULL DEFAULT '',
      event_time TEXT NOT NULL,
      event_type TEXT NOT NULL DEFAULT 'UNKNOWN',
      raw_payload TEXT NOT NULL DEFAULT '{}',
      imported_at TEXT NOT NULL,
      PRIMARY KEY(user_id,event_id),
      UNIQUE(user_id,device_id,source_uid)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_events_time ON hr_attendance_events(user_id,event_time DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_events_employee ON hr_attendance_events(user_id,iiko_employee_id,event_time DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_device_tokens (
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      rotated_at TEXT NOT NULL,
      last_used_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(user_id,device_id),
      UNIQUE(token_hash)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_device_tokens_hash ON hr_device_tokens(token_hash)`)
  ]);
  try{await db.prepare(`ALTER TABLE hr_devices ADD COLUMN restaurant_id TEXT NOT NULL DEFAULT ''`).run()}catch(_){}
  try{await db.prepare(`ALTER TABLE hr_devices ADD COLUMN device_model TEXT NOT NULL DEFAULT ''`).run()}catch(_){}
  await ensureZktecoAdmsTables(db);
  await ensurePilotTables(db);
}

async function auth(request,env){
  const state=await loadRequestIikoState(request,env);
  if(!state?.user)return null;
  if(!state.access?.allowed||!state.storageUserId){
    const denied=new Error('Нет доступа к выбранной организации HR.');
    denied.status=403;
    throw denied;
  }
  await ensure(env.DB);
  return state;
}
async function device(db,userId,deviceId){return db.prepare(`SELECT * FROM hr_devices WHERE user_id=?1 AND device_id=?2 LIMIT 1`).bind(userId,deviceId).first()}
export function isTimeclockScopeRestricted(scope){
  return isHrSubsetScope(scope)||scope?.membershipRestricted===true;
}
export function deviceAllowedForScope(row,scope){
  if(!row)return false;
  if(!isTimeclockScopeRestricted(scope))return true;
  const rid=clean(row.restaurant_id).toLowerCase();
  if(!rid)return false;
  return (scope.selectedDepartmentIds||[]).some(x=>clean(x).toLowerCase()===rid);
}
export function employeeAllowedForScope(employee,scope,deviceRow=null){
  if(!employee)return false;
  const codes=mergeEmployeeMembership(employee.departmentCodes,employee.department_code);
  const normalized=new Set(codes.map(c=>clean(c).toLowerCase()));
  if(isTimeclockScopeRestricted(scope)){
    const permitted=new Set(hrScopeKeys(scope).map(x=>clean(x).toLowerCase()));
    if(!codes.some(c=>permitted.has(clean(c).toLowerCase())))return false;
  }
  if(scope?.isChain&&deviceRow?.restaurant_id){
    const department=(scope.selectedRestaurants||[]).find(x=>clean(x.id).toLowerCase()===clean(deviceRow.restaurant_id).toLowerCase());
    if(!department||!normalized.has(clean(department.code).toLowerCase()))return false;
  }
  return true;
}
async function loadEmployeeMemberships(db,userId){
  const rows=await db.prepare(`SELECT iiko_employee_id,department_code FROM hr_employee_departments WHERE user_id=?1`).bind(userId).all();
  const memberships=new Map();
  for(const row of rows.results||[]){
    const id=clean(row.iiko_employee_id);
    if(!memberships.has(id))memberships.set(id,[]);
    memberships.get(id).push(row.department_code);
  }
  return memberships;
}
function attachEmployeeMemberships(employees,memberships){
  return (employees||[]).map(e=>({
    ...e,departmentCodes:mergeEmployeeMembership(memberships.get(clean(e.iiko_employee_id))||[],e.department_code)
  }));
}

async function snapshot(db,userId,scope=null){
  const [devices,employees,bindings,events,tokens,admsRows,admsRawRows,admsRequestRows,admsCommandRows,pilotRows]=await Promise.all([
    db.prepare(`SELECT * FROM hr_devices WHERE user_id=?1 ORDER BY is_active DESC,name COLLATE NOCASE`).bind(userId).all(),
    db.prepare(`SELECT * FROM hr_employees WHERE user_id=?1 AND TRIM(employee_code)<>'' ORDER BY is_deleted,last_name COLLATE NOCASE,first_name COLLATE NOCASE,display_name COLLATE NOCASE`).bind(userId).all(),
    db.prepare(`SELECT * FROM hr_employee_device_bindings WHERE user_id=?1 ORDER BY updated_at DESC`).bind(userId).all(),
    db.prepare(`SELECT e.*,COALESCE(h.display_name,'') AS employee_name,COALESCE(h.employee_code,'') AS employee_code
      FROM hr_attendance_events e LEFT JOIN hr_employees h ON h.user_id=e.user_id AND h.iiko_employee_id=e.iiko_employee_id
      WHERE e.user_id=?1 ORDER BY e.event_time DESC LIMIT 300`).bind(userId).all(),
    db.prepare(`SELECT device_id,last_used_at,rotated_at FROM hr_device_tokens WHERE user_id=?1`).bind(userId).all(),
    db.prepare(`SELECT device_id,serial_number,model,last_seen_at,last_event_at,push_version,firmware,last_ip,last_user_agent FROM hr_zkteco_adms_devices WHERE user_id=?1 AND enabled=1`).bind(userId).all(),
    db.prepare(`SELECT raw_id,device_id,serial_number,table_name,event_time,external_employee_id,event_status,verify_type,work_code,raw_line,received_at FROM hr_zkteco_adms_raw WHERE user_id=?1 ORDER BY received_at DESC LIMIT 200`).bind(userId).all(),
    db.prepare(`SELECT request_id,device_id,serial_number,endpoint,method,table_name,query_text,body_length,body_preview,received_at FROM hr_zkteco_adms_requests WHERE user_id=?1 ORDER BY received_at DESC LIMIT 100`).bind(userId).all(),
    db.prepare(`SELECT command_id,device_id,serial_number,command_text,status,created_at,sent_at,acknowledged_at,return_code FROM hr_zkteco_adms_commands WHERE user_id=?1 ORDER BY created_at DESC LIMIT 30`).bind(userId).all(),
    db.prepare(`SELECT p.device_id,p.iiko_employee_id,p.pin,p.format,p.command_id,p.status,p.return_code,p.updated_at,e.display_name
      FROM hr_zkteco_pilot_provisioning p LEFT JOIN hr_employees e ON e.user_id=p.user_id AND e.iiko_employee_id=p.iiko_employee_id
      WHERE p.user_id=?1 ORDER BY p.updated_at DESC`).bind(userId).all()
  ]);
  const allDevices=devices.results||[],allEmployees=employees.results||[],allBindings=bindings.results||[],allEvents=events.results||[],ts=tokens.results||[],adms=admsRows.results||[],allAdmsRaw=admsRawRows.results||[],allAdmsRequests=admsRequestRows.results||[],allAdmsCommands=admsCommandRows.results||[];
  const subset=isTimeclockScopeRestricted(scope);
  const ds=subset?allDevices.filter(x=>deviceAllowedForScope(x,scope)):allDevices;
  const memberships=await loadEmployeeMemberships(db,userId);
  const es=attachEmployeeMemberships(allEmployees,memberships)
    .filter(e=>employeeWithinMembershipScope(e,scope));
  const employeeIds=new Set(es.map(x=>String(x.iiko_employee_id)));
  const selectedDeviceIds=new Set(ds.map(x=>String(x.device_id)));
  const bs=subset?allBindings.filter(x=>selectedDeviceIds.has(String(x.device_id))&&employeeIds.has(String(x.iiko_employee_id))):allBindings;
  const ev=subset?allEvents.filter(x=>selectedDeviceIds.has(String(x.device_id))&&(!x.iiko_employee_id||employeeIds.has(String(x.iiko_employee_id)))):allEvents;
  const tokenMap=new Map(ts.map(x=>[String(x.device_id),x])),admsMap=new Map(adms.map(x=>[String(x.device_id),x])),nowMs=Date.now();
  const rosterDevices=ds.map(x=>({...x,device_model:x.device_model||admsMap.get(String(x.device_id))?.model||''}));
  const roster=plannedDeviceRoster(rosterDevices,es,scope);
  return{
    rosterPreview:roster,
    pilotProvisioning:(pilotRows.results||[]).filter(x=>selectedDeviceIds.has(String(x.device_id)))
      .map(x=>({deviceId:x.device_id,employeeId:x.iiko_employee_id,employeeName:x.display_name||'',
        pin:x.pin,format:x.format,commandId:Number(x.command_id),status:x.status,
        returnCode:x.return_code||'',updatedAt:x.updated_at})),
    pilotAvailable:Boolean(scope?.isChain&&!isTimeclockScopeRestricted(scope)&&
      (scope.selectedDepartmentIds||[]).length>0&&
      (scope.selectedDepartmentIds||[]).length===(scope.allowedDepartmentIds||[]).length),
    restaurantScope:scope?{mode:scope.mode,departmentIds:scope.selectedDepartmentIds,departmentCodes:scope.selectedDepartmentCodes,restaurants:(scope.selectedRestaurants||[]).map(r=>({id:r.id,code:r.code,name:r.name})),deviceScope:subset?'SCOPED_BY_RESTAURANT':'ALL'}:null,
    adms:{basePath:'/iclock',directPush:true,offlineBuffering:'DEVICE_LOCAL_MEMORY'},
    devices:ds.map(x=>{const token=tokenMap.get(String(x.device_id)),zk=admsMap.get(String(x.device_id)),seen=zk?.last_seen_at?new Date(zk.last_seen_at).getTime():0;return{id:x.device_id,provider:x.provider,name:x.name,restaurantId:x.restaurant_id||'',location:x.location,connectionMode:x.connection_mode,timezone:x.timezone,active:Boolean(x.is_active),lastSyncAt:x.last_sync_at||'',tokenConfigured:Boolean(token),tokenLastUsedAt:token?.last_used_at||'',tokenRotatedAt:token?.rotated_at||'',serialNumber:zk?.serial_number||'',model:x.device_model||zk?.model||'',admsLastSeenAt:zk?.last_seen_at||'',admsLastEventAt:zk?.last_event_at||'',pushVersion:zk?.push_version||'',firmware:zk?.firmware||'',lastIp:zk?.last_ip||'',admsOnline:Boolean(seen&&nowMs-seen<5*60*1000)}}),
    employees:es.map(x=>({
      id:x.iiko_employee_id,code:x.employee_code,name:x.display_name,firstName:x.first_name,lastName:x.last_name,roleName:x.role_name,
      departmentCode:(()=>{
        const visible=visibleEmployeeMembership(x.departmentCodes,scope);
        return visible.some(c=>c.toLowerCase()===clean(x.department_code).toLowerCase())
          ?x.department_code:(visible[0]||'');
      })(),
      departmentCodes:visibleEmployeeMembership(x.departmentCodes,scope),
      deleted:Boolean(x.is_deleted),fireDate:x.fire_date||''
    })),
    bindings:bs.map(x=>({deviceId:x.device_id,employeeId:x.iiko_employee_id,provider:x.provider,externalEmployeeId:x.external_employee_id,externalLabel:x.external_label||''})),
    events:ev.map(x=>({id:x.event_id,deviceId:x.device_id,provider:x.provider,sourceUid:x.source_uid,externalEmployeeId:x.external_employee_id,employeeId:x.iiko_employee_id,employeeName:x.employee_name||'',employeeCode:x.employee_code||'',eventTime:x.event_time,eventType:x.event_type,importedAt:x.imported_at})),
    rawAdms:(subset?allAdmsRaw.filter(x=>selectedDeviceIds.has(String(x.device_id))):allAdmsRaw).map(x=>({id:x.raw_id,deviceId:x.device_id,serialNumber:x.serial_number,tableName:x.table_name,eventTime:x.event_time||'',externalEmployeeId:x.external_employee_id||'',status:x.event_status||'',verifyType:x.verify_type||'',workCode:x.work_code||'',rawLine:x.raw_line||'',receivedAt:x.received_at||''})),
    admsRequests:(subset?allAdmsRequests.filter(x=>selectedDeviceIds.has(String(x.device_id))):allAdmsRequests).map(x=>({id:x.request_id,deviceId:x.device_id,serialNumber:x.serial_number,endpoint:x.endpoint||'',method:x.method||'',tableName:x.table_name||'',queryText:x.query_text||'',bodyLength:Number(x.body_length||0),bodyPreview:x.body_preview||'',receivedAt:x.received_at||''})),
    admsCommands:(subset?allAdmsCommands.filter(x=>selectedDeviceIds.has(String(x.device_id))):allAdmsCommands).map(x=>({id:Number(x.command_id),deviceId:x.device_id,serialNumber:x.serial_number,commandText:x.command_text,status:x.status,createdAt:x.created_at||'',sentAt:x.sent_at||'',acknowledgedAt:x.acknowledged_at||'',returnCode:x.return_code||''})),
    counts:{devices:ds.filter(x=>x.is_active).length,admsDevices:ds.filter(x=>admsMap.has(String(x.device_id))).length,admsOnline:ds.filter(x=>{const z=admsMap.get(String(x.device_id)),seen=z?.last_seen_at?new Date(z.last_seen_at).getTime():0;return Boolean(seen&&nowMs-seen<5*60*1000)}).length,unassignedDevices:ds.filter(x=>!clean(x.restaurant_id)).length,employees:es.filter(x=>!x.is_deleted&&!x.fire_date).length,bindings:bs.length,events:ev.length,unmatchedEvents:ev.filter(x=>!x.iiko_employee_id).length,deviceTokens:ts.filter(x=>ds.some(d=>String(d.device_id)===String(x.device_id))).length,rawAdms:(subset?allAdmsRaw.filter(x=>selectedDeviceIds.has(String(x.device_id))):allAdmsRaw).length,admsRequests:(subset?allAdmsRequests.filter(x=>selectedDeviceIds.has(String(x.device_id))):allAdmsRequests).length}
  };
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{const a=await auth(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);const userId=a.storageUserId,scope=await resolveHrRestaurantScope(request,env,userId,a.access);return json({success:true,attendanceSource:'EXTERNAL_DEVICE',payrollEngine:'SMART_HORECA',ingestPath:'/api/hr/device-ingest',admsPath:'/iclock',...(await snapshot(env.DB,userId,scope))})}
  catch(e){console.error('[HR-TIMECLOCK-GET]',e);return json({success:false,message:e?.message||String(e)},e?.status||500)}
}

export async function onRequestPost({request,env}){
  try{
    const a=await auth(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);
    const b=await request.json().catch(()=>({}));const action=clean(b.action);const userId=a.storageUserId;
    const scope=await resolveHrRestaurantScope(request,env,userId,a.access);
    if(action==='saveDevice'){
      let id=clean(b.id)||uid('dev');const provider=(clean(b.provider)||'ZKTECO').toUpperCase(),name=clean(b.name),location=clean(b.location),mode=clean(b.connectionMode)||'ADMS_PUSH',timezone=clean(b.timezone)||'Asia/Baku',serialNumber=clean(b.serialNumber).toUpperCase(),model=clean(b.model)||'SenseFace 2A';
      if(!name)return json({success:false,message:'Укажите название устройства'},400);
      if(provider==='ZKTECO'&&zktecoModelProfile(model).key==='UNKNOWN')return json({success:false,message:'Выберите поддерживаемую модель ZKTeco: F18, SenseFace 2A или SenseFace 3A.'},400);
      if(mode==='ADMS_PUSH'&&!serialNumber)return json({success:false,message:'Для прямого ZKTeco ADMS укажите серийный номер аппарата.'},400);
      if(mode==='ADMS_PUSH'&&serialNumber){
        const existingSn=await env.DB.prepare(`SELECT user_id,device_id FROM hr_zkteco_adms_devices WHERE serial_number=?1 LIMIT 1`).bind(serialNumber).first();
        if(existingSn){
          if(String(existingSn.user_id)!==String(userId))return json({success:false,message:'Этот серийный номер уже зарегистрирован.'},409);
          if(!clean(b.id))id=String(existingSn.device_id);
          else if(String(existingSn.device_id)!==String(id))return json({success:false,message:'Этот серийный номер уже привязан к другому устройству.'},409);
        }
      }
      const selectedRestaurants=Array.isArray(scope?.selectedDepartmentIds)?scope.selectedDepartmentIds.map(String).filter(Boolean):[];
      if(scope?.isChain&&selectedRestaurants.length!==1)return json({success:false,code:'HR_DEVICE_SINGLE_RESTAURANT_REQUIRED',message:'Для устройства Face ID в CHAIN выберите ровно один ресторан.'},409);
      const restaurantId=selectedRestaurants[0]||'';
      const existingDevice=clean(b.id)?await device(env.DB,userId,id):null;
      if(existingDevice&&!deviceAllowedForScope(existingDevice,scope))return json({success:false,message:'Устройство относится к другому ресторану.'},403);
      const t=now();await env.DB.prepare(`INSERT INTO hr_devices(user_id,device_id,provider,name,device_model,restaurant_id,location,connection_mode,timezone,is_active,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,1,?10,?10)
        ON CONFLICT(user_id,device_id) DO UPDATE SET provider=excluded.provider,name=excluded.name,device_model=excluded.device_model,restaurant_id=excluded.restaurant_id,location=excluded.location,connection_mode=excluded.connection_mode,timezone=excluded.timezone,updated_at=excluded.updated_at`)
        .bind(userId,id,provider,name,model,restaurantId,location,mode,timezone,t).run();
      if(mode==='ADMS_PUSH')await registerAdmsDevice(env.DB,{userId,deviceId:id,serialNumber,model});
      else await unregisterAdmsDevice(env.DB,userId,id);
      return json({success:true,deviceId:id,ingestPath:'/api/hr/device-ingest',admsPath:'/iclock',...await snapshot(env.DB,userId,scope)});
    }
    if(action==='correctDeviceSerial'){
      const deviceId=clean(b.deviceId),serialNumber=clean(b.serialNumber);
      if(!deviceId)return json({success:false,message:'Укажите зарегистрированное устройство.'},400);
      const d=await device(env.DB,userId,deviceId);
      if(!d)return json({success:false,message:'Устройство не найдено.'},404);
      if(!deviceAllowedForScope(d,scope))return json({success:false,message:'Устройство относится к другому RMS.'},403);
      if(clean(d.connection_mode)!=='ADMS_PUSH')return json({success:false,message:'Исправление SN доступно только для устройств ADMS PUSH.'},409);
      const result=await correctAdmsDeviceSerial(env.DB,{userId,deviceId,serialNumber});
      return json({success:true,deviceId,serialCorrection:result,
        message:result.changed?'SN исправлен. Дождитесь подключения SenseFace и нажмите «Обновить».':'SN уже совпадает.',
        ...await snapshot(env.DB,userId,scope)});
    }
    if(action==='reassignDeviceRestaurant'){
      const deviceId=clean(b.deviceId),restaurantId=clean(b.restaurantId);
      if(!deviceId||!restaurantId)return json({success:false,message:'Укажите устройство и новый RMS.'},400);
      const central=Boolean(scope?.isChain&&!isTimeclockScopeRestricted(scope)&&
        (scope.selectedDepartmentIds||[]).length>0&&
        (scope.selectedDepartmentIds||[]).length===(scope.allowedDepartmentIds||[]).length);
      if(!central)return json({success:false,message:'Переназначение устройств между RMS доступно только центральному HR всей сети.'},403);
      const d=await device(env.DB,userId,deviceId);
      if(!d)return json({success:false,message:'Устройство не найдено.'},404);
      if(!(scope.selectedRestaurants||[]).some(x=>clean(x.id)===restaurantId))
        return json({success:false,message:'Новый RMS не входит в доступную область CHAIN.'},403);
      if(clean(d.restaurant_id)===restaurantId)return json({success:true,deviceId,unchanged:true,...await snapshot(env.DB,userId,scope)});
      const historical=await env.DB.prepare(`SELECT COUNT(*) AS count FROM hr_attendance_events
        WHERE user_id=?1 AND device_id=?2`).bind(userId,deviceId).first();
      const raw=await env.DB.prepare(`SELECT COUNT(*) AS count FROM hr_zkteco_adms_raw
        WHERE user_id=?1 AND device_id=?2`).bind(userId,deviceId).first();
      if(Number(historical?.count||0)>0||Number(raw?.count||0)>0)
        return json({success:false,message:'У этого аппарата есть история явок. Переназначение может изменить старый Payroll и заблокировано. Требуется датированная история размещения устройства.'},409);
      await env.DB.prepare(`UPDATE hr_devices SET restaurant_id=?3,updated_at=?4
        WHERE user_id=?1 AND device_id=?2`).bind(userId,deviceId,restaurantId,now()).run();
      return json({success:true,deviceId,previousRestaurantId:d.restaurant_id||'',restaurantId,
        ...await snapshot(env.DB,userId,scope)});
    }
    if(action==='deleteDevice'){
      const deviceId=clean(b.deviceId);if(!deviceId)return json({success:false,message:'Не указано устройство'},400);
      const d=await device(env.DB,userId,deviceId);if(!d)return json({success:false,message:'Устройство не найдено'},404);
      if(!deviceAllowedForScope(d,scope))return json({success:false,message:'Устройство относится к другому ресторану.'},403);
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM hr_employee_device_bindings WHERE user_id=?1 AND device_id=?2`).bind(userId,deviceId),
        env.DB.prepare(`DELETE FROM hr_device_tokens WHERE user_id=?1 AND device_id=?2`).bind(userId,deviceId),
        env.DB.prepare(`DELETE FROM hr_zkteco_adms_raw WHERE user_id=?1 AND device_id=?2`).bind(userId,deviceId),
        env.DB.prepare(`DELETE FROM hr_zkteco_adms_devices WHERE user_id=?1 AND device_id=?2`).bind(userId,deviceId),
        env.DB.prepare(`DELETE FROM hr_devices WHERE user_id=?1 AND device_id=?2`).bind(userId,deviceId)
      ]);
      return json({success:true,deletedDeviceId:deviceId,...await snapshot(env.DB,userId,scope)});
    }
    if(action==='rotateDeviceToken'){
      const deviceId=clean(b.deviceId);if(!deviceId)return json({success:false,message:'Не указано устройство'},400);
      const d=await device(env.DB,userId,deviceId);if(!d)return json({success:false,message:'Устройство не найдено'},404);if(!deviceAllowedForScope(d,scope))return json({success:false,message:'Устройство относится к другому ресторану.'},403);
      if(String(d.connection_mode)==='ADMS_PUSH')return json({success:false,message:'Для SenseFace ADMS device token не нужен: аппарат подключается напрямую по серийному номеру.'},409);
      const token=randomDeviceToken(),hash=await sha256(token),t=now();
      await env.DB.prepare(`INSERT INTO hr_device_tokens(user_id,device_id,token_hash,created_at,rotated_at,last_used_at)
        VALUES(?1,?2,?3,?4,?4,'') ON CONFLICT(user_id,device_id) DO UPDATE SET token_hash=excluded.token_hash,rotated_at=excluded.rotated_at,last_used_at=''`)
        .bind(userId,deviceId,hash,t).run();
      return json({success:true,deviceId,deviceToken:token,ingestPath:'/api/hr/device-ingest',...await snapshot(env.DB,userId,scope)});
    }
    if(action==='revokeDeviceToken'){
      const deviceId=clean(b.deviceId);if(!deviceId)return json({success:false,message:'Не указано устройство'},400);
      const d=await device(env.DB,userId,deviceId);if(!d)return json({success:false,message:'Устройство не найдено'},404);if(!deviceAllowedForScope(d,scope))return json({success:false,message:'Устройство относится к другому ресторану.'},403);
      await env.DB.prepare(`DELETE FROM hr_device_tokens WHERE user_id=?1 AND device_id=?2`).bind(userId,deviceId).run();
      return json({success:true,deviceId,ingestPath:'/api/hr/device-ingest',...await snapshot(env.DB,userId,scope)});
    }
    if(action==='pilotPrepareTestHr'||action==='pilotProvisionTestHr'){
      const preparing=action==='pilotPrepareTestHr';
      const central=Boolean(scope?.isChain&&!isTimeclockScopeRestricted(scope)&&
        (scope.selectedDepartmentIds||[]).length>0&&
        (scope.selectedDepartmentIds||[]).length===(scope.allowedDepartmentIds||[]).length);
      if(!central)return json({success:false,message:'Только центральный HR всей сети может отправлять тестового сотрудника на все устройства.'},403);
      const ids=Array.isArray(b.deviceIds)?b.deviceIds.map(clean):[];
      if(new Set(ids).size!==2||ids.length!==2)return json({success:false,message:'Для пилота выберите ровно два разных SenseFace.'},400);
      if(!preparing&&b.confirmFreePin!==true)return json({success:false,message:'Подтвердите, что PIN свободен на обоих устройствах и разрешена отправка TEST HR.'},400);
      const format=clean(b.format)||'USERINFO';
      if(!['USERINFO','USER_AC_PUSH'].includes(format))return json({success:false,message:'Неподдерживаемый формат команды ADMS.'},400);
      const selected=new Set((scope.selectedDepartmentIds||[]).map(String));
      const devices=await env.DB.prepare(`SELECT d.device_id,d.name,d.device_model,d.restaurant_id,d.connection_mode,d.is_active,
        z.serial_number,z.last_seen_at,z.enabled FROM hr_devices d
        JOIN hr_zkteco_adms_devices z ON z.user_id=d.user_id AND z.device_id=d.device_id
        WHERE d.user_id=?1 AND d.device_id IN (?2,?3)`).bind(userId,...ids).all();
      const targets=devices.results||[];
      if(targets.length!==2||targets.some(d=>!selected.has(String(d.restaurant_id))||!Number(d.is_active)||
        !Number(d.enabled)||d.connection_mode!=='ADMS_PUSH'||!/^SenseFace\s+[23]A$/i.test(d.device_model||'')||
        !Number.isFinite(Date.parse(d.last_seen_at||''))||
        Date.now()-Date.parse(d.last_seen_at||'')>5*60*1000))
        return json({success:false,message:'Нужно выбрать два активных SenseFace 2A/3A с ADMS Online и разрешёнными RMS.'},409);
      const desired=new Set(targets.map(d=>String(d.device_model||'').toUpperCase().replace(/\s+/g,'')));
      if(!desired.has('SENSEFACE2A')||!desired.has('SENSEFACE3A'))
        return json({success:false,message:'Для этого пилота требуются SenseFace 2A и SenseFace 3A.'},409);
      const test=await env.DB.prepare(`SELECT iiko_employee_id,employee_code,display_name,is_deleted,fire_date
        FROM hr_employees WHERE user_id=?1 AND UPPER(TRIM(display_name))=?2`)
        .bind(userId,PILOT_EMPLOYEE_NAME).all();
      const staff=(test.results||[]).filter(e=>!Number(e.is_deleted)&&!clean(e.fire_date));
      if(staff.length!==1)return json({success:false,message:'Нужен ровно один действующий сотрудник TEST HR в справочнике CHAIN.'},409);
      const person=staff[0],personId=String(person.iiko_employee_id);
      const proposedPin=await proposePilotPin(env.DB,userId,person);
      if(preparing)return json({success:true,employee:person.display_name,pin:proposedPin,
        devices:targets.map(d=>({id:d.device_id,name:d.name,model:d.device_model})),
        message:'Проверьте, что такой PIN не принадлежит другому человеку на обоих устройствах.'});
      if(clean(b.expectedPin)!==proposedPin)
        return json({success:false,message:'PIN отличается от предварительного просмотра. Повторите подготовку отправки.'},409);
      const pin=await reservePilotPin(env.DB,userId,person);
      for(const d of targets){
        const bnd=await env.DB.prepare(`SELECT iiko_employee_id,external_employee_id FROM hr_employee_device_bindings
          WHERE user_id=?1 AND device_id=?2 AND (iiko_employee_id=?3 OR external_employee_id=?4)`)
          .bind(userId,d.device_id,personId,pin).all();
        if((bnd.results||[]).some(row=>String(row.iiko_employee_id)!==personId||String(row.external_employee_id)!==pin))
          return json({success:false,message:'PIN '+pin+' конфликтует с существующей привязкой на '+d.name+'. Отправка отменена.'},409);
      }
      const jobs=[];
      for(const d of targets){
        const old=await env.DB.prepare(`SELECT p.*,c.status AS cmd_status FROM hr_zkteco_pilot_provisioning p
          LEFT JOIN hr_zkteco_adms_commands c ON c.user_id=p.user_id AND c.device_id=p.device_id AND c.command_id=p.command_id
          WHERE p.user_id=?1 AND p.device_id=?2 AND p.iiko_employee_id=?3`)
          .bind(userId,d.device_id,personId).first();
        if(old&&['PENDING','SENT','ACK_SUCCESS'].includes(old.status)&&old.pin===pin){
          jobs.push({deviceId:d.device_id,commandId:old.command_id,status:old.status,reused:true});
          continue;
        }
        if(format==='USER_AC_PUSH'&&(!old||old.status!=='ACK_FAILED')){
          return json({success:false,message:'Альтернативная AC PUSH команда разрешена только после отказа первой команды на обоих устройствах.'},409);
        }
        const cmd=pilotCommand({pin,name:person.display_name,format});
        const commandId=await queueAdmsCommand(env.DB,{...d,user_id:userId},cmd);
        const t=now();
        await env.DB.prepare(`INSERT INTO hr_zkteco_pilot_provisioning
          (user_id,device_id,iiko_employee_id,pin,format,command_id,status,return_code,updated_at)
          VALUES(?1,?2,?3,?4,?5,?6,'PENDING','',?7)
          ON CONFLICT(user_id,device_id,iiko_employee_id) DO UPDATE
          SET pin=excluded.pin,format=excluded.format,command_id=excluded.command_id,status='PENDING',return_code='',updated_at=excluded.updated_at`)
          .bind(userId,d.device_id,personId,pin,format,commandId,t).run();
        jobs.push({deviceId:d.device_id,commandId,status:'PENDING',reused:false});
      }
      return json({success:true,employee:person.display_name,pin,jobs,
        message:'Карточка TEST HR поставлена в очередь на SenseFace 2A и 3A. Ждите ACK Return=0.',
        ...await snapshot(env.DB,userId,scope)});
    }
    if(action==='requestAttendanceLog'){
      const deviceId=clean(b.deviceId);if(!deviceId)return json({success:false,message:'Не указано устройство'},400);
      const d=await device(env.DB,userId,deviceId);if(!d)return json({success:false,message:'Устройство не найдено'},404);
      if(!deviceAllowedForScope(d,scope))return json({success:false,message:'Устройство относится к другому ресторану.'},403);
      if(String(d.connection_mode)!=='ADMS_PUSH')return json({success:false,message:'Запрос ATTLOG доступен только для ADMS PUSH устройств.'},409);
      const zk=await env.DB.prepare(`SELECT * FROM hr_zkteco_adms_devices WHERE user_id=?1 AND device_id=?2 AND enabled=1 LIMIT 1`).bind(userId,deviceId).first();
      if(!zk)return json({success:false,message:'ADMS устройство не зарегистрировано.'},409);
      await env.DB.prepare(`UPDATE hr_zkteco_adms_commands SET status='SUPERSEDED' WHERE user_id=?1 AND device_id=?2 AND status IN ('PENDING','SENT') AND (command_text LIKE 'DATA QUERY ATTLOG%' OR command_text LIKE 'DATA QUERY tablename=transaction%')`).bind(userId,deviceId).run();
      const pushVersion=String(zk.push_version||'');
      const commandText=pushVersion.startsWith('3')
        ? 'DATA QUERY tablename=transaction,fielddesc=*,filter=*'
        : 'DATA QUERY ATTLOG StartTime=2020-01-01 00:00:00\tEndTime=2030-12-31 23:59:59';
      const commandId=await queueAdmsCommand(env.DB,zk,commandText);
      return json({success:true,commandId,commandStatus:'PENDING',message:'Запрос журнала поставлен в очередь. SenseFace получит его при следующем ADMS polling.',...await snapshot(env.DB,userId,scope)});
    }
    if(action==='linkEmployee'){
      const deviceId=clean(b.deviceId),employeeId=clean(b.employeeId),externalId=clean(b.externalEmployeeId),label=clean(b.externalLabel);
      if(!deviceId||!employeeId||!externalId)return json({success:false,message:'Укажите устройство, сотрудника и ID сотрудника на устройстве'},400);
      const d=await device(env.DB,userId,deviceId);if(!d)return json({success:false,message:'Устройство не найдено'},404);if(!deviceAllowedForScope(d,scope))return json({success:false,message:'Устройство относится к другому ресторану.'},403);
      const e=await env.DB.prepare(`SELECT iiko_employee_id,department_code FROM hr_employees WHERE user_id=?1 AND iiko_employee_id=?2 AND TRIM(employee_code)<>'' LIMIT 1`).bind(userId,employeeId).first();if(!e)return json({success:false,message:'Сотрудник не найден. Сначала синхронизируйте справочник.'},404);
      const memberships=await loadEmployeeMemberships(env.DB,userId);
      const memberEmployee=attachEmployeeMemberships([e],memberships)[0];
      if(!employeeAllowedForScope(memberEmployee,scope,d))return json({success:false,message:'Сотрудник не относится к ресторану устройства.'},403);
      const t=now();
      await env.DB.prepare(`INSERT INTO hr_employee_device_bindings(user_id,device_id,iiko_employee_id,provider,external_employee_id,external_label,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?7)
        ON CONFLICT(user_id,device_id,iiko_employee_id) DO UPDATE SET provider=excluded.provider,external_employee_id=excluded.external_employee_id,external_label=excluded.external_label,updated_at=excluded.updated_at`)
        .bind(userId,deviceId,employeeId,d.provider,externalId,label,t).run();
      return json({success:true,ingestPath:'/api/hr/device-ingest',...await snapshot(env.DB,userId,scope)});
    }
    if(action==='unlinkEmployee'){
      const deviceId=clean(b.deviceId),employeeId=clean(b.employeeId);if(!deviceId||!employeeId)return json({success:false,message:'Не указана связь'},400);
      const d=await device(env.DB,userId,deviceId);if(!d)return json({success:false,message:'Устройство не найдено'},404);if(!deviceAllowedForScope(d,scope))return json({success:false,message:'Устройство относится к другому ресторану.'},403);
      const e=await env.DB.prepare(`SELECT iiko_employee_id,department_code FROM hr_employees WHERE user_id=?1 AND iiko_employee_id=?2 LIMIT 1`).bind(userId,employeeId).first();
      const memberships=await loadEmployeeMemberships(env.DB,userId);
      const memberEmployee=attachEmployeeMemberships(e?[e]:[],memberships)[0];
      if(!employeeAllowedForScope(memberEmployee,scope,d))return json({success:false,message:'Связь с сотрудником другого ресторана недоступна.'},403);
      await env.DB.prepare(`DELETE FROM hr_employee_device_bindings WHERE user_id=?1 AND device_id=?2 AND iiko_employee_id=?3`).bind(userId,deviceId,employeeId).run();
      return json({success:true,ingestPath:'/api/hr/device-ingest',...await snapshot(env.DB,userId,scope)});
    }
    if(action==='importEvents'){
      const deviceId=clean(b.deviceId),items=Array.isArray(b.events)?b.events:[];const d=await device(env.DB,userId,deviceId);if(!d)return json({success:false,message:'Устройство не найдено'},404);if(!deviceAllowedForScope(d,scope))return json({success:false,message:'Устройство относится к другому ресторану.'},403);
      if(!items.length)return json({success:false,message:'Нет событий для импорта'},400);
      if(items.length>2000)return json({success:false,message:'За один запрос можно импортировать не более 2000 событий'},400);
      const bindings=await env.DB.prepare(`SELECT b.external_employee_id,b.iiko_employee_id,e.department_code
        FROM hr_employee_device_bindings b
        LEFT JOIN hr_employees e ON e.user_id=b.user_id AND e.iiko_employee_id=b.iiko_employee_id
        WHERE b.user_id=?1 AND b.device_id=?2`).bind(userId,deviceId).all();
      const memberships=await loadEmployeeMemberships(env.DB,userId);
      const map=new Map(attachEmployeeMemberships(bindings.results||[],memberships)
        .filter(x=>employeeAllowedForScope(x,scope,d))
        .map(x=>[String(x.external_employee_id),String(x.iiko_employee_id)]));
      let accepted=0,skipped=0;const t=now(),stm=[];
      for(const raw of items){
        const ext=clean(raw?.externalEmployeeId??raw?.employeeId),time=iso(raw?.timestamp??raw?.eventTime),type=direction(raw?.type??raw?.eventType),source=clean(raw?.sourceId??raw?.id)||`${ext}|${time}|${type}`;
        if(!ext||!time){skipped++;continue}
        const employeeId=map.get(ext)||'';const eventId=uid('evt');
        stm.push(env.DB.prepare(`INSERT OR IGNORE INTO hr_attendance_events(user_id,event_id,device_id,provider,source_uid,external_employee_id,iiko_employee_id,event_time,event_type,raw_payload,imported_at)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`).bind(userId,eventId,deviceId,d.provider,source,ext,employeeId,time,type,JSON.stringify(raw||{}).slice(0,16000),t));accepted++;
      }
      for(let i=0;i<stm.length;i+=50)await env.DB.batch(stm.slice(i,i+50));
      await env.DB.prepare(`UPDATE hr_devices SET last_sync_at=?3,updated_at=?3 WHERE user_id=?1 AND device_id=?2`).bind(userId,deviceId,t).run();
      return json({success:true,imported:accepted,skipped,ingestPath:'/api/hr/device-ingest',...await snapshot(env.DB,userId,scope)});
    }
    return json({success:false,message:'Неизвестное действие'},400);
  }catch(e){console.error('[HR-TIMECLOCK-POST]',e);return json({success:false,message:e?.message||String(e)},e?.status||500)}
}
