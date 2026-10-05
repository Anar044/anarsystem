import { loadRequestIikoState, privateConnection } from '../iiko/_lib/user-state.js';
import { resolveHrRestaurantScope, filterEmployeesByScope } from './_lib/restaurant-scope.js';
import { logAuditEvent } from '../_lib/audit-log.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v,max=500){return String(v??'').trim().slice(0,max)}
function dateOnly(v){const s=clean(v,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''}
function now(){return new Date().toISOString()}
function uid(){return `hes_${crypto.randomUUID()}`}
function previousDate(v){const d=new Date(`${v}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)}
function todayBaku(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}catch{return new Date().toISOString().slice(0,10)}}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_schedule_overrides (
      user_id TEXT NOT NULL,
      override_id TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,override_id)
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_employee_schedule_start ON hr_employee_schedule_overrides(user_id,iiko_employee_id,effective_from)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_employee_schedule_current ON hr_employee_schedule_overrides(user_id,iiko_employee_id,is_active,effective_from DESC)`)
  ]);
}

async function employeeRow(db,userId,employeeId,scope){
  const row=await db.prepare(`SELECT iiko_employee_id,employee_code,display_name,first_name,middle_name,last_name,role_code,role_name,department_code,hire_date,fire_date,is_deleted
    FROM hr_employees WHERE user_id=?1 AND iiko_employee_id=?2 AND TRIM(employee_code)<>'' LIMIT 1`).bind(userId,employeeId).first();
  if(!row)return null;
  return filterEmployeesByScope([row],scope).length?row:null;
}
function employeeName(e){return[e?.last_name,e?.first_name,e?.middle_name].filter(Boolean).join(' ')||e?.display_name||e?.employee_code||e?.iiko_employee_id||'Сотрудник'}

