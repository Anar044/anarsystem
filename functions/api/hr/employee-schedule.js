import { loadRequestIikoState, privateConnection } from '../iiko/_lib/user-state.js';
import { resolveHrRestaurantScope, filterEmployeesByScope } from './_lib/restaurant-scope.js';
import { logAuditEvent } from '../_lib/audit-log.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v,max=500){return String(v??'').trim().slice(0,max)}
function now(){return new Date().toISOString()}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_attendance_rules (
      user_id TEXT NOT NULL,role_code TEXT NOT NULL,daily_norm_minutes INTEGER NOT NULL DEFAULT 480,shift_type TEXT NOT NULL DEFAULT 'DAY',updated_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(user_id,role_code)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_attendance_rules (
      user_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,shift_type_override TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(user_id,iiko_employee_id)
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
async function attendanceSnapshot(db,userId,employee){
  const [roleAttendance,employeeAttendance]=await Promise.all([
    db.prepare(`SELECT daily_norm_minutes,shift_type,updated_at FROM hr_role_attendance_rules WHERE user_id=?1 AND role_code=?2 LIMIT 1`).bind(userId,employee.role_code||'').first(),
    db.prepare(`SELECT shift_type_override,updated_at FROM hr_employee_attendance_rules WHERE user_id=?1 AND iiko_employee_id=?2 LIMIT 1`).bind(userId,employee.iiko_employee_id).first()
  ]);
  const roleShift=['DAY','NIGHT'].includes(String(roleAttendance?.shift_type||'').toUpperCase())?String(roleAttendance.shift_type).toUpperCase():'DAY';
  const overrideShift=['DAY','NIGHT'].includes(String(employeeAttendance?.shift_type_override||'').toUpperCase())?String(employeeAttendance.shift_type_override).toUpperCase():'';
  return{
    roleDailyNormMinutes:Number(roleAttendance?.daily_norm_minutes||480),
    roleShiftType:roleShift,
    shiftTypeOverride:overrideShift,
    effectiveShiftType:overrideShift||roleShift,
    source:overrideShift?'EMPLOYEE':'ROLE'
  };
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    await ensure(env.DB);
    const employeeId=clean(new URL(request.url).searchParams.get('id'),120);if(!employeeId)return json({success:false,message:'Не указан сотрудник'},400);
    const scope=await resolveHrRestaurantScope(request,env,state.user.id),employee=await employeeRow(env.DB,state.user.id,employeeId,scope);
    if(!employee)return json({success:false,message:'Сотрудник не найден или недоступен в выбранном ресторане'},404);
    return json({success:true,employee:{id:employeeId,name:employeeName(employee),code:employee.employee_code||'',roleCode:employee.role_code||'',roleName:employee.role_name||''},attendanceRule:await attendanceSnapshot(env.DB,state.user.id,employee)});
  }catch(e){console.error('[HR-EMPLOYEE-ATTENDANCE-GET]',e);return json({success:false,message:e?.message||String(e)},500)}
}

export async function onRequestPost({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    await ensure(env.DB);
    const body=await request.json().catch(()=>({})),action=clean(body.action,40),employeeId=clean(body.employeeId,120);
    if(!employeeId)return json({success:false,message:'Не указан сотрудник'},400);
    const scope=await resolveHrRestaurantScope(request,env,state.user.id),employee=await employeeRow(env.DB,state.user.id,employeeId,scope);
    if(!employee)return json({success:false,message:'Сотрудник не найден или недоступен в выбранном ресторане'},404);
    if(action!=='saveAttendanceRule')return json({success:false,message:'Старые индивидуальные графики отключены. Используйте тип смены Face ID.'},410);

    const shiftTypeOverride=clean(body.shiftTypeOverride,20).toUpperCase();
    if(shiftTypeOverride&&!['DAY','NIGHT'].includes(shiftTypeOverride))return json({success:false,message:'Тип смены должен быть DAY, NIGHT или пустым для наследования должности'},400);
    const before=await env.DB.prepare(`SELECT shift_type_override,updated_at FROM hr_employee_attendance_rules WHERE user_id=?1 AND iiko_employee_id=?2 LIMIT 1`).bind(state.user.id,employeeId).first();
    const t=now();
    await env.DB.prepare(`INSERT INTO hr_employee_attendance_rules(user_id,iiko_employee_id,shift_type_override,updated_at)
      VALUES(?1,?2,?3,?4)
      ON CONFLICT(user_id,iiko_employee_id) DO UPDATE SET shift_type_override=excluded.shift_type_override,updated_at=excluded.updated_at`)
      .bind(state.user.id,employeeId,shiftTypeOverride,t).run();
    await logAuditEvent({request,env,connection:privateConnection(state.state),action:'UPDATE',entityType:'HR_EMPLOYEE_ATTENDANCE_RULE',entityId:employeeId,entityLabel:`Учёт времени · ${employeeName(employee)}`,
      before:before?{shiftTypeOverride:before.shift_type_override||''}:null,after:{shiftTypeOverride},restaurantIds:scope?.selectedDepartmentIds||[],metadata:{roleCode:employee.role_code||''}});
    return json({success:true,message:shiftTypeOverride?'Тип смены сотрудника сохранён':'Сотрудник наследует тип смены должности',attendanceRule:await attendanceSnapshot(env.DB,state.user.id,employee)});
  }catch(e){console.error('[HR-EMPLOYEE-ATTENDANCE-POST]',e);return json({success:false,message:e?.message||String(e)},500)}
}
