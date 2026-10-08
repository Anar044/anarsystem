function clean(v,max=1000){return String(v??"").trim().slice(0,max)}
function now(){return new Date().toISOString()}
function normalizeSn(v){return clean(v,120).toUpperCase()}
function plain(text,status=200){return new Response(String(text??""),{status,headers:{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"}})}
function jsonSafe(value){try{return JSON.stringify(value)}catch{return "{}"}}
function direction(status){
  const s=String(status??"").trim();
  if(["0","3","4","IN","ENTRY","CHECKIN","BREAKIN","OTIN"].includes(s.toUpperCase()))return"IN";
  if(["1","2","5","OUT","EXIT","CHECKOUT","BREAKOUT","OTOUT"].includes(s.toUpperCase()))return"OUT";
  return"UNKNOWN";
}
async function sha256(value){
  const bytes=new TextEncoder().encode(String(value||""));
  const digest=await crypto.subtle.digest("SHA-256",bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function ipFromRequest(request){
  return clean(request.headers.get("CF-Connecting-IP")||request.headers.get("X-Forwarded-For")||"",120).split(",")[0].trim();
}
function parseLocalDateTime(value,timeZone="Asia/Baku"){
  const s=clean(value,40);
  const m=s.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if(!m){const d=new Date(s);return Number.isNaN(d.getTime())?"":d.toISOString()}
  const parts={y:+m[1],mo:+m[2],d:+m[3],h:+m[4],mi:+m[5],s:+m[6]};
  const guess=Date.UTC(parts.y,parts.mo-1,parts.d,parts.h,parts.mi,parts.s);
  try{
    const fmt=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"});
    const got=Object.fromEntries(fmt.formatToParts(new Date(guess)).filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
    const asUtc=Date.UTC(+got.year,+got.month-1,+got.day,+got.hour,+got.minute,+got.second);
    const offset=asUtc-guess;
    return new Date(guess-offset).toISOString();
  }catch{return new Date(guess).toISOString()}
}
function keyValueLine(line){
  const out={};
  for(const chunk of String(line||"").split(/\t+/)){
    const i=chunk.indexOf("=");if(i>0)out[chunk.slice(0,i).trim().toUpperCase()]=chunk.slice(i+1).trim();
  }
  return out;
}
function parseAttLine(line,timeZone){
  const raw=String(line||"").trim();if(!raw)return null;
  if(/\bPIN\s*=|\bDATETIME\s*=/i.test(raw)){
    const kv=keyValueLine(raw);
    const pin=clean(kv.PIN||kv.USERID||kv.USER,120);
    const local=clean(kv.DATETIME||kv.TIME||kv.TIMESTAMP,40);
    const status=clean(kv.STATUS??kv.STATE??"0",20);
    const verify=clean(kv.VERIFIED??kv.VERIFY??kv.VERIFYTYPE??"",20);
    const workCode=clean(kv.WORKCODE??"",40);
    if(!pin||!local)return null;
    return{pin,localTime:local,eventTime:parseLocalDateTime(local,timeZone),status,verify,workCode,raw};
  }
  const p=raw.split("\t").map(x=>x.trim());
  if(p.length<2)return null;
  const pin=clean(p[0],120),local=clean(p[1],40),status=clean(p[2]??"0",20),verify=clean(p[3]??"",20),workCode=clean(p[4]??"",40);
  if(!pin||!local)return null;
  return{pin,localTime:local,eventTime:parseLocalDateTime(local,timeZone),status,verify,workCode,raw};
}
export async function ensureZktecoAdmsTables(db){
  if(!db)throw new Error("D1 binding DB не настроен.");
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_zkteco_adms_devices (
      user_id TEXT NOT NULL,device_id TEXT NOT NULL,serial_number TEXT NOT NULL,model TEXT NOT NULL DEFAULT 'SenseFace 2A',
      enabled INTEGER NOT NULL DEFAULT 1,last_seen_at TEXT NOT NULL DEFAULT '',last_event_at TEXT NOT NULL DEFAULT '',
      push_version TEXT NOT NULL DEFAULT '',firmware TEXT NOT NULL DEFAULT '',last_ip TEXT NOT NULL DEFAULT '',last_user_agent TEXT NOT NULL DEFAULT '',
      registered_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,device_id),UNIQUE(serial_number)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_zkteco_adms_serial ON hr_zkteco_adms_devices(serial_number,enabled)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_zkteco_adms_raw (
      user_id TEXT NOT NULL,raw_id TEXT NOT NULL,device_id TEXT NOT NULL,serial_number TEXT NOT NULL,
      table_name TEXT NOT NULL DEFAULT '',source_uid TEXT NOT NULL,event_time TEXT NOT NULL DEFAULT '',
      external_employee_id TEXT NOT NULL DEFAULT '',event_status TEXT NOT NULL DEFAULT '',verify_type TEXT NOT NULL DEFAULT '',
      work_code TEXT NOT NULL DEFAULT '',raw_line TEXT NOT NULL DEFAULT '',received_at TEXT NOT NULL,
      PRIMARY KEY(user_id,raw_id),UNIQUE(user_id,device_id,source_uid)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_zkteco_raw_device_time ON hr_zkteco_adms_raw(user_id,device_id,received_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_zkteco_adms_requests (
      user_id TEXT NOT NULL,request_id TEXT NOT NULL,device_id TEXT NOT NULL,serial_number TEXT NOT NULL,
      endpoint TEXT NOT NULL DEFAULT '',method TEXT NOT NULL DEFAULT '',table_name TEXT NOT NULL DEFAULT '',
      query_text TEXT NOT NULL DEFAULT '',body_length INTEGER NOT NULL DEFAULT 0,body_preview TEXT NOT NULL DEFAULT '',
      received_at TEXT NOT NULL,PRIMARY KEY(user_id,request_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_zkteco_requests_device_time ON hr_zkteco_adms_requests(user_id,device_id,received_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_zkteco_adms_commands (
      user_id TEXT NOT NULL,command_id INTEGER NOT NULL,device_id TEXT NOT NULL,serial_number TEXT NOT NULL,
      command_text TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',created_at TEXT NOT NULL,sent_at TEXT NOT NULL DEFAULT '',
      acknowledged_at TEXT NOT NULL DEFAULT '',return_code TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(user_id,command_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_zkteco_commands_pending ON hr_zkteco_adms_commands(user_id,device_id,status,created_at)`)
  ]);
}
export async function registerAdmsDevice(db,{userId,deviceId,serialNumber,model="SenseFace 2A"}){
  await ensureZktecoAdmsTables(db);
  const sn=normalizeSn(serialNumber);if(!sn)throw new Error("Укажите серийный номер SenseFace 2A.");
  const conflict=await db.prepare(`SELECT user_id,device_id FROM hr_zkteco_adms_devices WHERE serial_number=?1 LIMIT 1`).bind(sn).first();
  if(conflict&&(String(conflict.user_id)!==String(userId)||String(conflict.device_id)!==String(deviceId))){
    const e=new Error("Этот серийный номер уже привязан к другому устройству.");e.status=409;throw e;
  }
  const t=now();
  await db.prepare(`INSERT INTO hr_zkteco_adms_devices(user_id,device_id,serial_number,model,enabled,registered_at,updated_at)
    VALUES(?1,?2,?3,?4,1,?5,?5)
    ON CONFLICT(user_id,device_id) DO UPDATE SET serial_number=excluded.serial_number,model=excluded.model,enabled=1,updated_at=excluded.updated_at`)
    .bind(userId,deviceId,sn,clean(model,120)||"SenseFace 2A",t).run();
  return sn;
}
export async function unregisterAdmsDevice(db,userId,deviceId){
  await ensureZktecoAdmsTables(db);
  await db.prepare(`DELETE FROM hr_zkteco_adms_devices WHERE user_id=?1 AND device_id=?2`).bind(userId,deviceId).run();
}
export async function admsDeviceBySerial(db,serialNumber){
  await ensureZktecoAdmsTables(db);
  const sn=normalizeSn(serialNumber);if(!sn)return null;
  return db.prepare(`SELECT z.*,d.name,d.timezone,d.is_active,d.restaurant_id
    FROM hr_zkteco_adms_devices z JOIN hr_devices d ON d.user_id=z.user_id AND d.device_id=z.device_id
    WHERE z.serial_number=?1 AND z.enabled=1 AND d.is_active=1 LIMIT 1`).bind(sn).first();
}
export async function touchAdmsDevice(db,row,request,extra={}){
  const t=now(),push=clean(extra.pushVersion||"",80),firmware=clean(extra.firmware||"",120),ip=ipFromRequest(request),ua=clean(request.headers.get("User-Agent")||"",300);
  await db.prepare(`UPDATE hr_zkteco_adms_devices SET last_seen_at=?3,push_version=CASE WHEN ?4<>'' THEN ?4 ELSE push_version END,
    firmware=CASE WHEN ?5<>'' THEN ?5 ELSE firmware END,last_ip=?6,last_user_agent=?7,updated_at=?3 WHERE user_id=?1 AND device_id=?2`)
    .bind(row.user_id,row.device_id,t,push,firmware,ip,ua).run();
  await db.prepare(`UPDATE hr_devices SET last_sync_at=?3,updated_at=?3 WHERE user_id=?1 AND device_id=?2`).bind(row.user_id,row.device_id,t).run();
}
function isAttendanceTable(table){
  const t=String(table||"").toUpperCase();
  return ["ATTLOG","RTLOG","TRANSACTION","TRANSACTIONS","ATTENDANCE"].includes(t);
}
function safeRequestBodyPreview(table,body){
  if(!isAttendanceTable(table))return "";
  return String(body||"").slice(0,8000);
}
export async function logAdmsRequest(db,row,request,{endpoint="",tableName="",body=""}={}){
  await ensureZktecoAdmsTables(db);
  const url=new URL(request.url),query=[...url.searchParams.entries()].map(([k,v])=>k+"="+v).join("&");
  await db.prepare(`INSERT INTO hr_zkteco_adms_requests(user_id,request_id,device_id,serial_number,endpoint,method,table_name,query_text,body_length,body_preview,received_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)`)
    .bind(row.user_id,"zkreq_"+crypto.randomUUID(),row.device_id,row.serial_number,clean(endpoint,80),request.method,clean(tableName,60).toUpperCase(),clean(query,3000),String(body||"").length,safeRequestBodyPreview(tableName,body),now()).run();
}
function parseRtLine(line,timeZone){
  const raw=String(line||"").trim();if(!raw)return null;
  const kv=keyValueLine(raw);
  const pin=clean(kv.PIN||kv.USERID||kv.USER||kv.ENROLLNUMBER,120);
  const local=clean(kv.DATETIME||kv.TIME||kv.TIMESTAMP,40);
  const status=clean(kv.INOUTSTATUS??kv.STATUS??kv.STATE??"0",20);
  const verify=clean(kv.VERIFYTYPE??kv.VERIFIED??kv.VERIFY??"",20);
  const workCode=clean(kv.WORKCODE??"",40);
  const event=Number(kv.EVENT??kv.EVENTTYPE??0);
  // Security PUSH RTLOG also contains door/alarm/system events. They are not attendance punches.
  if(!pin||pin==="0"||!local||!Number.isFinite(event)||event>=20)return null;
  return{pin,localTime:local,eventTime:parseLocalDateTime(local,timeZone),status,verify,workCode,raw};
}
function isAccSecurityPush(url){
  return String(url.searchParams.get("DeviceType")||"").toLowerCase()==="acc" ||
    String(url.searchParams.get("pushver")||url.searchParams.get("PushVersion")||"").startsWith("3");
}
async function registryCodeFor(sn){
  return (await sha256("smart-horeca-zk-acc|"+normalizeSn(sn))).slice(0,16).toUpperCase();
}
export async function accPushOptions(serialNumber){
  const sn=normalizeSn(serialNumber),code=await registryCodeFor(sn);
  return [
    "registry=ok",
    `RegistryCode=${code}`,
    "ServerVersion=3.1.2",
    "ServerName=SmartHoreca-ADMS",
    "PushVersion=3.1.2",
    "PushProtVer=3.1.2",
    "ErrorDelay=30",
    "RequestDelay=5",
    "TransTimes=00:00;23:59",
    "TransInterval=1",
    "TransTables=User Transaction",
    "Realtime=1",
    `SessionID=${code}`,
    "TimeoutSec=10",
    ""
  ].join("\r\n");
}
function decodeZkTimeSecond(raw){
  let value=Number(raw);if(!Number.isFinite(value)||value<0)return "";
  const sec=value%60;value=Math.floor(value/60);
  const min=value%60;value=Math.floor(value/60);
  const hour=value%24;value=Math.floor(value/24);
  const day=value%31+1;value=Math.floor(value/31);
  const month=value%12+1;value=Math.floor(value/12);
  const year=value+2000;
  const d=new Date(Date.UTC(year,month-1,day,hour,min,sec));
  if(Number.isNaN(d.getTime()))return "";
  return `${year}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")} ${String(hour).padStart(2,"0")}:${String(min).padStart(2,"0")}:${String(sec).padStart(2,"0")}`;
}
function parseTransactionLine(line,timeZone){
  const raw=String(line||"").trim();if(!raw)return null;
  const kv=keyValueLine(raw.replace(/^transaction\s+/i,""));
  const pin=clean(kv.PIN||kv.USERID||kv.USER,120);
  const local=clean(kv.TIME||kv.DATETIME||kv.TIMESTAMP||decodeZkTimeSecond(kv.TIME_SECOND),40);
  const status=clean(kv.INOUTSTATE??kv.INOUTSTATUS??kv.STATUS??"0",20);
  const verify=clean(kv.VERIFIED??kv.VERIFYTYPE??kv.VERIFY??"",20);
  const workCode=clean(kv.WORKCODE??"",40);
  const event=Number(kv.EVENTTYPE??kv.EVENT??0);
  if(!pin||!local||!Number.isFinite(event)||event>=20)return null;
  return{pin,localTime:local,eventTime:parseLocalDateTime(local,timeZone),status,verify,workCode,raw};
}
async function inferredAttendanceType(db,row,rec){
  const prior=await db.prepare(`SELECT event_time,event_type FROM hr_attendance_events
    WHERE user_id=?1 AND device_id=?2 AND external_employee_id=?3 AND event_time<?4
    ORDER BY event_time DESC LIMIT 1`).bind(row.user_id,row.device_id,String(rec.pin),rec.eventTime).first();
  if(prior?.event_time){
    const delta=new Date(rec.eventTime).getTime()-new Date(prior.event_time).getTime();
    if(Number.isFinite(delta)&&delta>=0&&delta<10000)return{type:"DUPLICATE",duplicate:true};
  }
  return{type:String(prior?.event_type||"").toUpperCase()==="IN"?"OUT":"IN",duplicate:false};
}
export async function ingestAdmsPayload(db,row,{tableName,body,request}){
  await ensureZktecoAdmsTables(db);
  const table=clean(tableName,60).toUpperCase(),receivedAt=now(),lines=String(body||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const bindings=await db.prepare(`SELECT external_employee_id,iiko_employee_id FROM hr_employee_device_bindings WHERE user_id=?1 AND device_id=?2`).bind(row.user_id,row.device_id).all();
  const employeeMap=new Map((bindings.results||[]).map(x=>[String(x.external_employee_id),String(x.iiko_employee_id)]));
  let parsed=0,matched=0,unmatched=0,invalid=0,lastEvent="";
  for(const line of lines){
    if(isAttendanceTable(table)){
      const rec=table==="ATTLOG"?parseAttLine(line,row.timezone||"Asia/Baku"):table==="TRANSACTION"?parseTransactionLine(line,row.timezone||"Asia/Baku"):parseRtLine(line,row.timezone||"Asia/Baku");
      if(!rec||!rec.eventTime){invalid++;continue}
      parsed++;
      const sourceUid=await sha256(`${row.serial_number}|${table}|${rec.pin}|${rec.localTime}|${rec.status}|${rec.verify}|${rec.workCode}`);
      const employeeId=employeeMap.get(String(rec.pin))||"";if(employeeId)matched++;else unmatched++;
      const rawId="zkraw_"+crypto.randomUUID(),eventId="evt_"+crypto.randomUUID();
      const inferred=(table==="RTLOG"||table==="TRANSACTION")?await inferredAttendanceType(db,row,rec):{type:direction(rec.status),duplicate:false};
      const payload={protocol:"ZKTECO_ADMS",serialNumber:row.serial_number,pin:rec.pin,localTime:rec.localTime,status:rec.status,verify:rec.verify,workCode:rec.workCode,raw:rec.raw,inferredDirection:Boolean(table==="RTLOG"||table==="TRANSACTION"),duplicateSuppressed:inferred.duplicate};
      const statements=[
        db.prepare(`INSERT OR IGNORE INTO hr_zkteco_adms_raw(user_id,raw_id,device_id,serial_number,table_name,source_uid,event_time,external_employee_id,event_status,verify_type,work_code,raw_line,received_at)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`)
          .bind(row.user_id,rawId,row.device_id,row.serial_number,table,sourceUid,rec.eventTime,rec.pin,rec.status,rec.verify,rec.workCode,rec.raw.slice(0,16000),receivedAt)
      ];
      if(!inferred.duplicate){
        statements.push(db.prepare(`INSERT OR IGNORE INTO hr_attendance_events(user_id,event_id,device_id,provider,source_uid,external_employee_id,iiko_employee_id,event_time,event_type,raw_payload,imported_at)
          VALUES(?1,?2,?3,'ZKTECO',?4,?5,?6,?7,?8,?9,?10)`)
          .bind(row.user_id,eventId,row.device_id,sourceUid,rec.pin,employeeId,rec.eventTime,inferred.type,jsonSafe(payload).slice(0,16000),receivedAt));
      }
      await db.batch(statements);
      if(!lastEvent||rec.eventTime>lastEvent)lastEvent=rec.eventTime;
    }else{
      // Smart Horeca intentionally does not persist biometric templates, face photos,
      // fingerprints, passwords or card enrollment payloads. Identification remains local on SenseFace.
      parsed++;
    }
  }
  await db.prepare(`UPDATE hr_zkteco_adms_devices SET last_seen_at=?3,last_event_at=CASE WHEN ?4<>'' THEN ?4 ELSE last_event_at END,updated_at=?3 WHERE user_id=?1 AND device_id=?2`)
    .bind(row.user_id,row.device_id,receivedAt,lastEvent).run();
  await db.prepare(`UPDATE hr_devices SET last_sync_at=?3,updated_at=?3 WHERE user_id=?1 AND device_id=?2`).bind(row.user_id,row.device_id,receivedAt).run();
  return{lines:lines.length,parsed,matched,unmatched,invalid,lastEvent};
}
export function admsOptions(serialNumber,pushVersion="3.1.2"){
  const sn=normalizeSn(serialNumber),pv=clean(pushVersion,40)||"3.1.2";
  return [
    `GET OPTION FROM: ${sn}`,
    "Stamp=0",
    "OpStamp=0",
    "PhotoStamp=0",
    "ATTLOGStamp=0",
    "OPERLOGStamp=0",
    "ATTPHOTOStamp=9999",
    "ErrorDelay=30",
    "Delay=10",
    "TransTimes=00:00;23:59",
    "TransInterval=1",
    "TransFlag=TransData AttLog OpLog",
    "Realtime=1",
    "Encrypt=0",
    "EncryptFlag=0",
    "SupportPing=1",
    "PushOptionsFlag=1",
    "MaxPostSize=1048576",
    "Timeout=60",
    "ServerVer=2.4.1",
    `PushProtVer=${pv}`,
    ""
  ].join("\r\n");
}
export async function handleCdata({request,env}){
  try{
    const url=new URL(request.url),sn=normalizeSn(url.searchParams.get("SN")||url.searchParams.get("sn"));
    if(!sn)return plain("ERROR: SN REQUIRED\n",200);
    const row=await admsDeviceBySerial(env.DB,sn);
    if(!row)return plain("ERROR: DEVICE NOT REGISTERED\n",200);
    await touchAdmsDevice(env.DB,row,request,{pushVersion:url.searchParams.get("pushver")||url.searchParams.get("PushVersion")||"",firmware:url.searchParams.get("FWVersion")||""});
    if(request.method==="GET"){
      const pushVersion=url.searchParams.get("pushver")||url.searchParams.get("PushVersion")||"3.1.2";
      await logAdmsRequest(env.DB,row,request,{endpoint:"cdata"});
      if(isAccSecurityPush(url))return plain(await accPushOptions(sn),200);
      return plain(admsOptions(sn,pushVersion),200);
    }
    const body=await request.text(),table=url.searchParams.get("table")||url.searchParams.get("Table")||url.searchParams.get("type")||"";
    await logAdmsRequest(env.DB,row,request,{endpoint:"cdata",tableName:table,body});
    const result=await ingestAdmsPayload(env.DB,row,{tableName:table,body,request});
    return plain(`OK: ${result.lines}\n`,200);
  }catch(error){console.error("[ZK-ADMS-CDATA]",error);return plain("ERROR\n",200)}
}
export async function queueAdmsCommand(db,row,commandText){
  await ensureZktecoAdmsTables(db);
  const text=clean(commandText,2000);if(!text)throw new Error("Пустая команда ADMS.");
  const maxRow=await db.prepare(`SELECT MAX(command_id) AS max_id FROM hr_zkteco_adms_commands WHERE user_id=?1`).bind(row.user_id).first();
  const commandId=Math.max(1,Number(maxRow?.max_id||0)+1),t=now();
  await db.prepare(`INSERT INTO hr_zkteco_adms_commands(user_id,command_id,device_id,serial_number,command_text,status,created_at)
    VALUES(?1,?2,?3,?4,?5,'PENDING',?6)`).bind(row.user_id,commandId,row.device_id,row.serial_number,text,t).run();
  return commandId;
}
async function nextAdmsCommand(db,row){
  await ensureZktecoAdmsTables(db);
  return db.prepare(`SELECT command_id,command_text,status,sent_at FROM hr_zkteco_adms_commands
    WHERE user_id=?1 AND device_id=?2 AND status IN ('PENDING','SENT')
    ORDER BY CASE status WHEN 'PENDING' THEN 0 ELSE 1 END,created_at LIMIT 1`).bind(row.user_id,row.device_id).first();
}
async function markAdmsCommandSent(db,row,commandId){
  await db.prepare(`UPDATE hr_zkteco_adms_commands SET status='SENT',sent_at=?4
    WHERE user_id=?1 AND device_id=?2 AND command_id=?3`).bind(row.user_id,row.device_id,commandId,now()).run();
}
async function acknowledgeAdmsCommand(db,row,commandId,returnCode=""){
  if(!commandId)return;
  await db.prepare(`UPDATE hr_zkteco_adms_commands SET status='ACK',acknowledged_at=?4,return_code=?5
    WHERE user_id=?1 AND device_id=?2 AND command_id=?3`).bind(row.user_id,row.device_id,commandId,now(),clean(returnCode,80)).run();
}
export async function handleRegistry({request,env}){
  try{
    const url=new URL(request.url),sn=normalizeSn(url.searchParams.get("SN")||url.searchParams.get("sn"));
    if(!sn)return plain("ERROR: SN REQUIRED\n");
    const row=await admsDeviceBySerial(env.DB,sn);if(!row)return plain("ERROR: DEVICE NOT REGISTERED\n");
    const body=request.method==="POST"?await request.text():"";
    await touchAdmsDevice(env.DB,row,request,{pushVersion:"3.1.2"});
    await logAdmsRequest(env.DB,row,request,{endpoint:"registry",body});
    return plain(`RegistryCode=${await registryCodeFor(sn)}\r\n`);
  }catch(error){console.error("[ZK-ADMS-REGISTRY]",error);return plain("ERROR\n")}
}
export async function handlePush({request,env}){
  try{
    const url=new URL(request.url),sn=normalizeSn(url.searchParams.get("SN")||url.searchParams.get("sn"));
    if(!sn)return plain("ERROR: SN REQUIRED\n");
    const row=await admsDeviceBySerial(env.DB,sn);if(!row)return plain("ERROR: DEVICE NOT REGISTERED\n");
    const body=request.method==="POST"?await request.text():"";
    await touchAdmsDevice(env.DB,row,request,{pushVersion:"3.1.2"});
    await logAdmsRequest(env.DB,row,request,{endpoint:"push",body});
    return plain(await accPushOptions(sn));
  }catch(error){console.error("[ZK-ADMS-PUSH]",error);return plain("ERROR\n")}
}
export async function handleQueryData({request,env}){
  try{
    const url=new URL(request.url),sn=normalizeSn(url.searchParams.get("SN")||url.searchParams.get("sn"));
    if(!sn)return plain("ERROR: SN REQUIRED\n");
    const row=await admsDeviceBySerial(env.DB,sn);if(!row)return plain("ERROR: DEVICE NOT REGISTERED\n");
    const body=await request.text();
    const table=clean(url.searchParams.get("tablename")||url.searchParams.get("table")||"transaction",60).toUpperCase();
    await touchAdmsDevice(env.DB,row,request,{pushVersion:"3.1.2"});
    await logAdmsRequest(env.DB,row,request,{endpoint:"querydata",tableName:table,body});
    const result=await ingestAdmsPayload(env.DB,row,{tableName:table,body,request});
    const count=url.searchParams.get("count")||result.lines;
    return plain(`${table.toLowerCase()}=${count}\n`);
  }catch(error){console.error("[ZK-ADMS-QUERYDATA]",error);return plain("ERROR\n")}
}
export async function handleGetRequest({request,env}){
  try{
    const url=new URL(request.url),sn=normalizeSn(url.searchParams.get("SN")||url.searchParams.get("sn"));if(!sn)return plain("OK\n");
    const row=await admsDeviceBySerial(env.DB,sn);if(!row)return plain("OK\n");
    await touchAdmsDevice(env.DB,row,request,{pushVersion:url.searchParams.get("pushver")||""});
    await logAdmsRequest(env.DB,row,request,{endpoint:"getrequest"});
    const cmd=await nextAdmsCommand(env.DB,row);
    if(cmd){
      await markAdmsCommandSent(env.DB,row,cmd.command_id);
      return plain(`C:${cmd.command_id}:${cmd.command_text}\n`);
    }
    return plain("OK\n");
  }catch(error){console.error("[ZK-ADMS-GETREQUEST]",error);return plain("OK\n")}
}
export async function handleDeviceCmd({request,env}){
  try{
    const url=new URL(request.url),sn=normalizeSn(url.searchParams.get("SN")||url.searchParams.get("sn"));
    if(sn){
      const row=await admsDeviceBySerial(env.DB,sn);
      if(row){
        const body=request.method==="POST"?await request.text():"";
        await touchAdmsDevice(env.DB,row,request,{});
        await logAdmsRequest(env.DB,row,request,{endpoint:"devicecmd",body});
        let id=Number(url.searchParams.get("ID")||url.searchParams.get("id")||0);
        let ret=url.searchParams.get("Return")||url.searchParams.get("return")||"";
        if(body){
          for(const line of body.split(/\r?\n/)){
            const fields={};for(const part of line.split("&")){const i=part.indexOf("=");if(i>0)fields[part.slice(0,i).toUpperCase()]=part.slice(i+1)}
            const bodyId=Number(fields.ID||0);if(bodyId){id=bodyId;ret=fields.RETURN||ret;await acknowledgeAdmsCommand(env.DB,row,bodyId,fields.RETURN||"")}
          }
        }
        if(id)await acknowledgeAdmsCommand(env.DB,row,id,ret);
      }
    }
    return plain("OK\n");
  }catch(error){console.error("[ZK-ADMS-DEVICECMD]",error);return plain("OK\n")}
}
export async function handlePing({request,env}){return handleGetRequest({request,env})}
