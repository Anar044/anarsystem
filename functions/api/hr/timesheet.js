import { getUser } from '../iiko/_lib/user-state.js';
import { resolveHrRestaurantScope, filterEmployeesByScope } from './_lib/restaurant-scope.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function ymd(v){return /^\d{4}-\d{2}-\d{2}$/.test(clean(v))?clean(v):''}
function isoDayShift(day,delta){const d=new Date(`${day}T00:00:00.000Z`);d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10)}
function dateList(from,to){const out=[];for(let d=from;d<=to;d=isoDayShift(d,1))out.push(d);return out}
function minutes(ms){return Math.max(0,Math.round(ms/60000))}
function timeZoneOf(v){const z=clean(v)||'Asia/Baku';try{new Intl.DateTimeFormat('en-US',{timeZone:z}).format(new Date());return z}catch{return'Asia/Baku'}}
function todayBaku(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}catch{return new Date().toISOString().slice(0,10)}}
function localParts(value,timeZone){const d=new Date(value);if(Number.isNaN(d.getTime()))return{date:'',time:''};const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);const m=Object.fromEntries(parts.map(x=>[x.type,x.value]));return{date:`${m.year}-${m.month}-${m.day}`,time:`${m.hour}:${m.minute}`}}
function weekday1(date){const d=new Date(`${date}T00:00:00Z`).getUTCDay();return d===0?7:d}
function shiftMinutes(start,end,breakMinutes=0){if(!/^\d{2}:\d{2}$/.test(start||'')||!/^\d{2}:\d{2}$/.test(end||''))return 0;const [sh,sm]=start.split(':').map(Number),[eh,em]=end.split(':').map(Number);let m=(eh*60+em)-(sh*60+sm);if(m<=0)m+=1440;return Math.max(0,m-Math.max(0,Number(breakMinutes||0)))}
function cycleWorkDay(date,s){if(!s?.anchor_date||!Number(s.work_days||0))return false;const delta=Math.floor((new Date(`${date}T00:00:00Z`)-new Date(`${s.anchor_date}T00:00:00Z`))/86400000);if(delta<0)return false;const cycle=Math.max(1,Number(s.work_days||0)+Number(s.off_days||0));return ((delta%cycle)+cycle)%cycle<Number(s.work_days||0)}
function employmentActive(date,hire,fire){if(hire&&date<hire)return false;if(fire&&date>fire)return false;return true}
function chunkList(values,size=50){const out=[];for(let i=0;i<(values||[]).length;i+=size)out.push(values.slice(i,i+size));return out}
async function snapshotHash(rows,kind){
  const compact=(rows||[]).map(x=>kind==='FACTUAL'
    ? [x.employeeId,x.workDate,x.status,Number(x.workedMinutes||0),Number(x.plannedMinutes||0),Number(x.issueCount||0),x.leaveId||'',x.scheduleName||'',x.scheduleSource||'']
    : [x.employeeId,x.workDate,x.status,Number(x.plannedMinutes||0),x.leaveId||'',x.scheduleName||'',x.scheduleSource||'',x.calendarType||'']);
  const bytes=new TextEncoder().encode(JSON.stringify(compact));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}

