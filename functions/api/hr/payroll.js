import { getUser } from '../iiko/_lib/user-state.js';
import { resolveHrRestaurantScope, filterEmployeesByScope } from './_lib/restaurant-scope.js';
import { calculateCompensation, AZ_PAYROLL_RULE_PROFILE } from './_lib/az-payroll-rules.js';
import { syncOvertimeAccrualPosting } from './_lib/payroll-accounting.js';

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
function chunkList(values,size=50){const out=[];for(let i=0;i<(values||[]).length;i+=size)out.push(values.slice(i,i+size));return out}
const NON_WORKING_2026=new Set([
  '2026-01-01','2026-01-02','2026-01-20','2026-03-08','2026-03-09','2026-03-20','2026-03-21','2026-03-22','2026-03-23','2026-03-24','2026-03-25','2026-03-26','2026-03-27','2026-03-30',
  '2026-05-09','2026-05-11','2026-05-27','2026-05-28','2026-05-29','2026-06-15','2026-06-26','2026-11-08','2026-11-09','2026-11-10','2026-12-31'
]);
function isProductionWorkDay(date){const dow=new Date(`${date}T00:00:00Z`).getUTCDay();return dow!==0&&dow!==6&&!NON_WORKING_2026.has(date)}
function workDaysBetween(from,to){if(!from||!to||from>to)return 0;let n=0;for(let d=from;d<=to;d=isoDayShift(d,1))if(isProductionWorkDay(d))n++;return n}
function clampDate(v,min,max){if(!v)return'';return v<min?min:(v>max?max:v)}
function activePeriod(from,to,hire,fire){
  const start=hire&&hire>from?hire:from,end=fire&&fire<to?fire:to;
  return start<=end?{from:start,to:end}:{from:'',to:''};
}
function overtimeRuleFor(employeeId,rules){
  const specific=(rules||[]).find(x=>String(x.iiko_employee_id)===String(employeeId));
  const global=(rules||[]).find(x=>String(x.iiko_employee_id)==='*'),base=specific||global||null;
  const threshold=Math.max(1,Number(base?.threshold_minutes||600)),payable=Math.max(threshold,Number(base?.payable_from_minutes||threshold));
  return{thresholdMinutes:threshold,payableFromMinutes:payable,source:specific?'EMPLOYEE':global?'GLOBAL':'DEFAULT',note:base?.note||''};
}

