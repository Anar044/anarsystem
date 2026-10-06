import { loadRequestIikoState, privateConnection } from '../iiko/_lib/user-state.js';
import { resolveHrRestaurantScope } from './_lib/restaurant-scope.js';
import { logAuditEvent } from '../_lib/audit-log.js';
import {
  ensureTimesheetAdjustmentTables,hrAccessForUser,requireCapability,
  correctionDto,overtimeDto,DEFAULT_OVERTIME_THRESHOLD_MINUTES
} from './_lib/timesheet-adjustments.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v,max=2000){return String(v??'').trim().slice(0,max)}
function ymd(v){const s=clean(v,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''}
function contour(v){const s=clean(v,20).toUpperCase();return['FACTUAL','OFFICIAL'].includes(s)?s:''}
function now(){return new Date().toISOString()}
function actorLabel(user){return clean(user?.user_metadata?.full_name||user?.user_metadata?.name||user?.email||user?.id||'Пользователь',180)}
function mins(v,{allowNull=false,max=1440}={}){
  if(v===null||v===undefined||v==='')return allowNull?-1:0;
  const n=Math.round(Number(v));
  if(!Number.isFinite(n)||n<0||n>max)return null;
  return n;
}
async function correctionRow(db,userId,employeeId,workDate,kind){
  return db.prepare(`SELECT * FROM hr_timesheet_day_corrections WHERE user_id=?1 AND iiko_employee_id=?2 AND work_date=?3 AND contour=?4 LIMIT 1`).bind(userId,employeeId,workDate,kind).first();
}
async function overtimeRow(db,userId,employeeId,workDate){
  return db.prepare(`SELECT * FROM hr_overtime_requests WHERE user_id=?1 AND iiko_employee_id=?2 AND work_date=?3 LIMIT 1`).bind(userId,employeeId,workDate).first();
}
async function ruleRow(db,userId,employeeId){
  return db.prepare(`SELECT * FROM hr_overtime_rules WHERE user_id=?1 AND iiko_employee_id=?2 LIMIT 1`).bind(userId,employeeId).first();
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    await ensureTimesheetAdjustmentTables(env.DB);
    const url=new URL(request.url),from=ymd(url.searchParams.get('from')),to=ymd(url.searchParams.get('to'));
    if(!from||!to||from>to)return json({success:false,message:'Некорректный период'},400);
    const userId=state.user.id;
    const [c,r,o]=await Promise.all([
      env.DB.prepare(`SELECT * FROM hr_timesheet_day_corrections WHERE user_id=?1 AND work_date>=?2 AND work_date<=?3 ORDER BY work_date,iiko_employee_id`).bind(userId,from,to).all(),
      env.DB.prepare(`SELECT * FROM hr_overtime_rules WHERE user_id=?1 ORDER BY iiko_employee_id`).bind(userId).all(),
      env.DB.prepare(`SELECT * FROM hr_overtime_requests WHERE user_id=?1 AND work_date>=?2 AND work_date<=?3 ORDER BY work_date,iiko_employee_id`).bind(userId,from,to).all()
    ]);
    return json({success:true,access:hrAccessForUser(state.user),corrections:(c.results||[]).map(correctionDto),rules:r.results||[],overtime:(o.results||[]).map(overtimeDto),defaults:{overtimeThresholdMinutes:DEFAULT_OVERTIME_THRESHOLD_MINUTES}});
  }catch(e){console.error('[HR-TIMESHEET-ADJUSTMENTS-GET]',e);return json({success:false,message:e?.message||String(e)},e?.status||500)}
}

