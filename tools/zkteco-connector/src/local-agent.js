import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, appendFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require=createRequire(import.meta.url);
const ZKLib=require('node-zklib');
const __dirname=dirname(fileURLToPath(import.meta.url));
const projectDir=resolve(__dirname,'..');
const configPath=resolve(process.env.ZKTECO_LOCAL_CONFIG||`${projectDir}/local-config.json`);

const clean=v=>String(v??'').trim();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hash=v=>createHash('sha256').update(String(v)).digest('hex');

async function loadConfig(){
  const raw=await readFile(configPath,'utf8').catch(()=>null);
  if(!raw)throw new Error(`Local Agent config not found: ${configPath}. Copy local-config.example.json to local-config.json.`);
  const cfg=JSON.parse(raw);
  cfg.smartHoreca??={};
  cfg.smartHoreca.baseUrl??='https://smarthoreca.pages.dev';
  cfg.smartHoreca.deviceConfigPath??='/api/hr/device-config';
  cfg.smartHoreca.ingestPath??='/api/hr/device-ingest';
  cfg.smartHoreca.requestTimeoutMs??=15000;
  cfg.deviceToken=clean(cfg.deviceToken);
  cfg.pollIntervalMs=Math.max(3000,Number(cfg.pollIntervalMs)||10000);
  cfg.deviceTimeoutMs=Math.max(3000,Number(cfg.deviceTimeoutMs)||10000);
  cfg.udpInPort=Number(cfg.udpInPort)||5200;
  cfg.commKey=Number(cfg.commKey)||0;
  cfg.initialSync=clean(cfg.initialSync||'FROM_NOW').toUpperCase();
  cfg.storage??={};
  cfg.storage.stateFile??='./data/local-agent-state.json';
  cfg.storage.logFile??='./data/local-agent.log';
  if(!cfg.deviceToken)throw new Error('deviceToken is required in local-config.json');
  return cfg;
}

const config=await loadConfig();
const stateFile=resolve(projectDir,config.storage.stateFile);
const logFile=resolve(projectDir,config.storage.logFile);
await mkdir(dirname(stateFile),{recursive:true});
await mkdir(dirname(logFile),{recursive:true});

async function log(level,message,meta=null){
  const line=`${new Date().toISOString()} [${level}] ${message}${meta?` ${JSON.stringify(meta)}`:''}`;
  console.log(line);await appendFile(logFile,`${line}\n`).catch(()=>{});
}

async function loadState(){
  const raw=await readFile(stateFile,'utf8').catch(()=>null);
  if(!raw)return{initialized:false,known:[]};
  try{const s=JSON.parse(raw);return{initialized:Boolean(s.initialized),known:Array.isArray(s.known)?s.known:[]}}catch{return{initialized:false,known:[]}}
}
let state=await loadState();
async function saveState(){
  const tmp=`${stateFile}.tmp`;
  await writeFile(tmp,JSON.stringify({initialized:state.initialized,known:state.known.slice(-10000),updatedAt:new Date().toISOString()},null,2),'utf8');
  await rename(tmp,stateFile);
}

async function fetchJson(url,options={}){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Number(config.smartHoreca.requestTimeoutMs)||15000);
  try{
    const r=await fetch(url,{...options,signal:controller.signal});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||j?.success!==true)throw new Error(j?.message||`HTTP ${r.status}`);
    return j;
  }finally{clearTimeout(timer)}
}

function url(path){return new URL(path,config.smartHoreca.baseUrl).toString()}
async function getDeviceConfig(){
  const j=await fetchJson(url(config.smartHoreca.deviceConfigPath),{headers:{Authorization:`Bearer ${config.deviceToken}`,Accept:'application/json'}});
  const d=j.device||{};
  if(clean(d.connectionMode)!=='DIRECT_TCP')throw new Error(`Device mode is ${d.connectionMode||'unknown'}, expected DIRECT_TCP`);
  if(!clean(d.deviceIp))throw new Error('Device IP is empty in SmartHoreca');
  return d;
}

function recordKey(record){
  const user=clean(record?.deviceUserId??record?.userId??record?.userSn);
  const time=record?.recordTime instanceof Date?record.recordTime.toISOString():new Date(record?.recordTime||record?.attTime||0).toISOString();
  return hash(`${user}|${time}|${clean(record?.userSn)}|${clean(record?.ip)}`);
}
function normalizeRecord(record,device){
  const externalEmployeeId=clean(record?.deviceUserId??record?.userId??record?.userSn);
  const d=record?.recordTime instanceof Date?record.recordTime:new Date(record?.recordTime||record?.attTime||0);
  if(!externalEmployeeId||Number.isNaN(d.getTime()))return null;
  const sourceId=recordKey(record);
  return{externalEmployeeId,timestamp:d.toISOString(),type:'UNKNOWN',sourceId,verifyMethod:'DEVICE',deviceSerial:device.serialNumber||'',raw:{userSn:record?.userSn??null,deviceUserId:record?.deviceUserId??null,ip:record?.ip??device.deviceIp}};
}

async function sendEvents(events){
  if(!events.length)return null;
  return await fetchJson(url(config.smartHoreca.ingestPath),{
    method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.deviceToken}`,'X-SH-Connector':'zkteco-local-agent/1.0'},
    body:JSON.stringify({events})
  });
}

async function pollOnce(){
  const device=await getDeviceConfig();
  const ip=clean(device.deviceIp),port=Number(device.devicePort)||4370;
  const zk=new ZKLib(ip,port,config.deviceTimeoutMs,config.udpInPort,config.commKey);
  try{
    await zk.createSocket();
    const info=await zk.getInfo().catch(()=>null);
    const result=await zk.getAttendances();
    const records=Array.isArray(result?.data)?result.data:[];
    const normalized=records.map(r=>normalizeRecord(r,device)).filter(Boolean);
    const known=new Set(state.known);

    if(!state.initialized&&config.initialSync!=='IMPORT_ALL'){
      state.known=normalized.map(x=>x.sourceId).slice(-10000);state.initialized=true;await saveState();
      await log('INFO','Initial attendance baseline captured',{device:device.name||device.deviceId,ip,port,records:normalized.length,info});
      return;
    }

    const fresh=normalized.filter(x=>!known.has(x.sourceId));
    if(fresh.length){
      const response=await sendEvents(fresh);
      for(const e of fresh)known.add(e.sourceId);
      state.known=[...known].slice(-10000);state.initialized=true;await saveState();
      await log('INFO','New attendance events delivered',{device:device.name||device.deviceId,ip,port,sent:fresh.length,matched:response?.matched,unmatched:response?.unmatched});
    }else{
      await log('INFO','Device poll OK',{device:device.name||device.deviceId,ip,port,records:normalized.length,newEvents:0});
    }
  }finally{
    await zk.disconnect().catch(()=>{});
  }
}

await log('INFO','SmartHoreca ZKTeco Local Agent started',{baseUrl:config.smartHoreca.baseUrl,pollIntervalMs:config.pollIntervalMs,initialSync:config.initialSync});
let stopped=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopped=true;log('INFO',`Stopping Local Agent (${signal})`).finally(()=>process.exit(0))});
while(!stopped){
  try{await pollOnce()}catch(e){await log('WARN','Device poll failed',{error:e?.message||String(e)})}
  await sleep(config.pollIntervalMs);
}
