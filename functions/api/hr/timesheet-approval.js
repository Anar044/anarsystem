import { loadRequestIikoState, privateConnection } from '../iiko/_lib/user-state.js';
import { resolveHrRestaurantScope } from './_lib/restaurant-scope.js';
import { logAuditEvent } from '../_lib/audit-log.js';
import { hrAccessForUser, requireCapability } from './_lib/timesheet-adjustments.js';
import { approvalTarget,approvalMonthClosed } from './_lib/department-approvals.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v,max=1000){return String(v??'').trim().slice(0,max)}
function month(v){const s=clean(v,7);return /^\d{4}-\d{2}$/.test(s)?s:''}
function contour(v){const s=clean(v,20).toUpperCase();return['FACTUAL','OFFICIAL'].includes(s)?s:''}
function now(){return new Date().toISOString()}
function actorLabel(user){return clean(user?.user_metadata?.full_name||user?.user_metadata?.name||user?.email||user?.id||'Пользователь',180)}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.prepare(`CREATE TABLE IF NOT EXISTS hr_timesheet_approvals (
    user_id TEXT NOT NULL,
    period_month TEXT NOT NULL,
    contour TEXT NOT NULL,
    scope_key TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    snapshot_hash TEXT NOT NULL DEFAULT '',
    manager_id TEXT NOT NULL DEFAULT '',
    manager_label TEXT NOT NULL DEFAULT '',
    manager_at TEXT NOT NULL DEFAULT '',
    hr_id TEXT NOT NULL DEFAULT '',
    hr_label TEXT NOT NULL DEFAULT '',
    hr_at TEXT NOT NULL DEFAULT '',
    comment TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(user_id,period_month,contour,scope_key)
  )`).run();
}
function dto(row,currentHash){
  if(!row)return{status:'DRAFT',stale:false,snapshotHash:'',manager:null,hr:null,comment:''};
  const stale=Boolean(row.snapshot_hash&&currentHash&&row.snapshot_hash!==currentHash);
  return{
    status:stale?'STALE':row.status,storedStatus:row.status,stale,snapshotHash:row.snapshot_hash||'',
    manager:row.manager_at?{id:row.manager_id||'',label:row.manager_label||'',at:row.manager_at}:null,
    hr:row.hr_at?{id:row.hr_id||'',label:row.hr_label||'',at:row.hr_at}:null,
    comment:row.comment||''
  };
}
async function getRow(db,userId,period,kind,key){
  return db.prepare(`SELECT * FROM hr_timesheet_approvals WHERE user_id=?1 AND period_month=?2 AND contour=?3 AND scope_key=?4 LIMIT 1`).bind(userId,period,kind,key).first();
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    if(!state.access?.allowed)return json({success:false,message:'Нет доступа к рабочему пространству'},403);
    const url=new URL(request.url),period=month(url.searchParams.get('month')),kind=contour(url.searchParams.get('contour')),currentHash=clean(url.searchParams.get('snapshotHash'),128);
    if(!period||!kind)return json({success:false,message:'Не указан месяц или контур табеля'},400);
    const userId=state.storageUserId||state.user.id,scope=await resolveHrRestaurantScope(request,env,userId,state.access);
    const selected=approvalTarget(scope,url.searchParams.get('departmentId')||'');
    await ensure(env.DB);
    const accessible=selected.available;
    let approvals=[];
    if(scope?.isChain&&accessible.length){
      const all=await env.DB.prepare("SELECT * FROM hr_timesheet_approvals WHERE user_id=?1 AND period_month=?2 AND contour=?3").bind(userId,period,kind).all();
      const byKey=new Map((all.results||[]).map(x=>[String(x.scope_key),x]));
      approvals=accessible.map(d=>({...d,approval:dto(byKey.get(d.id)||null,selected.key===d.id?currentHash:'')}));
    }
    const row=selected.key?await getRow(env.DB,userId,period,kind,selected.key):null;
    return json({success:true,month:period,contour:kind,scopeKey:selected.key,department:selected.department,
      departments:accessible,departmentApprovals:approvals,selectionRequired:scope?.isChain&&!selected.key,
      monthClosed:approvalMonthClosed(period),access:hrAccessForUser(state.user,state.access),approval:dto(row,currentHash)});
  }catch(e){console.error('[HR-TIMESHEET-APPROVAL-GET]',e);return json({success:false,message:e?.message||String(e)},e?.status||500)}
}
export async function onRequestPost({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    if(!state.access?.allowed)return json({success:false,message:'Нет доступа к рабочему пространству'},403);
    await ensure(env.DB);
    const body=await request.json().catch(()=>({})),action=clean(body.action,40).toUpperCase(),period=month(body.month),kind=contour(body.contour),hash=clean(body.snapshotHash,128),comment=clean(body.comment,1600);
    if(!period||!kind)return json({success:false,message:'Не указан месяц или контур табеля'},400);
    if(!hash&&action!=='REOPEN')return json({success:false,message:'Нет контрольной версии табеля. Сначала пересчитайте страницу.'},409);
    const userId=state.storageUserId||state.user.id,scope=await resolveHrRestaurantScope(request,env,userId,state.access);
    const target=approvalTarget(scope,body.departmentId||''),key=target.key;
    if(!key)return json({success:false,message:'Выберите один ресторан для подтверждения документа'},400);
    if(action!=='REOPEN'&&!approvalMonthClosed(period))return json({success:false,message:'Месячный табель можно подтвердить только после окончания месяца'},409);
    const old=await getRow(env.DB,userId,period,kind,key),oldDto=dto(old,hash),actor=actorLabel(state.user),t=now(),actorId=clean(state.user.id,180);
    let status=old?.status||'DRAFT',managerId=old?.manager_id||'',managerLabel=old?.manager_label||'',managerAt=old?.manager_at||'',hrId=old?.hr_id||'',hrLabel=old?.hr_label||'',hrAt=old?.hr_at||'',snapshot=old?.snapshot_hash||'';

    if(action==='MANAGER_APPROVE'){
      requireCapability(state.user,'canManagerApprove',state.access);
      status='MANAGER_APPROVED';snapshot=hash;managerId=actorId;managerLabel=actor;managerAt=t;hrId='';hrLabel='';hrAt='';
    }else if(action==='HR_APPROVE'){
      requireCapability(state.user,'canHrApprove',state.access);
      if(!old||old.status!=='MANAGER_APPROVED')return json({success:false,message:'Сначала табель должен подтвердить менеджер'},409);
      if(old.snapshot_hash!==hash)return json({success:false,message:'После подтверждения менеджером данные табеля изменились. Пересчитайте и подтвердите заново.'},409);
      status='HR_APPROVED';snapshot=hash;hrId=actorId;hrLabel=actor;hrAt=t;
    }else if(action==='REOPEN'){
      requireCapability(state.user,'canReopen',state.access);
      if(old?.status==='HR_APPROVED'&&!hrAccessForUser(state.user,state.access).canHrApprove)return json({success:false,message:'После утверждения HR вернуть табель может только HR или владелец'},403);
      status='DRAFT';snapshot='';managerId='';managerLabel='';managerAt='';hrId='';hrLabel='';hrAt='';
    }else return json({success:false,message:'Неизвестное действие'},400);

    await env.DB.prepare(`INSERT INTO hr_timesheet_approvals(user_id,period_month,contour,scope_key,status,snapshot_hash,manager_id,manager_label,manager_at,hr_id,hr_label,hr_at,comment,created_at,updated_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?14)
      ON CONFLICT(user_id,period_month,contour,scope_key) DO UPDATE SET status=excluded.status,snapshot_hash=excluded.snapshot_hash,manager_id=excluded.manager_id,manager_label=excluded.manager_label,manager_at=excluded.manager_at,hr_id=excluded.hr_id,hr_label=excluded.hr_label,hr_at=excluded.hr_at,comment=excluded.comment,updated_at=excluded.updated_at`)
      .bind(userId,period,kind,key,status,snapshot,managerId,managerLabel,managerAt,hrId,hrLabel,hrAt,comment,t).run();

    const row=await getRow(env.DB,userId,period,kind,key),afterDto=dto(row,hash),connection=privateConnection(state.state);
    await logAuditEvent({request,env,connection,action,entityType:'HR_TIMESHEET_APPROVAL',entityId:`${period}:${kind}:${key}`,entityLabel:`Табель ${period} · ${kind==='FACTUAL'?'Фактический':'Официальный'}`,before:oldDto,after:afterDto,restaurantIds:target.department?[target.department.id]:(scope?.selectedDepartmentIds||[]),metadata:{month:period,contour:kind,departmentId:target.department?.id||'',departmentName:target.department?.name||''}});
    return json({success:true,scopeKey:key,department:target.department,access:hrAccessForUser(state.user,state.access),approval:afterDto});
  }catch(e){console.error('[HR-TIMESHEET-APPROVAL-POST]',e);return json({success:false,message:e?.message||String(e),access:e?.access||undefined},e?.status||500)}
}