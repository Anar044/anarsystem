import { getUser } from '../iiko/_lib/user-state.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function now(){return new Date().toISOString()}
function uid(prefix='id'){return `${prefix}_${crypto.randomUUID()}`}
function direction(v){const s=clean(v).toUpperCase();if(['IN','ENTRY','CHECKIN','0'].includes(s))return'IN';if(['OUT','EXIT','CHECKOUT','1'].includes(s))return'OUT';return'UNKNOWN'}
function iso(v){const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toISOString()}
async function sha256(value){const bytes=new TextEncoder().encode(String(value||''));const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('')}
function randomDeviceToken(){const bytes=crypto.getRandomValues(new Uint8Array(32));let binary='';for(const b of bytes)binary+=String.fromCharCode(b);return `shd_${btoa(binary).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')}`}
function connectorState(value){
  if(!value)return{status:'OFFLINE',label:'Нет связи',ageSeconds:null};
  const ms=Date.parse(value);if(!Number.isFinite(ms))return{status:'OFFLINE',label:'Нет связи',ageSeconds:null};
  const age=Math.max(0,Math.floor((Date.now()-ms)/1000));
  if(age<=90)return{status:'ONLINE',label:'Connector online',ageSeconds:age};
  if(age<=600)return{status:'STALE',label:'Связь устарела',ageSeconds:age};
  return{status:'OFFLINE',label:'Нет связи',ageSeconds:age};
}

