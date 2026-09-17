function clean(value){
  return String(value ?? '').trim();
}

export function parseRegistryPayload(body=''){
  const result={};
  for(const part of String(body).split(/[\r\n,]+/)){
    const index=part.indexOf('=');
    if(index<1)continue;
    const key=part.slice(0,index).trim().replace(/^~/,'');
    const value=part.slice(index+1).trim();
    if(key)result[key]=value;
  }
  return result;
}

export function localTimestampToIso(value,utcOffsetMinutes=240){
  const text=clean(value);
  const match=text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if(!match){
    const parsed=new Date(text);
    return Number.isNaN(parsed.getTime())?'':parsed.toISOString();
  }
  const year=Number(match[1]);
  const month=Number(match[2]);
  const day=Number(match[3]);
  const hour=Number(match[4]);
  const minute=Number(match[5]);
  const second=Number(match[6]);
  const utc=Date.UTC(year,month-1,day,hour,minute,second)-Number(utcOffsetMinutes||0)*60000;
  return new Date(utc).toISOString();
}

export function statusToDirection(status){
  const value=clean(status).toUpperCase();
  if(['0','IN','ENTRY','CHECKIN'].includes(value))return'IN';
  if(['1','OUT','EXIT','CHECKOUT'].includes(value))return'OUT';
  return'UNKNOWN';
}

export function parseAttLog(body,{serial='',utcOffsetMinutes=240}={}){
  const events=[];
  const invalid=[];
  for(const rawLine of String(body||'').split(/\r?\n/)){
    const line=rawLine.trim();
    if(!line)continue;
    let fields=line.split('\t');
    if(fields.length<2)fields=line.split(/\s{2,}/);
    const pin=clean(fields[0]);
    const deviceTime=clean(fields[1]);
    const status=clean(fields[2]);
    const verifyMode=clean(fields[3]);
    const workCode=clean(fields[4]);
    const timestamp=localTimestampToIso(deviceTime,utcOffsetMinutes);
    if(!pin||!timestamp){
      invalid.push(line);
      continue;
    }
    events.push({
      externalEmployeeId:pin,
      timestamp,
      type:statusToDirection(status),
      sourceId:`${serial}|${pin}|${deviceTime}|${status}|${verifyMode}|${workCode}`,
      provider:'ZKTECO',
      raw:{serial,deviceTime,status,verifyMode,workCode,line}
    });
  }
  return{events,invalid};
}

export function buildInitialOptions(serial,{timezone=4}={}){
  return[
    `GET OPTION FROM: ${clean(serial)}`,
    'STAMP=9999',
    'ATTLOGStamp=9999',
    'OPERLOGStamp=9999',
    'ATTPHOTOStamp=9999',
    'ErrorDelay=30',
    'Delay=10',
    'TransTimes=00:00;23:59',
    'TransInterval=1',
    'TransFlag=TransData AttLog\tOpLog\tEnrollUser\tChgUser',
    `TimeZone=${Number(timezone)||0}`,
    'Realtime=1',
    'Encrypt=None',
    ''
  ].join('\n');
}

export function queryMeta(url){
  return{
    serial:clean(url.searchParams.get('SN')||url.searchParams.get('sn')),
    table:clean(url.searchParams.get('table')).toUpperCase(),
    options:clean(url.searchParams.get('options')),
    stamp:clean(url.searchParams.get('Stamp')||url.searchParams.get('stamp'))
  };
}
