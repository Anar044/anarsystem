import { getUser } from '../iiko/_lib/user-state.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}

async function auth(request,env){return await getUser(request,env)}
function gatewayConfig(env){return{url:clean(env.ZK_GATEWAY_URL).replace(/\/$/,''),key:clean(env.ZK_GATEWAY_ADMIN_KEY)}}
async function ownedDevice(env,userId,deviceId){
  return env.DB.prepare(`SELECT d.device_id,d.name,d.location,d.timezone,m.model,m.serial_number,m.protocol_mode,m.device_ip,m.device_port,m.connector_host,m.connector_port
    FROM hr_devices d LEFT JOIN hr_zkteco_device_meta m ON m.user_id=d.user_id AND m.device_id=d.device_id
    WHERE d.user_id=?1 AND d.device_id=?2 LIMIT 1`).bind(userId,deviceId).first();
}
async function callGateway(env,path,body){
  const cfg=gatewayConfig(env);if(!cfg.url||!cfg.key)throw new Error('ZKTeco Gateway ещё не настроен на сервере SmartHoreca');
  const response=await fetch(`${cfg.url}${path}`,{method:'POST',headers:{'Content-Type':'application/json','X-SH-Gateway-Key':cfg.key},body:JSON.stringify(body)});
  const data=await response.json().catch(()=>({}));if(!response.ok||data?.success!==true)throw new Error(data?.message||`Gateway HTTP ${response.status}`);return data;
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){
  const a=await auth(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);
  const cfg=gatewayConfig(env);return json({success:true,configured:Boolean(cfg.url&&cfg.key),gatewayUrl:cfg.url||''});
}
export async function onRequestPost({request,env}){
  try{
    const a=await auth(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);
    const b=await request.json().catch(()=>({})),action=clean(b.action),deviceId=clean(b.deviceId);if(!deviceId)return json({success:false,message:'Не указано устройство'},400);
    const d=await ownedDevice(env,a.user.id,deviceId);if(!d)return json({success:false,message:'Устройство не найдено'},404);
    const serial=clean(d.serial_number);if(!serial)return json({success:false,message:'У устройства не указан Serial Number'},400);
    if(action==='register'){
      const deviceToken=clean(b.deviceToken);if(!deviceToken)return json({success:false,message:'Не указан новый device token'},400);
      const result=await callGateway(env,'/admin/devices',{serialNumber:serial,deviceToken,deviceId:d.device_id,tenantId:a.user.id,name:d.name||'',location:d.location||'',model:d.model||'',protocolMode:d.protocol_mode||'PUSH_ADMS',deviceIp:d.device_ip||'',devicePort:Number(d.device_port||4370),gatewayHost:d.connector_host||'',gatewayPort:Number(d.connector_port||80),enabled:true});
      return json({success:true,registered:true,serialNumber:serial,gateway:result.device||null});
    }
    if(action==='revoke'){
      await callGateway(env,'/admin/devices/revoke',{serialNumber:serial,deviceId:d.device_id,tenantId:a.user.id});
      return json({success:true,revoked:true,serialNumber:serial});
    }
    return json({success:false,message:'Неизвестное действие'},400);
  }catch(e){console.error('[HR-ZK-GATEWAY]',e);return json({success:false,message:e?.message||String(e)},500)}
}