async function ensureColumn(db,table,column,definition){
  const info=await db.prepare(`PRAGMA table_info(${table})`).all();
  if((info.results||[]).some(x=>String(x.name)===column))return;
  await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`).run();
}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employees (
      user_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,employee_code TEXT NOT NULL DEFAULT '',first_name TEXT NOT NULL DEFAULT '',middle_name TEXT NOT NULL DEFAULT '',last_name TEXT NOT NULL DEFAULT '',display_name TEXT NOT NULL DEFAULT '',role_code TEXT NOT NULL DEFAULT '',role_name TEXT NOT NULL DEFAULT '',department_code TEXT NOT NULL DEFAULT '',hire_date TEXT NOT NULL DEFAULT '',fire_date TEXT NOT NULL DEFAULT '',is_deleted INTEGER NOT NULL DEFAULT 0,synced_at TEXT NOT NULL,PRIMARY KEY(user_id,iiko_employee_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_devices (
      user_id TEXT NOT NULL,device_id TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'ZKTECO',name TEXT NOT NULL,location TEXT NOT NULL DEFAULT '',connection_mode TEXT NOT NULL DEFAULT 'LOCAL_CONNECTOR',timezone TEXT NOT NULL DEFAULT 'Asia/Baku',is_active INTEGER NOT NULL DEFAULT 1,last_sync_at TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,device_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_devices_user ON hr_devices(user_id,is_active,name)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_device_bindings (
      user_id TEXT NOT NULL,device_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'ZKTECO',external_employee_id TEXT NOT NULL,external_label TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,device_id,iiko_employee_id),UNIQUE(user_id,device_id,external_employee_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_bindings_employee ON hr_employee_device_bindings(user_id,iiko_employee_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_attendance_events (
      user_id TEXT NOT NULL,event_id TEXT NOT NULL,device_id TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'ZKTECO',source_uid TEXT NOT NULL,external_employee_id TEXT NOT NULL DEFAULT '',iiko_employee_id TEXT NOT NULL DEFAULT '',event_time TEXT NOT NULL,event_type TEXT NOT NULL DEFAULT 'UNKNOWN',raw_payload TEXT NOT NULL DEFAULT '{}',imported_at TEXT NOT NULL,PRIMARY KEY(user_id,event_id),UNIQUE(user_id,device_id,source_uid)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_events_time ON hr_attendance_events(user_id,event_time DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_events_employee ON hr_attendance_events(user_id,iiko_employee_id,event_time DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_device_tokens (
      user_id TEXT NOT NULL,device_id TEXT NOT NULL,token_hash TEXT NOT NULL,created_at TEXT NOT NULL,rotated_at TEXT NOT NULL,last_used_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(user_id,device_id),UNIQUE(token_hash)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_device_tokens_hash ON hr_device_tokens(token_hash)`)
  ]);
  await ensureColumn(db,'hr_devices','model',"TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db,'hr_devices','connector_adapter',"TEXT NOT NULL DEFAULT 'TA_PUSH'");
  await ensureColumn(db,'hr_devices','ip_address',"TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db,'hr_devices','port',"INTEGER NOT NULL DEFAULT 4370");
  await ensureColumn(db,'hr_devices','serial_number',"TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db,'hr_devices','last_connector_at',"TEXT NOT NULL DEFAULT ''");
}

async function auth(request,env){const a=await getUser(request,env);if(!a)return null;await ensure(env.DB);return a}
async function device(db,userId,deviceId){return db.prepare(`SELECT * FROM hr_devices WHERE user_id=?1 AND device_id=?2 LIMIT 1`).bind(userId,deviceId).first()}

async function snapshot(db,userId){
  const [devices,employees,bindings,events,tokens]=await Promise.all([
    db.prepare(`SELECT * FROM hr_devices WHERE user_id=?1 ORDER BY is_active DESC,name COLLATE NOCASE`).bind(userId).all(),
    db.prepare(`SELECT * FROM hr_employees WHERE user_id=?1 AND TRIM(employee_code)<>'' ORDER BY is_deleted,last_name COLLATE NOCASE,first_name COLLATE NOCASE,display_name COLLATE NOCASE`).bind(userId).all(),
    db.prepare(`SELECT * FROM hr_employee_device_bindings WHERE user_id=?1 ORDER BY updated_at DESC`).bind(userId).all(),
    db.prepare(`SELECT e.*,COALESCE(h.display_name,'') AS employee_name,COALESCE(h.employee_code,'') AS employee_code
      FROM hr_attendance_events e LEFT JOIN hr_employees h ON h.user_id=e.user_id AND h.iiko_employee_id=e.iiko_employee_id
      WHERE e.user_id=?1 ORDER BY e.event_time DESC LIMIT 300`).bind(userId).all(),
    db.prepare(`SELECT device_id,last_used_at,rotated_at FROM hr_device_tokens WHERE user_id=?1`).bind(userId).all()
  ]);
  const ds=devices.results||[],es=employees.results||[],bs=bindings.results||[],ev=events.results||[],ts=tokens.results||[];
  const tokenMap=new Map(ts.map(x=>[String(x.device_id),x]));
  return{
    devices:ds.map(x=>{const token=tokenMap.get(String(x.device_id)),state=connectorState(x.last_connector_at);return{
      id:x.device_id,provider:x.provider,name:x.name,location:x.location,connectionMode:x.connection_mode,timezone:x.timezone,
      model:x.model||'',adapter:x.connector_adapter||'TA_PUSH',ipAddress:x.ip_address||'',port:Number(x.port||4370),serialNumber:x.serial_number||'',
      active:Boolean(x.is_active),lastSyncAt:x.last_sync_at||'',connectorLastSeenAt:x.last_connector_at||'',connectorStatus:state.status,connectorStatusLabel:state.label,connectorAgeSeconds:state.ageSeconds,
      tokenConfigured:Boolean(token),tokenLastUsedAt:token?.last_used_at||'',tokenRotatedAt:token?.rotated_at||''
    }}),
    employees:es.map(x=>({id:x.iiko_employee_id,code:x.employee_code,name:x.display_name,firstName:x.first_name,lastName:x.last_name,roleName:x.role_name,departmentCode:x.department_code,deleted:Boolean(x.is_deleted),fireDate:x.fire_date||''})),
    bindings:bs.map(x=>({deviceId:x.device_id,employeeId:x.iiko_employee_id,provider:x.provider,externalEmployeeId:x.external_employee_id,externalLabel:x.external_label||''})),
    events:ev.map(x=>({id:x.event_id,deviceId:x.device_id,provider:x.provider,sourceUid:x.source_uid,externalEmployeeId:x.external_employee_id,employeeId:x.iiko_employee_id,employeeName:x.employee_name||'',employeeCode:x.employee_code||'',eventTime:x.event_time,eventType:x.event_type,importedAt:x.imported_at})),
    counts:{devices:ds.filter(x=>x.is_active).length,onlineConnectors:ds.filter(x=>connectorState(x.last_connector_at).status==='ONLINE').length,employees:es.filter(x=>!x.is_deleted&&!x.fire_date).length,bindings:bs.length,events:ev.length,unmatchedEvents:ev.filter(x=>!x.iiko_employee_id).length,deviceTokens:ts.length}
  };
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{const a=await auth(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);return json({success:true,attendanceSource:'EXTERNAL_DEVICE',payrollEngine:'SMART_HORECA',ingestPath:'/api/hr/device-ingest',connectorHeartbeatSeconds:30,...(await snapshot(env.DB,a.user.id))})}
  catch(e){console.error('[HR-TIMECLOCK-GET]',e);return json({success:false,message:e?.message||String(e)},500)}
}

export async function onRequestPost({request,env}){
  try{
    const a=await auth(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);
    const b=await request.json().catch(()=>({}));const action=clean(b.action);const userId=a.user.id;
    if(action==='saveDevice'){
      const id=clean(b.id)||uid('dev'),provider=(clean(b.provider)||'ZKTECO').toUpperCase(),name=clean(b.name),location=clean(b.location),mode=clean(b.connectionMode)||'LOCAL_CONNECTOR',timezone=clean(b.timezone)||'Asia/Baku';
      const model=clean(b.model),adapter=(clean(b.adapter)||'TA_PUSH').toUpperCase(),ipAddress=clean(b.ipAddress),serialNumber=clean(b.serialNumber);const port=Number(b.port||4370);
      if(!name)return json({success:false,message:'Укажите название устройства'},400);
      if(!['TA_PUSH','ZKEMKEEPER'].includes(adapter))return json({success:false,message:'Неподдерживаемый режим connector'},400);
      if(!Number.isInteger(port)||port<1||port>65535)return json({success:false,message:'Порт должен быть от 1 до 65535'},400);
      if(adapter==='TA_PUSH'&&!serialNumber)return json({success:false,message:'Для TA Push укажите Serial Number терминала'},400);
      if(adapter==='ZKEMKEEPER'&&!ipAddress)return json({success:false,message:'Для ZKEMKEEPER укажите IP терминала'},400);
      const t=now();await env.DB.prepare(`INSERT INTO hr_devices(user_id,device_id,provider,name,location,connection_mode,timezone,is_active,last_sync_at,created_at,updated_at,model,connector_adapter,ip_address,port,serial_number,last_connector_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,1,'',?8,?8,?9,?10,?11,?12,?13,'')
        ON CONFLICT(user_id,device_id) DO UPDATE SET provider=excluded.provider,name=excluded.name,location=excluded.location,connection_mode=excluded.connection_mode,timezone=excluded.timezone,model=excluded.model,connector_adapter=excluded.connector_adapter,ip_address=excluded.ip_address,port=excluded.port,serial_number=excluded.serial_number,updated_at=excluded.updated_at`)
        .bind(userId,id,provider,name,location,mode,timezone,t,model,adapter,ipAddress,port,serialNumber).run();
      return json({success:true,deviceId:id,ingestPath:'/api/hr/device-ingest',...await snapshot(env.DB,userId)});
    }
    if(action==='setDeviceActive'){
      const deviceId=clean(b.deviceId),active=b.active?1:0;if(!deviceId)return json({success:false,message:'Не указано устройство'},400);
      await env.DB.prepare(`UPDATE hr_devices SET is_active=?3,updated_at=?4 WHERE user_id=?1 AND device_id=?2`).bind(userId,deviceId,active,now()).run();
      return json({success:true,deviceId,...await snapshot(env.DB,userId)});
    }
    if(action==='checkConnector'){
      const deviceId=clean(b.deviceId);if(!deviceId)return json({success:false,message:'Не указано устройство'},400);
      const d=await device(env.DB,userId,deviceId);if(!d)return json({success:false,message:'Устройство не найдено'},404);
      const state=connectorState(d.last_connector_at);
      return json({success:true,deviceId,connectorStatus:state.status,connectorStatusLabel:state.label,connectorLastSeenAt:d.last_connector_at||'',connectorAgeSeconds:state.ageSeconds,...await snapshot(env.DB,userId)});
    }
    if(action==='rotateDeviceToken'){
      const deviceId=clean(b.deviceId);if(!deviceId)return json({success:false,message:'Не указано устройство'},400);
      const d=await device(env.DB,userId,deviceId);if(!d)return json({success:false,message:'Устройство не найдено'},404);
      const token=randomDeviceToken(),hash=await sha256(token),t=now();
      await env.DB.prepare(`INSERT INTO hr_device_tokens(user_id,device_id,token_hash,created_at,rotated_at,last_used_at)
        VALUES(?1,?2,?3,?4,?4,'') ON CONFLICT(user_id,device_id) DO UPDATE SET token_hash=excluded.token_hash,rotated_at=excluded.rotated_at,last_used_at=''`)
        .bind(userId,deviceId,hash,t).run();
      return json({success:true,deviceId,deviceToken:token,ingestPath:'/api/hr/device-ingest',...await snapshot(env.DB,userId)});
    }
    if(action==='revokeDeviceToken'){
      const deviceId=clean(b.deviceId);if(!deviceId)return json({success:false,message:'Не указано устройство'},400);
      await env.DB.prepare(`DELETE FROM hr_device_tokens WHERE user_id=?1 AND device_id=?2`).bind(userId,deviceId).run();
      return json({success:true,deviceId,ingestPath:'/api/hr/device-ingest',...await snapshot(env.DB,userId)});
    }
    if(action==='linkEmployee'){
      const deviceId=clean(b.deviceId),employeeId=clean(b.employeeId),externalId=clean(b.externalEmployeeId),label=clean(b.externalLabel);
      if(!deviceId||!employeeId||!externalId)return json({success:false,message:'Укажите устройство, сотрудника и ID сотрудника на устройстве'},400);
      const d=await device(env.DB,userId,deviceId);if(!d)return json({success:false,message:'Устройство не найдено'},404);
      const e=await env.DB.prepare(`SELECT iiko_employee_id FROM hr_employees WHERE user_id=?1 AND iiko_employee_id=?2 AND TRIM(employee_code)<>'' LIMIT 1`).bind(userId,employeeId).first();if(!e)return json({success:false,message:'Сотрудник не найден. Сначала синхронизируйте справочник.'},404);
      const t=now();
      await env.DB.prepare(`INSERT INTO hr_employee_device_bindings(user_id,device_id,iiko_employee_id,provider,external_employee_id,external_label,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?7)
        ON CONFLICT(user_id,device_id,iiko_employee_id) DO UPDATE SET provider=excluded.provider,external_employee_id=excluded.external_employee_id,external_label=excluded.external_label,updated_at=excluded.updated_at`)
        .bind(userId,deviceId,employeeId,d.provider,externalId,label,t).run();
      return json({success:true,ingestPath:'/api/hr/device-ingest',...await snapshot(env.DB,userId)});
    }
    if(action==='unlinkEmployee'){
      const deviceId=clean(b.deviceId),employeeId=clean(b.employeeId);if(!deviceId||!employeeId)return json({success:false,message:'Не указана связь'},400);
      await env.DB.prepare(`DELETE FROM hr_employee_device_bindings WHERE user_id=?1 AND device_id=?2 AND iiko_employee_id=?3`).bind(userId,deviceId,employeeId).run();
      return json({success:true,ingestPath:'/api/hr/device-ingest',...await snapshot(env.DB,userId)});
    }
    if(action==='importEvents'){
      const deviceId=clean(b.deviceId),items=Array.isArray(b.events)?b.events:[];const d=await device(env.DB,userId,deviceId);if(!d)return json({success:false,message:'Устройство не найдено'},404);
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
      return json({success:true,imported:accepted,skipped,ingestPath:'/api/hr/device-ingest',...await snapshot(env.DB,userId)});
    }
    return json({success:false,message:'Неизвестное действие'},400);
  }catch(e){console.error('[HR-TIMECLOCK-POST]',e);return json({success:false,message:e?.message||String(e)},500)}
}