const LEAVE_NAMES={MAIN:'Основной отпуск',SENIORITY:'По стажу',CHILD:'По ребёнку',DISABILITY:'Инвалидность',EXTRA_1:'Дополнительный вид 1',EXTRA_2:'Дополнительный вид 2'};
const SPECIAL_2026=new Map(Object.entries({
  '2026-01-01':['HOLIDAY','Новый год'],'2026-01-02':['HOLIDAY','Новый год'],'2026-01-20':['MOURNING','День всенародной скорби'],
  '2026-03-08':['HOLIDAY','Международный женский день'],'2026-03-20':['HOLIDAY','Новруз / Рамазан'],'2026-03-21':['HOLIDAY','Новруз / Рамазан'],
  '2026-03-22':['HOLIDAY','Новруз'],'2026-03-23':['HOLIDAY','Новруз'],'2026-03-24':['HOLIDAY','Новруз'],'2026-05-09':['HOLIDAY','День Победы над фашизмом'],
  '2026-05-27':['HOLIDAY','Гурбан байрамы'],'2026-05-28':['HOLIDAY','Гурбан байрамы / День независимости'],'2026-06-15':['HOLIDAY','День национального спасения'],
  '2026-06-26':['HOLIDAY','День Вооружённых сил'],'2026-11-08':['HOLIDAY','День Победы'],'2026-11-09':['HOLIDAY','День Государственного флага'],
  '2026-12-31':['HOLIDAY','День солидарности азербайджанцев мира'],'2026-03-09':['TRANSFERRED_REST','Перенесённый выходной'],
  '2026-03-25':['TRANSFERRED_REST','Перенесённый выходной'],'2026-03-26':['TRANSFERRED_REST','Перенесённый выходной'],'2026-03-27':['TRANSFERRED_REST','Перенесённый выходной'],
  '2026-03-30':['TRANSFERRED_REST','Перенесённый выходной'],'2026-05-11':['TRANSFERRED_REST','Перенесённый выходной'],'2026-05-29':['TRANSFERRED_REST','Перенесённый выходной'],
  '2026-11-10':['TRANSFERRED_REST','Перенесённый выходной']
}));
const SHORT_2026=new Set(['2026-01-19','2026-03-19','2026-05-08','2026-05-26','2026-06-25','2026-12-30']);
function calendarInfo(date){const sp=SPECIAL_2026.get(date);if(sp)return{type:sp[0],name:sp[1],workHours:0};const dow=new Date(`${date}T00:00:00Z`).getUTCDay();if(dow===0||dow===6)return{type:'WEEKEND',name:'Выходной',workHours:0};if(SHORT_2026.has(date))return{type:'SHORT_WORKDAY',name:'Сокращённый рабочий день',workHours:7};return{type:'WORKDAY',name:'Рабочий день',workHours:8}}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  const required=['hr_employees','hr_devices','hr_attendance_events','hr_employee_leave_entries','hr_leave_type_settings','hr_employee_profiles','hr_role_attendance_rules','hr_employee_attendance_rules'];
  try{
    const placeholders=required.map((_,i)=>`?${i+1}`).join(',');
    const check=await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${placeholders})`).bind(...required).all();
    const found=new Set((check.results||[]).map(x=>String(x.name||'')));
    if(required.every(x=>found.has(x)))return;
  }catch(error){
    console.warn('[HR-TIMESHEET-SCHEMA-CHECK]',String(error?.message||error));
  }
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
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_events_employee ON hr_attendance_events(user_id,iiko_employee_id,event_time DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_leave_entries (
      user_id TEXT NOT NULL,leave_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,contour TEXT NOT NULL,leave_type TEXT NOT NULL,date_from TEXT NOT NULL,date_to TEXT NOT NULL,days REAL NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'APPROVED',note TEXT NOT NULL DEFAULT '',actor_id TEXT NOT NULL DEFAULT '',actor_label TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,leave_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_leave_type_settings (
      user_id TEXT NOT NULL,leave_type TEXT NOT NULL,display_name TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,PRIMARY KEY(user_id,leave_type)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_profiles (
      user_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,fin TEXT NOT NULL DEFAULT '',ssn TEXT NOT NULL DEFAULT '',birth_date TEXT NOT NULL DEFAULT '',phone_primary TEXT NOT NULL DEFAULT '',phone_secondary TEXT NOT NULL DEFAULT '',email_personal TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',emergency_contact_name TEXT NOT NULL DEFAULT '',emergency_contact_relation TEXT NOT NULL DEFAULT '',emergency_contact_phone TEXT NOT NULL DEFAULT '',education_level TEXT NOT NULL DEFAULT '',education_institution TEXT NOT NULL DEFAULT '',specialty TEXT NOT NULL DEFAULT '',employment_type TEXT NOT NULL DEFAULT 'MAIN',factual_hire_date TEXT NOT NULL DEFAULT '',factual_fire_date TEXT NOT NULL DEFAULT '',official_hire_date TEXT NOT NULL DEFAULT '',official_fire_date TEXT NOT NULL DEFAULT '',official_employer_name TEXT NOT NULL DEFAULT '',official_employer_voen TEXT NOT NULL DEFAULT '',quota_category TEXT NOT NULL DEFAULT 'NONE',work_capacity_percent INTEGER NOT NULL DEFAULT 100,notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,iiko_employee_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_attendance_rules (
      user_id TEXT NOT NULL,role_code TEXT NOT NULL,daily_norm_minutes INTEGER NOT NULL DEFAULT 480,shift_type TEXT NOT NULL DEFAULT 'DAY',updated_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(user_id,role_code)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_attendance_rules (
      user_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,shift_type_override TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(user_id,iiko_employee_id)
    )`)
  ]);
}
function clockMinutes(v){const m=/^(\d{2}):(\d{2})$/.exec(String(v||''));return m?Number(m[1])*60+Number(m[2]):0}
function freeShiftMeta(shiftType){
  const type=String(shiftType||'DAY').toUpperCase()==='NIGHT'?'NIGHT':'DAY';
  return type==='NIGHT'
    ?{type,startMinute:12*60,start:'12:00',end:'11:59',label:'Ночная'}
    :{type,startMinute:5*60,start:'05:00',end:'04:59',label:'Дневная'};
}
function freeWorkDate(eventTime,timeZone,shiftType){
  const p=localParts(eventTime,timeZone),meta=freeShiftMeta(shiftType),m=clockMinutes(p.time);
  return m>=meta.startMinute?p.date:isoDayShift(p.date,-1);
}
function aggregateFreeAttendance(events,employee,timeZone,from,to,roleRule,employeeRule){
  const roleShift=['DAY','NIGHT'].includes(String(roleRule?.shift_type||'').toUpperCase())?String(roleRule.shift_type).toUpperCase():'DAY';
  const overrideShift=['DAY','NIGHT'].includes(String(employeeRule?.shift_type_override||'').toUpperCase())?String(employeeRule.shift_type_override).toUpperCase():'';
  const shiftType=overrideShift||roleShift,meta=freeShiftMeta(shiftType),normMinutes=Math.max(60,Number(roleRule?.daily_norm_minutes||480));
  const groups=new Map(),issues=[],intervals=[];
  const sorted=[...(events||[])].filter(x=>x?.event_time).sort((a,b)=>String(a.event_time).localeCompare(String(b.event_time)));
  for(const e of sorted){
    const workDate=freeWorkDate(e.event_time,timeZone,shiftType);
    if(workDate<from||workDate>to)continue;
    if(!groups.has(workDate))groups.set(workDate,[]);
    groups.get(workDate).push(e);
  }
  const days=new Map();
  for(const [workDate,items] of groups){
    const unique=[];let lastMs=null;
    for(const e of items){
      const ms=new Date(e.event_time).getTime();
      if(Number.isFinite(lastMs)&&Number.isFinite(ms)&&ms-lastMs<10000){
        issues.push({code:'DUPLICATE_MARK',eventId:e.event_id||'',eventTime:e.event_time||'',deviceId:e.device_id||'',employeeId:employee.id,employeeCode:employee.code,employeeName:employee.name,workDate});
        continue;
      }
      unique.push(e);lastMs=ms;
    }
    if(!unique.length)continue;
    const first=unique[0],last=unique[unique.length-1],complete=unique.length>=2;
    const workedMinutes=complete?minutes(new Date(last.event_time)-new Date(first.event_time)):0;
    const status=complete?'OK':'INCOMPLETE';
    if(!complete)issues.push({code:'MISSING_PAIR',eventId:first.event_id||'',eventTime:first.event_time||'',deviceId:first.device_id||'',employeeId:employee.id,employeeCode:employee.code,employeeName:employee.name,workDate});
    if(complete)intervals.push({employeeId:employee.id,employeeCode:employee.code,employeeName:employee.name,roleName:employee.roleName,workDate,startTime:first.event_time,endTime:last.event_time,startLocal:localParts(first.event_time,timeZone).time,endLocal:localParts(last.event_time,timeZone).time,durationMinutes:workedMinutes,status:'OK',startEventId:first.event_id,endEventId:last.event_id,startDeviceId:first.device_id,endDeviceId:last.device_id,markCount:unique.length,aggregation:'FIRST_LAST'});
    days.set(workDate,{employeeId:employee.id,employeeCode:employee.code,employeeName:employee.name,roleName:employee.roleName,workDate,firstIn:first.event_time,lastOut:complete?last.event_time:'',workedMinutes,intervalCount:complete?1:0,issueCount:complete?0:1,status,markCount:unique.length,shiftType,shiftLabel:meta.label,shiftStart:meta.start,shiftEnd:meta.end,normMinutes,attendanceSource:overrideShift?'EMPLOYEE':'ROLE'});
  }
  return{days,issues,intervals,shiftType,shiftMeta:meta,normMinutes,source:overrideShift?'EMPLOYEE':'ROLE'};
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
      addIssue('MISSING_OUT',open,{nextEventId:e.event_id});open=e;last=e;continue;
    }
    if(type==='OUT'){
      if(!open){const gap=last&&String(last.event_type).toUpperCase()==='OUT'?minutes(new Date(e.event_time)-new Date(last.event_time)):999999;addIssue(gap<=10?'DUPLICATE_OUT':'MISSING_IN',e,last?{relatedEventId:last.event_id}:{});last=e;continue}
      const start=new Date(open.event_time),end=new Date(e.event_time),duration=minutes(end-start);
      if(end<=start){addIssue('INVALID_ORDER',e,{relatedEventId:open.event_id});open=null;last=e;continue}
      const lp=localParts(open.event_time,timeZone);
      const status=duration>15*60?'REVIEW':'OK';
      if(status==='REVIEW')addIssue('LONG_INTERVAL',e,{relatedEventId:open.event_id,durationMinutes:duration});
      if(lp.date>=from&&lp.date<=to)intervals.push({employeeId:employee.id,employeeCode:employee.code,employeeName:employee.name,roleName:employee.roleName,workDate:lp.date,startTime:open.event_time,endTime:e.event_time,startLocal:lp.time,endLocal:localParts(e.event_time,timeZone).time,durationMinutes:duration,status,startEventId:open.event_id,endEventId:e.event_id,startDeviceId:open.device_id,endDeviceId:e.device_id});
      open=null;last=e;continue;
    }
  }
  if(open)addIssue('MISSING_OUT',open);
  return{intervals,issues};
}

