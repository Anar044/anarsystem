import { getUser } from '../iiko/_lib/user-state.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function now(){return new Date().toISOString()}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.exec(`CREATE TABLE IF NOT EXISTS hr_zkteco_device_meta (
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    model TEXT NOT NULL DEFAULT '',
    serial_number TEXT NOT NULL DEFAULT '',
    protocol_mode TEXT NOT NULL DEFAULT 'PUSH_ADMS',
    connector_port INTEGER NOT NULL DEFAULT 8088,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id,device_id)
  )`);
  await db.exec(`CREATE INDEX IF NOT EXISTS idx_hr_zkteco_meta_serial ON hr_zkteco_device_meta(user_id,serial_number)`);
}

async function auth(request,env){const a=await getUser(request,env);if(!a)return null;await ensure(env.DB);return a}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{
    const a=await auth(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);
    const rows=await env.DB.prepare(`SELECT device_id,model,serial_number,protocol_mode,connector_port,updated_at FROM hr_zkteco_device_meta WHERE user_id=?1 ORDER BY updated_at DESC`).bind(a.user.id).all();
    return json({success:true,items:(rows.results||[]).map(x=>({deviceId:x.device_id,model:x.model||'',serialNumber:x.serial_number||'',protocolMode:x.protocol_mode||'PUSH_ADMS',connectorPort:Number(x.connector_port||8088),updatedAt:x.updated_at||''}))});
  }catch(e){console.error('[HR-ZK-META-GET]',e);return json({success:false,message:e?.message||String(e)},500)}
}

export async function onRequestPost({request,env}){
  try{
    const a=await auth(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);
    const b=await request.json().catch(()=>({}));
    const action=clean(b.action);
    if(action!=='saveMetadata')return json({success:false,message:'Неизвестное действие'},400);
    const deviceId=clean(b.deviceId),model=clean(b.model),serialNumber=clean(b.serialNumber),protocolMode=(clean(b.protocolMode)||'PUSH_ADMS').toUpperCase(),connectorPort=Number(b.connectorPort||8088);
    if(!deviceId)return json({success:false,message:'Не указано устройство'},400);
    if(!model)return json({success:false,message:'Укажите модель ZKTeco'},400);
    if(!serialNumber)return json({success:false,message:'Укажите Serial Number устройства'},400);
    if(serialNumber.length>128)return json({success:false,message:'Serial Number слишком длинный'},400);
    if(!Number.isInteger(connectorPort)||connectorPort<1||connectorPort>65535)return json({success:false,message:'Некорректный порт connector'},400);
    const device=await env.DB.prepare(`SELECT device_id,provider FROM hr_devices WHERE user_id=?1 AND device_id=?2 LIMIT 1`).bind(a.user.id,deviceId).first();
    if(!device)return json({success:false,message:'Устройство не найдено. Сначала добавьте его в разделе учёта времени.'},404);
    const duplicate=await env.DB.prepare(`SELECT device_id FROM hr_zkteco_device_meta WHERE user_id=?1 AND serial_number=?2 AND device_id<>?3 LIMIT 1`).bind(a.user.id,serialNumber,deviceId).first();
    if(duplicate)return json({success:false,message:'Этот Serial Number уже привязан к другому устройству'},409);
    const t=now();
    await env.DB.prepare(`INSERT INTO hr_zkteco_device_meta(user_id,device_id,model,serial_number,protocol_mode,connector_port,created_at,updated_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?7)
      ON CONFLICT(user_id,device_id) DO UPDATE SET model=excluded.model,serial_number=excluded.serial_number,protocol_mode=excluded.protocol_mode,connector_port=excluded.connector_port,updated_at=excluded.updated_at`)
      .bind(a.user.id,deviceId,model,serialNumber,protocolMode,connectorPort,t).run();
    return json({success:true,deviceId,model,serialNumber,protocolMode,connectorPort,updatedAt:t});
  }catch(e){console.error('[HR-ZK-META-POST]',e);return json({success:false,message:e?.message||String(e)},500)}
}
