import fs from 'node:fs';
import path from 'node:path';

function loadDotEnv(filePath){
  if(!fs.existsSync(filePath))return;
  for(const line of fs.readFileSync(filePath,'utf8').split(/\r?\n/)){
    const s=line.trim();
    if(!s||s.startsWith('#'))continue;
    const eq=s.indexOf('=');
    if(eq<1)continue;
    const key=s.slice(0,eq).trim();
    let value=s.slice(eq+1).trim();
    if((value.startsWith('"')&&value.endsWith('"'))||(value.startsWith("'")&&value.endsWith("'")))value=value.slice(1,-1);
    if(process.env[key]===undefined)process.env[key]=value;
  }
}

const cwd=process.cwd();
loadDotEnv(path.join(cwd,'.env'));

function num(name,fallback,min=0,max=Number.MAX_SAFE_INTEGER){
  const n=Number(process.env[name]);
  return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback;
}

export const config={
  port:num('PORT',8081,1,65535),
  host:process.env.BIND_HOST||'0.0.0.0',
  shBaseUrl:(process.env.SH_BASE_URL||'https://smarthoreca.pages.dev').replace(/\/$/,''),
  shIngestPath:process.env.SH_INGEST_PATH||'/api/hr/device-ingest',
  fallbackToken:(process.env.SH_DEVICE_TOKEN||'').trim(),
  utcOffsetMinutes:num('DEVICE_UTC_OFFSET_MINUTES',240,-720,840),
  admsTimezone:num('ADMS_TIMEZONE',4,-12,14),
  dataDir:path.resolve(cwd,process.env.DATA_DIR||'./data'),
  devicesFile:path.resolve(cwd,process.env.DEVICES_FILE||'./devices.json'),
  flushIntervalMs:num('FLUSH_INTERVAL_MS',3000,500,60000),
  flushBatchSize:num('FLUSH_BATCH_SIZE',300,1,2000),
  httpTimeoutMs:num('HTTP_TIMEOUT_MS',10000,1000,120000),
  maxQueueItems:num('MAX_QUEUE_ITEMS',50000,1000,500000),
  logLevel:(process.env.LOG_LEVEL||'info').toLowerCase()
};

export class DeviceRegistry{
  constructor(filePath=config.devicesFile,fallbackToken=config.fallbackToken){
    this.filePath=filePath;
    this.fallbackToken=fallbackToken;
    this.mtimeMs=-1;
    this.devices=new Map();
    this.reload(true);
  }
  reload(force=false){
    try{
      const stat=fs.statSync(this.filePath);
      if(!force&&stat.mtimeMs===this.mtimeMs)return;
      const json=JSON.parse(fs.readFileSync(this.filePath,'utf8'));
      const rows=Array.isArray(json?.devices)?json.devices:[];
      this.devices=new Map(rows.filter(x=>String(x?.serial||'').trim()).map(x=>{
        const serial=String(x.serial).trim();
        return[serial,{serial,name:String(x.name||serial),model:String(x.model||''),token:String(x.token||'').trim()}];
      }));
      this.mtimeMs=stat.mtimeMs;
    }catch(error){
      if(force&&error?.code!=='ENOENT')console.error('[CONFIG] devices.json:',error.message);
      if(error?.code==='ENOENT'){this.devices=new Map();this.mtimeMs=-1;}
    }
  }
  resolve(serial){
    this.reload(false);
    const row=this.devices.get(String(serial||'').trim());
    if(row)return row;
    if(this.fallbackToken)return{serial:String(serial||''),name:String(serial||''),model:'',token:this.fallbackToken,fallback:true};
    return null;
  }
  publicList(){
    this.reload(false);
    return[...this.devices.values()].map(({token,...x})=>({...x,tokenConfigured:Boolean(token)}));
  }
}
