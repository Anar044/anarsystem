import http from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, appendFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectDir = resolve(__dirname, '..');
const configPath = resolve(process.env.ZKTECO_CONFIG || `${projectDir}/config.json`);

function clean(v){return String(v??'').trim()}
function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
function json(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'});res.end(body)}
function text(res,status,body='OK'){const value=String(body);res.writeHead(status,{'Content-Type':'text/plain; charset=utf-8','Content-Length':Buffer.byteLength(value),'Cache-Control':'no-store'});res.end(value)}
async function readBody(req,maxBytes=2*1024*1024){const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>maxBytes)throw new Error('Request body too large');chunks.push(chunk)}return Buffer.concat(chunks).toString('utf8')}
function safeEqual(a,b){const aa=Buffer.from(String(a||'')),bb=Buffer.from(String(b||''));return aa.length===bb.length&&timingSafeEqual(aa,bb)}

async function loadConfig(){
  const raw=await readFile(configPath,'utf8').catch(()=>null);
  if(!raw)throw new Error(`Config not found: ${configPath}`);
  const cfg=JSON.parse(raw);
  cfg.listen??={};cfg.listen.host??='0.0.0.0';cfg.listen.port??=8088;
  cfg.smartHoreca??={};cfg.smartHoreca.baseUrl??='https://smarthoreca.pages.dev';cfg.smartHoreca.ingestPath??='/api/hr/device-ingest';cfg.smartHoreca.requestTimeoutMs??=15000;
  cfg.attendance??={};cfg.attendance.utcOffset??='+04:00';cfg.attendance.flushIntervalMs??=5000;cfg.attendance.maxBatchSize??=200;
  cfg.storage??={};cfg.storage.queueFile??='./data/pending-events.jsonl';cfg.storage.logFile??='./data/gateway.log';cfg.storage.registryFile??='./data/device-registry.json';
  cfg.admin??={};cfg.admin.key=process.env.ZK_GATEWAY_ADMIN_KEY||cfg.admin.key||'';
  cfg.simulation??={};cfg.simulation.enabled??=false;
  cfg.devices??={};
  return cfg;
}

const config=await loadConfig();
const queueFile=resolve(projectDir,config.storage.queueFile);
const logFile=resolve(projectDir,config.storage.logFile);
const registryFile=resolve(projectDir,config.storage.registryFile);
for(const file of [queueFile,logFile,registryFile])await mkdir(dirname(file),{recursive:true});

async function log(level,message,meta=null){const line=`${new Date().toISOString()} [${level}] ${message}${meta?` ${JSON.stringify(meta)}`:''}`;console.log(line);await appendFile(logFile,`${line}\n`).catch(()=>{})}

let registry={};
async function loadRegistry(){
  const raw=await readFile(registryFile,'utf8').catch(()=>null);
  if(raw){try{registry=JSON.parse(raw)||{}}catch{registry={}}}
  for(const [serial,device] of Object.entries(config.devices||{})){if(!registry[serial])registry[serial]={...device,serial,source:'config'}}
  await persistRegistry();
}
async function persistRegistry(){const tmp=`${registryFile}.tmp`;await writeFile(tmp,`${JSON.stringify(registry,null,2)}\n`,'utf8');await rename(tmp,registryFile)}
function publicDevice(d){if(!d)return null;const {deviceToken,...safe}=d;return safe}
function deviceBySerial(serial){const key=clean(serial);const d=registry[key];if(!d||d.enabled===false)return null;return{serial:key,...d}}

function normalizeTimestamp(value){const raw=clean(value);if(!raw)return'';const direct=new Date(raw);if(!Number.isNaN(direct.getTime())&&/(?:Z|[+-]\d\d:?\d\d)$/i.test(raw))return direct.toISOString();const d=new Date(`${raw.replace(' ','T')}${config.attendance.utcOffset}`);return Number.isNaN(d.getTime())?'':d.toISOString()}
function attendanceDirection(status){const s=clean(status).toUpperCase();if(['0','IN','ENTRY','CHECKIN','3','4'].includes(s))return'IN';if(['1','OUT','EXIT','CHECKOUT','2','5'].includes(s))return'OUT';return'UNKNOWN'}
function verifyMethod(value){const s=clean(value).toUpperCase();return({'0':'PASSWORD','1':'FINGERPRINT','2':'CARD','3':'PASSWORD','4':'CARD','15':'FACE','20':'FACE'})[s]||(s||'UNKNOWN')}
function sourceId(serial,pin,timestamp,status,verify,rawLine){return createHash('sha256').update(`${serial}|${pin}|${timestamp}|${status}|${verify}|${rawLine}`).digest('hex')}
function parseKeyValueLine(line){const result={};for(const part of line.split(/\t+/)){const idx=part.indexOf('=');if(idx>0)result[part.slice(0,idx).trim().toUpperCase()]=part.slice(idx+1).trim()}return result}
function parseAttendanceLine(serial,line){
  const rawLine=clean(line);if(!rawLine)return null;
  const kv=parseKeyValueLine(rawLine);let pin=clean(kv.PIN||kv.USERID||kv.USER||kv.ENROLLNUMBER),time=clean(kv.TIME||kv.DATETIME||kv.CHECKTIME),status=clean(kv.STATUS||kv.ATTSTATE||kv.STATE),verify=clean(kv.VERIFY||kv.VERIFYTYPE||kv.VERIFYMODE),workCode=clean(kv.WORKCODE);
  if(!pin||!time){const p=rawLine.split('\t').map(clean);pin||=p[0];time||=p[1];status||=p[2];verify||=p[3];workCode||=p[4]}
  if(!pin||!time)return null;const timestamp=normalizeTimestamp(time);if(!timestamp)return null;
  return{externalEmployeeId:pin,timestamp,type:attendanceDirection(status),sourceId:sourceId(serial,pin,timestamp,status,verify,rawLine),verifyMethod:verifyMethod(verify),attendanceStatus:status,workCode,deviceSerial:serial,rawLine};
}
function parseAttendance(serial,body){const events=[];let invalid=0;for(const line of String(body||'').split(/\r?\n/)){if(!clean(line))continue;const e=parseAttendanceLine(serial,line);if(e)events.push(e);else invalid++}return{events,invalid}}

