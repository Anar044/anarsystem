import { getUser } from '../iiko/_lib/user-state.js';
import { resolveHrRestaurantScope, filterEmployeesByScope, hrScopeKeys, isHrSubsetScope } from './_lib/restaurant-scope.js';
import { ensureZktecoAdmsTables, registerAdmsDevice, unregisterAdmsDevice } from './_lib/zkteco-adms.js';

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
  await ensureZktecoAdmsTables(db);
}

async function auth(request,env){const a=await getUser(request,env);if(!a)return null;await ensure(env.DB);return a}
async function device(db,userId,deviceId){return db.prepare(`SELECT * FROM hr_devices WHERE user_id=?1 AND device_id=?2 LIMIT 1`).bind(userId,deviceId).first()}
function deviceAllowedForScope(row,scope){
  if(!row||!isHrSubsetScope(scope))return Boolean(row);
  const rid=clean(row.restaurant_id);
  if(!rid)return false;
  return (scope.selectedDepartmentIds||[]).map(String).includes(rid);
}

async function snapshot(db,userId,scope=null){
  const [devices,employees,bindings,events,tokens,admsRows,admsRawRows]=await Promise.all([
    db.prepare(`SELECT * FROM hr_devices WHERE user_id=?1 ORDER BY is_active DESC,name COLLATE NOCASE`).bind(userId).all(),
    db.prepare(`SELECT * FROM hr_employees WHERE user_id=?1 AND TRIM(employee_code)<>'' ORDER BY is_deleted,last_name COLLATE NOCASE,first_name COLLATE NOCASE,display_name COLLATE NOCASE`).bind(userId).all(),
    db.prepare(`SELECT * FROM hr_employee_device_bindings WHERE user_id=?1 ORDER BY updated_at DESC`).bind(userId).all(),
    db.prepare(`SELECT e.*,COALESCE(h.display_name,'') AS employee_name,COALESCE(h.employee_code,'') AS employee_code
      FROM hr_attendance_events e LEFT JOIN hr_employees h ON h.user_id=e.user_id AND h.iiko_employee_id=e.iiko_employee_id
      WHERE e.user_id=?1 ORDER BY e.event_time DESC LIMIT 300`).bind(userId).all(),
    db.prepare(`SELECT device_id,last_used_at,rotated_at FROM hr_device_tokens WHERE user_id=?1`).bind(userId).all(),
    db.prepare(`SELECT device_id,serial_number,model,last_seen_at,last_event_at,push_version,firmware,last_ip,last_user_agent FROM hr_zkteco_adms_devices WHERE user_id=?1 AND enabled=1`).bind(userId).all(),
    db.prepare(`SELECT raw_id,device_id,serial_number,table_name,event_time,external_employee_id,event_status,verify_type,work_code,raw_line,received_at FROM hr_zkteco_adms_raw WHERE user_id=?1 ORDER BY received_at DESC LIMIT 200`).bind(userId).all()
  ]);
  const allDevices=devices.results||[],allEmployees=employees.results||[],allBindings=bindings.results||[],allEvents=events.results||[],ts=tokens.results||[],adms=admsRows.results||[],allAdmsRaw=admsRawRows.results||[];
  const selectedRestaurants=new Set(Array.isArray(scope?.selectedDepartmentIds)?scope.selectedDepartmentIds.map(String):[]);
  const subset=isHrSubsetScope(scope);
  const ds=subset?allDevices.filter(x=>selectedRestaurants.has(String(x.restaurant_id))):allDevices;
  const es=filterEmployeesByScope(allEmployees,scope);
  const employeeIds=new Set(es.map(x=>String(x.iiko_employee_id)));
  const bs=subset?allBindings.filter(x=>employeeIds.has(String(x.iiko_employee_id))):allBindings;
  const selectedDeviceIds=new Set(ds.map(x=>String(x.device_id)));
  const ev=subset?allEvents.filter(x=>selectedDeviceIds.has(String(x.device_id))||(x.iiko_employee_id&&employeeIds.has(String(x.iiko_employee_id)))):allEvents;
  const tokenMap=new Map(ts.map(x=>[String(x.device_id),x])),admsMap=new Map(adms.map(x=>[String(x.device_id),x])),nowMs=Date.now();
  return{
    restaurantScope:scope?{mode:scope.mode,departmentIds:scope.selectedDepartmentIds,departmentCodes:scope.selectedDepartmentCodes,deviceScope:subset?'SCOPED_BY_RESTAURANT':'ALL'}:null,
    adms:{basePath:'/iclock',directPush:true,offlineBuffering:'DEVICE_LOCAL_MEMORY'},
    devices:ds.map(x=>{const token=tokenMap.get(String(x.device_id)),zk=admsMap.get(String(x.device_id)),seen=zk?.last_seen_at?new Date(zk.last_seen_at).getTime():0;return{id:x.device_id,provider:x.provider,name:x.name,restaurantId:x.restaurant_id||'',location:x.location,connectionMode:x.connection_mode,timezone:x.timezone,active:Boolean(x.is_active),lastSyncAt:x.last_sync_at||'',tokenConfigured:Boolean(token),tokenLastUsedAt:token?.last_used_at||'',tokenRotatedAt:token?.rotated_at||'',serialNumber:zk?.serial_number||'',model:zk?.model||'',admsLastSeenAt:zk?.last_seen_at||'',admsLastEventAt:zk?.last_event_at||'',pushVersion:zk?.push_version||'',firmware:zk?.firmware||'',lastIp:zk?.last_ip||'',admsOnline:Boolean(seen&&nowMs-seen<5*60*1000)}}),
    employees:es.map(x=>({id:x.iiko_employee_id,code:x.employee_code,name:x.display_name,firstName:x.first_name,lastName:x.last_name,roleName:x.role_name,departmentCode:x.department_code,deleted:Boolean(x.is_deleted),fireDate:x.fire_date||''})),
    bindings:bs.map(x=>({deviceId:x.device_id,employeeId:x.iiko_employee_id,provider:x.provider,externalEmployeeId:x.external_employee_id,externalLabel:x.external_label||''})),
    events:ev.map(x=>({id:x.event_id,deviceId:x.device_id,provider:x.provider,sourceUid:x.source_uid,externalEmployeeId:x.external_employee_id,employeeId:x.iiko_employee_id,employeeName:x.employee_name||'',employeeCode:x.employee_code||'',eventTime:x.event_time,eventType:x.event_type,importedAt:x.imported_at})),
    rawAdms:(subset?allAdmsRaw.filter(x=>selectedDeviceIds.has(String(x.device_id))):allAdmsRaw).map(x=>({id:x.raw_id,deviceId:x.device_id,serialNumber:x.serial_number,tableName:x.table_name,eventTime:x.event_time||'',externalEmployeeId:x.external_employee_id||'',status:x.event_status||'',verifyType:x.verify_type||'',workCode:x.work_code||'',rawLine:x.raw_line||'',receivedAt:x.received_at||''})),
    counts:{devices:ds.filter(x=>x.is_active).length,admsDevices:ds.filter(x=>admsMap.has(String(x.device_id))).length,admsOnline:ds.filter(x=>{const z=admsMap.get(String(x.device_id)),seen=z?.last_seen_at?new Date(z.last_seen_at).getTime():0;return Boolean(seen&&nowMs-seen<5*60*1000)}).length,unassignedDevices:ds.filter(x=>!clean(x.restaurant_id)).length,employees:es.filter(x=>!x.is_deleted&&!x.fire_date).length,bindings:bs.length,events:ev.length,unmatchedEvents:ev.filter(x=>!x.iiko_employee_id).length,deviceTokens:ts.filter(x=>ds.some(d=>String(d.device_id)===String(x.device_id))).length,rawAdms:(subset?allAdmsRaw.filter(x=>selectedDeviceIds.has(String(x.device_id))):allAdmsRaw).length}
  };
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{const a=await auth(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);const scope=await resolveHrRestaurantScope(request,env,a.user.id);return json({success:true,attendanceSource:'EXTERNAL_DEVICE',payrollEngine:'SMART_HORECA',ingestPath:'/api/hr/device-ingest',admsPath:'/iclock',...(await snapshot(env.DB,a.user.id,scope))})}
  catch(e){console.error('[HR-TIMECLOCK-GET]',e);return json({success:false,message:e?.message||String(e)},500)}
}