async function scheduleChoices(db,userId,roleCode){
  if(!roleCode)return[];
  const rows=await db.prepare(`SELECT schedule_id,schedule_name,pattern_type,weekdays,work_days,off_days,anchor_date,shift_start,shift_end,break_minutes,valid_from,valid_to,is_default,is_active
    FROM hr_role_schedules WHERE user_id=?1 AND role_code=?2 AND is_active=1 ORDER BY is_default DESC,valid_from DESC,schedule_name COLLATE NOCASE`).bind(userId,roleCode).all();
  return (rows.results||[]).map(s=>({
    id:s.schedule_id,name:s.schedule_name,patternType:s.pattern_type,weekdays:String(s.weekdays||'').split(',').map(Number).filter(Boolean),
    workDays:Number(s.work_days||0),offDays:Number(s.off_days||0),anchorDate:s.anchor_date||'',shiftStart:s.shift_start,shiftEnd:s.shift_end,
    breakMinutes:Number(s.break_minutes||0),validFrom:s.valid_from,validTo:s.valid_to||'',isDefault:Boolean(s.is_default),active:Boolean(s.is_active)
  }));
}
async function history(db,userId,employeeId){
  const rows=await db.prepare(`SELECT o.*,s.schedule_name,s.pattern_type,s.weekdays,s.work_days,s.off_days,s.shift_start,s.shift_end,s.break_minutes
    FROM hr_employee_schedule_overrides o
    LEFT JOIN hr_role_schedules s ON s.user_id=o.user_id AND s.schedule_id=o.schedule_id
    WHERE o.user_id=?1 AND o.iiko_employee_id=?2 AND o.is_active=1
    ORDER BY o.effective_from DESC,o.created_at DESC`).bind(userId,employeeId).all();
  return (rows.results||[]).map(r=>({
    id:r.override_id,scheduleId:r.schedule_id,scheduleName:r.schedule_name||'Удалённый шаблон',patternType:r.pattern_type||'',
    weekdays:String(r.weekdays||'').split(',').map(Number).filter(Boolean),workDays:Number(r.work_days||0),offDays:Number(r.off_days||0),
    shiftStart:r.shift_start||'',shiftEnd:r.shift_end||'',breakMinutes:Number(r.break_minutes||0),
    effectiveFrom:r.effective_from,effectiveTo:r.effective_to||'',note:r.note||'',createdAt:r.created_at,updatedAt:r.updated_at
  }));
}
async function rebuildRanges(db,userId,employeeId){
  const rows=await db.prepare(`SELECT o.override_id,o.effective_from,s.valid_to AS schedule_valid_to
    FROM hr_employee_schedule_overrides o
    LEFT JOIN hr_role_schedules s ON s.user_id=o.user_id AND s.schedule_id=o.schedule_id
    WHERE o.user_id=?1 AND o.iiko_employee_id=?2 AND o.is_active=1 ORDER BY o.effective_from ASC,o.created_at ASC`).bind(userId,employeeId).all();
  const list=rows.results||[],t=now();
  if(!list.length)return;
  await db.batch(list.map((r,i)=>{
    const nextTo=list[i+1]?previousDate(list[i+1].effective_from):'';
    const scheduleTo=r.schedule_valid_to||'';
    const effectiveTo=nextTo&&scheduleTo?(nextTo<scheduleTo?nextTo:scheduleTo):(nextTo||scheduleTo);
    return db.prepare(`UPDATE hr_employee_schedule_overrides SET effective_to=?4,updated_at=?5
      WHERE user_id=?1 AND iiko_employee_id=?2 AND override_id=?3`).bind(userId,employeeId,r.override_id,effectiveTo,t);
  }));
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    await ensure(env.DB);
    const url=new URL(request.url),employeeId=clean(url.searchParams.get('id'),120),asOf=dateOnly(url.searchParams.get('asOf'))||todayBaku();
    if(!employeeId)return json({success:false,message:'Не указан сотрудник'},400);
    const scope=await resolveHrRestaurantScope(request,env,state.user.id),employee=await employeeRow(env.DB,state.user.id,employeeId,scope);
    if(!employee)return json({success:false,message:'Сотрудник не найден или недоступен в выбранном ресторане'},404);
    const [choices,items]=await Promise.all([scheduleChoices(env.DB,state.user.id,employee.role_code||''),history(env.DB,state.user.id,employeeId)]);
    const current=items.find(x=>x.effectiveFrom<=asOf&&(!x.effectiveTo||x.effectiveTo>=asOf))||null;
    const roleDefault=choices.find(x=>x.isDefault&&x.validFrom<=asOf&&(!x.validTo||x.validTo>=asOf))||null;
    return json({success:true,asOf,employee:{id:employeeId,name:employeeName(employee),code:employee.employee_code||'',roleCode:employee.role_code||'',roleName:employee.role_name||''},currentOverride:current,roleDefault,choices,history:items});
  }catch(e){console.error('[HR-EMPLOYEE-SCHEDULE-GET]',e);return json({success:false,message:e?.message||String(e)},500)}
}

