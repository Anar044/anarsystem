import http from 'node:http';
import {config,DeviceRegistry} from './config.js';
import {PersistentQueue} from './queue.js';
import {buildInitialOptions,parseAttLog,parseRegistryPayload,queryMeta} from './adms.js';
import {sendEvents} from './smarthoreca.js';

const registry=new DeviceRegistry();
const queue=new PersistentQueue(config.dataDir,config.maxQueueItems);
const devices=new Map();
let flushRunning=false;
let lastFlushAt='';
let lastFlushError='';
let totalForwarded=0;

function stamp(){return new Date().toISOString();}
function log(level,...args){
  const order={debug:10,info:20,warn:30,error:40};
  if((order[level]??20)<(order[config.logLevel]??20))return;
  console.log(`[${stamp()}] [${level.toUpperCase()}]`,...args);
}

function touch(serial,req,extra={}){
  if(!serial)return;
  const prev=devices.get(serial)||{};
  devices.set(serial,{
    ...prev,
    ...extra,
    serial,
    lastSeen:stamp(),
    remoteAddress:req.socket?.remoteAddress||'',
    userAgent:req.headers['user-agent']||''
  });
}

function writeText(res,status,body,headers={}){
  const text=String(body??'');
  res.writeHead(status,{
    'Content-Type':'text/plain; charset=utf-8',
    'Content-Length':Buffer.byteLength(text),
    'Connection':'close',
    ...headers
  });
  res.end(text);
}

function writeJson(res,status,data){
  const body=JSON.stringify(data,null,2);
  res.writeHead(status,{
    'Content-Type':'application/json; charset=utf-8',
    'Content-Length':Buffer.byteLength(body),
    'Cache-Control':'no-store'
  });
  res.end(body);
}

