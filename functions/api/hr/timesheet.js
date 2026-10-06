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
  const required=['hr_employees','hr_devices','hr_attendance_events','hr_employee_leave_entries','hr_leave_type_settings','hr_employee_profiles','hr_role_schedules','hr_role_schedule_days','hr_employee_schedule_overrides'];
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
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_schedules (
      user_id TEXT NOT NULL,schedule_id TEXT NOT NULL,role_code TEXT NOT NULL,schedule_name TEXT NOT NULL,pattern_type TEXT NOT NULL DEFAULT 'WEEKLY',weekdays TEXT NOT NULL DEFAULT '1,2,3,4,5',work_days INTEGER NOT NULL DEFAULT 5,off_days INTEGER NOT NULL DEFAULT 2,anchor_date TEXT NOT NULL DEFAULT '',shift_start TEXT NOT NULL,shift_end TEXT NOT NULL,break_minutes INTEGER NOT NULL DEFAULT 0,valid_from TEXT NOT NULL,valid_to TEXT NOT NULL DEFAULT '',is_default INTEGER NOT NULL DEFAULT 0,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,schedule_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_schedule_days (
      user_id TEXT NOT NULL,schedule_id TEXT NOT NULL,weekday INTEGER NOT NULL,shift_start TEXT NOT NULL,shift_end TEXT NOT NULL,break_minutes INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,schedule_id,weekday)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_schedule_overrides (
      user_id TEXT NOT NULL,override_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,schedule_id TEXT NOT NULL,effective_from TEXT NOT NULL,effective_to TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,override_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_employee_schedule_current ON hr_employee_schedule_overrides(user_id,iiko_employee_id,is_active,effective_from DESC)`)
  
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

function scheduleForDate(employeeId,roleCode,date,schedules,overrides){
  const override=(overrides||[]).filter(o=>String(o.iiko_employee_id)===String(employeeId)&&Number(o.is_active)===1&&o.effective_from<=date&&(!o.effective_to||o.effective_to>=date)).sort((a,b)=>String(b.effective_from).localeCompare(String(a.effective_from)))[0];
  if(override){
    const selected=(schedules||[]).find(s=>String(s.schedule_id)===String(override.schedule_id)&&Number(s.is_active)===1);
    if(selected)return{...selected,_selectionSource:'EMPLOYEE',_overrideId:override.override_id,_overrideNote:override.note||''};
  }
  const candidates=(schedules||[]).filter(s=>s.role_code===roleCode&&s.valid_from<=date&&(!s.valid_to||s.valid_to>=date)&&Number(s.is_active)===1&&Number(s.is_default)===1).sort((a,b)=>String(b.valid_from).localeCompare(String(a.valid_from)));
  return candidates[0]?{...candidates[0],_selectionSource:'ROLE'}:null;
}
function schedulePlan(date,schedule,dayRules){
  if(!schedule){
    const c=calendarInfo(date);
    return{scheduled:c.workHours>0,plannedMinutes:c.workHours*60,shiftStart:c.workHours>0?'09:00':'',shiftEnd:c.workHours>0?(c.workHours===7?'16:00':'17:00'):'',breakMinutes:0,scheduleName:'Производственный календарь',source:'CALENDAR'};
  }
  const type=String(schedule.pattern_type||'WEEKLY').toUpperCase();
  if(type==='CYCLE'){
    const work=cycleWorkDay(date,schedule);
    return{scheduled:work,plannedMinutes:work?shiftMinutes(schedule.shift_start,schedule.shift_end,schedule.break_minutes):0,shiftStart:work?schedule.shift_start:'',shiftEnd:work?schedule.shift_end:'',breakMinutes:work?Number(schedule.break_minutes||0):0,scheduleName:schedule.schedule_name||'',source:schedule._selectionSource||'ROLE',overrideId:schedule._overrideId||'',overrideNote:schedule._overrideNote||''};
  }
  const wd=weekday1(date),rules=dayRules.get(String(schedule.schedule_id))||[];
  const rule=rules.find(x=>Number(x.weekday)===wd);
  const weekdays=String(schedule.weekdays||'').split(',').map(Number);
  const work=Boolean(rule||weekdays.includes(wd));
  const start=rule?.shift_start||schedule.shift_start,end=rule?.shift_end||schedule.shift_end,br=Number(rule?.break_minutes??schedule.break_minutes??0);
  return{scheduled:work,plannedMinutes:work?shiftMinutes(start,end,br):0,shiftStart:work?start:'',shiftEnd:work?end:'',breakMinutes:work?br:0,scheduleName:schedule.schedule_name||'',source:schedule._selectionSource||'ROLE',overrideId:schedule._overrideId||'',overrideNote:schedule._overrideNote||''};
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

    const [deviceRows,scheduleRows,dayRuleRows,typeRows]=await env.DB.batch([
      env.DB.prepare(`SELECT device_id,name,timezone FROM hr_devices WHERE user_id=?1`).bind(userId),
      env.DB.prepare(`SELECT * FROM hr_role_schedules WHERE user_id=?1 AND is_active=1 AND valid_from<=?2 AND (valid_to='' OR valid_to>=?3) ORDER BY is_default DESC,valid_from DESC`).bind(userId,to,from),
      env.DB.prepare(`SELECT schedule_id,weekday,shift_start,shift_end,break_minutes FROM hr_role_schedule_days WHERE user_id=?1`).bind(userId),
      env.DB.prepare(`SELECT leave_type,display_name FROM hr_leave_type_settings WHERE user_id=?1`).bind(userId)
    ]);

    const eventResults=[],profileResults=[],leaveResults=[],overrideResults=[];
    for(const ids of employeeChunks){
      const empIn=ids.map(()=>'?').join(',');
      const attendanceSql=`SELECT event_id,device_id,iiko_employee_id,event_time,event_type FROM hr_attendance_events WHERE user_id=? AND iiko_employee_id IN (${empIn}) AND event_time>=? AND event_time<=? ORDER BY iiko_employee_id,event_time`;
      const profileSql=`SELECT iiko_employee_id,factual_hire_date,factual_fire_date,official_hire_date,official_fire_date,work_capacity_percent FROM hr_employee_profiles WHERE user_id=? AND iiko_employee_id IN (${empIn})`;
      const leaveSql=`SELECT leave_id,iiko_employee_id,contour,leave_type,date_from,date_to,days,status,note FROM hr_employee_leave_entries WHERE user_id=? AND iiko_employee_id IN (${empIn}) AND status='APPROVED' AND date_from<=? AND date_to>=? ORDER BY date_from`;
      const overrideSql=`SELECT override_id,iiko_employee_id,schedule_id,effective_from,effective_to,note,is_active FROM hr_employee_schedule_overrides WHERE user_id=? AND iiko_employee_id IN (${empIn}) AND is_active=1 AND effective_from<=? AND (effective_to='' OR effective_to>=?)`;
      const [eventPart,profilePart,leavePart,overridePart]=await env.DB.batch([
        env.DB.prepare(attendanceSql).bind(userId,...ids,`${isoDayShift(from,-1)}T00:00:00.000Z`,`${isoDayShift(to,1)}T23:59:59.999Z`),
        env.DB.prepare(profileSql).bind(userId,...ids),
        env.DB.prepare(leaveSql).bind(userId,...ids,to,from),
        env.DB.prepare(overrideSql).bind(userId,...ids,to,from)
      ]);
      eventResults.push(...(eventPart.results||[]));
      profileResults.push(...(profilePart.results||[]));
      leaveResults.push(...(leavePart.results||[]));
      overrideResults.push(...(overridePart.results||[]));
    }

    const eventRows={results:eventResults},profileRows={results:profileResults},leaveRows={results:leaveResults},overrideRows={results:overrideResults};
    const devices=deviceRows.results||[],deviceMap=new Map(devices.map(x=>[String(x.device_id),x]));
    const profiles=new Map((profileRows.results||[]).map(x=>[String(x.iiko_employee_id),x]));
    const customTypes=new Map((typeRows.results||[]).map(x=>[x.leave_type,x.display_name]));
    const leaves=(leaveRows.results||[]).map(x=>({...x,leaveName:clean(customTypes.get(x.leave_type))||LEAVE_NAMES[x.leave_type]||x.leave_type}));
    const schedules=scheduleRows.results||[],overrides=overrideRows.results||[],dayRules=new Map();
    for(const r of dayRuleRows.results||[]){const id=String(r.schedule_id);if(!dayRules.has(id))dayRules.set(id,[]);dayRules.get(id).push(r)}

    const events=eventRows.results||[],byEmployee=new Map();for(const e of events){const id=String(e.iiko_employee_id||'');if(!byEmployee.has(id))byEmployee.set(id,[]);byEmployee.get(id).push(e)}
    const intervals=[],issues=[];
    for(const employee of employees){const list=byEmployee.get(employee.id)||[];if(!list.length)continue;const firstDevice=deviceMap.get(String(list[0].device_id));const zone=timeZoneOf(firstDevice?.timezone||'Asia/Baku');const r=normalizeEmployee(list,employee,zone,from,to);intervals.push(...r.intervals);for(const issue of r.issues){const p=localParts(issue.eventTime,zone);if(p.date>=from&&p.date<=to)issues.push({...issue,employeeId:employee.id,employeeCode:employee.code,employeeName:employee.name,workDate:p.date})}}

    const rawDayMap=new Map();
    for(const x of intervals){const key=`${x.employeeId}|${x.workDate}`;let d=rawDayMap.get(key);if(!d){d={employeeId:x.employeeId,employeeCode:x.employeeCode,employeeName:x.employeeName,roleName:x.roleName,workDate:x.workDate,firstIn:x.startTime,lastOut:x.endTime,workedMinutes:0,intervalCount:0,issueCount:0,status:'OK'};rawDayMap.set(key,d)}d.workedMinutes+=x.durationMinutes;d.intervalCount++;if(x.startTime<d.firstIn)d.firstIn=x.startTime;if(x.endTime>d.lastOut)d.lastOut=x.endTime;if(x.status!=='OK')d.status='REVIEW'}
    for(const i of issues){const key=`${i.employeeId}|${i.workDate}`;let d=rawDayMap.get(key);if(!d){const e=employees.find(x=>x.id===i.employeeId)||{};d={employeeId:i.employeeId,employeeCode:i.employeeCode||e.code||'',employeeName:i.employeeName||e.name||'',roleName:e.roleName||'',workDate:i.workDate,firstIn:'',lastOut:'',workedMinutes:0,intervalCount:0,issueCount:0,status:'REVIEW'};rawDayMap.set(key,d)}d.issueCount++;d.status='REVIEW'}

    const dates=dateList(from,to),factualDays=[],officialDays=[];
    for(const employee of employees){
      const p=profiles.get(employee.id)||{};
      const factualHire=p.factual_hire_date||employee.hireDate||'',factualFire=p.factual_fire_date||employee.fireDate||'';
      const officialHire=p.official_hire_date||employee.hireDate||'',officialFire=p.official_fire_date||employee.fireDate||'';
      const capacity=Math.max(1,Math.min(100,Number(p.work_capacity_percent||100)))/100;
      for(const date of dates){
        const raw=rawDayMap.get(`${employee.id}|${date}`)||null;
        if(employmentActive(date,factualHire,factualFire)){
          const schedule=scheduleForDate(employee.id,employee.roleCode,date,schedules,overrides),plan=schedule?schedulePlan(date,schedule,dayRules):null,leave=leaveForDate(employee.id,date,'FACTUAL',leaves);
          const worked=Number(raw?.workedMinutes||0)>0,scheduleConfigured=Boolean(schedule);
          let status;
          if(date>todayBaku())status='FUTURE';
          else if(leave)status=worked?'LEAVE_WITH_WORK':'LEAVE';
          else if(raw?.status==='REVIEW')status='REVIEW';
          else if(worked)status=!scheduleConfigured?'WORK_NO_SCHEDULE':(plan.scheduled?'WORK':'WORK_REST');
          else status=!scheduleConfigured?'NO_SCHEDULE':(plan.scheduled?'ABSENT':'REST');
          factualDays.push({
            employeeId:employee.id,employeeCode:employee.code,employeeName:employee.name,roleName:employee.roleName,departmentCode:employee.departmentCode,workDate:date,
            status,firstIn:raw?.firstIn||'',lastOut:raw?.lastOut||'',workedMinutes:Number(raw?.workedMinutes||0),intervalCount:Number(raw?.intervalCount||0),issueCount:Number(raw?.issueCount||0),
            scheduleConfigured,scheduled:Boolean(plan?.scheduled),plannedMinutes:Math.round(Number(plan?.plannedMinutes||0)*capacity),shiftStart:plan?.shiftStart||'',shiftEnd:plan?.shiftEnd||'',
            scheduleName:plan?.scheduleName||'',scheduleSource:plan?.source||'',scheduleOverrideId:plan?.overrideId||'',scheduleOverrideNote:plan?.overrideNote||'',
            leaveId:leave?.leave_id||'',leaveType:leave?.leave_type||'',leaveName:leave?.leaveName||'',leaveNote:leave?.note||''
          });
        }
        if(employmentActive(date,officialHire,officialFire)){
          const schedule=scheduleForDate(employee.id,employee.roleCode,date,schedules,overrides),plan=schedulePlan(date,schedule,dayRules),calendar=calendarInfo(date),leave=leaveForDate(employee.id,date,'OFFICIAL',leaves);
          let planned=Math.round(plan.plannedMinutes*capacity);
          let status=leave?'LEAVE':plan.scheduled?(calendar.type==='HOLIDAY'||calendar.type==='MOURNING'?'WORK_HOLIDAY':'WORK'):'REST';
          if(plan.source==='CALENDAR'&&(calendar.type==='HOLIDAY'||calendar.type==='TRANSFERRED_REST'||calendar.type==='WEEKEND'||calendar.type==='MOURNING')){status=leave?'LEAVE':'REST';planned=0}
          if(plan.source==='CALENDAR'&&calendar.type==='SHORT_WORKDAY')planned=Math.round(7*60*capacity);
          officialDays.push({
            employeeId:employee.id,employeeCode:employee.code,employeeName:employee.name,roleName:employee.roleName,departmentCode:employee.departmentCode,workDate:date,
            status,plannedMinutes:planned,shiftStart:plan.shiftStart,shiftEnd:plan.shiftEnd,breakMinutes:plan.breakMinutes,scheduleName:plan.scheduleName,scheduleSource:plan.source,scheduleOverrideId:plan.overrideId||'',scheduleOverrideNote:plan.overrideNote||'',
            calendarType:calendar.type,calendarName:calendar.name,leaveId:leave?.leave_id||'',leaveType:leave?.leave_type||'',leaveName:leave?.leaveName||'',leaveNote:leave?.note||''
          });
        }
      }
    }

    const factualSummary={
      rows:factualDays.length,workedDays:factualDays.filter(x=>['WORK','WORK_REST','REVIEW','LEAVE_WITH_WORK'].includes(x.status)&&x.workedMinutes>0).length,
      leaveDays:factualDays.filter(x=>x.status==='LEAVE').length,absentDays:factualDays.filter(x=>x.status==='ABSENT').length,
      restDays:factualDays.filter(x=>x.status==='REST').length,workedRestDays:factualDays.filter(x=>x.status==='WORK_REST').length,
      noScheduleDays:factualDays.filter(x=>x.status==='NO_SCHEDULE').length,workedNoScheduleDays:factualDays.filter(x=>x.status==='WORK_NO_SCHEDULE').length,
      workedMinutes:factualDays.reduce((s,x)=>s+x.workedMinutes,0),reviewDays:factualDays.filter(x=>['REVIEW','LEAVE_WITH_WORK'].includes(x.status)).length
    };
    const officialSummary={
      rows:officialDays.length,workDays:officialDays.filter(x=>['WORK','WORK_HOLIDAY'].includes(x.status)).length,leaveDays:officialDays.filter(x=>x.status==='LEAVE').length,
      restDays:officialDays.filter(x=>x.status==='REST').length,plannedMinutes:officialDays.reduce((s,x)=>s+x.plannedMinutes,0),holidayWorkDays:officialDays.filter(x=>x.status==='WORK_HOLIDAY').length
    };

    const [factualSnapshotHash,officialSnapshotHash]=await Promise.all([snapshotHash(factualDays,'FACTUAL'),snapshotHash(officialDays,'OFFICIAL')]);

    return json({
      success:true,period:{from,to},engine:'TIMESHEET_V2_EMPLOYEE_OVERRIDE',restaurantScope:scope?{mode:scope.mode,departmentIds:scope.selectedDepartmentIds,departmentCodes:scope.selectedDepartmentCodes}:null,
      snapshotHashes:{FACTUAL:factualSnapshotHash,OFFICIAL:officialSnapshotHash},
      rules:{duplicateWindowMinutes:10,longIntervalMinutes:900,factualFuture:'FUTURE',factualNoMarkScheduled:'ABSENT',factualNoMarkRest:'REST',factualNoRoleSchedule:'NO_SCHEDULE',factualWorkOnRest:'WORK_REST',factualWorkNoRoleSchedule:'WORK_NO_SCHEDULE',officialScheduleRestStatus:'REST',leaveSource:'HR_EMPLOYEE_LEAVE'},
      summary:{factual:factualSummary,official:officialSummary,raw:{intervals:intervals.length,issues:issues.length}},
      employees,devices:devices.map(x=>({id:x.device_id,name:x.name,timezone:x.timezone||'Asia/Baku'})),
      factualDays,officialDays,intervals,issues
    });
  }catch(error){console.error('[HR-TIMESHEET-GET]',error);return json({success:false,message:error?.message||String(error)},500)}
}
