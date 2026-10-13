import {loadRequestIikoState} from '../iiko/_lib/user-state.js';
import {hasPermission} from '../access/_lib/access-control.js';
import {resolveHrRestaurantScope,filterEmployeesByScope} from './_lib/restaurant-scope.js';
import {validMonth,parseNorm,OFFICE_RESTAURANT_ID,MODES} from './_lib/monthly-role-payroll.js';

const clean=v=>String(v??'').trim();
const cors=()=>({'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}});
async function ensure(db){
  if(!db)throw new Error('Отсутствует D1 для HR');
  await db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_monthly_payroll_norms(
    user_id TEXT NOT NULL,month TEXT NOT NULL,restaurant_id TEXT NOT NULL,role_code TEXT NOT NULL,
    payroll_mode TEXT NOT NULL DEFAULT 'RESTAURANT_HOURS',
    norm_days INTEGER NOT NULL DEFAULT 0,daily_norm_minutes INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id,month,restaurant_id,role_code)
  )`).run();
}
function allowedRestaurants(scope){
  const selected=new Set((scope?.selectedDepartmentIds||[]).map(clean));
  return (scope?.selectedRestaurants||[]).filter(r=>selected.has(clean(r.id)))
    .map(r=>({id:clean(r.id),code:clean(r.code),name:clean(r.name)||clean(r.code)}));
}
async function snapshot(db,userId,scope,month,access){
  const restricted=Boolean(scope?.membershipRestricted)||
    Boolean(scope?.isChain&&(scope?.selectedDepartmentIds||[]).length<(scope?.allowedDepartmentIds||[]).length);
  const restaurants=allowedRestaurants(scope);
  const canEdit=hasPermission(access,'hr.schedules.manage');
  const local=await db.prepare(`SELECT role_code,role_name,department_code,is_deleted,fire_date
    FROM hr_employees WHERE user_id=?1 AND TRIM(role_code)<>''`).bind(userId).all().catch(()=>({results:[]}));
  const inScope=filterEmployeesByScope(local.results||[],scope).filter(e=>!Number(e.is_deleted)&&!clean(e.fire_date));
  const allowedRoles=new Set(inScope.map(x=>clean(x.role_code)));
  const roles=new Map();
  const configured=await db.prepare(`SELECT role_code,role_name FROM hr_roles WHERE user_id=?1 AND is_deleted=0`)
    .bind(userId).all().catch(()=>({results:[]}));
  for(const row of [...(configured.results||[]),...(local.results||[])]){
    const code=clean(row.role_code);
    if(code&&(!restricted||allowedRoles.has(code)))roles.set(code,{code,name:clean(row.role_name)||code});
  }
  const normsR=await db.prepare(`SELECT month,restaurant_id,role_code,payroll_mode,norm_days,daily_norm_minutes,updated_at
    FROM hr_role_monthly_payroll_norms WHERE user_id=?1 AND month=?2 ORDER BY restaurant_id,role_code`)
    .bind(userId,month).all();
  const permitted=new Set(restaurants.map(r=>r.id));
  const norms=(normsR.results||[]).filter(r=>permitted.has(clean(r.restaurant_id))||
    (!restricted&&r.restaurant_id===OFFICE_RESTAURANT_ID))
    .filter(r=>!restricted||roles.has(clean(r.role_code))).map(r=>({
      restaurantId:r.restaurant_id,roleCode:r.role_code,payrollMode:r.payroll_mode,
      normDays:Number(r.norm_days||0),dailyNormMinutes:Number(r.daily_norm_minutes||0),
      plannedMinutes:Number(r.norm_days||0)*Number(r.daily_norm_minutes||0),
      updatedAt:r.updated_at
    }));
  return{month,restaurants:restricted?restaurants:[...restaurants,{id:OFFICE_RESTAURANT_ID,code:'OFFICE',name:'Центральный офис'}],
    roles:[...roles.values()].sort((a,b)=>a.name.localeCompare(b.name,'ru')),norms,
    canEdit,calculationPolicy:'RMS_ROLE_MONTH_MANUAL',isChain:Boolean(scope?.isChain),
    restricted,livePostingEnabled:false};
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);
    if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    if(!state.access?.allowed)return json({success:false,message:'Нет доступа к HR'},403);
    const month=clean(new URL(request.url).searchParams.get('month'))||new Date().toISOString().slice(0,7);
    if(!validMonth(month))return json({success:false,message:'Месяц должен быть в формате YYYY-MM'},400);
    const userId=state.storageUserId||state.user.id;
    await ensure(env.DB);
    const scope=await resolveHrRestaurantScope(request,env,userId,state.access);
    return json({success:true,...await snapshot(env.DB,userId,scope,month,state.access)});
  }catch(e){console.error('[HR-MONTHLY-NORMS-GET]',e);return json({success:false,message:e?.message||String(e)},e?.status||500)}
}
export async function onRequestPost({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);
    if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    if(!state.access?.allowed||!hasPermission(state.access,'hr.schedules.manage'))
      return json({success:false,message:'Недостаточно прав для изменения норм должностей'},403);
    const body=await request.json().catch(()=>({}));
    if(clean(body.action)!=='SAVE')return json({success:false,message:'Неизвестное действие'},400);
    const month=clean(body.month),restaurantId=clean(body.restaurantId),roleCode=clean(body.roleCode);
    if(!validMonth(month)||!restaurantId||!roleCode)return json({success:false,message:'Укажите месяц, ресторан и должность'},400);
    const norm=parseNorm(body),userId=state.storageUserId||state.user.id;
    await ensure(env.DB);
    const scope=await resolveHrRestaurantScope(request,env,userId,state.access);
    const restaurants=allowedRestaurants(scope);
    const restricted=Boolean(scope?.membershipRestricted)||
      Boolean(scope?.isChain&&(scope?.selectedDepartmentIds||[]).length<(scope?.allowedDepartmentIds||[]).length);
    if(norm.payrollMode===MODES.OFFICE){
      if(restaurantId!==OFFICE_RESTAURANT_ID||restricted)return json({success:false,message:'Настройки окладов центрального офиса доступны только HR всей сети'},403);
    }else if(!restaurants.some(r=>r.id===restaurantId)){
      return json({success:false,message:'Этот RMS отсутствует среди разрешённых подразделений'},403);
    }
    const employeeRole=await env.DB.prepare(`SELECT role_code FROM hr_employees WHERE user_id=?1 AND role_code=?2 AND is_deleted=0 LIMIT 1`)
      .bind(userId,roleCode).first();
    const role=await env.DB.prepare(`SELECT role_code FROM hr_roles WHERE user_id=?1 AND role_code=?2 AND is_deleted=0 LIMIT 1`)
      .bind(userId,roleCode).first().catch(()=>null);
    if(!role&&!employeeRole)return json({success:false,message:'Должность не найдена'},404);
    if(restricted){
      const sample=await env.DB.prepare(`SELECT role_code,department_code,is_deleted,fire_date FROM hr_employees WHERE user_id=?1 AND role_code=?2`)
        .bind(userId,roleCode).all();
      if(!filterEmployeesByScope(sample.results||[],scope).some(e=>!Number(e.is_deleted)&&!clean(e.fire_date)))
        return json({success:false,message:'Нет доступа к сотрудникам данной должности в выбранном RMS'},403);
    }
    await env.DB.prepare(`INSERT INTO hr_role_monthly_payroll_norms(
      user_id,month,restaurant_id,role_code,payroll_mode,norm_days,daily_norm_minutes,updated_at
    ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)
    ON CONFLICT(user_id,month,restaurant_id,role_code)
    DO UPDATE SET payroll_mode=excluded.payroll_mode,norm_days=excluded.norm_days,
      daily_norm_minutes=excluded.daily_norm_minutes,updated_at=excluded.updated_at`)
      .bind(userId,month,restaurantId,roleCode,norm.payrollMode,norm.normDays,norm.dailyNormMinutes,new Date().toISOString()).run();
    return json({success:true,...await snapshot(env.DB,userId,scope,month,state.access)});
  }catch(e){console.error('[HR-MONTHLY-NORMS-POST]',e);return json({success:false,message:e?.message||String(e)},e?.status||400)}
}
