import { loadRequestIikoState, privateConnection } from '../iiko/_lib/user-state.js';
import { resolveHrRestaurantScope, filterEmployeesByScope } from './_lib/restaurant-scope.js';
import { calculateAzPrivateNonOilPayroll } from './_lib/az-payroll-rules.js';
import { logAuditEvent } from '../_lib/audit-log.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v,max=500){return String(v??'').trim().slice(0,max)}
function dateOnly(v){const s=clean(v,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''}
function money(v){const n=Number(v);return Number.isFinite(n)?Math.round(Math.max(0,n)*100)/100:0}
function now(){return new Date().toISOString()}
function uid(){return `hept_${crypto.randomUUID()}`}
function todayBaku(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}catch{return new Date().toISOString().slice(0,10)}}
function previousDate(v){const d=new Date(`${v}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_pay_terms_v2 (
      user_id TEXT NOT NULL,
      term_id TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT NOT NULL DEFAULT '',
      factual_rate_type TEXT NOT NULL DEFAULT 'MONTHLY',
      factual_rate REAL NOT NULL DEFAULT 0,
      official_rate_type TEXT NOT NULL DEFAULT 'MONTHLY',
      official_rate REAL NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'AZN',
      note TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,term_id)
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_emp_pay_v2_start ON hr_employee_pay_terms_v2(user_id,iiko_employee_id,effective_from)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_emp_pay_v2_current ON hr_employee_pay_terms_v2(user_id,iiko_employee_id,is_active,effective_from DESC)`)
  ]);
}

function employeeName(e){
  return [e?.last_name,e?.first_name,e?.middle_name].filter(Boolean).join(' ')||e?.display_name||e?.employee_code||e?.iiko_employee_id||'Сотрудник';
}

async function employeeRow(db,userId,employeeId,scope){
  const row=await db.prepare(`SELECT iiko_employee_id,employee_code,display_name,first_name,middle_name,last_name,role_code,role_name,department_code,hire_date,fire_date,is_deleted
    FROM hr_employees WHERE user_id=?1 AND iiko_employee_id=?2 AND TRIM(employee_code)<>'' LIMIT 1`).bind(userId,employeeId).first();
  if(!row)return null;
  return filterEmployeesByScope([row],scope).length?row:null;
}

function dto(r,asOf){
  const officialRate=money(r.official_rate),officialRateType=r.official_rate_type||'MONTHLY';
  return{
    id:r.term_id,
    employeeId:r.iiko_employee_id,
    effectiveFrom:r.effective_from,
    effectiveTo:r.effective_to||'',
    factualRateType:r.factual_rate_type||'MONTHLY',
    factualRate:money(r.factual_rate),
    officialRateType,
    officialRate,
    currency:r.currency||'AZN',
    note:r.note||'',
    active:Boolean(r.is_active),
    createdAt:r.created_at,
    updatedAt:r.updated_at,
    officialPayrollPreview:officialRateType==='MONTHLY'?calculateAzPrivateNonOilPayroll(officialRate,asOf||r.effective_from):null
  };
}

async function terms(db,userId,employeeId,asOf){
  const rows=await db.prepare(`SELECT * FROM hr_employee_pay_terms_v2
    WHERE user_id=?1 AND iiko_employee_id=?2 AND is_active=1
    ORDER BY effective_from DESC,created_at DESC`).bind(userId,employeeId).all();
  const history=(rows.results||[]).map(r=>dto(r,asOf));
  const current=history.find(t=>t.effectiveFrom<=asOf&&(!t.effectiveTo||t.effectiveTo>=asOf))||null;
  return{current,history};
}

async function rebuildRanges(db,userId,employeeId){
  const rows=await db.prepare(`SELECT term_id,effective_from FROM hr_employee_pay_terms_v2
    WHERE user_id=?1 AND iiko_employee_id=?2 AND is_active=1
    ORDER BY effective_from ASC,created_at ASC`).bind(userId,employeeId).all();
  const list=rows.results||[],t=now();
  const statements=list.map((row,i)=>{
    const next=list[i+1],to=next?previousDate(next.effective_from):'';
    return db.prepare(`UPDATE hr_employee_pay_terms_v2 SET effective_to=?4,updated_at=?5
      WHERE user_id=?1 AND iiko_employee_id=?2 AND term_id=?3`).bind(userId,employeeId,row.term_id,to,t);
  });
  if(statements.length)await db.batch(statements);
}

