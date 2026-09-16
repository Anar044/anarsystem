import { getUser } from '../iiko/_lib/user-state.js';
import { calculateCompensation, AZ_PAYROLL_RULE_PROFILE } from './_lib/az-payroll-rules.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function monthOnly(v){return /^\d{4}-\d{2}$/.test(clean(v))?clean(v):''}
function minutes(ms){return Math.max(0,Math.round(ms/60000))}
function round2(v){return Math.round((Number(v)||0)*100)/100}
function isoDayShift(day,delta){const d=new Date(`${day}T00:00:00.000Z`);d.setUTCDate(d.getUTCDate()+delta);return d.toISOString().slice(0,10)}
function monthBounds(month){const [y,m]=month.split('-').map(Number);const last=new Date(Date.UTC(y,m,0)).getUTCDate();return{from:`${month}-01`,to:`${month}-${String(last).padStart(2,'0')}`,year:y,month:m,days:last}}
function weekday(date){const d=new Date(`${date}T00:00:00Z`).getUTCDay();return d===0?7:d}
function shiftMinutes(start,end,breakMinutes=0){const [sh,sm]=String(start||'00:00').split(':').map(Number),[eh,em]=String(end||'00:00').split(':').map(Number);let a=sh*60+sm,b=eh*60+em;if(b<=a)b+=1440;return Math.max(0,b-a-Number(breakMinutes||0))}
function localParts(value,timeZone='Asia/Baku'){const d=new Date(value);if(Number.isNaN(d.getTime()))return{date:'',time:''};const parts=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(d);const m=Object.fromEntries(parts.map(x=>[x.type,x.value]));return{date:`${m.year}-${m.month}-${m.day}`,time:`${m.hour}:${m.minute}`}}