const MONTH_NORMS_2026={1:{days:19,hours:151},2:{days:20,hours:160},3:{days:14,hours:111},4:{days:22,hours:176},5:{days:17,hours:134},6:{days:20,hours:159},7:{days:23,hours:184},8:{days:21,hours:168},9:{days:22,hours:176},10:{days:22,hours:176},11:{days:19,hours:152},12:{days:22,hours:175}};

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employees (user_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,employee_code TEXT NOT NULL DEFAULT '',first_name TEXT NOT NULL DEFAULT '',middle_name TEXT NOT NULL DEFAULT '',last_name TEXT NOT NULL DEFAULT '',display_name TEXT NOT NULL DEFAULT '',role_code TEXT NOT NULL DEFAULT '',role_name TEXT NOT NULL DEFAULT '',department_code TEXT NOT NULL DEFAULT '',hire_date TEXT NOT NULL DEFAULT '',fire_date TEXT NOT NULL DEFAULT '',is_deleted INTEGER NOT NULL DEFAULT 0,synced_at TEXT NOT NULL,PRIMARY KEY(user_id,iiko_employee_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_compensation_terms (user_id TEXT NOT NULL,term_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,effective_from TEXT NOT NULL,effective_to TEXT NOT NULL DEFAULT '',official_gross REAL NOT NULL DEFAULT 0,additional_amount REAL NOT NULL DEFAULT 0,additional_payment_method TEXT NOT NULL DEFAULT 'CASH',additional_tax_treatment TEXT NOT NULL DEFAULT 'TAXABLE',additional_legal_basis TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,term_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_compensation_terms (user_id TEXT NOT NULL,term_id TEXT NOT NULL,role_code TEXT NOT NULL,effective_from TEXT NOT NULL,effective_to TEXT NOT NULL DEFAULT '',official_gross REAL NOT NULL DEFAULT 0,additional_amount REAL NOT NULL DEFAULT 0,additional_payment_method TEXT NOT NULL DEFAULT 'CASH',additional_tax_treatment TEXT NOT NULL DEFAULT 'TAXABLE',additional_legal_basis TEXT NOT NULL DEFAULT '',note TEXT NOT NULL DEFAULT '',is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,term_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_schedules (user_id TEXT NOT NULL,schedule_id TEXT NOT NULL,role_code TEXT NOT NULL,schedule_name TEXT NOT NULL,pattern_type TEXT NOT NULL DEFAULT 'WEEKLY',weekdays TEXT NOT NULL DEFAULT '1,2,3,4,5',work_days INTEGER NOT NULL DEFAULT 5,off_days INTEGER NOT NULL DEFAULT 2,anchor_date TEXT NOT NULL DEFAULT '',shift_start TEXT NOT NULL,shift_end TEXT NOT NULL,break_minutes INTEGER NOT NULL DEFAULT 0,valid_from TEXT NOT NULL,valid_to TEXT NOT NULL DEFAULT '',is_default INTEGER NOT NULL DEFAULT 0,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,schedule_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_schedule_days (user_id TEXT NOT NULL,schedule_id TEXT NOT NULL,weekday INTEGER NOT NULL,shift_start TEXT NOT NULL,shift_end TEXT NOT NULL,break_minutes INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(user_id,schedule_id,weekday))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_attendance_events (user_id TEXT NOT NULL,event_id TEXT NOT NULL,device_id TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'ZKTECO',source_uid TEXT NOT NULL,external_employee_id TEXT NOT NULL DEFAULT '',iiko_employee_id TEXT NOT NULL DEFAULT '',event_time TEXT NOT NULL,event_type TEXT NOT NULL DEFAULT 'UNKNOWN',raw_payload TEXT NOT NULL DEFAULT '{}',imported_at TEXT NOT NULL,PRIMARY KEY(user_id,event_id),UNIQUE(user_id,device_id,source_uid))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_devices (user_id TEXT NOT NULL,device_id TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'ZKTECO',name TEXT NOT NULL,location TEXT NOT NULL DEFAULT '',connection_mode TEXT NOT NULL DEFAULT 'LOCAL_CONNECTOR',timezone TEXT NOT NULL DEFAULT 'Asia/Baku',is_active INTEGER NOT NULL DEFAULT 1,last_sync_at TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,device_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_profiles (user_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,fin TEXT NOT NULL DEFAULT '',ssn TEXT NOT NULL DEFAULT '',birth_date TEXT NOT NULL DEFAULT '',phone_primary TEXT NOT NULL DEFAULT '',phone_secondary TEXT NOT NULL DEFAULT '',email_personal TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',emergency_contact_name TEXT NOT NULL DEFAULT '',emergency_contact_relation TEXT NOT NULL DEFAULT '',emergency_contact_phone TEXT NOT NULL DEFAULT '',education_level TEXT NOT NULL DEFAULT '',education_institution TEXT NOT NULL DEFAULT '',specialty TEXT NOT NULL DEFAULT '',employment_type TEXT NOT NULL DEFAULT 'MAIN',factual_hire_date TEXT NOT NULL DEFAULT '',factual_fire_date TEXT NOT NULL DEFAULT '',official_hire_date TEXT NOT NULL DEFAULT '',official_fire_date TEXT NOT NULL DEFAULT '',official_employer_name TEXT NOT NULL DEFAULT '',official_employer_voen TEXT NOT NULL DEFAULT '',quota_category TEXT NOT NULL DEFAULT 'NONE',work_capacity_percent INTEGER NOT NULL DEFAULT 100,notes TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,iiko_employee_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_overtime_payroll_accruals (
      user_id TEXT NOT NULL,
      month TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      payable_minutes REAL NOT NULL DEFAULT 0,
      extra_day_equivalent REAL NOT NULL DEFAULT 0,
      source_version TEXT NOT NULL DEFAULT 'PAYROLL_V2',
      calculated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,month,iiko_employee_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_overtime_payroll_accruals_employee ON hr_overtime_payroll_accruals(user_id,iiko_employee_id,month)`)
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
    const scope=await resolveHrRestaurantScope(request,env,userId);
    const [employeesR,employeeTermsR,roleTermsR,schedulesR,daysR,devicesR,profilesR]=await Promise.all([
      env.DB.prepare(`SELECT iiko_employee_id,employee_code,display_name,first_name,middle_name,last_name,role_code,role_name,department_code,hire_date,fire_date,is_deleted FROM hr_employees WHERE user_id=?1 AND TRIM(employee_code)<>'' ORDER BY display_name COLLATE NOCASE`).bind(userId).all(),
      env.DB.prepare(`SELECT * FROM hr_compensation_terms WHERE user_id=?1 AND is_active=1 ORDER BY iiko_employee_id,effective_from DESC`).bind(userId).all(),
      env.DB.prepare(`SELECT * FROM hr_role_compensation_terms WHERE user_id=?1 AND is_active=1 ORDER BY role_code,effective_from DESC`).bind(userId).all(),
      env.DB.prepare(`SELECT * FROM hr_role_schedules WHERE user_id=?1 AND is_active=1 AND is_default=1 AND valid_from<=?3 AND (valid_to='' OR valid_to>=?2) ORDER BY role_code,valid_from DESC`).bind(userId,b.from,b.to).all(),
      env.DB.prepare(`SELECT * FROM hr_role_schedule_days WHERE user_id=?1 ORDER BY schedule_id,weekday`).bind(userId).all(),
      env.DB.prepare(`SELECT device_id,name,timezone,is_active,last_sync_at FROM hr_devices WHERE user_id=?1 AND is_active=1 ORDER BY name`).bind(userId).all(),
      env.DB.prepare(`SELECT iiko_employee_id,factual_hire_date,factual_fire_date,official_hire_date,official_fire_date,work_capacity_percent FROM hr_employee_profiles WHERE user_id=?1`).bind(userId).all()
    ]);
    const employeeTerms=employeeTermsR.results||[],roleTerms=roleTermsR.results||[],schedules=schedulesR.results||[],scheduleDays=daysR.results||[],activeDevices=devicesR.results||[];
    const profiles=new Map((profilesR.results||[]).map(x=>[String(x.iiko_employee_id),x]));
    const scheduleByRole=new Map();for(const s of schedules){if(!scheduleByRole.has(String(s.role_code)))scheduleByRole.set(String(s.role_code),s)}
    const dayRulesBySchedule=new Map();for(const d of scheduleDays){const id=String(d.schedule_id);if(!dayRulesBySchedule.has(id))dayRulesBySchedule.set(id,[]);dayRulesBySchedule.get(id).push(d)}
    const rows=[];
    const scopedEmployees=filterEmployeesByScope(employeesR.results||[],scope);
    const scopedIds=[...new Set(scopedEmployees.filter(e=>!Number(e.is_deleted)).map(e=>String(e.iiko_employee_id||'')).filter(Boolean))];
    const faceIdConnected=activeDevices.length>0;
    const eventsByEmployee=new Map(),overtimeByEmployee=new Map();
    let overtimeRules=[];
    if(faceIdConnected&&scopedIds.length){
      for(const ids of chunkList(scopedIds,50)){
        const qs=ids.map(()=>'?').join(',');
        const part=await env.DB.prepare(`SELECT event_id,device_id,iiko_employee_id,event_time,event_type FROM hr_attendance_events WHERE user_id=? AND iiko_employee_id IN (${qs}) AND event_time>=? AND event_time<=? ORDER BY iiko_employee_id,event_time`).bind(userId,...ids,`${isoDayShift(b.from,-1)}T00:00:00.000Z`,`${isoDayShift(b.to,1)}T23:59:59.999Z`).all();
        for(const e of part.results||[]){const id=String(e.iiko_employee_id||'');if(!eventsByEmployee.has(id))eventsByEmployee.set(id,[]);eventsByEmployee.get(id).push(e)}
      }
    }
    if(scopedIds.length){
      try{
        const rulesR=await env.DB.prepare(`SELECT iiko_employee_id,threshold_minutes,payable_from_minutes,note FROM hr_overtime_rules WHERE user_id=?1`).bind(userId).all();
        overtimeRules=rulesR.results||[];
        for(const ids of chunkList(scopedIds,50)){
          const qs=ids.map(()=>'?').join(',');
          const part=await env.DB.prepare(`SELECT iiko_employee_id,work_date,candidate_minutes,requested_minutes,approved_minutes,status FROM hr_overtime_requests WHERE user_id=? AND iiko_employee_id IN (${qs}) AND work_date>=? AND work_date<=? AND status IN ('HR_APPROVED','HR_CHANGED')`).bind(userId,...ids,b.from,b.to).all();
          for(const x of part.results||[]){
            const id=String(x.iiko_employee_id||''),rule=overtimeRuleFor(id,overtimeRules),candidate=Math.max(0,Number(x.candidate_minutes||0)),approved=Math.max(0,Number(x.approved_minutes||0));
            const unpaidGap=Math.max(0,rule.payableFromMinutes-rule.thresholdMinutes),payableCandidate=Math.max(0,candidate-unpaidGap),payableApproved=Math.min(approved,payableCandidate);
            const cur=overtimeByEmployee.get(id)||{approvedMinutes:0,payableMinutes:0,unpaidGapMinutes:0,candidateMinutes:0,extraDayEquivalent:0,days:0};
            cur.approvedMinutes+=approved;cur.payableMinutes+=payableApproved;cur.unpaidGapMinutes+=Math.min(candidate,unpaidGap);cur.candidateMinutes+=candidate;cur.extraDayEquivalent+=rule.thresholdMinutes>0?payableApproved/rule.thresholdMinutes:0;cur.days++;
            overtimeByEmployee.set(id,cur);
          }
        }
      }catch(error){
        if(!/no such table|does not exist/i.test(String(error?.message||error)))console.warn('[HR-PAYROLL-OVERTIME]',error);
      }
    }
    for(const e of scopedEmployees){if(Number(e.is_deleted))continue;if(e.hire_date&&e.hire_date>b.to)continue;if(e.fire_date&&e.fire_date<b.from)continue;
      const id=String(e.iiko_employee_id),roleCode=String(e.role_code||''),full=[e.last_name,e.first_name,e.middle_name].filter(Boolean).join(' ')||e.display_name||e.employee_code||id;
      const individualRaw=activeTerm(employeeTerms,'iiko_employee_id',id,b.to),roleRaw=activeTerm(roleTerms,'role_code',roleCode,b.to),termRaw=individualRaw||roleRaw,sourceType=individualRaw?'EMPLOYEE':(roleRaw?'ROLE':'');
      const term=individualRaw?termDto(individualRaw,'employeeId'):(roleRaw?termDto(roleRaw,'roleCode'):null),calculation=term?calculateCompensation({officialGross:term.officialGross,additionalAmount:term.additionalAmount,additionalTaxTreatment:term.additionalTaxTreatment,calculationDate:b.to}):null;
      const schedule=scheduleByRole.get(roleCode)||null,dayRules=schedule?dayRulesBySchedule.get(String(schedule.schedule_id))||[]:[],plannedMinutes=plannedMinutesForSchedule(schedule,dayRules,b.from,b.to);
      const attendance=faceIdConnected?normalizeEmployee(eventsByEmployee.get(id)||[],b.from,b.to):{intervals:[],issues:0};
      const actualMinutes=faceIdConnected?attendance.intervals.reduce((a,x)=>a+x.durationMinutes,0):null,normMinutes=norm.hours*60,varianceMinutes=faceIdConnected?actualMinutes-(plannedMinutes||normMinutes):null;
      const profile=profiles.get(id)||{},factualHire=profile.factual_hire_date||e.hire_date||'',factualFire=profile.factual_fire_date||e.fire_date||'',officialHire=profile.official_hire_date||e.hire_date||'',officialFire=profile.official_fire_date||e.fire_date||'';
      const factualPeriod=activePeriod(b.from,b.to,factualHire,factualFire),officialPeriod=activePeriod(b.from,b.to,officialHire,officialFire);
      const factualPayDays=factualPeriod.from?workDaysBetween(factualPeriod.from,factualPeriod.to):0,officialPayDays=officialPeriod.from?workDaysBetween(officialPeriod.from,officialPeriod.to):0;
      const factualFactor=norm.days>0?Math.min(1,factualPayDays/norm.days):0,officialFactor=norm.days>0?Math.min(1,officialPayDays/norm.days):0;
      const monthlyFactualGross=term?round2(Number(term.officialGross||0)+Number(term.additionalAmount||0)):0;
      const factualBaseGross=round2(monthlyFactualGross*factualFactor),officialAccruedGross=round2(Number(term?.officialGross||0)*officialFactor),additionalAccruedGross=round2(Math.max(0,factualBaseGross-officialAccruedGross));
      const ot=overtimeByEmployee.get(id)||{approvedMinutes:0,payableMinutes:0,unpaidGapMinutes:0,candidateMinutes:0,extraDayEquivalent:0,days:0};
      const otRule=overtimeRuleFor(id,overtimeRules),extraDayPay=term&&norm.days>0?round2(monthlyFactualGross/norm.days*Number(ot.extraDayEquivalent||0)):0;
      const termChanges=overlapTermCount(employeeTerms,'iiko_employee_id',id,b.from,b.to)+(individualRaw?0:overlapTermCount(roleTerms,'role_code',roleCode,b.from,b.to));
      let status='READY';const flags=[];if(!term){status='NO_TERMS';flags.push('Нет условий оплаты')}if(faceIdConnected&&attendance.issues){status='REVIEW';flags.push(`Ошибки табеля: ${attendance.issues}`)}if(termChanges>1){status='REVIEW';flags.push('Изменение условий внутри месяца')}if(faceIdConnected&&Math.abs(varianceMinutes)>=60){status='REVIEW';flags.push('Есть отклонение факта от плана')}
      if(term&&factualPayDays<norm.days)flags.push(`Неполный месяц: ${factualPayDays} из ${norm.days} раб. дней`);
      if(Number(ot.payableMinutes||0)>0)flags.push(`Доп. часы к отдельной оплате: ${Math.round(ot.payableMinutes)} мин`);
      if(Number(ot.unpaidGapMinutes||0)>0)flags.push(`Неоплачиваемый промежуток доп. часов: ${Math.round(ot.unpaidGapMinutes)} мин`);
      rows.push({
        employeeId:id,employeeCode:e.employee_code||'',employeeName:full,departmentCode:e.department_code||'',roleCode,roleName:e.role_name||roleCode,sourceType,term,
        schedule:schedule?{id:schedule.schedule_id,name:schedule.schedule_name,patternType:schedule.pattern_type}:null,
        normMinutes,plannedMinutes:plannedMinutes||normMinutes,actualMinutes,varianceMinutes,attendanceIssues:attendance.issues,attendanceMode:faceIdConnected?'FACE_ID':'NOT_CONNECTED',
        proration:{normWorkDays:norm.days,factualWorkDays:factualPayDays,officialWorkDays:officialPayDays,factualFactor:round2(factualFactor),officialFactor:round2(officialFactor),factualHireDate:factualHire,factualFireDate:factualFire,officialHireDate:officialHire,officialFireDate:officialFire,source:faceIdConnected?'EMPLOYMENT_PLUS_ATTENDANCE':'EMPLOYMENT_CALENDAR'},
        accrual:{monthlyFactualGross,factualBaseGross,officialAccruedGross,additionalAccruedGross,extraDayPay,totalFactualGross:round2(factualBaseGross+extraDayPay)},
        overtime:{approvedMinutes:round2(ot.approvedMinutes),payableMinutes:round2(ot.payableMinutes),unpaidGapMinutes:round2(ot.unpaidGapMinutes),candidateMinutes:round2(ot.candidateMinutes),extraDayEquivalent:round2(ot.extraDayEquivalent),thresholdMinutes:otRule.thresholdMinutes,payableFromMinutes:otRule.payableFromMinutes,ruleSource:otRule.source,ruleNote:otRule.note||'',approvalDays:ot.days},
        overtimeApprovedMinutes:round2(ot.payableMinutes),status,flags,calculation
      });
    }
    const configured=rows.filter(r=>r.term);

    // Snapshot only overtime accruals that changed. This gives the payment ledger
    // a stable monthly history without turning every Payroll GET into hundreds of writes.
    try{
      const existingR=await env.DB.prepare(`SELECT iiko_employee_id,amount,payable_minutes,extra_day_equivalent FROM hr_overtime_payroll_accruals WHERE user_id=?1 AND month=?2`).bind(userId,month).all();
      const existing=new Map((existingR.results||[]).map(x=>[String(x.iiko_employee_id),x]));
      const visibleIds=new Set(rows.map(x=>String(x.employeeId)));
      const statements=[],t=new Date().toISOString();
      for(const row of rows){
        const id=String(row.employeeId),amount=round2(row.accrual?.extraDayPay||0),payable=round2(row.overtime?.payableMinutes||0),daysEq=round2(row.overtime?.extraDayEquivalent||0),old=existing.get(id);
        if(amount>0||payable>0||daysEq>0){
          const changed=!old||Math.abs(Number(old.amount||0)-amount)>.009||Math.abs(Number(old.payable_minutes||0)-payable)>.009||Math.abs(Number(old.extra_day_equivalent||0)-daysEq)>.009;
          if(changed)statements.push(env.DB.prepare(`INSERT INTO hr_overtime_payroll_accruals(user_id,month,iiko_employee_id,amount,payable_minutes,extra_day_equivalent,source_version,calculated_at) VALUES(?1,?2,?3,?4,?5,?6,'PAYROLL_V2_PARTIAL_OVERTIME',?7) ON CONFLICT(user_id,month,iiko_employee_id) DO UPDATE SET amount=excluded.amount,payable_minutes=excluded.payable_minutes,extra_day_equivalent=excluded.extra_day_equivalent,source_version=excluded.source_version,calculated_at=excluded.calculated_at`).bind(userId,month,id,amount,payable,daysEq,t));
        }else if(old){
          statements.push(env.DB.prepare(`DELETE FROM hr_overtime_payroll_accruals WHERE user_id=?1 AND month=?2 AND iiko_employee_id=?3`).bind(userId,month,id));
        }
      }
      // Do not touch accruals of employees outside the current CHAIN scope.
      if(statements.length)for(let i=0;i<statements.length;i+=50)await env.DB.batch(statements.slice(i,i+50));
    }catch(error){
      console.warn('[HR-PAYROLL-ACCRUAL-SNAPSHOT]',error);
    }

    let accountingPosted=0,accountingPending=0,accountingErrors=0;
    for(const row of rows){
      try{
        const result=await syncOvertimeAccrualPosting(env.DB,{
          userId,month,employeeId:String(row.employeeId),employeeName:row.employeeName||row.employeeCode||String(row.employeeId),
          departmentCode:row.departmentCode||'',amount:Number(row.accrual?.extraDayPay||0),
          payableMinutes:Number(row.overtime?.payableMinutes||0),extraDayEquivalent:Number(row.overtime?.extraDayEquivalent||0)
        });
        if(result?.posted)accountingPosted++;
        else if(result?.reason==='ACCOUNTING_NOT_CONFIGURED')accountingPending++;
      }catch(error){
        accountingErrors++;console.warn('[HR-PAYROLL-ACCOUNTING-ACCRUAL]',row.employeeId,error);
      }
    }

    const totals={
      monthlyFactualGross:round2(configured.reduce((a,r)=>a+Number(r.accrual?.monthlyFactualGross||0),0)),
      factualBaseGross:round2(configured.reduce((a,r)=>a+Number(r.accrual?.factualBaseGross||0),0)),
      officialGross:round2(configured.reduce((a,r)=>a+Number(r.accrual?.officialAccruedGross||0),0)),
      additional:round2(configured.reduce((a,r)=>a+Number(r.accrual?.additionalAccruedGross||0),0)),
      extraDayPay:round2(configured.reduce((a,r)=>a+Number(r.accrual?.extraDayPay||0),0)),
      totalFactualGross:round2(configured.reduce((a,r)=>a+Number(r.accrual?.totalFactualGross||0),0))
    };
    return json({
      success:true,engine:'MONTHLY_PAYROLL_V2_PARTIAL_OVERTIME',month,period:{from:b.from,to:b.to},currency:'AZN',
      restaurantScope:scope?{mode:scope.mode,departmentIds:scope.selectedDepartmentIds,departmentCodes:scope.selectedDepartmentCodes}:null,
      ruleProfile:AZ_PAYROLL_RULE_PROFILE,calendar:{year:2026,workDays:norm.days,normHours:norm.hours,source:'ƏƏSMN 2026 istehsalat təqvimi'},
      attendance:{mode:faceIdConnected?'FACE_ID':'NOT_CONNECTED',activeDevices:activeDevices.length,label:faceIdConnected?'Face ID подключён':'Face ID пока не подключён'},
      summary:{
        employees:rows.length,configured:configured.length,ready:rows.filter(r=>r.status==='READY').length,review:rows.filter(r=>r.status==='REVIEW').length,withoutTerms:rows.filter(r=>r.status==='NO_TERMS').length,
        partialMonth:rows.filter(r=>r.term&&Number(r.proration?.factualWorkDays||0)<norm.days).length,normMinutes:rows.length*norm.hours*60,
        actualMinutes:faceIdConnected?rows.reduce((a,r)=>a+Number(r.actualMinutes||0),0):null,
        overtimeApprovedMinutes:round2(rows.reduce((a,r)=>a+Number(r.overtime?.approvedMinutes||0),0)),
        overtimePayableMinutes:round2(rows.reduce((a,r)=>a+Number(r.overtime?.payableMinutes||0),0)),
        overtimeUnpaidGapMinutes:round2(rows.reduce((a,r)=>a+Number(r.overtime?.unpaidGapMinutes||0),0)),
        overtimeExtraDays:round2(rows.reduce((a,r)=>a+Number(r.overtime?.extraDayEquivalent||0),0)),overtimeExtraPay:totals.extraDayPay,
        accountingPosted,accountingPending,accountingErrors
      },
      totals,rows,
      notes:[
        faceIdConnected?'Face ID участвует как источник фактического времени; базовый неполный месяц определяется также датами приёма/увольнения.':'Face ID не подключён: для неполного месяца используются даты фактического/официального приёма и увольнения и производственный календарь.',
        'Неполный месяц: фактический месячный оклад / норма рабочих дней × расчётные рабочие дни.',
        'Дополнительный день: оплачиваемые подтверждённые HR часы / дневной норматив; сумма = фактический месячный оклад / норма рабочих дней × дополнительный день.',
        'Часы между порогом дополнительных часов и порогом оплаты показываются отдельно как нерассчитываемые дополнительные часы.',
        'Оплата дополнительных часов учитывается как отдельное начисление и отдельная выплата.',
        accountingPending?'Для части начислений не настроены реальные бухгалтерские счета SH Server; проводки ожидают настройки Payroll → Бухгалтерия.':'Начисления дополнительных часов синхронизированы с бухгалтерским журналом Smart Horeca по реальным счетам SH Server.'
      ]
    });
  }catch(e){console.error('[HR-PAYROLL-GET]',e);return json({success:false,message:e?.message||String(e)},500)}
}