export async function onRequestPost({request,env}){
  try{
    const a=await auth(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);
    const b=await request.json().catch(()=>({}));const action=clean(b.action);const userId=a.user.id;
    const scope=await resolveHrRestaurantScope(request,env,userId);
    if(action==='saveDevice'){
      const id=clean(b.id)||uid('dev'),provider=(clean(b.provider)||'ZKTECO').toUpperCase(),name=clean(b.name),location=clean(b.location),mode=clean(b.connectionMode)||'ADMS_PUSH',timezone=clean(b.timezone)||'Asia/Baku',serialNumber=clean(b.serialNumber).toUpperCase(),model=clean(b.model)||'SenseFace 2A';
      if(!name)return json({success:false,message:'Укажите название устройства'},400);
      if(mode==='ADMS_PUSH'&&!serialNumber)return json({success:false,message:'Для прямого ZKTeco ADMS укажите серийный номер аппарата.'},400);
      const selectedRestaurants=Array.isArray(scope?.selectedDepartmentIds)?scope.selectedDepartmentIds.map(String).filter(Boolean):[];
      if(scope?.isChain&&selectedRestaurants.length!==1)return json({success:false,code:'HR_DEVICE_SINGLE_RESTAURANT_REQUIRED',message:'Для устройства Face ID в CHAIN выберите ровно один ресторан.'},409);
      const restaurantId=selectedRestaurants[0]||'';
      const existingDevice=clean(b.id)?await device(env.DB,userId,id):null;
      if(existingDevice&&!deviceAllowedForScope(existingDevice,scope))return json({success:false,message:'Устройство относится к другому ресторану.'},403);
      const t=now();await env.DB.prepare(`INSERT INTO hr_devices(user_id,device_id,provider,name,restaurant_id,location,connection_mode,timezone,is_active,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,1,?9,?9)
        ON CONFLICT(user_id,device_id) DO UPDATE SET provider=excluded.provider,name=excluded.name,restaurant_id=excluded.restaurant_id,location=excluded.location,connection_mode=excluded.connection_mode,timezone=excluded.timezone,updated_at=excluded.updated_at`)
        .bind(userId,id,provider,name,restaurantId,location,mode,timezone,t).run();
      if(mode==='ADMS_PUSH')await registerAdmsDevice(env.DB,{userId,deviceId:id,serialNumber,model});
      else await unregisterAdmsDevice(env.DB,userId,id);
      return json({success:true,deviceId:id,ingestPath:'/api/hr/device-ingest',admsPath:'/iclock',...await snapshot(env.DB,userId,scope)});
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
    if(action==='linkEmployee'){
      const deviceId=clean(b.deviceId),employeeId=clean(b.employeeId),externalId=clean(b.externalEmployeeId),label=clean(b.externalLabel);
      if(!deviceId||!employeeId||!externalId)return json({success:false,message:'Укажите устройство, сотрудника и ID сотрудника на устройстве'},400);
      const d=await device(env.DB,userId,deviceId);if(!d)return json({success:false,message:'Устройство не найдено'},404);if(!deviceAllowedForScope(d,scope))return json({success:false,message:'Устройство относится к другому ресторану.'},403);
      const e=await env.DB.prepare(`SELECT iiko_employee_id,department_code FROM hr_employees WHERE user_id=?1 AND iiko_employee_id=?2 AND TRIM(employee_code)<>'' LIMIT 1`).bind(userId,employeeId).first();if(!e)return json({success:false,message:'Сотрудник не найден. Сначала синхронизируйте справочник.'},404);
      if(isHrSubsetScope(scope)&&!new Set(hrScopeKeys(scope)).has(clean(e.department_code)))return json({success:false,message:'Сотрудник не относится к выбранному подразделению.'},403);
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
      await env.DB.prepare(`DELETE FROM hr_employee_device_bindings WHERE user_id=?1 AND device_id=?2 AND iiko_employee_id=?3`).bind(userId,deviceId,employeeId).run();
      return json({success:true,ingestPath:'/api/hr/device-ingest',...await snapshot(env.DB,userId,scope)});
    }
    if(action==='importEvents'){
      const deviceId=clean(b.deviceId),items=Array.isArray(b.events)?b.events:[];const d=await device(env.DB,userId,deviceId);if(!d)return json({success:false,message:'Устройство не найдено'},404);if(!deviceAllowedForScope(d,scope))return json({success:false,message:'Устройство относится к другому ресторану.'},403);
      if(!items.length)return json({success:false,message:'Нет событий для импорта'},400);
      if(items.length>2000)return json({success:false,message:'За один запрос можно импортировать не более 2000 событий'},400);
      const bindings=await env.DB.prepare(`SELECT external_employee_id,iiko_employee_id FROM hr_employee_device_bindings WHERE user_id=?1 AND device_id=?2`).bind(userId,deviceId).all();
      const map=new Map((bindings.results||[]).map(x=>[String(x.external_employee_id),String(x.iiko_employee_id)]));
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
  }catch(e){console.error('[HR-TIMECLOCK-POST]',e);return json({success:false,message:e?.message||String(e)},500)}
}
