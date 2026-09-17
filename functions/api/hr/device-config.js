function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
function clean(v){return String(v??'').trim()}
async function sha256(value){const bytes=new TextEncoder().encode(String(value||''));const digest=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(digest)).map(x=>x.toString(16).padStart(2,'0')).join('')}
function suppliedToken(request){const auth=request.headers.get('Authorization')||'';if(/^Bearer\s+/i.test(auth))return auth.replace(/^Bearer\s+/i,'').trim();return clean(request.headers.get('X-SH-Device-Token'))}

export async function onRequestOptions(){return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Authorization, X-SH-Device-Token'}})}

export async function onRequestGet({request,env}){
  try{
    if(!env.DB)return json({success:false,message:'D1 binding DB не настроен'},500);
    const token=suppliedToken(request);if(!token)return json({success:false,message:'Не указан device token'},401);
    const tokenHash=await sha256(token);
    const row=await env.DB.prepare(`SELECT t.user_id,t.device_id,d.provider,d.name,d.location,d.timezone,d.connection_mode,d.is_active,
      m.model,m.serial_number,m.protocol_mode,m.device_ip,m.device_port,m.connector_host,m.connector_port
      FROM hr_device_tokens t
      JOIN hr_devices d ON d.user_id=t.user_id AND d.device_id=t.device_id
      LEFT JOIN hr_zkteco_device_meta m ON m.user_id=d.user_id AND m.device_id=d.device_id
      WHERE t.token_hash=?1 LIMIT 1`).bind(tokenHash).first();
    if(!row)return json({success:false,message:'Неверный device token'},401);
    if(!Number(row.is_active))return json({success:false,message:'Устройство отключено'},403);
    return json({success:true,device:{
      deviceId:row.device_id,provider:row.provider||'ZKTECO',name:row.name||'',location:row.location||'',timezone:row.timezone||'Asia/Baku',
      connectionMode:row.connection_mode||row.protocol_mode||'DIRECT_TCP',model:row.model||'',serialNumber:row.serial_number||'',
      deviceIp:row.device_ip||'',devicePort:Number(row.device_port||4370),gatewayHost:row.connector_host||'',gatewayPort:Number(row.connector_port||80)
    }});
  }catch(e){console.error('[HR-DEVICE-CONFIG]',e);return json({success:false,message:e?.message||String(e)},500)}
}