let queue=[],flushing=false;
async function loadQueue(){const raw=await readFile(queueFile,'utf8').catch(()=>'');queue=raw.split(/\r?\n/).filter(Boolean).map(line=>{try{return JSON.parse(line)}catch{return null}}).filter(Boolean);if(queue.length)await log('INFO','Loaded pending events',{count:queue.length})}
async function persistQueue(){const tmp=`${queueFile}.tmp`,content=queue.length?`${queue.map(x=>JSON.stringify(x)).join('\n')}\n`:'';await writeFile(tmp,content,'utf8');await rename(tmp,queueFile)}
async function enqueue(serial,events){if(!events.length)return;const receivedAt=new Date().toISOString(),rows=events.map(event=>({serial,event,receivedAt}));queue.push(...rows);await appendFile(queueFile,`${rows.map(x=>JSON.stringify(x)).join('\n')}\n`,'utf8')}
function ingestUrl(){return new URL(config.smartHoreca.ingestPath,config.smartHoreca.baseUrl).toString()}
async function sendBatch(device,rows){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Number(config.smartHoreca.requestTimeoutMs)||15000);try{const response=await fetch(ingestUrl(),{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${device.deviceToken}`,'X-SH-Connector':'zkteco-gateway/1.0.0'},body:JSON.stringify({events:rows.map(x=>x.event)}),signal:controller.signal});const data=await response.json().catch(()=>({}));if(!response.ok||data?.success!==true)throw new Error(`SmartHoreca ingest failed: HTTP ${response.status} ${data?.message||''}`.trim());return data}finally{clearTimeout(timer)}}
async function flushQueue(){if(flushing||!queue.length)return;flushing=true;try{for(const serial of [...new Set(queue.map(x=>x.serial))]){const device=deviceBySerial(serial);if(!device?.deviceToken){await log('WARN','No token for queued device',{serial});continue}const max=Math.max(1,Math.min(1000,Number(config.attendance.maxBatchSize)||200)),rows=queue.filter(x=>x.serial===serial).slice(0,max);if(!rows.length)continue;try{const result=await sendBatch(device,rows),ids=new Set(rows.map(x=>x.event.sourceId));queue=queue.filter(x=>!(x.serial===serial&&ids.has(x.event.sourceId)));await persistQueue();await log('INFO','Attendance delivered',{serial,sent:rows.length,matched:result.matched,unmatched:result.unmatched,pending:queue.length})}catch(error){await log('WARN','Attendance delivery postponed',{serial,error:error?.message||String(error)})}}}finally{flushing=false}}

function adminAuthorized(req){const auth=clean(req.headers.authorization).replace(/^Bearer\s+/i,''),key=clean(req.headers['x-sh-gateway-key']);return Boolean(config.admin.key)&&(safeEqual(auth,config.admin.key)||safeEqual(key,config.admin.key))}
async function handleAdmin(req,res,url){
  if(!adminAuthorized(req))return json(res,401,{success:false,message:'Unauthorized'});
  if(url.pathname==='/admin/devices'&&req.method==='GET')return json(res,200,{success:true,items:Object.entries(registry).map(([serial,d])=>({serial,...publicDevice(d)}))});
  if(url.pathname==='/admin/devices'&&['POST','PUT'].includes(req.method)){
    const body=JSON.parse((await readBody(req))||'{}'),serial=clean(body.serialNumber||body.serial),token=clean(body.deviceToken);
    if(!serial)return json(res,400,{success:false,message:'serialNumber required'});if(!token)return json(res,400,{success:false,message:'deviceToken required'});
    registry[serial]={...(registry[serial]||{}),serial,enabled:body.enabled!==false,name:clean(body.name),model:clean(body.model),deviceId:clean(body.deviceId),tenantId:clean(body.tenantId),location:clean(body.location),deviceIp:clean(body.deviceIp),devicePort:Number(body.devicePort||4370),protocolMode:clean(body.protocolMode)||'PUSH_ADMS',deviceToken:token,updatedAt:new Date().toISOString(),source:'smarthoreca'};
    await persistRegistry();await log('INFO','Gateway device registered',{serial,deviceId:registry[serial].deviceId,model:registry[serial].model});return json(res,200,{success:true,device:publicDevice(registry[serial])});
  }
  if(url.pathname==='/admin/devices/revoke'&&req.method==='POST'){
    const body=JSON.parse((await readBody(req))||'{}'),serial=clean(body.serialNumber||body.serial);if(!serial)return json(res,400,{success:false,message:'serialNumber required'});
    if(registry[serial]){registry[serial].enabled=false;delete registry[serial].deviceToken;registry[serial].updatedAt=new Date().toISOString();await persistRegistry();await log('INFO','Gateway device revoked',{serial})}
    return json(res,200,{success:true,serial});
  }
  return json(res,404,{success:false,message:'Not found'});
}

function admsOptions(serial){return[`GET OPTION FROM: ${serial}`,'Stamp=9999','OpStamp=9999','PhotoStamp=9999','ErrorDelay=60','Delay=10','TransTimes=00:00;14:05','TransInterval=1','TransFlag=1111000000','Realtime=1','Encrypt=0'].join('\n')}
async function handleCdata(req,res,url){const serial=clean(url.searchParams.get('SN')||url.searchParams.get('sn'));if(!serial)return text(res,400,'ERROR: missing SN');const device=deviceBySerial(serial);if(!device){await log('WARN','Unknown ZKTeco contacted gateway',{serial,ip:req.socket.remoteAddress});return text(res,403,'ERROR: device not registered')}
  device.lastSeenAt=new Date().toISOString();device.lastRemoteAddress=clean(req.socket.remoteAddress);registry[serial]={...registry[serial],...device};void persistRegistry();
  if(req.method==='GET'){await log('INFO','ZKTeco online',{serial,model:device.model||'',ip:req.socket.remoteAddress});return text(res,200,admsOptions(serial))}
  const table=clean(url.searchParams.get('table')).toUpperCase(),body=await readBody(req);if(table==='ATTLOG'||(!table&&body)){const{events,invalid}=parseAttendance(serial,body);await enqueue(serial,events);await log('INFO','Attendance received',{serial,received:events.length,invalid,pending:queue.length});void flushQueue();return text(res,200,`OK: ${events.length}`)}return text(res,200,'OK')}

async function handleSimulate(req,res){if(!config.simulation.enabled)return json(res,404,{success:false,message:'Simulation disabled'});const body=JSON.parse((await readBody(req))||'{}'),serial=clean(body.serial),device=deviceBySerial(serial);if(!device)return json(res,400,{success:false,message:'Unknown serial'});const timestamp=normalizeTimestamp(body.timestamp||new Date().toISOString()),employee=clean(body.externalEmployeeId||body.employeeId||'1'),raw=JSON.stringify(body),event={externalEmployeeId:employee,timestamp,type:attendanceDirection(body.type||'IN'),sourceId:sourceId(serial,employee,timestamp,body.type||'IN','SIM',raw),verifyMethod:clean(body.verifyMethod||'FACE'),attendanceStatus:clean(body.type||'IN'),workCode:'',deviceSerial:serial,simulated:true};await enqueue(serial,[event]);await flushQueue();return json(res,200,{success:true,event,pending:queue.length})}

await loadRegistry();await loadQueue();
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,`http://${req.headers.host||'localhost'}`);if(url.pathname.startsWith('/admin/'))return await handleAdmin(req,res,url);if(url.pathname==='/health')return json(res,200,{success:true,service:'SmartHoreca ZKTeco Gateway',version:'1.0.0',registeredDevices:Object.values(registry).filter(d=>d.enabled!==false&&d.deviceToken).length,pendingEvents:queue.length,now:new Date().toISOString()});if(url.pathname==='/iclock/cdata'&&['GET','POST'].includes(req.method))return await handleCdata(req,res,url);if(url.pathname==='/iclock/getrequest'&&req.method==='GET')return text(res,200,'OK');if(url.pathname==='/iclock/devicecmd'&&req.method==='POST'){const body=await readBody(req);await log('INFO','Device command result',{serial:clean(url.searchParams.get('SN')),body:body.slice(0,1000)});return text(res,200,'OK')}if(url.pathname==='/simulate'&&req.method==='POST')return await handleSimulate(req,res);return text(res,404,'Not found')}catch(error){await log('ERROR','Request failed',{error:error?.stack||error?.message||String(error)});return text(res,500,'ERROR')}});
const host=config.listen.host,port=Number(process.env.PORT||config.listen.port)||8088;server.listen(port,host,()=>void log('INFO','SmartHoreca ZKTeco Gateway started',{listen:`${host}:${port}`,ingest:ingestUrl(),registryFile,queueFile}));setInterval(()=>void flushQueue(),Math.max(1000,Number(config.attendance.flushIntervalMs)||5000)).unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await log('INFO',`Stopping gateway (${signal})`,{pending:queue.length});server.close();await Promise.allSettled([persistQueue(),persistRegistry()]);await sleep(50);process.exit(0)});