function schedulePlan(date){
  const c=calendarInfo(date);
  return{scheduled:c.workHours>0,plannedMinutes:c.workHours*60,shiftStart:c.workHours>0?'09:00':'',shiftEnd:c.workHours>0?(c.workHours===7?'16:00':'17:00'):'',breakMinutes:0,scheduleName:'Производственный календарь',source:'CALENDAR'};
}
function leaveForDate(employeeId,date,contour,leaves){
  return (leaves||[]).find(x=>String(x.iiko_employee_id)===String(employeeId)&&String(x.contour)===contour&&x.status==='APPROVED'&&x.date_from<=date&&x.date_to>=date)||null;
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
    const userId=auth.user.id,scope=await resolveHrRestaurantScope(request,env,userId);

    const employeeRows=await env.DB.prepare(`SELECT iiko_employee_id,employee_code,display_name,role_code,role_name,department_code,hire_date,fire_date,is_deleted FROM hr_employees WHERE user_id=?1 AND TRIM(employee_code)<>'' ORDER BY display_name COLLATE NOCASE`).bind(userId).all();
    const scopedEmployeeRows=filterEmployeesByScope(employeeRows.results||[],scope);
    const employees=scopedEmployeeRows.map(x=>({
      id:String(x.iiko_employee_id),code:x.employee_code||'',name:x.display_name||'',roleCode:x.role_code||'',roleName:x.role_name||'',departmentCode:x.department_code||'',
      hireDate:x.hire_date||'',fireDate:x.fire_date||'',deleted:Boolean(x.is_deleted)
    }));
    const employeeIds=[...new Set(employees.map(x=>String(x.id||'')).filter(Boolean))];
    const employeeChunks=chunkList(employeeIds,50);

    const [deviceRows,typeRows,roleAttendanceRows]=await env.DB.batch([
      env.DB.prepare(`SELECT device_id,name,timezone FROM hr_devices WHERE user_id=?1`).bind(userId),
      env.DB.prepare(`SELECT leave_type,display_name FROM hr_leave_type_settings WHERE user_id=?1`).bind(userId),
      env.DB.prepare(`SELECT role_code,daily_norm_minutes,shift_type,updated_at FROM hr_role_attendance_rules WHERE user_id=?1`).bind(userId)
    ]);

    const eventResults=[],profileResults=[],leaveResults=[],employeeAttendanceResults=[];
    for(const ids of employeeChunks){
      const empIn=ids.map(()=>'?').join(',');
      const attendanceSql=`SELECT event_id,device_id,iiko_employee_id,event_time,event_type FROM hr_attendance_events WHERE user_id=? AND iiko_employee_id IN (${empIn}) AND event_time>=? AND event_time<=? ORDER BY iiko_employee_id,event_time`;
      const profileSql=`SELECT iiko_employee_id,factual_hire_date,factual_fire_date,official_hire_date,official_fire_date,work_capacity_percent FROM hr_employee_profiles WHERE user_id=? AND iiko_employee_id IN (${empIn})`;
      const leaveSql=`SELECT leave_id,iiko_employee_id,contour,leave_type,date_from,date_to,days,status,note FROM hr_employee_leave_entries WHERE user_id=? AND iiko_employee_id IN (${empIn}) AND status='APPROVED' AND date_from<=? AND date_to>=? ORDER BY date_from`;
      const attendanceRuleSql=`SELECT iiko_employee_id,shift_type_override,updated_at FROM hr_employee_attendance_rules WHERE user_id=? AND iiko_employee_id IN (${empIn})`;
      const [eventPart,profilePart,leavePart,employeeAttendancePart]=await env.DB.batch([
        env.DB.prepare(attendanceSql).bind(userId,...ids,`${isoDayShift(from,-1)}T00:00:00.000Z`,`${isoDayShift(to,1)}T23:59:59.999Z`),
        env.DB.prepare(profileSql).bind(userId,...ids),
        env.DB.prepare(leaveSql).bind(userId,...ids,to,from),
        env.DB.prepare(attendanceRuleSql).bind(userId,...ids)
      ]);
      eventResults.push(...(eventPart.results||[]));
      profileResults.push(...(profilePart.results||[]));
      leaveResults.push(...(leavePart.results||[]));
      employeeAttendanceResults.push(...(employeeAttendancePart.results||[]));
    }

    const eventRows={results:eventResults},profileRows={results:profileResults},leaveRows={results:leaveResults};
    const devices=deviceRows.results||[],deviceMap=new Map(devices.map(x=>[String(x.device_id),x]));
    const profiles=new Map((profileRows.results||[]).map(x=>[String(x.iiko_employee_id),x]));
    const customTypes=new Map((typeRows.results||[]).map(x=>[x.leave_type,x.display_name]));
    const leaves=(leaveRows.results||[]).map(x=>({...x,leaveName:clean(customTypes.get(x.leave_type))||LEAVE_NAMES[x.leave_type]||x.leave_type}));
    const roleAttendanceMap=new Map((roleAttendanceRows.results||[]).map(x=>[String(x.role_code||''),x]));
    const employeeAttendanceMap=new Map((employeeAttendanceResults||[]).map(x=>[String(x.iiko_employee_id||''),x]));

    const events=eventRows.results||[],byEmployee=new Map();for(const e of events){const id=String(e.iiko_employee_id||'');if(!byEmployee.has(id))byEmployee.set(id,[]);byEmployee.get(id).push(e)}
    const intervals=[],issues=[],rawDayMap=new Map(),attendanceConfigByEmployee=new Map();
    for(const employee of employees){
      const list=byEmployee.get(employee.id)||[],firstDevice=deviceMap.get(String(list[0]?.device_id||'')),zone=timeZoneOf(firstDevice?.timezone||'Asia/Baku');
      const roleRule=roleAttendanceMap.get(String(employee.roleCode||''))||null,employeeRule=employeeAttendanceMap.get(employee.id)||null;
      const r=aggregateFreeAttendance(list,employee,zone,from,to,roleRule,employeeRule);
      attendanceConfigByEmployee.set(employee.id,{shiftType:r.shiftType,shiftMeta:r.shiftMeta,normMinutes:r.normMinutes,source:r.source});
      intervals.push(...r.intervals);issues.push(...r.issues);
      for(const [workDate,day] of r.days)rawDayMap.set(`${employee.id}|${workDate}`,day);
    }

    const dates=dateList(from,to),factualDays=[],officialDays=[];
    for(const employee of employees){
      const p=profiles.get(employee.id)||{};
      const factualHire=p.factual_hire_date||employee.hireDate||'',factualFire=p.factual_fire_date||employee.fireDate||'';
      const officialHire=p.official_hire_date||employee.hireDate||'',officialFire=p.official_fire_date||employee.fireDate||'';
      const capacity=Math.max(1,Math.min(100,Number(p.work_capacity_percent||100)))/100;
      for(const date of dates){
        const raw=rawDayMap.get(`${employee.id}|${date}`)||null;
        if(employmentActive(date,factualHire,factualFire)){
          const leave=leaveForDate(employee.id,date,'FACTUAL',leaves),cfg=attendanceConfigByEmployee.get(employee.id)||{shiftType:'DAY',shiftMeta:freeShiftMeta('DAY'),normMinutes:480,source:'ROLE'};
          const complete=Boolean(raw&&raw.lastOut),hasMark=Boolean(raw?.firstIn),worked=complete&&Number(raw?.workedMinutes||0)>0;
          let status;
          if(date>todayBaku())status='FUTURE';
          else if(leave)status=hasMark?'LEAVE_WITH_WORK':'LEAVE';
          else if(raw?.status==='INCOMPLETE')status='INCOMPLETE';
          else if(worked)status='WORK';
          else status='FREE_NO_MARKS';
          factualDays.push({
            employeeId:employee.id,employeeCode:employee.code,employeeName:employee.name,roleName:employee.roleName,departmentCode:employee.departmentCode,workDate:date,
            status,firstIn:raw?.firstIn||'',lastOut:raw?.lastOut||'',workedMinutes:Number(raw?.workedMinutes||0),intervalCount:Number(raw?.intervalCount||0),issueCount:Number(raw?.issueCount||0),markCount:Number(raw?.markCount||0),
            scheduleConfigured:true,scheduled:hasMark,plannedMinutes:hasMark?Math.round(Number(cfg.normMinutes||480)*capacity):0,roleNormMinutes:Math.round(Number(cfg.normMinutes||480)*capacity),
            shiftType:cfg.shiftType,shiftStart:cfg.shiftMeta.start,shiftEnd:cfg.shiftMeta.end,scheduleName:`Свободный график · ${cfg.shiftMeta.label}`,scheduleSource:cfg.source==='EMPLOYEE'?'EMPLOYEE':'ROLE',scheduleOverrideId:'',scheduleOverrideNote:'',
            leaveId:leave?.leave_id||'',leaveType:leave?.leave_type||'',leaveName:leave?.leaveName||'',leaveNote:leave?.note||''
          });
        }
        if(employmentActive(date,officialHire,officialFire)){
          const plan=schedulePlan(date),calendar=calendarInfo(date),leave=leaveForDate(employee.id,date,'OFFICIAL',leaves);
          let planned=Math.round(plan.plannedMinutes*capacity);
          let status=leave?'LEAVE':plan.scheduled?(calendar.type==='HOLIDAY'||calendar.type==='MOURNING'?'WORK_HOLIDAY':'WORK'):'REST';
          if(calendar.type==='HOLIDAY'||calendar.type==='TRANSFERRED_REST'||calendar.type==='WEEKEND'||calendar.type==='MOURNING'){status=leave?'LEAVE':'REST';planned=0}
          if(calendar.type==='SHORT_WORKDAY')planned=Math.round(7*60*capacity);
          officialDays.push({
            employeeId:employee.id,employeeCode:employee.code,employeeName:employee.name,roleName:employee.roleName,departmentCode:employee.departmentCode,workDate:date,
            status,plannedMinutes:planned,shiftStart:plan.shiftStart,shiftEnd:plan.shiftEnd,breakMinutes:0,scheduleName:'Производственный календарь',scheduleSource:'CALENDAR',scheduleOverrideId:'',scheduleOverrideNote:'',
            calendarType:calendar.type,calendarName:calendar.name,leaveId:leave?.leave_id||'',leaveType:leave?.leave_type||'',leaveName:leave?.leaveName||'',leaveNote:leave?.note||''
          });
        }
      }
    }

    const factualSummary={
      rows:factualDays.length,workedDays:factualDays.filter(x=>['WORK','LEAVE_WITH_WORK'].includes(x.status)&&x.workedMinutes>0).length,
      leaveDays:factualDays.filter(x=>x.status==='LEAVE').length,absentDays:0,
      restDays:0,workedRestDays:0,
      noScheduleDays:0,workedNoScheduleDays:0,incompleteDays:factualDays.filter(x=>x.status==='INCOMPLETE').length,
      workedMinutes:factualDays.reduce((s,x)=>s+x.workedMinutes,0),reviewDays:factualDays.filter(x=>['INCOMPLETE','LEAVE_WITH_WORK'].includes(x.status)).length
    };
    const officialSummary={
      rows:officialDays.length,workDays:officialDays.filter(x=>['WORK','WORK_HOLIDAY'].includes(x.status)).length,leaveDays:officialDays.filter(x=>x.status==='LEAVE').length,
      restDays:officialDays.filter(x=>x.status==='REST').length,plannedMinutes:officialDays.reduce((s,x)=>s+x.plannedMinutes,0),holidayWorkDays:officialDays.filter(x=>x.status==='WORK_HOLIDAY').length
    };

    const [factualSnapshotHash,officialSnapshotHash]=await Promise.all([snapshotHash(factualDays,'FACTUAL'),snapshotHash(officialDays,'OFFICIAL')]);

    return json({
      success:true,period:{from,to},engine:'TIMESHEET_V4_FREE_SHIFT_PLUS_OFFICIAL_CALENDAR',restaurantScope:scope?{mode:scope.mode,departmentIds:scope.selectedDepartmentIds,departmentCodes:scope.selectedDepartmentCodes}:null,
      snapshotHashes:{FACTUAL:factualSnapshotHash,OFFICIAL:officialSnapshotHash},
      rules:{duplicateWindowSeconds:10,factualMode:'FREE_SCHEDULE_FIRST_LAST',dayShift:'05:00-04:59',nightShift:'12:00-11:59',lateness:false,earlyDeparture:false,incompleteStatus:'INCOMPLETE',noMarksStatus:'FREE_NO_MARKS',officialScheduleRestStatus:'REST',leaveSource:'HR_EMPLOYEE_LEAVE'},
      summary:{factual:factualSummary,official:officialSummary,raw:{intervals:intervals.length,issues:issues.length}},
      employees,devices:devices.map(x=>({id:x.device_id,name:x.name,timezone:x.timezone||'Asia/Baku'})),
      factualDays,officialDays,intervals,issues
    });
  }catch(error){console.error('[HR-TIMESHEET-GET]',error);return json({success:false,message:error?.message||String(error)},500)}
}
