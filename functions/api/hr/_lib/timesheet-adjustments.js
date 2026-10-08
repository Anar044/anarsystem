const clean=v=>String(v??'').trim();
const num=(v,fallback=-1)=>{const n=Number(v);return Number.isFinite(n)?Math.round(n):fallback};
export const DEFAULT_OVERTIME_THRESHOLD_MINUTES=600;

export function hrAccessForUser(user,workspaceAccess=null){
  if(workspaceAccess!==null){
    const perms=new Set(workspaceAccess?.allowed?workspaceAccess.permissions||[]:[]);
    const can=permission=>perms.has('*')||perms.has(permission);
    return{
      role:workspaceAccess?.isOwner?'OWNER':'MEMBER',
      label:workspaceAccess?.isOwner?'Владелец':(workspaceAccess?.displayName||'Сотрудник'),
      canManagerApprove:can('hr.timesheet.manager_approve'),
      canHrApprove:can('hr.timesheet.hr_approve'),
      canReopen:can('hr.timesheet.manage')||can('hr.timesheet.hr_approve'),
      canCorrect:can('hr.timesheet.manage'),
      canSetOvertimeRule:can('hr.timesheet.hr_approve'),
      canViewPayroll:can('hr.payroll.view'),
      canSettlePayroll:can('hr.payroll.pay'),
      canConfigurePayrollAccounting:can('hr.payroll.calculate')
    };
  }
  const raw=clean(user?.app_metadata?.hr_role||user?.app_metadata?.app_role||user?.app_metadata?.role).toUpperCase();
  const role=['OWNER','ADMIN','MANAGER','HR','PAYROLL','VIEWER'].includes(raw)?raw:'OWNER';
  const owner=role==='OWNER'||role==='ADMIN';
  return{
    role,
    label:({OWNER:'Владелец',ADMIN:'Администратор',MANAGER:'Менеджер',HR:'HR',PAYROLL:'Payroll',VIEWER:'Просмотр'})[role]||role,
    canManagerApprove:owner||role==='MANAGER',
    canHrApprove:owner||role==='HR',
    canReopen:owner||role==='HR'||role==='MANAGER',
    canCorrect:owner||role==='HR'||role==='MANAGER',
    canSetOvertimeRule:owner||role==='HR',
    canViewPayroll:owner||role==='HR'||role==='PAYROLL',
    canSettlePayroll:owner||role==='HR'||role==='PAYROLL',
    canConfigurePayrollAccounting:owner||role==='PAYROLL'
  };
}
export function requireCapability(user,capability,workspaceAccess=null){
  const access=hrAccessForUser(user,workspaceAccess);
  if(!access[capability]){const e=new Error('Недостаточно прав для этого действия');e.status=403;e.access=access;throw e}
  return access;
}
export async function ensureTimesheetAdjustmentTables(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_timesheet_day_corrections (
      user_id TEXT NOT NULL,
      correction_id TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL,
      work_date TEXT NOT NULL,
      contour TEXT NOT NULL DEFAULT 'FACTUAL',
      status_override TEXT NOT NULL DEFAULT '',
      worked_minutes_override INTEGER NOT NULL DEFAULT -1,
      planned_minutes_override INTEGER NOT NULL DEFAULT -1,
      reason TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL DEFAULT '',
      actor_label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,iiko_employee_id,work_date,contour)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_timesheet_corrections_period ON hr_timesheet_day_corrections(user_id,work_date,contour)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_overtime_rules (
      user_id TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL,
      threshold_minutes INTEGER NOT NULL DEFAULT 600,
      payable_from_minutes INTEGER NOT NULL DEFAULT 600,
      note TEXT NOT NULL DEFAULT '',
      actor_id TEXT NOT NULL DEFAULT '',
      actor_label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,iiko_employee_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_overtime_requests (
      user_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL,
      work_date TEXT NOT NULL,
      candidate_minutes INTEGER NOT NULL DEFAULT 0,
      requested_minutes INTEGER NOT NULL DEFAULT 0,
      approved_minutes INTEGER NOT NULL DEFAULT 0,
      manager_reason TEXT NOT NULL DEFAULT '',
      hr_comment TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'DRAFT',
      manager_id TEXT NOT NULL DEFAULT '',
      manager_label TEXT NOT NULL DEFAULT '',
      manager_at TEXT NOT NULL DEFAULT '',
      hr_id TEXT NOT NULL DEFAULT '',
      hr_label TEXT NOT NULL DEFAULT '',
      hr_at TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,iiko_employee_id,work_date)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_overtime_period ON hr_overtime_requests(user_id,work_date,status)`)
  ]);
  // Existing installations already have the correction table; add columns in place.
  const columns=await db.prepare("PRAGMA table_info(hr_timesheet_day_corrections)").all();
  const existing=new Set((columns.results||[]).map(x=>String(x.name||'')));
  for(const column of ['first_in_override','last_out_override']){
    if(existing.has(column))continue;
    try{await db.prepare(`ALTER TABLE hr_timesheet_day_corrections ADD COLUMN ${column} TEXT NOT NULL DEFAULT ''`).run();}
    catch(error){if(!/duplicate column name/i.test(String(error?.message||error)))throw error}
  }
}
export async function loadTimesheetAdjustments(db,userId,from,to){
  if(!db)throw new Error('D1 binding DB не настроен.');
  try{
    const [c,r,o]=await Promise.all([
      db.prepare(`SELECT * FROM hr_timesheet_day_corrections WHERE user_id=?1 AND work_date>=?2 AND work_date<=?3`).bind(userId,from,to).all(),
      db.prepare(`SELECT * FROM hr_overtime_rules WHERE user_id=?1`).bind(userId).all(),
      db.prepare(`SELECT * FROM hr_overtime_requests WHERE user_id=?1 AND work_date>=?2 AND work_date<=?3`).bind(userId,from,to).all()
    ]);
    return{corrections:c.results||[],rules:r.results||[],overtime:o.results||[]};
  }catch(error){
    const message=String(error?.message||error||'');
    if(/no such table|does not exist/i.test(message))return{corrections:[],rules:[],overtime:[]};
    throw error;
  }
}
export function overtimeRuleFor(employeeId,rules,plannedMinutes=0){
  const rows=Array.isArray(rules)?rules:[];
  const specific=rows.find(x=>String(x.iiko_employee_id)===String(employeeId));
  const global=rows.find(x=>String(x.iiko_employee_id)==='*');
  const base=specific||global||null;
  const fallback=DEFAULT_OVERTIME_THRESHOLD_MINUTES;
  const threshold=Math.max(1,num(base?.threshold_minutes,fallback));
  const payable=Math.max(threshold,num(base?.payable_from_minutes,threshold));
  return{thresholdMinutes:threshold,payableFromMinutes:payable,source:specific?'EMPLOYEE':global?'GLOBAL':'DEFAULT',note:base?.note||''};
}
export function correctionDto(row){
  if(!row)return null;
  return{
    id:row.correction_id||'',
    employeeId:String(row.iiko_employee_id||''),
    workDate:row.work_date||'',
    contour:row.contour||'FACTUAL',
    statusOverride:row.status_override||'',
    workedMinutesOverride:Number(row.worked_minutes_override??-1),
    firstInOverride:row.first_in_override||'',
    lastOutOverride:row.last_out_override||'',
    plannedMinutesOverride:Number(row.planned_minutes_override??-1),
    reason:row.reason||'',
    actorId:row.actor_id||'',
    actorLabel:row.actor_label||'',
    createdAt:row.created_at||'',
    updatedAt:row.updated_at||''
  };
}
export function overtimeDto(row){
  if(!row)return null;
  return{
    id:row.request_id||'',
    employeeId:String(row.iiko_employee_id||''),
    workDate:row.work_date||'',
    candidateMinutes:Number(row.candidate_minutes||0),
    requestedMinutes:Number(row.requested_minutes||0),
    approvedMinutes:Number(row.approved_minutes||0),
    managerReason:row.manager_reason||'',
    hrComment:row.hr_comment||'',
    status:row.status||'DRAFT',
    manager:row.manager_at?{id:row.manager_id||'',label:row.manager_label||'',at:row.manager_at}:null,
    hr:row.hr_at?{id:row.hr_id||'',label:row.hr_label||'',at:row.hr_at}:null,
    createdAt:row.created_at||'',
    updatedAt:row.updated_at||''
  };
}