export async function onRequestPost({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    await ensure(env.DB);
    const body=await request.json().catch(()=>({})),action=clean(body.action,40),employeeId=clean(body.employeeId,120);
    if(!employeeId)return json({success:false,message:'Не указан сотрудник'},400);
    const scope=await resolveHrRestaurantScope(request,env,state.user.id),employee=await employeeRow(env.DB,state.user.id,employeeId,scope);
    if(!employee)return json({success:false,message:'Сотрудник не найден или недоступен в выбранном ресторане'},404);
    const connection=privateConnection(state.state);

    if(action==='saveOverride'){
      const scheduleId=clean(body.scheduleId,160),effectiveFrom=dateOnly(body.effectiveFrom),note=clean(body.note,1200);
      if(!scheduleId||!effectiveFrom)return json({success:false,message:'Выберите график и дату начала действия'},400);
      const schedule=await env.DB.prepare(`SELECT schedule_id,schedule_name,role_code,valid_from,valid_to FROM hr_role_schedules WHERE user_id=?1 AND schedule_id=?2 AND is_active=1 LIMIT 1`).bind(state.user.id,scheduleId).first();
      if(!schedule)return json({success:false,message:'График не найден или отключён'},404);
      if(String(schedule.role_code)!==String(employee.role_code))return json({success:false,message:'Индивидуальный график должен относиться к текущей должности сотрудника'},409);
      if(schedule.valid_from&&effectiveFrom<schedule.valid_from)return json({success:false,message:`Этот шаблон действует только с ${schedule.valid_from}. Выберите другую дату начала.`},409);
      if(schedule.valid_to&&effectiveFrom>schedule.valid_to)return json({success:false,message:`Срок действия этого шаблона закончился ${schedule.valid_to}. Выберите другой шаблон.`},409);
      const same=await env.DB.prepare(`SELECT override_id FROM hr_employee_schedule_overrides WHERE user_id=?1 AND iiko_employee_id=?2 AND effective_from=?3 AND is_active=1 LIMIT 1`).bind(state.user.id,employeeId,effectiveFrom).first();
      if(same)return json({success:false,message:'На эту дату уже есть индивидуальное назначение графика'},409);
      const beforeHistory=await history(env.DB,state.user.id,employeeId),before=beforeHistory.find(x=>x.effectiveFrom<=effectiveFrom&&(!x.effectiveTo||x.effectiveTo>=effectiveFrom))||null;
      const id=uid(),t=now();
      await env.DB.prepare(`INSERT INTO hr_employee_schedule_overrides(user_id,override_id,iiko_employee_id,schedule_id,effective_from,effective_to,note,is_active,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,'',?6,1,?7,?7)`).bind(state.user.id,id,employeeId,scheduleId,effectiveFrom,note,t).run();
      await rebuildRanges(env.DB,state.user.id,employeeId);
      const items=await history(env.DB,state.user.id,employeeId),after=items.find(x=>x.id===id)||null;
      await logAuditEvent({request,env,connection,action:'ASSIGN',entityType:'HR_EMPLOYEE_SCHEDULE',entityId:employeeId,entityLabel:`Индивидуальный график · ${employeeName(employee)}`,
        before:before?{scheduleId:before.scheduleId,scheduleName:before.scheduleName,effectiveFrom:before.effectiveFrom,effectiveTo:before.effectiveTo}:null,
        after:after?{scheduleId:after.scheduleId,scheduleName:after.scheduleName,effectiveFrom:after.effectiveFrom,effectiveTo:after.effectiveTo,note:after.note}:null,
        restaurantIds:scope?.selectedDepartmentIds||[],metadata:{overrideId:id,roleCode:employee.role_code||''}});
      return json({success:true,message:'Индивидуальный график назначен',override:after});
    }

    if(action==='removeOverride'){
      const overrideId=clean(body.overrideId,160);if(!overrideId)return json({success:false,message:'Не указано назначение'},400);
      const row=await env.DB.prepare(`SELECT o.*,s.schedule_name FROM hr_employee_schedule_overrides o LEFT JOIN hr_role_schedules s ON s.user_id=o.user_id AND s.schedule_id=o.schedule_id
        WHERE o.user_id=?1 AND o.iiko_employee_id=?2 AND o.override_id=?3 AND o.is_active=1 LIMIT 1`).bind(state.user.id,employeeId,overrideId).first();
      if(!row)return json({success:false,message:'Назначение не найдено'},404);
      await env.DB.prepare(`UPDATE hr_employee_schedule_overrides SET is_active=0,updated_at=?4 WHERE user_id=?1 AND iiko_employee_id=?2 AND override_id=?3`).bind(state.user.id,employeeId,overrideId,now()).run();
      await rebuildRanges(env.DB,state.user.id,employeeId);
      await logAuditEvent({request,env,connection,action:'DELETE',entityType:'HR_EMPLOYEE_SCHEDULE',entityId:employeeId,entityLabel:`Индивидуальный график · ${employeeName(employee)}`,
        before:{scheduleId:row.schedule_id,scheduleName:row.schedule_name||'',effectiveFrom:row.effective_from,effectiveTo:row.effective_to||'',note:row.note||''},after:null,
        restaurantIds:scope?.selectedDepartmentIds||[],metadata:{overrideId,roleCode:employee.role_code||''}});
      return json({success:true,message:'Индивидуальное назначение удалено. Сотрудник снова использует основной график должности.'});
    }

    return json({success:false,message:'Неизвестное действие'},400);
  }catch(e){console.error('[HR-EMPLOYEE-SCHEDULE-POST]',e);return json({success:false,message:e?.message||String(e)},500)}
}
