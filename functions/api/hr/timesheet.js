import { getUser } from '../iiko/_lib/user-state.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function ymd(v){return /^\d{4}-\d{2}-\d{2}$/.test(clean(v))?clean(v):''}
function isoDayShift(day,delta){const d=new Date(`${day}T00:00:00.000Z`);d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10)}
function minutes(ms){return Math.max(0,Math.round(ms/60000))}
function timeZoneOf(v){const z=clean(v)||'Asia/Baku';try{new Intl.DateTimeFormat('en-US',{timeZone:z}).format(new Date());return z}catch{return'Asia/Baku'}}
function localParts(value,timeZone){const d=new Date(value);if(Number.isNaN(d.getTime()))return{date:'',time:''};const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);const m=Object.fromEntries(parts.map(x=>[x.type,x.value]));return{date:`${m.year}-${m.month}-${m.day}`,time:`${m.hour}:${m.minute}`}}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employees (
      user_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,employee_code TEXT NOT NULL DEFAULT '',first_name TEXT NOT NULL DEFAULT '',middle_name TEXT NOT NULL DEFAULT '',last_name TEXT NOT NULL DEFAULT '',display_name TEXT NOT NULL DEFAULT '',role_code TEXT NOT NULL DEFAULT '',role_name TEXT NOT NULL DEFAULT '',department_code TEXT NOT NULL DEFAULT '',hire_date TEXT NOT NULL DEFAULT '',fire_date TEXT NOT NULL DEFAULT '',is_deleted INTEGER NOT NULL DEFAULT 0,synced_at TEXT NOT NULL,PRIMARY KEY(user_id,iiko_employee_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_devices (
      user_id TEXT NOT NULL,device_id TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'ZKTECO',name TEXT NOT NULL,location TEXT NOT NULL DEFAULT '',connection_mode TEXT NOT NULL DEFAULT 'LOCAL_CONNECTOR',timezone TEXT NOT NULL DEFAULT 'Asia/Baku',is_active INTEGER NOT NULL DEFAULT 1,last_sync_at TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,device_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_attendance_events (
      user_id TEXT NOT NULL,event_id TEXT NOT NULL,device_id TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'ZKTECO',source_uid TEXT NOT NULL,external_employee_id TEXT NOT NULL DEFAULT '',iiko_employee_id TEXT NOT NULL DEFAULT '',event_time TEXT NOT NULL,event_type TEXT NOT NULL DEFAULT 'UNKNOWN',raw_payload TEXT NOT NULL DEFAULT '{}',imported_at TEXT NOT NULL,PRIMARY KEY(user_id,event_id),UNIQUE(user_id,device_id,source_uid)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_events_employee ON hr_attendance_events(user_id,iiko_employee_id,event_time DESC)`)
  ]);
}

function normalizeEmployee(events,employee,timeZone,from,to){
  const sorted=[...events].sort((a,b)=>String(a.event_time).localeCompare(String(b.event_time)));
  const intervals=[],issues=[];let open=null,last=null;
  const addIssue=(code,event,extra={})=>issues.push({code,eventId:event?.event_id||'',eventTime:event?.event_time||'',deviceId:event?.device_id||'',...extra});
  for(const e of sorted){
    const type=String(e.event_type||'UNKNOWN').toUpperCase();
    if(type==='UNKNOWN'){addIssue('UNKNOWN_EVENT_TYPE',e);last=e;continue}
    if(type==='IN'){
      if(!open){open=e;last=e;continue}
      const gap=minutes(new Date(e.event_time)-new Date(open.event_time));
      if(gap<=10){addIssue('DUPLICATE_IN',e,{relatedEventId:open.event_id});last=e;continue}
      addIssue('MISSING_OUT',open,{nextEventId:e.event_id});
      open=e;last=e;continue;
    }
    if(type==='OUT'){
      if(!open){
        const gap=last&&String(last.event_type).toUpperCase()==='OUT'?minutes(new Date(e.event_time)-new Date(last.event_time)):999999;
        addIssue(gap<=10?'DUPLICATE_OUT':'MISSING_IN',e,last?{relatedEventId:last.event_id}:{});last=e;continue;
      }
      const start=new Date(open.event_time),end=new Date(e.event_time),duration=minutes(end-start);
      if(end<=start){addIssue('INVALID_ORDER',e,{relatedEventId:open.event_id});open=null;last=e;continue}
      const lp=localParts(open.event_time,timeZone);
      const status=duration>24*60?'REVIEW':'OK';
      if(status==='REVIEW')addIssue('LONG_INTERVAL',e,{relatedEventId:open.event_id,durationMinutes:duration});
      if(lp.date>=from&&lp.date<=to)intervals.push({
        employeeId:employee.id,employeeCode:employee.code,employeeName:employee.name,roleName:employee.roleName,
        workDate:lp.date,startTime:open.event_time,endTime:e.event_time,startLocal:lp.time,endLocal:localParts(e.event_time,timeZone).time,
        durationMinutes:duration,status,startEventId:open.event_id,endEventId:e.event_id,startDeviceId:open.device_id,endDeviceId:e.device_id
      });
      open=null;last=e;continue;
    }
  }
  if(open)addIssue('MISSING_OUT',open);
  return{intervals,issues};
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{
    const auth=await getUser(request,env);if(!auth)return json({success:false,message:'Требуется авторизация'},401);
    await ensure(env.DB);
    const url=new URL(request.url),today=new Date().toISOString().slice(0,10),defaultFrom=`${today.slice(0,8)}01`;
    const from=ymd(url.searchParams.get('from'))||defaultFrom,to=ymd(url.searchParams.get('to'))||today;
    if(from>to)return json({success:false,message:'Дата начала не может быть позже даты окончания'},400);
    const span=(new Date(`${to}T00:00:00Z`)-new Date(`${from}T00:00:00Z`))/86400000;if(span>92)return json({success:false,message:'Для табеля выберите период не более 93 дней'},400);
    const userId=auth.user.id;
    const [employeeRows,deviceRows,eventRows]=await Promise.all([
      env.DB.prepare(`SELECT iiko_employee_id,employee_code,display_name,role_name,fire_date,is_deleted FROM hr_employees WHERE user_id=?1 AND TRIM(employee_code)<>'' ORDER BY display_name COLLATE NOCASE`).bind(userId).all(),
      env.DB.prepare(`SELECT device_id,name,timezone FROM hr_devices WHERE user_id=?1`).bind(userId).all(),
      env.DB.prepare(`SELECT event_id,device_id,iiko_employee_id,event_time,event_type FROM hr_attendance_events WHERE user_id=?1 AND iiko_employee_id<>'' AND event_time>=?2 AND event_time<=?3 ORDER BY iiko_employee_id,event_time`).bind(userId,`${isoDayShift(from,-1)}T00:00:00.000Z`,`${isoDayShift(to,1)}T23:59:59.999Z`).all()
    ]);
    const devices=deviceRows.results||[],deviceMap=new Map(devices.map(x=>[String(x.device_id),x]));
    const employees=(employeeRows.results||[]).map(x=>({id:String(x.iiko_employee_id),code:x.employee_code||'',name:x.display_name||'',roleName:x.role_name||'',fireDate:x.fire_date||'',deleted:Boolean(x.is_deleted)}));
    const events=eventRows.results||[],byEmployee=new Map();for(const e of events){const id=String(e.iiko_employee_id||'');if(!byEmployee.has(id))byEmployee.set(id,[]);byEmployee.get(id).push(e)}
    const intervals=[],issues=[];
    for(const employee of employees){const list=byEmployee.get(employee.id)||[];if(!list.length)continue;const firstDevice=deviceMap.get(String(list[0].device_id));const zone=timeZoneOf(firstDevice?.timezone||'Asia/Baku');const r=normalizeEmployee(list,employee,zone,from,to);intervals.push(...r.intervals);for(const issue of r.issues){const p=localParts(issue.eventTime,zone);if(p.date>=from&&p.date<=to)issues.push({...issue,employeeId:employee.id,employeeCode:employee.code,employeeName:employee.name,workDate:p.date})}}
    const dayMap=new Map();
    for(const x of intervals){const key=`${x.employeeId}|${x.workDate}`;let d=dayMap.get(key);if(!d){d={employeeId:x.employeeId,employeeCode:x.employeeCode,employeeName:x.employeeName,roleName:x.roleName,workDate:x.workDate,firstIn:x.startTime,lastOut:x.endTime,workedMinutes:0,intervalCount:0,issueCount:0,status:'OK'};dayMap.set(key,d)}d.workedMinutes+=x.durationMinutes;d.intervalCount++;if(x.startTime<d.firstIn)d.firstIn=x.startTime;if(x.endTime>d.lastOut)d.lastOut=x.endTime;if(x.status!=='OK')d.status='REVIEW'}
    for(const i of issues){const key=`${i.employeeId}|${i.workDate}`;let d=dayMap.get(key);if(!d){const e=employees.find(x=>x.id===i.employeeId)||{};d={employeeId:i.employeeId,employeeCode:i.employeeCode||e.code||'',employeeName:i.employeeName||e.name||'',roleName:e.roleName||'',workDate:i.workDate,firstIn:'',lastOut:'',workedMinutes:0,intervalCount:0,issueCount:0,status:'REVIEW'};dayMap.set(key,d)}d.issueCount++;d.status='REVIEW'}
    const days=[...dayMap.values()].sort((a,b)=>a.workDate.localeCompare(b.workDate)||a.employeeName.localeCompare(b.employeeName));
    const workedMinutes=intervals.reduce((s,x)=>s+x.durationMinutes,0),employeesWithData=new Set([...intervals.map(x=>x.employeeId),...issues.map(x=>x.employeeId)]).size;
    return json({success:true,period:{from,to},engine:'RAW_IN_OUT_V1',rules:{duplicateWindowMinutes:10,longIntervalMinutes:1440},summary:{employees:employeesWithData,days:days.length,intervals:intervals.length,workedMinutes,issues:issues.length},employees,devices:devices.map(x=>({id:x.device_id,name:x.name,timezone:x.timezone||'Asia/Baku'})),days,intervals,issues});
  }catch(error){console.error('[HR-TIMESHEET-GET]',error);return json({success:false,message:error?.message||String(error)},500)}
}
