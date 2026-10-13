import {loadRequestIikoState} from '../iiko/_lib/user-state.js';
import {resolveHrRestaurantScope} from './_lib/restaurant-scope.js';
import {approvalMonthClosed,approvalDepartments} from './_lib/department-approvals.js';
import {hasPermission} from '../access/_lib/access-control.js';
import {buildRmsPayrollDocument,approvalSourceForRestaurant,hashRmsDocument} from './_lib/rms-payroll-document.js';
import {loadPayrollTaxContext} from './_lib/payroll-tax-engine.js';
import {allocateNetworkPayrollTax} from './_lib/rms-tax-allocation.js';

const clean=v=>String(v??'').trim();
const now=()=>new Date().toISOString();
const cors=()=>({'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'});
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}});
const month=v=>/^20\d\d-(0[1-9]|1[0-2])$/.test(clean(v))?clean(v):'';
const ymd=v=>/^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(clean(v))?clean(v):'';
const monthEnd=m=>{const[y,n]=m.split('-').map(Number);return m+'-'+String(new Date(Date.UTC(y,n,0)).getUTCDate()).padStart(2,'0')};
const monthStart=m=>m+'-01';
const dayOffset=(m,d)=>{const dt=new Date(m+'T00:00:00Z');dt.setUTCDate(dt.getUTCDate()+d);return dt.toISOString().slice(0,10)};
function error(message,status=400){return Object.assign(new Error(message),{status})}
async function ensure(db){
  if(!db)throw error('Не настроен D1',503);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_rms_payroll_corrections(
      user_id TEXT NOT NULL,month TEXT NOT NULL,restaurant_id TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL,work_date TEXT NOT NULL,worked_minutes INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL,actor_id TEXT NOT NULL,updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,month,restaurant_id,iiko_employee_id,work_date)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_rms_payroll_corrections_scope
      ON hr_rms_payroll_corrections(user_id,month,restaurant_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_rms_payroll_approvals(
      user_id TEXT NOT NULL,month TEXT NOT NULL,restaurant_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',source_hash TEXT NOT NULL DEFAULT '',
      approved_snapshot TEXT NOT NULL DEFAULT '{}',
      manager_id TEXT NOT NULL DEFAULT '',manager_at TEXT NOT NULL DEFAULT '',
      hr_id TEXT NOT NULL DEFAULT '',hr_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,month,restaurant_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_rms_payroll_audit(
      user_id TEXT NOT NULL,audit_id TEXT NOT NULL PRIMARY KEY,
      month TEXT NOT NULL,restaurant_id TEXT NOT NULL,action TEXT NOT NULL,
      employee_id TEXT NOT NULL DEFAULT '',actor_id TEXT NOT NULL,
      details_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL
    )`)
  ]);
}
function authorizedRestaurants(scope){
  if(!scope?.isChain)return[];
  return approvalDepartments(scope);
}
function can(access,permission){return Boolean(access?.allowed&&hasPermission(access,permission))}
function reviewer(action,access,scope){
  const central=scope?.isChain&&!scope?.membershipRestricted&&
    (scope.selectedDepartmentIds||[]).length===(scope.allowedDepartmentIds||[]).length;
  if(action==='SAVE_CORRECTION'||action==='REMOVE_CORRECTION')
    return can(access,'hr.timesheet.manage');
  if(action==='MANAGER_APPROVE')return can(access,'hr.timesheet.manager_approve');
  if(action==='HR_APPROVE')return central&&can(access,'hr.timesheet.hr_approve');
  if(action==='REOPEN')return can(access,'hr.timesheet.hr_approve')||can(access,'hr.timesheet.manager_approve');
  return false;
}
async function rows(db,sql,args){
  const out=await db.prepare(sql).bind(...args).all();
  return out.results||[];
}
async function loadDocument(db,userId,scope,period){
  const restaurants=authorizedRestaurants(scope);
  if(!restaurants.length)throw error('Для CHAIN выберите доступные RMS',403);
  const permitted=new Set(restaurants.map(r=>r.id));
  const bounds=[dayOffset(monthStart(period),-2)+'T00:00:00.000Z',dayOffset(monthEnd(period),2)+'T23:59:59.999Z'];
  const [employees,devices,terms,roleTerms,norms,roleRules,employeeRules,corrections,approvals]=await Promise.all([
    rows(db,`SELECT iiko_employee_id,employee_code,display_name,role_code,department_code,fire_date,is_deleted
      FROM hr_employees WHERE user_id=?1 AND TRIM(employee_code)<>''`,[userId]),
    rows(db,`SELECT device_id,restaurant_id,is_active FROM hr_devices WHERE user_id=?1`,[userId]),
    rows(db,`SELECT iiko_employee_id,effective_from,effective_to,official_gross,additional_amount,is_active,updated_at
      FROM hr_compensation_terms WHERE user_id=?1 AND is_active=1 ORDER BY effective_from DESC`,[userId]),
    rows(db,`SELECT role_code,effective_from,effective_to,official_gross,additional_amount,is_active,updated_at
      FROM hr_role_compensation_terms WHERE user_id=?1 AND is_active=1 ORDER BY effective_from DESC`,[userId]),
    rows(db,`SELECT restaurant_id,role_code,payroll_mode,norm_days,daily_norm_minutes,updated_at
      FROM hr_role_monthly_payroll_norms WHERE user_id=?1 AND month=?2`,[userId,period]).catch(e=>/no such table/i.test(String(e?.message||e))?[]:Promise.reject(e)),
    rows(db,`SELECT role_code,shift_type,updated_at FROM hr_role_attendance_rules WHERE user_id=?1`,[userId]),
    rows(db,`SELECT iiko_employee_id,shift_type_override,updated_at FROM hr_employee_attendance_rules WHERE user_id=?1`,[userId]),
    rows(db,`SELECT * FROM hr_rms_payroll_corrections WHERE user_id=?1 AND month=?2`,[userId,period]),
    rows(db,`SELECT * FROM hr_rms_payroll_approvals WHERE user_id=?1 AND month=?2`,[userId,period])
  ]);
  const activeDevices=devices.filter(d=>Number(d.is_active)&&permitted.has(clean(d.restaurant_id)));
  const events=[];
  for(let i=0;i<activeDevices.length;i+=20){
    const slice=activeDevices.slice(i,i+20),map=new Map(slice.map(d=>[clean(d.device_id),clean(d.restaurant_id)]));
    const vals=slice.map(d=>clean(d.device_id));
    const extracted=await rows(db,`SELECT event_id,device_id,iiko_employee_id,event_time,event_type
      FROM hr_attendance_events WHERE user_id=? AND device_id IN (${vals.map(()=>'?').join(',')})
      AND event_time>=? AND event_time<=? ORDER BY event_time,event_id`,
      [userId,...vals,...bounds]);
    events.push(...extracted.map(e=>({...e,restaurantId:map.get(clean(e.device_id))||''})));
  }
  const visibleCorrections=corrections.filter(x=>permitted.has(clean(x.restaurant_id)));
  const filteredNorms=norms.filter(x=>permitted.has(clean(x.restaurant_id))||
    (!scope.membershipRestricted&&(scope.selectedDepartmentIds||[]).length===(scope.allowedDepartmentIds||[]).length&&x.restaurant_id==='NETWORK_OFFICE'));
  const doc=buildRmsPayrollDocument({
    month:period,scope,devices:activeDevices,employees,events,roleRules,employeeRules,
    norms:filteredNorms,employeeTerms:terms,roleTerms,corrections:visibleCorrections
  });
  const approvalsMap=new Map(approvals.filter(x=>permitted.has(clean(x.restaurant_id))).map(x=>[clean(x.restaurant_id),x]));
  const docs=[];
  for(const restaurant of doc.restaurants){
    const source=approvalSourceForRestaurant(doc,restaurant.restaurantId,events,visibleCorrections,filteredNorms,terms,roleTerms,roleRules,employeeRules);
    const sourceHash=await hashRmsDocument(source);
    const record=approvalsMap.get(restaurant.restaurantId);
    docs.push({...restaurant,sourceHash,
      approval:record?{status:record.source_hash===sourceHash?record.status:'STALE',
        storedStatus:record.status,stale:record.source_hash!==sourceHash,
        managerAt:record.manager_at||'',hrAt:record.hr_at||'',approvedSnapshot:record.status==='HR_APPROVED'&&record.source_hash===sourceHash
          ?JSON.parse(record.approved_snapshot||'{}'):null
      }:{status:'DRAFT',stale:false,storedStatus:'DRAFT',managerAt:'',hrAt:'',approvedSnapshot:null}});
  }
  return{doc,docs,corrections:visibleCorrections,terms,roleTerms};
}
async function audit(db,userId,month,restaurantId,action,actorId,employeeId='',details={}){
  await db.prepare(`INSERT INTO hr_rms_payroll_audit(user_id,audit_id,month,restaurant_id,action,employee_id,actor_id,details_json,created_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
    .bind(userId,crypto.randomUUID(),month,restaurantId,action,employeeId,actorId,JSON.stringify(details).slice(0,5000),now()).run();
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);
    if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    if(!state.access?.allowed)return json({success:false,message:'Недостаточно прав'},403);
    if(!can(state.access,'hr.payroll.view'))return json({success:false,message:'Недостаточно прав для просмотра Payroll'},403);
    const period=month(new URL(request.url).searchParams.get('month'));
    if(!period)return json({success:false,message:'Укажите месяц YYYY-MM'},400);
    const userId=state.storageUserId||state.user.id;
    await ensure(env.DB);
    const scope=await resolveHrRestaurantScope(request,env,userId,state.access);
    const {doc,docs,corrections,terms,roleTerms}=await loadDocument(env.DB,userId,scope,period);
    const central=!scope.membershipRestricted&&
      (scope.selectedDepartmentIds||[]).length===(scope.allowedDepartmentIds||[]).length;
    let taxAllocation=null,taxProfile=null;
    if(central){
      const tax=await loadPayrollTaxContext(env.DB,userId,monthEnd(period));
      taxProfile={source:tax.source,mode:tax.mode,effectiveFrom:tax.active?.effectiveFrom||''};
      taxAllocation=allocateNetworkPayrollTax({
        rmsRows:doc.pay.rows,officeRows:doc.pay.officeRows,
        employeeTerms:terms,roleTerms,settings:tax.settings
      });
    }
    return json({success:true,month:period,mode:'RMS_PAYROLL_APPROVAL_V1',postingEnabled:false,
      taxProfile,taxAllocation,
      canManage:reviewer('SAVE_CORRECTION',state.access,scope),
      canManagerApprove:reviewer('MANAGER_APPROVE',state.access,scope),
      canHrApprove:reviewer('HR_APPROVE',state.access,scope),
      canReopen:reviewer('REOPEN',state.access,scope),
      closed:approvalMonthClosed(period),restaurants:docs,attendance:doc.attendance,corrections,
      network:doc.network,office:scope.membershipRestricted?[]:doc.pay.officeRows});
  }catch(e){console.error('[HR-RMS-PAYROLL-GET]',e);return json({success:false,message:e?.message||String(e)},e?.status||500)}
}
export async function onRequestPost({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);
    if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    const body=await request.json().catch(()=>({}));
    if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    const action=clean(body.action).toUpperCase(),period=month(body.month),restaurantId=clean(body.restaurantId);
    if(!period||!restaurantId)return json({success:false,message:'Укажите месяц и один ресторан'},400);
    const userId=state.storageUserId||state.user.id,scope=await resolveHrRestaurantScope(request,env,userId,state.access);
    if(!reviewer(action,state.access,scope))return json({success:false,message:'Недостаточно прав для этого действия'},403);
    if(!authorizedRestaurants(scope).some(x=>x.id===restaurantId))return json({success:false,message:'Ресторан не входит в область доступа'},403);
    await ensure(env.DB);
    const actorId=clean(state.user.id),old=await env.DB.prepare(`SELECT * FROM hr_rms_payroll_approvals
      WHERE user_id=?1 AND month=?2 AND restaurant_id=?3`).bind(userId,period,restaurantId).first();
    if(action==='SAVE_CORRECTION'||action==='REMOVE_CORRECTION'){
      if(old?.status==='HR_APPROVED')return json({success:false,message:'Payroll уже утверждён HR. Сначала выполните возврат на перерасчёт.'},409);
      const employeeId=clean(body.employeeId),workDate=ymd(body.workDate);
      if(!employeeId||!workDate||workDate.slice(0,7)!==period)return json({success:false,message:'Укажите сотрудника и дату месяца'},400);
      const existing=await env.DB.prepare(`SELECT iiko_employee_id FROM hr_employees
        WHERE user_id=?1 AND iiko_employee_id=?2 AND is_deleted=0 LIMIT 1`).bind(userId,employeeId).first();
      if(!existing)return json({success:false,message:'Сотрудник отсутствует в справочнике CHAIN'},404);
      if(action==='SAVE_CORRECTION'){
        const minutes=Number(body.workedMinutes),reason=clean(body.reason);
        if(!Number.isInteger(minutes)||minutes<0||minutes>1440||reason.length<10)
          return json({success:false,message:'Укажите 0–1440 минут и причину исправления (не менее 10 символов)'},400);
        const original=await loadDocument(env.DB,userId,scope,period);
        if(!original.doc.attendance.some(x=>x.employeeId===employeeId&&x.restaurantId===restaurantId&&
           x.workDate===workDate&&x.markCount>0))
          return json({success:false,message:'Нельзя создать оплачиваемую явку без исходной отметки ZKTeco этого RMS. Требуется отдельная проверка HR.'},409);
        await env.DB.prepare(`INSERT INTO hr_rms_payroll_corrections(
          user_id,month,restaurant_id,iiko_employee_id,work_date,worked_minutes,reason,actor_id,updated_at)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
          ON CONFLICT(user_id,month,restaurant_id,iiko_employee_id,work_date)
          DO UPDATE SET worked_minutes=excluded.worked_minutes,reason=excluded.reason,
          actor_id=excluded.actor_id,updated_at=excluded.updated_at`)
          .bind(userId,period,restaurantId,employeeId,workDate,minutes,reason,actorId,now()).run();
      }else await env.DB.prepare(`DELETE FROM hr_rms_payroll_corrections
        WHERE user_id=?1 AND month=?2 AND restaurant_id=?3 AND iiko_employee_id=?4 AND work_date=?5`)
        .bind(userId,period,restaurantId,employeeId,workDate).run();
      await env.DB.prepare(`UPDATE hr_rms_payroll_approvals SET status='DRAFT',source_hash='',approved_snapshot='{}',
        manager_id='',manager_at='',hr_id='',hr_at='',updated_at=?4
        WHERE user_id=?1 AND month=?2 AND restaurant_id=?3`).bind(userId,period,restaurantId,now()).run();
      await audit(env.DB,userId,period,restaurantId,action,actorId,employeeId,{workDate,workedMinutes:body.workedMinutes,reason:clean(body.reason)});
    }else if(action==='MANAGER_APPROVE'||action==='HR_APPROVE'||action==='REOPEN'){
      if(action!=='REOPEN'&&!approvalMonthClosed(period))return json({success:false,message:'Утверждение доступно после закрытия месяца'},409);
      const {docs}=await loadDocument(env.DB,userId,scope,period);
      const target=docs.find(x=>x.restaurantId===restaurantId);
      if(!target)return json({success:false,message:'Расчёт выбранного RMS не найден'},404);
      if(action!=='REOPEN'&&(!target.ready||target.attendanceDays===0))
        return json({success:false,message:'В Payroll есть неполные явки, нет нормы/ставки либо отсутствуют данные RMS. Проверьте строки перед утверждением.'},409);
      const t=now();
      if(action==='MANAGER_APPROVE'){
        if(old?.status==='HR_APPROVED')return json({success:false,message:'Payroll уже утверждён HR. Нужен возврат на перерасчёт.'},409);
        await env.DB.prepare(`INSERT INTO hr_rms_payroll_approvals(user_id,month,restaurant_id,status,source_hash,
          approved_snapshot,manager_id,manager_at,hr_id,hr_at,updated_at)
          VALUES(?1,?2,?3,'MANAGER_APPROVED',?4,'{}',?5,?6,'','',?6)
          ON CONFLICT(user_id,month,restaurant_id) DO UPDATE SET status='MANAGER_APPROVED',
          source_hash=excluded.source_hash,approved_snapshot='{}',manager_id=excluded.manager_id,
          manager_at=excluded.manager_at,hr_id='',hr_at='',updated_at=excluded.updated_at`)
          .bind(userId,period,restaurantId,target.sourceHash,actorId,t).run();
      }else if(action==='HR_APPROVE'){
        if(old?.status!=='MANAGER_APPROVED')return json({success:false,message:'Сначала Payroll должен подтвердить менеджер RMS'},409);
        if(old.source_hash!==target.sourceHash)return json({success:false,message:'Отметки, нормы или ставки изменились. Требуется новое утверждение менеджера.'},409);
        if(old.manager_id===actorId)return json({success:false,message:'Менеджер и утверждающий HR должны быть разными пользователями'},409);
        const snapshot={month:period,restaurantId,sourceHash:target.sourceHash,
          gross:target.gross,officialGross:target.officialGross,additionalGross:target.additionalGross,
          rows:target.rows.map(x=>({
            employeeId:x.employeeId,employeeName:x.employeeName,
            roleCode:x.roleCode,actualMinutes:x.acceptedMinutes,normDays:x.normDays,
            dailyNormMinutes:x.dailyNormMinutes,officialGross:x.officialGross,
            additionalGross:x.additionalGross,totalGross:x.totalGross
          })),approvedAt:t,approverId:actorId};
        await env.DB.prepare(`UPDATE hr_rms_payroll_approvals SET status='HR_APPROVED',approved_snapshot=?4,
          hr_id=?5,hr_at=?6,updated_at=?6 WHERE user_id=?1 AND month=?2 AND restaurant_id=?3
          AND status='MANAGER_APPROVED' AND source_hash=?7`)
          .bind(userId,period,restaurantId,JSON.stringify(snapshot),actorId,t,target.sourceHash).run();
      }else{
        if(old?.status!=='HR_APPROVED'&&old?.status!=='MANAGER_APPROVED')return json({success:false,message:'Payroll ещё не утверждён'},409);
        if(old.status==='HR_APPROVED'&&!can(state.access,'hr.timesheet.hr_approve'))return json({success:false,message:'После утверждения HR вернуть документ на перерасчёт может только HR сети'},403);
        await env.DB.prepare(`UPDATE hr_rms_payroll_approvals SET status='DRAFT',source_hash='',
          approved_snapshot='{}',manager_id='',manager_at='',hr_id='',hr_at='',updated_at=?4
          WHERE user_id=?1 AND month=?2 AND restaurant_id=?3`).bind(userId,period,restaurantId,t).run();
      }
      await audit(env.DB,userId,period,restaurantId,action,actorId,'',{previous:old?.status||'DRAFT',hash:target.sourceHash});
    }else return json({success:false,message:'Неизвестное действие'},400);
    const updated=await loadDocument(env.DB,userId,scope,period);
    return json({success:true,month:period,restaurantId,restaurants:updated.docs,
      network:updated.doc.network,attendance:updated.doc.attendance,postingEnabled:false});
  }catch(e){console.error('[HR-RMS-PAYROLL-POST]',e);return json({success:false,message:e?.message||String(e)},e?.status||500)}
}