function validate(body){
  const effectiveFrom=dateOnly(body.effectiveFrom);
  const factualRateType=(clean(body.factualRateType,20)||'MONTHLY').toUpperCase();
  const officialRateType=(clean(body.officialRateType,20)||'MONTHLY').toUpperCase();
  if(!effectiveFrom)return{error:'Укажите дату начала действия новых условий'};
  if(!['MONTHLY','HOURLY'].includes(factualRateType))return{error:'Неизвестный тип фактической ставки'};
  if(!['MONTHLY','HOURLY'].includes(officialRateType))return{error:'Неизвестный тип официальной ставки'};
  return{
    effectiveFrom,
    factualRateType,
    factualRate:money(body.factualRate),
    officialRateType,
    officialRate:money(body.officialRate),
    note:clean(body.note,2000)
  };
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    await ensure(env.DB);
    const url=new URL(request.url),employeeId=clean(url.searchParams.get('id'),120),asOf=dateOnly(url.searchParams.get('asOf'))||todayBaku();
    if(!employeeId)return json({success:false,message:'Не указан сотрудник'},400);
    const scope=await resolveHrRestaurantScope(request,env,state.user.id);
    const employee=await employeeRow(env.DB,state.user.id,employeeId,scope);
    if(!employee)return json({success:false,message:'Сотрудник не найден или недоступен в выбранном ресторане'},404);
    return json({success:true,asOf,employee:{id:employeeId,name:employeeName(employee),code:employee.employee_code||'',roleName:employee.role_name||'',departmentCode:employee.department_code||''},...await terms(env.DB,state.user.id,employeeId,asOf)});
  }catch(e){console.error('[HR-EMPLOYEE-PAY-GET]',e);return json({success:false,message:e?.message||String(e)},500)}
}

export async function onRequestPost({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    await ensure(env.DB);
    const body=await request.json().catch(()=>({})),action=clean(body.action,40);
    if(action!=='saveTerm')return json({success:false,message:'Неизвестное действие'},400);
    const employeeId=clean(body.employeeId,120);if(!employeeId)return json({success:false,message:'Не указан сотрудник'},400);
    const scope=await resolveHrRestaurantScope(request,env,state.user.id);
    const employee=await employeeRow(env.DB,state.user.id,employeeId,scope);
    if(!employee)return json({success:false,message:'Сотрудник не найден или недоступен в выбранном ресторане'},404);
    const fields=validate(body);if(fields.error)return json({success:false,message:fields.error},400);

    const same=await env.DB.prepare(`SELECT term_id FROM hr_employee_pay_terms_v2
      WHERE user_id=?1 AND iiko_employee_id=?2 AND effective_from=?3 AND is_active=1 LIMIT 1`)
      .bind(state.user.id,employeeId,fields.effectiveFrom).first();
    if(same)return json({success:false,message:'На эту дату уже есть условия оплаты. Изменение зарплаты должно создаваться новой записью с другой датой начала.'},409);

    const beforeSet=await terms(env.DB,state.user.id,employeeId,fields.effectiveFrom);
    const before=beforeSet.current?{
      factualRateType:beforeSet.current.factualRateType,
      factualRate:beforeSet.current.factualRate,
      officialRateType:beforeSet.current.officialRateType,
      officialRate:beforeSet.current.officialRate,
      effectiveFrom:beforeSet.current.effectiveFrom,
      effectiveTo:beforeSet.current.effectiveTo,
      note:beforeSet.current.note
    }:null;

    const termId=uid(),t=now();
    await env.DB.prepare(`INSERT INTO hr_employee_pay_terms_v2(
      user_id,term_id,iiko_employee_id,effective_from,effective_to,factual_rate_type,factual_rate,official_rate_type,official_rate,currency,note,is_active,created_at,updated_at
    ) VALUES(?1,?2,?3,?4,'',?5,?6,?7,?8,'AZN',?9,1,?10,?10)`)
      .bind(state.user.id,termId,employeeId,fields.effectiveFrom,fields.factualRateType,fields.factualRate,fields.officialRateType,fields.officialRate,fields.note,t).run();

    await rebuildRanges(env.DB,state.user.id,employeeId);
    const responseTerms=await terms(env.DB,state.user.id,employeeId,todayBaku());
    const inserted=responseTerms.history.find(x=>x.id===termId);
    const after={
      factualRateType:inserted?.factualRateType||fields.factualRateType,
      factualRate:inserted?.factualRate??fields.factualRate,
      officialRateType:inserted?.officialRateType||fields.officialRateType,
      officialRate:inserted?.officialRate??fields.officialRate,
      effectiveFrom:inserted?.effectiveFrom||fields.effectiveFrom,
      effectiveTo:inserted?.effectiveTo||'',
      note:inserted?.note||fields.note
    };

    await logAuditEvent({
      request,env,connection:privateConnection(state.state),action:before?'UPDATE':'CREATE',
      entityType:'HR_EMPLOYEE_PAY_TERM',entityId:employeeId,entityLabel:`Условия оплаты · ${employeeName(employee)}`,
      before,after,restaurantIds:scope?.selectedDepartmentIds||[],
      metadata:{termId,employeeCode:employee.employee_code||'',roleCode:employee.role_code||'',effectiveFrom:fields.effectiveFrom}
    });

    return json({success:true,message:'Новые условия оплаты сохранены отдельной записью.',term:inserted||null,...responseTerms});
  }catch(e){console.error('[HR-EMPLOYEE-PAY-POST]',e);return json({success:false,message:e?.message||String(e)},500)}
}
