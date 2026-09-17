function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'}})}
function clean(v){return String(v??'').trim()}
function now(){return new Date().toISOString()}
async function sha256(value){const bytes=new TextEncoder().encode(String(value||''));const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('')}
function suppliedToken(request){const auth=request.headers.get('Authorization')||'';if(/^Bearer\s+/i.test(auth))return auth.replace(/^Bearer\s+/i,'').trim();return clean(request.headers.get('X-SH-Device-Token'))}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_devices (
      user_id TEXT NOT NULL,device_id TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'ZKTECO',name TEXT NOT NULL,location TEXT NOT NULL DEFAULT '',connection_mode TEXT NOT NULL DEFAULT 'LOCAL_CONNECTOR',timezone TEXT NOT NULL DEFAULT 'Asia/Baku',is_active INTEGER NOT NULL DEFAULT 1,last_sync_at TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,device_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_device_tokens (
      user_id TEXT NOT NULL,device_id TEXT NOT NULL,token_hash TEXT NOT NULL,created_at TEXT NOT NULL,rotated_at TEXT NOT NULL,last_used_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(user_id,device_id),UNIQUE(token_hash)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_device_heartbeats (
      user_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      connector_version TEXT NOT NULL DEFAULT '',
      serial_number TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      port INTEGER NOT NULL DEFAULT 0,
      protocol TEXT NOT NULL DEFAULT '',
      queue_size INTEGER NOT NULL DEFAULT 0,
      terminal_last_seen_at TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL,
      raw_payload TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY(user_id,device_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_device_heartbeats_seen ON hr_device_heartbeats(user_id,last_seen_at DESC)`)
  ]);
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, X-SH-Device-Token'}})}

export async function onRequestPost({request,env}){
  try{
    await ensure(env.DB);
    const token=suppliedToken(request);if(!token)return json({success:false,message:'Не указан device token'},401);
    const tokenHash=await sha256(token);
    const row=await env.DB.prepare(`SELECT t.user_id,t.device_id,d.name,d.is_active FROM hr_device_tokens t JOIN hr_devices d ON d.user_id=t.user_id AND d.device_id=t.device_id WHERE t.token_hash=?1 LIMIT 1`).bind(tokenHash).first();
    if(!row)return json({success:false,message:'Неверный device token'},401);
    if(!Number(row.is_active))return json({success:false,message:'Устройство отключено'},403);
    const body=await request.json().catch(()=>({}));
    const t=now();
    const connectorVersion=clean(body.connectorVersion).slice(0,80);
    const serial=clean(body.serial).slice(0,120);
    const model=clean(body.model).slice(0,120);
    const ip=clean(body.ipAddress||body.ip).slice(0,120);
    const port=Math.max(0,Math.min(65535,Number(body.port)||0));
    const protocol=clean(body.protocol).slice(0,80);
    const queueSize=Math.max(0,Math.min(500000,Number(body.queueSize)||0));
    const terminalLastSeen=clean(body.terminalLastSeenAt).slice(0,80);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO hr_device_heartbeats(user_id,device_id,connector_version,serial_number,model,ip_address,port,protocol,queue_size,terminal_last_seen_at,last_seen_at,raw_payload)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)
        ON CONFLICT(user_id,device_id) DO UPDATE SET connector_version=excluded.connector_version,serial_number=excluded.serial_number,model=excluded.model,ip_address=excluded.ip_address,port=excluded.port,protocol=excluded.protocol,queue_size=excluded.queue_size,terminal_last_seen_at=excluded.terminal_last_seen_at,last_seen_at=excluded.last_seen_at,raw_payload=excluded.raw_payload`)
        .bind(row.user_id,row.device_id,connectorVersion,serial,model,ip,port,protocol,queueSize,terminalLastSeen,t,JSON.stringify(body||{}).slice(0,16000)),
      env.DB.prepare(`UPDATE hr_device_tokens SET last_used_at=?3 WHERE user_id=?1 AND device_id=?2`).bind(row.user_id,row.device_id,t)
    ]);
    return json({success:true,deviceId:row.device_id,deviceName:row.name,receivedAt:t});
  }catch(error){console.error('[HR-DEVICE-HEARTBEAT]',error);return json({success:false,message:error?.message||String(error)},500)}
}
