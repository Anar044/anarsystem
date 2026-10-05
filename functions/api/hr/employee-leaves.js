import { loadRequestIikoState, privateConnection } from '../iiko/_lib/user-state.js';
import { resolveHrRestaurantScope, filterEmployeesByScope } from './_lib/restaurant-scope.js';
import { logAuditEvent } from '../_lib/audit-log.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v,max=500){return String(v??'').trim().slice(0,max)}
function dateOnly(v){const s=clean(v,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''}
function num(v,fallback=0){const n=Number(v);return Number.isFinite(n)?Math.round(n*100)/100:fallback}
function int(v,min,max,fallback){const n=Number.parseInt(String(v??''),10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback}
function now(){return new Date().toISOString()}
function uid(prefix='leave'){return `${prefix}_${crypto.randomUUID()}`}
function todayBaku(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}catch{return new Date().toISOString().slice(0,10)}}
function addMonths(date,months){if(!date)return'';const d=new Date(`${date}T00:00:00Z`);if(Number.isNaN(d.getTime()))return'';const day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10)}
function daysInclusive(from,to){const a=new Date(`${from}T00:00:00Z`),b=new Date(`${to}T00:00:00Z`);if(Number.isNaN(a.getTime())||Number.isNaN(b.getTime())||b<a)return 0;return Math.floor((b-a)/86400000)+1}