export async function onRequestPost({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    await ensureTimesheetAdjustmentTables(env.DB);
    const body=await request.json().catch(()=>({})),action=clean(body.action,60).toUpperCase(),userId=state.user.id,actorId=clean(state.user.id,180),actor=actorLabel(state.user),t=now();
    const access=hrAccessForUser(state.user),scope=await resolveHrRestaurantScope(request,env,userId),connection=privateConnection(state.state);
    const employeeId=clean(body.employeeId,180),workDate=ymd(body.workDate),kind=contour(body.contour)||'FACTUAL';
    const audit=async({auditAction,entityType,entityId,entityLabel,before,after,metadata={}})=>logAuditEvent({request,env,connection,action:auditAction,entityType,entityId,entityLabel,before,after,restaurantIds:scope?.selectedDepartmentIds||[],metadata});

    if(action==='SAVE_CORRECTION'){
      requireCapability(state.user,'canCorrect');
      if(!employeeId||!workDate)return json({success:false,message:'Не указан сотрудник или дата'},400);
      const allowed=new Set(['','WORK','WORK_REST','LEAVE','LEAVE_WITH_WORK','ABSENT','REST','REVIEW','NO_SCHEDULE','WORK_NO_SCHEDULE']);
      const statusOverride=clean(body.statusOverride,40).toUpperCase();
      if(!allowed.has(statusOverride))return json({success:false,message:'Недопустимый статус корректировки'},400);
      const worked=mins(body.workedMinutesOverride,{allowNull:true,max:1440}),planned=mins(body.plannedMinutesOverride,{allowNull:true,max:1440}),reason=clean(body.reason,1600);
      if(worked===null||planned===null)return json({success:false,message:'Часы корректировки указаны неверно'},400);
      if(!reason)return json({success:false,message:'Укажите причину ручной корректировки'},400);
      const old=correctionDto(await correctionRow(env.DB,userId,employeeId,workDate,kind)),id=old?.id||crypto.randomUUID();
      await env.DB.prepare(`INSERT INTO hr_timesheet_day_corrections(user_id,correction_id,iiko_employee_id,work_date,contour,status_override,worked_minutes_override,planned_minutes_override,reason,actor_id,actor_label,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12)
        ON CONFLICT(user_id,iiko_employee_id,work_date,contour) DO UPDATE SET status_override=excluded.status_override,worked_minutes_override=excluded.worked_minutes_override,planned_minutes_override=excluded.planned_minutes_override,reason=excluded.reason,actor_id=excluded.actor_id,actor_label=excluded.actor_label,updated_at=excluded.updated_at`)
        .bind(userId,id,employeeId,workDate,kind,statusOverride,worked,planned,reason,actorId,actor,t).run();
      const after=correctionDto(await correctionRow(env.DB,userId,employeeId,workDate,kind));
      await audit({auditAction:'UPDATE',entityType:'HR_TIMESHEET_CORRECTION',entityId:id,entityLabel:`Корректировка табеля · ${employeeId} · ${workDate}`,before:old,after,metadata:{employeeId,workDate,contour:kind}});
      return json({success:true,access,correction:after});
    }

    if(action==='DELETE_CORRECTION'){
      requireCapability(state.user,'canCorrect');
      if(!employeeId||!workDate)return json({success:false,message:'Не указан сотрудник или дата'},400);
      const old=correctionDto(await correctionRow(env.DB,userId,employeeId,workDate,kind));
      if(old)await env.DB.prepare(`DELETE FROM hr_timesheet_day_corrections WHERE user_id=?1 AND iiko_employee_id=?2 AND work_date=?3 AND contour=?4`).bind(userId,employeeId,workDate,kind).run();
      await audit({auditAction:'DELETE',entityType:'HR_TIMESHEET_CORRECTION',entityId:old?.id||`${employeeId}:${workDate}:${kind}`,entityLabel:`Корректировка табеля · ${employeeId} · ${workDate}`,before:old,after:null,metadata:{employeeId,workDate,contour:kind}});
      return json({success:true,access,deleted:Boolean(old)});
    }

    if(action==='SAVE_OVERTIME_RULE'){
      requireCapability(state.user,'canSetOvertimeRule');
      const target=employeeId||'*',threshold=mins(body.thresholdMinutes,{max:1440}),payable=mins(body.payableFromMinutes,{max:1440}),note=clean(body.note,1000);
      if(threshold===null||payable===null||threshold<1||payable<threshold)return json({success:false,message:'Порог оплаты должен быть не меньше порога дополнительных часов'},400);
      const old=await ruleRow(env.DB,userId,target);
      const created=old?.created_at||t;
      await env.DB.prepare(`INSERT INTO hr_overtime_rules(user_id,iiko_employee_id,threshold_minutes,payable_from_minutes,note,actor_id,actor_label,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)
        ON CONFLICT(user_id,iiko_employee_id) DO UPDATE SET threshold_minutes=excluded.threshold_minutes,payable_from_minutes=excluded.payable_from_minutes,note=excluded.note,actor_id=excluded.actor_id,actor_label=excluded.actor_label,updated_at=excluded.updated_at`)
        .bind(userId,target,threshold,payable,note,actorId,actor,created,t).run();
      const after=await ruleRow(env.DB,userId,target);
      await audit({auditAction:'UPDATE',entityType:'HR_OVERTIME_RULE',entityId:target,entityLabel:target==='*'?'Общее правило доп. часов':`Правило доп. часов · ${target}`,before:old,after,metadata:{employeeId:target}});
      return json({success:true,access,rule:after});
    }

    if(action==='SUBMIT_OVERTIME'){
      requireCapability(state.user,'canManagerApprove');
      if(!employeeId||!workDate)return json({success:false,message:'Не указан сотрудник или дата'},400);
      const candidate=mins(body.candidateMinutes,{max:1440}),requested=mins(body.requestedMinutes,{max:1440}),reason=clean(body.managerReason,1600);
      if(candidate===null||requested===null||candidate<=0)return json({success:false,message:'На выбранную дату нет дополнительных часов для подтверждения'},400);
      if(requested<0||requested>candidate)return json({success:false,message:'Подтверждаемое менеджером время не может превышать рассчитанные дополнительные часы'},400);
      if(!reason)return json({success:false,message:'Менеджер должен указать причину дополнительных часов'},400);
      const old=overtimeDto(await overtimeRow(env.DB,userId,employeeId,workDate)),id=old?.id||crypto.randomUUID(),created=old?.createdAt||t;
      await env.DB.prepare(`INSERT INTO hr_overtime_requests(user_id,request_id,iiko_employee_id,work_date,candidate_minutes,requested_minutes,approved_minutes,manager_reason,hr_comment,status,manager_id,manager_label,manager_at,hr_id,hr_label,hr_at,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,0,?7,'','MANAGER_SUBMITTED',?8,?9,?10,'','','',?11,?10)
        ON CONFLICT(user_id,iiko_employee_id,work_date) DO UPDATE SET candidate_minutes=excluded.candidate_minutes,requested_minutes=excluded.requested_minutes,approved_minutes=0,manager_reason=excluded.manager_reason,hr_comment='',status='MANAGER_SUBMITTED',manager_id=excluded.manager_id,manager_label=excluded.manager_label,manager_at=excluded.manager_at,hr_id='',hr_label='',hr_at='',updated_at=excluded.updated_at`)
        .bind(userId,id,employeeId,workDate,candidate,requested,reason,actorId,actor,t,created).run();
      const after=overtimeDto(await overtimeRow(env.DB,userId,employeeId,workDate));
      await audit({auditAction:'SUBMIT',entityType:'HR_OVERTIME_REQUEST',entityId:id,entityLabel:`Доп. часы · ${employeeId} · ${workDate}`,before:old,after,metadata:{employeeId,workDate}});
      return json({success:true,access,overtime:after});
    }

    if(action==='HR_APPROVE_OVERTIME'){
      requireCapability(state.user,'canHrApprove');
      if(!employeeId||!workDate)return json({success:false,message:'Не указан сотрудник или дата'},400);
      const oldRow=await overtimeRow(env.DB,userId,employeeId,workDate),old=overtimeDto(oldRow);
      if(!oldRow||oldRow.status!=='MANAGER_SUBMITTED')return json({success:false,message:'Сначала менеджер должен отправить дополнительные часы на HR'},409);
      const approved=mins(body.approvedMinutes,{max:1440}),comment=clean(body.hrComment,1600);
      if(approved===null||approved<0||approved>Number(oldRow.candidate_minutes||0))return json({success:false,message:'HR не может подтвердить больше рассчитанных дополнительных часов'},400);
      const status=approved===Number(oldRow.requested_minutes||0)?'HR_APPROVED':'HR_CHANGED';
      await env.DB.prepare(`UPDATE hr_overtime_requests SET approved_minutes=?5,hr_comment=?6,status=?7,hr_id=?8,hr_label=?9,hr_at=?10,updated_at=?10 WHERE user_id=?1 AND iiko_employee_id=?2 AND work_date=?3`)
        .bind(userId,employeeId,workDate,'',approved,comment,status,actorId,actor,t).run();
      const after=overtimeDto(await overtimeRow(env.DB,userId,employeeId,workDate));
      await audit({auditAction:'APPROVE',entityType:'HR_OVERTIME_REQUEST',entityId:after.id,entityLabel:`Доп. часы · ${employeeId} · ${workDate}`,before:old,after,metadata:{employeeId,workDate}});
      return json({success:true,access,overtime:after});
    }

    if(action==='HR_REJECT_OVERTIME'){
      requireCapability(state.user,'canHrApprove');
      if(!employeeId||!workDate)return json({success:false,message:'Не указан сотрудник или дата'},400);
      const oldRow=await overtimeRow(env.DB,userId,employeeId,workDate),old=overtimeDto(oldRow),comment=clean(body.hrComment,1600);
      if(!oldRow||oldRow.status!=='MANAGER_SUBMITTED')return json({success:false,message:'Нет заявки менеджера на подтверждение'},409);
      await env.DB.prepare(`UPDATE hr_overtime_requests SET approved_minutes=0,hr_comment=?4,status='HR_REJECTED',hr_id=?5,hr_label=?6,hr_at=?7,updated_at=?7 WHERE user_id=?1 AND iiko_employee_id=?2 AND work_date=?3`)
        .bind(userId,employeeId,workDate,comment,actorId,actor,t).run();
      const after=overtimeDto(await overtimeRow(env.DB,userId,employeeId,workDate));
      await audit({auditAction:'REJECT',entityType:'HR_OVERTIME_REQUEST',entityId:after.id,entityLabel:`Доп. часы · ${employeeId} · ${workDate}`,before:old,after,metadata:{employeeId,workDate}});
      return json({success:true,access,overtime:after});
    }

    if(action==='RESET_OVERTIME'){
      requireCapability(state.user,'canReopen');
      if(!employeeId||!workDate)return json({success:false,message:'Не указан сотрудник или дата'},400);
      const old=overtimeDto(await overtimeRow(env.DB,userId,employeeId,workDate));
      if(old)await env.DB.prepare(`DELETE FROM hr_overtime_requests WHERE user_id=?1 AND iiko_employee_id=?2 AND work_date=?3`).bind(userId,employeeId,workDate).run();
      await audit({auditAction:'REOPEN',entityType:'HR_OVERTIME_REQUEST',entityId:old?.id||`${employeeId}:${workDate}`,entityLabel:`Доп. часы · ${employeeId} · ${workDate}`,before:old,after:null,metadata:{employeeId,workDate}});
      return json({success:true,access,deleted:Boolean(old)});
    }

    return json({success:false,message:'Неизвестное действие'},400);
  }catch(e){console.error('[HR-TIMESHEET-ADJUSTMENTS-POST]',e);return json({success:false,message:e?.message||String(e),access:e?.access||undefined},e?.status||500)}
}