async function readBody(req,limit=2*1024*1024){
  return await new Promise((resolve,reject)=>{
    const chunks=[];
    let size=0;
    req.on('data',chunk=>{
      size+=chunk.length;
      if(size>limit){
        reject(new Error('Request body is too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end',()=>resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error',reject);
  });
}

async function flushQueue(){
  if(flushRunning)return;
  flushRunning=true;
  try{
    const pending=queue.peek(config.flushBatchSize);
    if(!pending.length){
      lastFlushAt=stamp();
      lastFlushError='';
      return;
    }

    const groups=new Map();
    for(const item of pending){
      const device=registry.resolve(item.serial);
      if(!device?.token)continue;
      const key=device.token;
      if(!groups.has(key))groups.set(key,{device,items:[]});
      groups.get(key).items.push(item);
    }

    if(!groups.size){
      lastFlushAt=stamp();
      lastFlushError='No SmartHoreca device token matches queued terminal serials';
      return;
    }

    for(const {device,items} of groups.values()){
      const ids=items.map(x=>x.queueId);
      try{
        const result=await sendEvents({
          baseUrl:config.shBaseUrl,
          ingestPath:config.shIngestPath,
          token:device.token,
          events:items.map(x=>x.event),
          timeoutMs:config.httpTimeoutMs
        });
        queue.remove(ids);
        totalForwarded+=items.length;
        lastFlushError='';
        log('info',`Forwarded ${items.length} event(s) from ${device.name||device.serial} to SmartHoreca`,result?.matched!==undefined?`matched=${result.matched} unmatched=${result.unmatched}`:'');
      }catch(error){
        queue.markFailed(ids,error?.message||String(error));
        lastFlushError=error?.message||String(error);
        log('warn',`SmartHoreca upload failed for ${device.name||device.serial}:`,lastFlushError);
      }
    }
    lastFlushAt=stamp();
  }finally{
    flushRunning=false;
  }
}

function publicDevices(){
  return[...devices.values()].map(row=>({
    serial:row.serial,
    lastSeen:row.lastSeen||'',
    remoteAddress:row.remoteAddress||'',
    userAgent:row.userAgent||'',
    lastTable:row.lastTable||'',
    lastUploadAt:row.lastUploadAt||'',
    lastUploadCount:row.lastUploadCount||0,
    registry:row.registry||{},
    lastCommandResult:row.lastCommandResult||''
  }));
}

async function handleCData(req,res,url){
  const meta=queryMeta(url);
  touch(meta.serial,req,{lastTable:meta.table||'INIT'});

  if(req.method==='GET'){
    writeText(res,200,buildInitialOptions(meta.serial,{timezone:config.admsTimezone}));
    return;
  }

  if(req.method!=='POST'){
    writeText(res,405,'Method Not Allowed');
    return;
  }

  const body=await readBody(req);
  if(meta.table==='ATTLOG'){
    const parsed=parseAttLog(body,{serial:meta.serial,utcOffsetMinutes:config.utcOffsetMinutes});
    const queued=queue.enqueueMany(meta.serial,parsed.events);
    touch(meta.serial,req,{lastTable:'ATTLOG',lastUploadAt:stamp(),lastUploadCount:parsed.events.length,lastInvalidCount:parsed.invalid.length});
    log('info',`ATTLOG ${meta.serial||'(no SN)'}: received=${parsed.events.length}, queued=${queued.added}, duplicate=${queued.duplicates}, invalid=${parsed.invalid.length}`);
    void flushQueue();
    writeText(res,200,'OK');
    return;
  }

  const registryPayload=parseRegistryPayload(body);
  if(Object.keys(registryPayload).length){
    touch(meta.serial,req,{registry:{...(devices.get(meta.serial)?.registry||{}),...registryPayload}});
  }
  log('debug',`CDATA ${meta.serial||'(no SN)'} table=${meta.table||'(none)'}`,body.slice(0,500));
  writeText(res,200,'OK');
}

async function handleRegistry(req,res,url){
  const meta=queryMeta(url);
  const body=req.method==='POST'?await readBody(req):'';
  const payload={...Object.fromEntries(url.searchParams.entries()),...parseRegistryPayload(body)};
  touch(meta.serial||payload.SN||payload.sn,req,{registry:payload,lastTable:'REGISTRY'});
  writeText(res,200,'OK');
}

async function handleRequest(req,res){
  try{
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
    if(url.pathname==='/health'){
      writeJson(res,200,{ok:true,service:'SmartHoreca ZKTeco Connector',version:'0.1.0',time:stamp(),queue:queue.stats(),devices:publicDevices().length});
      return;
    }
    if(url.pathname==='/api/status'){
      writeJson(res,200,{
        ok:true,
        version:'0.1.0',
        listen:{host:config.host,port:config.port},
        smartHoreca:{baseUrl:config.shBaseUrl,ingestPath:config.shIngestPath},
        configuredDevices:registry.publicList(),
        discoveredDevices:publicDevices(),
        queue:queue.stats(),
        lastFlushAt,
        lastFlushError,
        totalForwarded
      });
      return;
    }
    if(url.pathname==='/api/flush'&&req.method==='POST'){
      await flushQueue();
      writeJson(res,200,{ok:true,queue:queue.stats(),lastFlushAt,lastFlushError,totalForwarded});
      return;
    }
    if(url.pathname==='/iclock/cdata'){
      await handleCData(req,res,url);
      return;
    }
    if(url.pathname==='/iclock/registry'){
      await handleRegistry(req,res,url);
      return;
    }
    if(url.pathname==='/iclock/getrequest'){
      const meta=queryMeta(url);
      touch(meta.serial,req,{lastTable:'GETREQUEST'});
      writeText(res,200,'OK');
      return;
    }
    if(url.pathname==='/iclock/devicecmd'){
      const meta=queryMeta(url);
      const body=await readBody(req);
      touch(meta.serial,req,{lastTable:'DEVICECMD',lastCommandResult:body.slice(0,2000)});
      log('debug',`DEVICECMD ${meta.serial||'(no SN)'}`,body.slice(0,500));
      writeText(res,200,'OK');
      return;
    }
    if(url.pathname==='/iclock/ping'||url.pathname==='/iclock/test'){
      const meta=queryMeta(url);
      touch(meta.serial,req,{lastTable:'PING'});
      writeText(res,200,'OK');
      return;
    }
    writeJson(res,404,{ok:false,error:'Not found'});
  }catch(error){
    log('error',error?.stack||error);
    if(!res.headersSent)writeJson(res,500,{ok:false,error:error?.message||String(error)});
    else res.end();
  }
}

const server=http.createServer((req,res)=>void handleRequest(req,res));
const timer=setInterval(()=>void flushQueue(),config.flushIntervalMs);
timer.unref();

server.listen(config.port,config.host,()=>{
  log('info',`SmartHoreca ZKTeco Connector 0.1.0 listening on http://${config.host}:${config.port}`);
  log('info',`ADMS endpoint: http://<connector-ip>:${config.port}/iclock/cdata`);
  log('info',`SmartHoreca target: ${config.shBaseUrl}${config.shIngestPath}`);
  const q=queue.stats();
  if(q.queued)log('info',`Recovered ${q.queued} queued event(s) from disk`);
});

function shutdown(signal){
  log('info',`${signal}: shutting down`);
  clearInterval(timer);
  server.close(()=>process.exit(0));
  setTimeout(()=>process.exit(1),5000).unref();
}
process.on('SIGINT',()=>shutdown('SIGINT'));
process.on('SIGTERM',()=>shutdown('SIGTERM'));
