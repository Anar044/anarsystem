function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
function clean(v){return String(v??'').trim()}
function now(){return new Date().toISOString()}
function uid(prefix='id'){return `${prefix}_${crypto.randomUUID()}`}
function direction(v){const s=clean(v).toUpperCase();if(['IN','ENTRY','CHECKIN','0'].includes(s))return'IN';if(['OUT','EXIT','CHECKOUT','1'].includes(s))return'OUT';return'UNKNOWN'}
function iso(v){const d=new Date(v);return Number.isNaN(d.getTime())?'':d.toISOString()}
async function sha256(value){const bytes=new TextEncoder().encode(String(value||''));const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('')}
function suppliedToken(request){const auth=request.headers.get('Authorization')||'';if(/^Bearer\s+/i.test(auth))return auth.replace(/^Bearer\s+/i,'').trim();return clean(request.headers.get('X-SH-Device-Token'))}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_devices (
      user_id TEXT NOT NULL,device_id TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'ZKTECO',name TEXT NOT NULL,location TEXT NOT NULL DEFAULT '',connection_mode TEXT NOT NULL DEFAULT 'LOCAL_CONNECTOR',timezone TEXT NOT NULL DEFAULT 'Asia/Baku',is_active INTEGER NOT NULL DEFAULT 1,last_sync_at TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,device_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_device_bindings (
      user_id TEXT NOT NULL,device_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'ZKTECO',external_employee_id TEXT NOT NULL,external_label TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,device_id,iiko_employee_id),UNIQUE(user_id,device_id,external_employee_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_attendance_events (
      user_id TEXT NOT NULL,event_id TEXT NOT NULL,device_id TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'ZKTECO',source_uid TEXT NOT NULL,external_employee_id TEXT NOT NULL DEFAULT '',iiko_employee_id TEXT NOT NULL DEFAULT '',event_time TEXT NOT NULL,event_type TEXT NOT NULL DEFAULT 'UNKNOWN',raw_payload TEXT NOT NULL DEFAULT '{}',imported_at TEXT NOT NULL,PRIMARY KEY(user_id,event_id),UNIQUE(user_id,device_id,source_uid)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_events_time ON hr_attendance_events(user_id,event_time DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_device_tokens (
      user_id TEXT NOT NULL,device_id TEXT NOT NULL,token_hash TEXT NOT NULL,created_at TEXT NOT NULL,rotated_at TEXT NOT NULL,last_used_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(user_id,device_id),UNIQUE(token_hash)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_device_tokens_hash ON hr_device_tokens(token_hash)`)
  ]);
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, X-SH-Device-Token'}})}

export async function onRequestPost({request,env}){
  try{
    await ensure(env.DB);
    const token=suppliedToken(request);if(!token)return json({success:false,message:'Не указан device token'},401);
    const tokenHash=await sha256(token);
    const row=await env.DB.prepare(`SELECT t.user_id,t.device_id,d.provider,d.name,d.is_active
      FROM hr_device_tokens t JOIN hr_devices d ON d.user_id=t.user_id AND d.device_id=t.device_id
      WHERE t.token_hash=?1 LIMIT 1`).bind(tokenHash).first();
    if(!row)return json({success:false,message:'Неверный device token'},401);
    if(!Number(row.is_active))return json({success:false,message:'Устройство отключено'},403);

    const body=await request.json().catch(()=>({}));
    const items=Array.isArray(body?.events)?body.events:Array.isArray(body)?body:[];
    if(!items.length)return json({success:false,message:'Нет событий для импорта'},400);
    if(items.length>2000)return json({success:false,message:'За один запрос можно импортировать не более 2000 событий'},400);

    const bindings=await env.DB.prepare(`SELECT external_employee_id,iiko_employee_id FROM hr_employee_device_bindings WHERE user_id=?1 AND device_id=?2`).bind(row.user_id,row.device_id).all();
    const map=new Map((bindings.results||[]).map(x=>[String(x.external_employee_id),String(x.iiko_employee_id)]));
    const importedAt=now();let accepted=0,invalid=0,matched=0,unmatched=0;const statements=[];
    for(const raw of items){
      const ext=clean(raw?.externalEmployeeId??raw?.employeeId??raw?.userId);
      const time=iso(raw?.timestamp??raw?.eventTime??raw?.time);
      const type=direction(raw?.type??raw?.eventType??raw?.direction);
      const source=clean(raw?.sourceId??raw?.id??raw?.uid)||`${ext}|${time}|${type}`;
      if(!ext||!time){invalid++;continue}
      const employeeId=map.get(ext)||'';if(employeeId)matched++;else unmatched++;
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO hr_attendance_events(user_id,event_id,device_id,provider,source_uid,external_employee_id,iiko_employee_id,event_time,event_type,raw_payload,imported_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
        .bind(row.user_id,uid('evt'),row.device_id,row.provider,source,ext,employeeId,time,type,JSON.stringify(raw||{}).slice(0,16000),importedAt));
      accepted++;
    }
    for(let i=0;i<statements.length;i+=50)await env.DB.batch(statements.slice(i,i+50));
    await env.DB.batch([
      env.DB.prepare(`UPDATE hr_devices SET last_sync_at=?3,updated_at=?3 WHERE user_id=?1 AND device_id=?2`).bind(row.user_id,row.device_id,importedAt),
      env.DB.prepare(`UPDATE hr_device_tokens SET last_used_at=?3 WHERE user_id=?1 AND device_id=?2`).bind(row.user_id,row.device_id,importedAt)
    ]);
    return json({success:true,deviceId:row.device_id,deviceName:row.name,received:items.length,accepted,invalid,matched,unmatched,receivedAt:importedAt});
  }catch(error){console.error('[HR-DEVICE-INGEST]',error);return json({success:false,message:error?.message||String(error)},500)}
}