const BUILTIN_TYPES=[
  {code:'MAIN',name:'Основной отпуск',terminationCompensable:true},
  {code:'SENIORITY',name:'По стажу',terminationCompensable:false},
  {code:'CHILD',name:'По ребёнку',terminationCompensable:true},
  {code:'DISABILITY',name:'Инвалидность',terminationCompensable:true},
  {code:'EXTRA_1',name:'Дополнительный вид 1',terminationCompensable:true,customizable:true},
  {code:'EXTRA_2',name:'Дополнительный вид 2',terminationCompensable:true,customizable:true}
];

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_leave_balances (
      user_id TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL,
      leave_year INTEGER NOT NULL,
      contour TEXT NOT NULL,
      leave_type TEXT NOT NULL,
      entitled_days REAL NOT NULL DEFAULT 0,
      adjustment_days REAL NOT NULL DEFAULT 0,
      manual_activate INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,iiko_employee_id,leave_year,contour,leave_type)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_leave_balances_employee ON hr_employee_leave_balances(user_id,iiko_employee_id,leave_year,contour)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_leave_entries (
      user_id TEXT NOT NULL,
      leave_id TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL,
      contour TEXT NOT NULL,
      leave_type TEXT NOT NULL,
      date_from TEXT NOT NULL,
      date_to TEXT NOT NULL,
      days REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'APPROVED',
      note TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL DEFAULT '',
      actor_label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,leave_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_leave_entries_employee ON hr_employee_leave_entries(user_id,iiko_employee_id,date_from DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_leave_type_settings (
      user_id TEXT NOT NULL,
      leave_type TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,leave_type)
    )`)
  ]);
}

async function employeeRow(db,userId,employeeId,scope){
  const row=await db.prepare(`SELECT iiko_employee_id,employee_code,display_name,first_name,middle_name,last_name,role_code,role_name,department_code,hire_date,fire_date,is_deleted
    FROM hr_employees WHERE user_id=?1 AND iiko_employee_id=?2 AND TRIM(employee_code)<>'' LIMIT 1`).bind(userId,employeeId).first();
  if(!row)return null;
  return filterEmployeesByScope([row],scope).length?row:null;
}
function employeeName(e){return[e?.last_name,e?.first_name,e?.middle_name].filter(Boolean).join(' ')||e?.display_name||e?.employee_code||e?.iiko_employee_id||'Сотрудник'}

async function hireDates(db,userId,employee){
  let p=null;
  try{p=await db.prepare(`SELECT factual_hire_date,official_hire_date FROM hr_employee_profiles WHERE user_id=?1 AND iiko_employee_id=?2 LIMIT 1`).bind(userId,employee.iiko_employee_id).first()}catch(_){}
  return{
    FACTUAL:dateOnly(p?.factual_hire_date)||dateOnly(employee.hire_date),
    OFFICIAL:dateOnly(p?.official_hire_date)||dateOnly(employee.hire_date)
  };
}

async function typeList(db,userId){
  const custom=await db.prepare(`SELECT leave_type,display_name FROM hr_leave_type_settings WHERE user_id=?1`).bind(userId).all().catch(()=>({results:[]}));
  const names=new Map((custom.results||[]).map(x=>[x.leave_type,x.display_name]));
  return BUILTIN_TYPES.map(x=>({...x,name:clean(names.get(x.code),120)||x.name}));
}

async function balanceRows(db,userId,employeeId,year,contour){
  const rows=await db.prepare(`SELECT * FROM hr_employee_leave_balances WHERE user_id=?1 AND iiko_employee_id=?2 AND leave_year=?3 AND contour=?4`).bind(userId,employeeId,year,contour).all();
  return new Map((rows.results||[]).map(x=>[x.leave_type,x]));
}
async function usedRows(db,userId,employeeId,year,contour){
  const rows=await db.prepare(`SELECT leave_type,SUM(days) used_days FROM hr_employee_leave_entries
    WHERE user_id=?1 AND iiko_employee_id=?2 AND contour=?3 AND status='APPROVED' AND substr(date_from,1,4)=?4 GROUP BY leave_type`)
    .bind(userId,employeeId,contour,String(year)).all();
  return new Map((rows.results||[]).map(x=>[x.leave_type,num(x.used_days)]));
}
async function recentEntries(db,userId,employeeId,limit=200){
  const rows=await db.prepare(`SELECT * FROM hr_employee_leave_entries WHERE user_id=?1 AND iiko_employee_id=?2 ORDER BY date_from DESC,created_at DESC LIMIT ?3`).bind(userId,employeeId,limit).all();
  return (rows.results||[]).map(r=>({
    id:r.leave_id,contour:r.contour,typeCode:r.leave_type,dateFrom:r.date_from,dateTo:r.date_to,days:num(r.days),
    status:r.status,note:r.note||'',actorLabel:r.actor_label||'',createdAt:r.created_at,updatedAt:r.updated_at
  }));
}
function actorLabel(user){return clean(user?.user_metadata?.full_name||user?.user_metadata?.name||user?.email||user?.id||'Пользователь',180)}

async function snapshot(db,userId,employeeId,year,asOf,types,hires){
  const contours={};
  for(const contour of ['FACTUAL','OFFICIAL']){
    const balances=await balanceRows(db,userId,employeeId,year,contour);
    const used=await usedRows(db,userId,employeeId,year,contour);
    const hireDate=hires[contour]||'',eligibleDate=addMonths(hireDate,6);
    const rows=types.map(type=>{
      const b=balances.get(type.code);
      const entitled=num(b?.entitled_days),adjustment=num(b?.adjustment_days),usedDays=num(used.get(type.code));
      const manualActivated=Boolean(b?.manual_activate);
      const activated=manualActivated||Boolean(eligibleDate&&asOf>=eligibleDate);
      const remaining=num(entitled+adjustment-usedDays);
      return{
        typeCode:type.code,typeName:type.name,terminationCompensable:Boolean(type.terminationCompensable),
        customizable:Boolean(type.customizable),entitledDays:entitled,adjustmentDays:adjustment,usedDays,remainingDays:remaining,
        manualActivated,activated,note:b?.note||'',updatedAt:b?.updated_at||''
      };
    });
    const totals=rows.reduce((a,x)=>({entitled:num(a.entitled+x.entitledDays+x.adjustmentDays),used:num(a.used+x.usedDays),remaining:num(a.remaining+x.remainingDays)}),{entitled:0,used:0,remaining:0});
    const terminationDays=num(rows.filter(x=>x.terminationCompensable).reduce((s,x)=>s+Math.max(0,x.remainingDays),0));
    contours[contour]={hireDate,eligibleDate,autoActivated:Boolean(eligibleDate&&asOf>=eligibleDate),rows,totals,terminationCompensationDays:terminationDays};
  }
  return contours;
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    await ensure(env.DB);
    const url=new URL(request.url),employeeId=clean(url.searchParams.get('id'),120),year=int(url.searchParams.get('year'),2000,2100,new Date().getFullYear()),asOf=dateOnly(url.searchParams.get('asOf'))||todayBaku();
    if(!employeeId)return json({success:false,message:'Не указан сотрудник'},400);
    const scope=await resolveHrRestaurantScope(request,env,state.user.id),employee=await employeeRow(env.DB,state.user.id,employeeId,scope);
    if(!employee)return json({success:false,message:'Сотрудник не найден или недоступен в выбранном ресторане'},404);
    const [types,hires,entries]=await Promise.all([typeList(env.DB,state.user.id),hireDates(env.DB,state.user.id,employee),recentEntries(env.DB,state.user.id,employeeId)]);
    const contours=await snapshot(env.DB,state.user.id,employeeId,year,asOf,types,hires);
    return json({success:true,year,asOf,employee:{id:employeeId,name:employeeName(employee),code:employee.employee_code||'',roleName:employee.role_name||''},types,contours,entries});
  }catch(e){console.error('[HR-EMPLOYEE-LEAVES-GET]',e);return json({success:false,message:e?.message||String(e)},500)}
}

export async function onRequestPost({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    await ensure(env.DB);
    const body=await request.json().catch(()=>({})),action=clean(body.action,40),employeeId=clean(body.employeeId,120);
    if(!employeeId)return json({success:false,message:'Не указан сотрудник'},400);
    const scope=await resolveHrRestaurantScope(request,env,state.user.id),employee=await employeeRow(env.DB,state.user.id,employeeId,scope);
    if(!employee)return json({success:false,message:'Сотрудник не найден или недоступен в выбранном ресторане'},404);
    const connection=privateConnection(state.state),types=await typeList(env.DB,state.user.id),validTypes=new Set(types.map(x=>x.code));

    if(action==='saveBalance'){
      const year=int(body.year,2000,2100,0),contour=clean(body.contour,20).toUpperCase(),typeCode=clean(body.typeCode,30).toUpperCase();
      if(!year||!['FACTUAL','OFFICIAL'].includes(contour)||!validTypes.has(typeCode))return json({success:false,message:'Некорректные параметры отпуска'},400);
      const beforeRow=await env.DB.prepare(`SELECT * FROM hr_employee_leave_balances WHERE user_id=?1 AND iiko_employee_id=?2 AND leave_year=?3 AND contour=?4 AND leave_type=?5 LIMIT 1`).bind(state.user.id,employeeId,year,contour,typeCode).first();
      const after={year,contour,typeCode,entitledDays:num(body.entitledDays),adjustmentDays:num(body.adjustmentDays),manualActivated:Boolean(body.manualActivated),note:clean(body.note,1000)};
      const t=now();
      await env.DB.prepare(`INSERT INTO hr_employee_leave_balances(user_id,iiko_employee_id,leave_year,contour,leave_type,entitled_days,adjustment_days,manual_activate,note,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10)
        ON CONFLICT(user_id,iiko_employee_id,leave_year,contour,leave_type) DO UPDATE SET entitled_days=excluded.entitled_days,adjustment_days=excluded.adjustment_days,manual_activate=excluded.manual_activate,note=excluded.note,updated_at=excluded.updated_at`)
        .bind(state.user.id,employeeId,year,contour,typeCode,after.entitledDays,after.adjustmentDays,after.manualActivated?1:0,after.note,t).run();
      const before=beforeRow?{year:Number(beforeRow.leave_year),contour:beforeRow.contour,typeCode:beforeRow.leave_type,entitledDays:num(beforeRow.entitled_days),adjustmentDays:num(beforeRow.adjustment_days),manualActivated:Boolean(beforeRow.manual_activate),note:beforeRow.note||''}:null;
      await logAuditEvent({request,env,connection,action:before?'UPDATE':'CREATE',entityType:'HR_EMPLOYEE_LEAVE_BALANCE',entityId:employeeId,entityLabel:`Отпуска · ${employeeName(employee)}`,before,after,restaurantIds:scope?.selectedDepartmentIds||[],metadata:{year,contour,typeCode}});
      return json({success:true,message:'Остаток отпуска сохранён'});
    }

    if(action==='addLeave'){
      const contour=clean(body.contour,20).toUpperCase(),typeCode=clean(body.typeCode,30).toUpperCase(),dateFrom=dateOnly(body.dateFrom),dateTo=dateOnly(body.dateTo);
      if(!['FACTUAL','OFFICIAL'].includes(contour)||!validTypes.has(typeCode)||!dateFrom||!dateTo||dateTo<dateFrom)return json({success:false,message:'Проверьте вид отпуска и период'},400);
      const year=Number(dateFrom.slice(0,4)),balance=await env.DB.prepare(`SELECT * FROM hr_employee_leave_balances WHERE user_id=?1 AND iiko_employee_id=?2 AND leave_year=?3 AND contour=?4 AND leave_type=?5 LIMIT 1`).bind(state.user.id,employeeId,year,contour,typeCode).first();
      const hires=await hireDates(env.DB,state.user.id,employee),eligibleDate=addMonths(hires[contour],6),manual=Boolean(balance?.manual_activate);
      if(!(manual||(eligibleDate&&dateFrom>=eligibleDate)))return json({success:false,message:`Право на этот отпуск ещё не активно. Автоматическая активация: ${eligibleDate||'не определена'}. HR может включить ручную активацию в остатках.`},409);
      const suggested=daysInclusive(dateFrom,dateTo),days=num(body.days,suggested);
      if(days<=0)return json({success:false,message:'Количество дней должно быть больше нуля'},400);
      const leaveId=uid('hrleave'),t=now(),note=clean(body.note,1200),actor=actorLabel(state.user);
      await env.DB.prepare(`INSERT INTO hr_employee_leave_entries(user_id,leave_id,iiko_employee_id,contour,leave_type,date_from,date_to,days,status,note,actor_id,actor_label,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'APPROVED',?9,?10,?11,?12,?12)`).bind(state.user.id,leaveId,employeeId,contour,typeCode,dateFrom,dateTo,days,note,clean(state.user.id,160),actor,t).run();
      const after={leaveId,contour,typeCode,dateFrom,dateTo,days,status:'APPROVED',note};
      await logAuditEvent({request,env,connection,action:'CREATE',entityType:'HR_EMPLOYEE_LEAVE',entityId:employeeId,entityLabel:`Отпуск · ${employeeName(employee)}`,before:null,after,restaurantIds:scope?.selectedDepartmentIds||[],metadata:{leaveId,year,contour,typeCode}});
      return json({success:true,message:'Отпуск добавлен',leaveId});
    }

    if(action==='cancelLeave'){
      const leaveId=clean(body.leaveId,160);if(!leaveId)return json({success:false,message:'Не указан отпуск'},400);
      const row=await env.DB.prepare(`SELECT * FROM hr_employee_leave_entries WHERE user_id=?1 AND leave_id=?2 AND iiko_employee_id=?3 LIMIT 1`).bind(state.user.id,leaveId,employeeId).first();
      if(!row)return json({success:false,message:'Запись отпуска не найдена'},404);
      if(row.status==='CANCELLED')return json({success:true,message:'Отпуск уже отменён'});
      await env.DB.prepare(`UPDATE hr_employee_leave_entries SET status='CANCELLED',updated_at=?4 WHERE user_id=?1 AND leave_id=?2 AND iiko_employee_id=?3`).bind(state.user.id,leaveId,employeeId,now()).run();
      await logAuditEvent({request,env,connection,action:'UPDATE',entityType:'HR_EMPLOYEE_LEAVE',entityId:employeeId,entityLabel:`Отпуск · ${employeeName(employee)}`,before:{leaveId,status:row.status,contour:row.contour,typeCode:row.leave_type,dateFrom:row.date_from,dateTo:row.date_to,days:num(row.days)},after:{leaveId,status:'CANCELLED',contour:row.contour,typeCode:row.leave_type,dateFrom:row.date_from,dateTo:row.date_to,days:num(row.days)},restaurantIds:scope?.selectedDepartmentIds||[],metadata:{leaveId,contour:row.contour,typeCode:row.leave_type}});
      return json({success:true,message:'Отпуск отменён'});
    }

    if(action==='saveTypeName'){
      const typeCode=clean(body.typeCode,30).toUpperCase(),name=clean(body.name,120);
      if(!['EXTRA_1','EXTRA_2'].includes(typeCode)||!name)return json({success:false,message:'Можно переименовывать только два дополнительных вида отпуска'},400);
      const t=now();
      await env.DB.prepare(`INSERT INTO hr_leave_type_settings(user_id,leave_type,display_name,updated_at) VALUES(?1,?2,?3,?4)
        ON CONFLICT(user_id,leave_type) DO UPDATE SET display_name=excluded.display_name,updated_at=excluded.updated_at`).bind(state.user.id,typeCode,name,t).run();
      await logAuditEvent({request,env,connection,action:'UPDATE',entityType:'HR_LEAVE_TYPE',entityId:typeCode,entityLabel:'Вид отпуска',before:null,after:{typeCode,name},restaurantIds:scope?.selectedDepartmentIds||[]});
      return json({success:true,message:'Название дополнительного отпуска сохранено'});
    }

    return json({success:false,message:'Неизвестное действие'},400);
  }catch(e){console.error('[HR-EMPLOYEE-LEAVES-POST]',e);return json({success:false,message:e?.message||String(e)},500)}
}