const MONTH_NORMS_2026={1:{days:19,hours:151},2:{days:20,hours:160},3:{days:14,hours:111},4:{days:22,hours:176},5:{days:17,hours:134},6:{days:20,hours:159},7:{days:23,hours:184},8:{days:21,hours:168},9:{days:22,hours:176},10:{days:22,hours:176},11:{days:19,hours:152},12:{days:22,hours:175}};

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employees (user_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,employee_code TEXT NOT NULL DEFAULT '',first_name TEXT NOT NULL DEFAULT '',middle_name TEXT NOT NULL DEFAULT '',last_name TEXT NOT NULL DEFAULT '',display_name TEXT NOT NULL DEFAULT '',role_code TEXT NOT NULL DEFAULT '',role_name TEXT NOT NULL DEFAULT '',department_code TEXT NOT NULL DEFAULT '',hire_date TEXT NOT NULL DEFAULT '',fire_date TEXT NOT NULL DEFAULT '',is_deleted INTEGER NOT NULL DEFAULT 0,synced_at TEXT NOT NULL,PRIMARY KEY(user_id,iiko_employee_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_compensation_terms (user_id TEXT NOT NULL,term_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,effective_from TEXT NOT NULL,effective_to TEXT NOT NULL DEFAULT '',official_gross REAL NOT NULL DEFAULT 0,additional_amount REAL NOT NULL DEFAULT 0,additional_payment_method TEXT NOT NULL DEFAULT 'CASH',additional_tax_treatment TEXT NOT NULL DEFAULT 'TAXABLE',additional_legal_basis TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,term_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_compensation_terms (user_id TEXT NOT NULL,term_id TEXT NOT NULL,role_code TEXT NOT NULL,effective_from TEXT NOT NULL,effective_to TEXT NOT NULL DEFAULT '',official_gross REAL NOT NULL DEFAULT 0,additional_amount REAL NOT NULL DEFAULT 0,additional_payment_method TEXT NOT NULL DEFAULT 'CASH',additional_tax_treatment TEXT NOT NULL DEFAULT 'TAXABLE',additional_legal_basis TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,term_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_schedules (user_id TEXT NOT NULL,schedule_id TEXT NOT NULL,role_code TEXT NOT NULL,schedule_name TEXT NOT NULL,pattern_type TEXT NOT NULL DEFAULT 'WEEKLY',weekdays TEXT NOT NULL DEFAULT '1,2,3,4,5',work_days INTEGER NOT NULL DEFAULT 5,off_days INTEGER NOT NULL DEFAULT 2,anchor_date TEXT NOT NULL DEFAULT '',shift_start TEXT NOT NULL,shift_end TEXT NOT NULL,break_minutes INTEGER NOT NULL DEFAULT 0,valid_from TEXT NOT NULL,valid_to TEXT NOT NULL DEFAULT '',is_default INTEGER NOT NULL DEFAULT 0,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,schedule_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_schedule_days (user_id TEXT NOT NULL,schedule_id TEXT NOT NULL,weekday INTEGER NOT NULL,shift_start TEXT NOT NULL,shift_end TEXT NOT NULL,break_minutes INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,schedule_id,weekday))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_attendance_events (user_id TEXT NOT NULL,event_id TEXT NOT NULL,device_id TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'ZKTECO',source_uid TEXT NOT NULL,external_employee_id TEXT NOT NULL DEFAULT '',iiko_employee_id TEXT NOT NULL DEFAULT '',event_time TEXT NOT NULL,event_type TEXT NOT NULL DEFAULT 'UNKNOWN',raw_payload TEXT NOT NULL DEFAULT '{}',imported_at TEXT NOT NULL,PRIMARY KEY(user_id,event_id),UNIQUE(user_id,device_id,source_uid))`)
  ]);
}

function termDto(r,key){return r?{id:r.term_id,[key]:r[key==='employeeId'?'iiko_employee_id':'role_code'],effectiveFrom:r.effective_from,effectiveTo:r.effective_to||'',officialGross:round2(r.official_gross),additionalAmount:round2(r.additional_amount),additionalPaymentMethod:r.additional_payment_method||'CASH',additionalTaxTreatment:r.additional_tax_treatment||'TAXABLE',additionalLegalBasis:r.additional_legal_basis||'',note:r.note||''}:null}
function activeTerm(rows,key,value,asOf){return rows.find(r=>String(r[key])===String(value)&&r.effective_from<=asOf&&(!r.effective_to||r.effective_to>=asOf))||null}
function overlapTermCount(rows,key,value,from,to){return rows.filter(r=>String(r[key])===String(value)&&r.effective_from<=to&&(!r.effective_to||r.effective_to>=from)).length}

function normalizeEmployee(events,from,to){
  const sorted=[...events].sort((a,b)=>String(a.event_time).localeCompare(String(b.event_time))),intervals=[];let open=null,issues=0,last=null;
  for(const e of sorted){const type=String(e.event_type||'UNKNOWN').toUpperCase();
    if(type==='UNKNOWN'){issues++;last=e;continue}
    if(type==='IN'){if(!open){open=e;last=e;continue}const gap=minutes(new Date(e.event_time)-new Date(open.event_time));if(gap<=10){issues++;last=e;continue}issues++;open=e;last=e;continue}
    if(type==='OUT'){if(!open){issues++;last=e;continue}const start=new Date(open.event_time),end=new Date(e.event_time),duration=minutes(end-start);if(end<=start){issues++;open=null;last=e;continue}const lp=localParts(open.event_time);if(duration>1440)issues++;if(lp.date>=from&&lp.date<=to)intervals.push({workDate:lp.date,durationMinutes:duration});open=null;last=e}
  }
  if(open)issues++;
  return{intervals,issues};
}

function plannedMinutesForSchedule(schedule,dayRules,from,to){
  if(!schedule)return 0;let total=0;const rules=new Map(dayRules.map(r=>[Number(r.weekday),r]));
  for(let date=from;date<=to;date=isoDayShift(date,1)){
    if(date<schedule.valid_from||(schedule.valid_to&&date>schedule.valid_to))continue;
    if(schedule.pattern_type==='CYCLE'){
      if(!schedule.anchor_date)continue;const diff=Math.floor((new Date(`${date}T00:00:00Z`)-new Date(`${schedule.anchor_date}T00:00:00Z`))/86400000);if(diff<0)continue;const cycle=Number(schedule.work_days||0)+Number(schedule.off_days||0);if(!cycle)continue;const pos=((diff%cycle)+cycle)%cycle;if(pos<Number(schedule.work_days||0))total+=shiftMinutes(schedule.shift_start,schedule.shift_end,schedule.break_minutes);
    }else{
      const r=rules.get(weekday(date));if(r)total+=shiftMinutes(r.shift_start,r.shift_end,r.break_minutes);else{const list=String(schedule.weekdays||'').split(',').map(Number);if(list.includes(weekday(date)))total+=shiftMinutes(schedule.shift_start,schedule.shift_end,schedule.break_minutes)}
    }
  }
  return total;
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){
  try{
    const auth=await getUser(request,env);if(!auth)return json({success:false,message:'Требуется авторизация'},401);await ensure(env.DB);
    const url=new URL(request.url),fallback=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit'}).format(new Date()),month=monthOnly(url.searchParams.get('month'))||fallback,b=monthBounds(month);
    if(b.year!==2026)return json({success:false,message:'В HR Preview производственный календарь Payroll пока настроен на 2026 год.'},400);
    const userId=auth.user.id,norm=MONTH_NORMS_2026[b.month];
    const [employeesR,employeeTermsR,roleTermsR,schedulesR,daysR,eventsR]=await Promise.all([
      env.DB.prepare(`SELECT iiko_employee_id,employee_code,display_name,first_name,middle_name,last_name,role_code,role_name,hire_date,fire_date,is_deleted FROM hr_employees WHERE user_id=?1 AND TRIM(employee_code)<>'' ORDER BY display_name COLLATE NOCASE`).bind(userId).all(),
      env.DB.prepare(`SELECT * FROM hr_compensation_terms WHERE user_id=?1 AND is_active=1 ORDER BY iiko_employee_id,effective_from DESC`).bind(userId).all(),
      env.DB.prepare(`SELECT * FROM hr_role_compensation_terms WHERE user_id=?1 AND is_active=1 ORDER BY role_code,effective_from DESC`).bind(userId).all(),
      env.DB.prepare(`SELECT * FROM hr_role_schedules WHERE user_id=?1 AND is_active=1 AND is_default=1 AND valid_from<=?3 AND (valid_to='' OR valid_to>=?2) ORDER BY role_code,valid_from DESC`).bind(userId,b.from,b.to).all(),
      env.DB.prepare(`SELECT * FROM hr_role_schedule_days WHERE user_id=?1 ORDER BY schedule_id,weekday`).bind(userId).all(),
      env.DB.prepare(`SELECT event_id,device_id,iiko_employee_id,event_time,event_type FROM hr_attendance_events WHERE user_id=?1 AND iiko_employee_id<>'' AND event_time>=?2 AND event_time<=?3 ORDER BY iiko_employee_id,event_time`).bind(userId,`${isoDayShift(b.from,-1)}T00:00:00.000Z`,`${isoDayShift(b.to,1)}T23:59:59.999Z`).all()
    ]);
    const employeeTerms=employeeTermsR.results||[],roleTerms=roleTermsR.results||[],schedules=schedulesR.results||[],scheduleDays=daysR.results||[];
    const scheduleByRole=new Map();for(const s of schedules){if(!scheduleByRole.has(String(s.role_code)))scheduleByRole.set(String(s.role_code),s)}
    const dayRulesBySchedule=new Map();for(const d of scheduleDays){const id=String(d.schedule_id);if(!dayRulesBySchedule.has(id))dayRulesBySchedule.set(id,[]);dayRulesBySchedule.get(id).push(d)}
    const eventsByEmployee=new Map();for(const e of eventsR.results||[]){const id=String(e.iiko_employee_id||'');if(!eventsByEmployee.has(id))eventsByEmployee.set(id,[]);eventsByEmployee.get(id).push(e)}
    const rows=[];
    for(const e of employeesR.results||[]){if(Number(e.is_deleted))continue;if(e.hire_date&&e.hire_date>b.to)continue;if(e.fire_date&&e.fire_date<b.from)continue;
      const id=String(e.iiko_employee_id),roleCode=String(e.role_code||''),full=[e.last_name,e.first_name,e.middle_name].filter(Boolean).join(' ')||e.display_name||e.employee_code||id;
      const individualRaw=activeTerm(employeeTerms,'iiko_employee_id',id,b.to),roleRaw=activeTerm(roleTerms,'role_code',roleCode,b.to),termRaw=individualRaw||roleRaw,sourceType=individualRaw?'EMPLOYEE':(roleRaw?'ROLE':'');
      const term=individualRaw?termDto(individualRaw,'employeeId'):(roleRaw?termDto(roleRaw,'roleCode'):null),calculation=term?calculateCompensation({officialGross:term.officialGross,additionalAmount:term.additionalAmount,additionalTaxTreatment:term.additionalTaxTreatment,calculationDate:b.to}):null;
      const schedule=scheduleByRole.get(roleCode)||null,dayRules=schedule?dayRulesBySchedule.get(String(schedule.schedule_id))||[]:[],plannedMinutes=plannedMinutesForSchedule(schedule,dayRules,b.from,b.to);
      const attendance=normalizeEmployee(eventsByEmployee.get(id)||[],b.from,b.to),actualMinutes=attendance.intervals.reduce((a,x)=>a+x.durationMinutes,0),normMinutes=norm.hours*60,varianceMinutes=actualMinutes-(plannedMinutes||normMinutes);
      const termChanges=overlapTermCount(employeeTerms,'iiko_employee_id',id,b.from,b.to)+(individualRaw?0:overlapTermCount(roleTerms,'role_code',roleCode,b.from,b.to));
      let status='READY';const flags=[];if(!term){status='NO_TERMS';flags.push('Нет условий оплаты')}if(attendance.issues){status='REVIEW';flags.push(`Ошибки табеля: ${attendance.issues}`)}if(termChanges>1){status='REVIEW';flags.push('Изменение условий внутри месяца')}if(Math.abs(varianceMinutes)>=60){status='REVIEW';flags.push('Есть отклонение факта от плана')}
      rows.push({employeeId:id,employeeCode:e.employee_code||'',employeeName:full,roleCode,roleName:e.role_name||roleCode,sourceType,term,schedule:schedule?{id:schedule.schedule_id,name:schedule.schedule_name,patternType:schedule.pattern_type}:null,normMinutes,plannedMinutes:plannedMinutes||normMinutes,actualMinutes,varianceMinutes,attendanceIssues:attendance.issues,status,flags,calculation});
    }
    const configured=rows.filter(r=>r.calculation),sum=k=>round2(configured.reduce((a,r)=>a+Number(r.calculation?.[k]||0),0));
    const totals={officialGross:round2(configured.reduce((a,r)=>a+Number(r.calculation?.official?.gross||0),0)),officialNet:round2(configured.reduce((a,r)=>a+Number(r.calculation?.official?.net||0),0)),additional:round2(configured.reduce((a,r)=>a+Number(r.term?.additionalAmount||0),0)),employeeReceives:sum('totalEmployeeReceives'),employerCost:sum('totalEmployerCost')};
    return json({success:true,engine:'MONTHLY_PAYROLL_PREVIEW_V1',month,period:{from:b.from,to:b.to},currency:'AZN',ruleProfile:AZ_PAYROLL_RULE_PROFILE,calendar:{year:2026,workDays:norm.days,normHours:norm.hours,source:'ƏƏSMN 2026 istehsalat təqvimi'},summary:{employees:rows.length,configured:configured.length,ready:rows.filter(r=>r.status==='READY').length,review:rows.filter(r=>r.status==='REVIEW').length,withoutTerms:rows.filter(r=>r.status==='NO_TERMS').length,normMinutes:rows.length*norm.hours*60,actualMinutes:rows.reduce((a,r)=>a+r.actualMinutes,0)},totals,rows,notes:['Черновой Payroll: отклонение Face ID само по себе не уменьшает оклад.','Отпуска, больничные, ночные, праздничные и сверхурочные будут отдельными подтверждёнными начислениями/удержаниями.','Для сменных графиков план берётся из основного графика должности; индивидуальные назначения смен A/B будут добавлены отдельным слоем.']});
  }catch(e){console.error('[HR-PAYROLL-GET]',e);return json({success:false,message:e?.message||String(e)},500)}
}
