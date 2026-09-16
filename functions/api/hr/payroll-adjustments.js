import { calculateCompensation } from './_lib/az-payroll-rules.js';
import { iikoJson } from '../iiko/_lib/iiko-client.js';
import { loadRequestIikoState, privateConnection, hasPrivateConnection } from '../iiko/_lib/user-state.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function money(v){const n=Number(v);return Number.isFinite(n)?Math.round(Math.max(0,n)*100)/100:0}
function monthOnly(v){return /^\d{4}-\d{2}$/.test(clean(v))?clean(v):''}
function dateOnly(v){const s=clean(v);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''}
function monthBounds(month){const[y,m]=month.split('-').map(Number),last=new Date(Date.UTC(y,m,0)).getUTCDate();return{from:`${month}-01`,to:`${month}-${String(last).padStart(2,'0')}`}}
function previousDate(v){const d=new Date(`${v}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)}
function now(){return new Date().toISOString()}
function uid(prefix){return`${prefix}_${crypto.randomUUID()}`}
function asArray(payload){if(Array.isArray(payload))return payload;for(const k of ['items','data','rows','accounts'])if(Array.isArray(payload?.[k]))return payload[k];return[]}
function idValue(v){if(v&&typeof v==='object')return clean(v.id??v.uuid??v.entityId??v.counteragentId??v.accountId);return clean(v).replace(/^\{+|\}+$/g,'').toLowerCase()}
function pick(o,keys){for(const k of keys){if(o&&o[k]!=null&&clean(o[k])!=='')return o[k]}return''}
function rowEmployeeId(r){return idValue(pick(r,['counteragentId','counteragent','contractorId','contractor','employeeId','employee','personId','person']))}
function rowAccountId(r){return idValue(pick(r,['accountId','account','accountUuid','Account']))}
function rowAmount(r){const n=Number(pick(r,['sum','balance','amount','value','Sum']));return Number.isFinite(n)?n:0}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_payroll_adjustments (
      user_id TEXT NOT NULL,adjustment_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,month TEXT NOT NULL,
      adjustment_type TEXT NOT NULL,amount REAL NOT NULL DEFAULT 0,reason TEXT NOT NULL DEFAULT '',source TEXT NOT NULL DEFAULT 'MANUAL',
      tax_treatment TEXT NOT NULL DEFAULT 'TAXABLE',legal_basis TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT 'DRAFT',
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,adjustment_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_payroll_adj_month ON hr_payroll_adjustments(user_id,month,iiko_employee_id,status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_meal_policies (
      user_id TEXT NOT NULL,policy_id TEXT NOT NULL,scope_type TEXT NOT NULL,scope_key TEXT NOT NULL,monthly_limit REAL NOT NULL DEFAULT 0,
      effective_from TEXT NOT NULL,effective_to TEXT NOT NULL DEFAULT '',is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,policy_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_meal_policy_scope ON hr_meal_policies(user_id,scope_type,scope_key,is_active,effective_from)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_meal_monthly (
      user_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,month TEXT NOT NULL,opening_debt REAL NOT NULL DEFAULT 0,closing_debt REAL NOT NULL DEFAULT 0,
      month_net_increase REAL NOT NULL DEFAULT 0,source TEXT NOT NULL DEFAULT 'MANUAL',synced_at TEXT NOT NULL DEFAULT '',details_json TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY(user_id,iiko_employee_id,month)
    )`)
  ]);
}

function activePolicy(policies,employeeId,roleCode,asOf){
  const valid=p=>Number(p.is_active)&&p.effective_from<=asOf&&(!p.effective_to||p.effective_to>=asOf);
  return policies.find(p=>valid(p)&&p.scope_type==='EMPLOYEE'&&String(p.scope_key)===String(employeeId))
    ||policies.find(p=>valid(p)&&p.scope_type==='ROLE'&&String(p.scope_key)===String(roleCode))||null;
}
function activeTerm(rows,key,value,asOf){return rows.find(r=>String(r[key])===String(value)&&r.effective_from<=asOf&&(!r.effective_to||r.effective_to>=asOf))||null}
function adjustmentDto(r){return{id:r.adjustment_id,employeeId:r.iiko_employee_id,month:r.month,type:r.adjustment_type,amount:money(r.amount),reason:r.reason||'',source:r.source||'MANUAL',taxTreatment:r.tax_treatment||'TAXABLE',legalBasis:r.legal_basis||'',status:r.status||'DRAFT',createdAt:r.created_at,updatedAt:r.updated_at}}
function termDto(r){return r?{officialGross:money(r.official_gross),additionalAmount:money(r.additional_amount),additionalTaxTreatment:r.additional_tax_treatment||'TAXABLE'}:null}

async function snapshot(db,userId,month){
  const b=monthBounds(month),asOf=b.to;
  const [employeesR,adjustmentsR,policiesR,mealR,employeeTermsR,roleTermsR]=await Promise.all([
    db.prepare(`SELECT iiko_employee_id,employee_code,display_name,first_name,middle_name,last_name,role_code,role_name,is_deleted,fire_date,hire_date FROM hr_employees WHERE user_id=?1 AND TRIM(employee_code)<>'' ORDER BY display_name COLLATE NOCASE`).bind(userId).all(),
    db.prepare(`SELECT * FROM hr_payroll_adjustments WHERE user_id=?1 AND month=?2 ORDER BY updated_at DESC`).bind(userId,month).all(),
    db.prepare(`SELECT * FROM hr_meal_policies WHERE user_id=?1 AND is_active=1 ORDER BY effective_from DESC`).bind(userId).all(),
    db.prepare(`SELECT * FROM hr_employee_meal_monthly WHERE user_id=?1 AND month=?2`).bind(userId,month).all(),
    db.prepare(`SELECT * FROM hr_compensation_terms WHERE user_id=?1 AND is_active=1 ORDER BY iiko_employee_id,effective_from DESC`).bind(userId).all(),
    db.prepare(`SELECT * FROM hr_role_compensation_terms WHERE user_id=?1 AND is_active=1 ORDER BY role_code,effective_from DESC`).bind(userId).all()
  ]);
  const adjustments=(adjustmentsR.results||[]).map(adjustmentDto),policies=policiesR.results||[],mealMap=new Map((mealR.results||[]).map(x=>[String(x.iiko_employee_id),x]));
  const empTerms=employeeTermsR.results||[],roleTerms=roleTermsR.results||[];
  const employees=[];
  for(const e of employeesR.results||[]){
    if(Number(e.is_deleted))continue;if(e.hire_date&&e.hire_date>b.to)continue;if(e.fire_date&&e.fire_date<b.from)continue;
    const id=String(e.iiko_employee_id),roleCode=String(e.role_code||''),name=[e.last_name,e.first_name,e.middle_name].filter(Boolean).join(' ')||e.display_name||e.employee_code||id;
    const list=adjustments.filter(a=>String(a.employeeId)===id),approved=list.filter(a=>a.status==='APPROVED');
    const advances=approved.filter(a=>a.type==='ADVANCE').reduce((s,a)=>s+a.amount,0),deductions=approved.filter(a=>a.type==='DEDUCTION').reduce((s,a)=>s+a.amount,0);
    const taxableRewards=approved.filter(a=>a.type==='REWARD'&&a.taxTreatment!=='EXEMPT_WITH_BASIS').reduce((s,a)=>s+a.amount,0),exemptRewards=approved.filter(a=>a.type==='REWARD'&&a.taxTreatment==='EXEMPT_WITH_BASIS').reduce((s,a)=>s+a.amount,0);
    const individual=activeTerm(empTerms,'iiko_employee_id',id,asOf),role=activeTerm(roleTerms,'role_code',roleCode,asOf),term=termDto(individual||role);
    const calc=term?calculateCompensation({officialGross:term.officialGross+taxableRewards,additionalAmount:term.additionalAmount,additionalTaxTreatment:term.additionalTaxTreatment,calculationDate:asOf}):null;
    const beforeDeductions=calc?money(calc.totalEmployeeReceives+exemptRewards):0,finalPayable=money(Math.max(0,beforeDeductions-advances-deductions));
    const employerCost=calc?money(calc.totalEmployerCost+exemptRewards):0;
    const policy=activePolicy(policies,id,roleCode,asOf),limit=money(policy?.monthly_limit||0),meal=mealMap.get(id),openingDebt=money(meal?.opening_debt||0),closingDebt=money(meal?.closing_debt||0),netIncrease=Math.max(0,money(meal?.month_net_increase||0));
    const restaurantCovered=money(Math.min(netIncrease,limit)),overLimit=money(Math.max(0,netIncrease-limit));
    const approvedMealDeduction=approved.filter(a=>a.type==='DEDUCTION'&&a.source==='MEAL_OVER_LIMIT').reduce((s,a)=>s+a.amount,0);
    const deductionCap=money(beforeDeductions*.20),deductionOverCap=deductions>deductionCap+.009;
    employees.push({id,code:e.employee_code||'',name,roleCode,roleName:e.role_name||roleCode,
      adjustments:list,totals:{advances:money(advances),deductions:money(deductions),taxableRewards:money(taxableRewards),exemptRewards:money(exemptRewards),rewards:money(taxableRewards+exemptRewards),drafts:list.filter(a=>a.status==='DRAFT').length},
      meal:{policyId:policy?.policy_id||'',policySource:policy?.scope_type||'',limit,openingDebt,closingDebt,monthNetIncrease:netIncrease,restaurantCovered,overLimit,approvedDeduction:money(approvedMealDeduction),pendingDeduction:money(Math.max(0,overLimit-approvedMealDeduction)),source:meal?.source||'',syncedAt:meal?.synced_at||''},
      payroll:{baseConfigured:Boolean(term),calculation:calc,beforeDeductions,finalPayable,employerCost,deductionCap,deductionOverCap}
    });
  }
  const sum=(path)=>money(employees.reduce((s,e)=>s+path(e),0));
  return{success:true,month,employees,adjustments,policies:policies.map(p=>({id:p.policy_id,scopeType:p.scope_type,scopeKey:p.scope_key,monthlyLimit:money(p.monthly_limit),effectiveFrom:p.effective_from,effectiveTo:p.effective_to||'',active:Boolean(p.is_active)})),summary:{employees:employees.length,advances:sum(e=>e.totals.advances),deductions:sum(e=>e.totals.deductions),rewards:sum(e=>e.totals.rewards),mealUsed:sum(e=>e.meal.monthNetIncrease),mealCovered:sum(e=>e.meal.restaurantCovered),mealOverLimit:sum(e=>e.meal.overLimit),finalPayable:sum(e=>e.payroll.finalPayable),employerCost:sum(e=>e.payroll.employerCost),review:employees.filter(e=>e.payroll.deductionOverCap||e.meal.pendingDeduction>0||e.totals.drafts>0).length}};
}

async function fetchDebtAccounts(connection){
  const r=await iikoJson(connection,'/resto/api/v2/entities/accounts/list?includeDeleted=false&revisionFrom=-1');
  if(!r.ok||!r.payload)return{ids:new Set(),accounts:[],status:r.status};
  const rows=asArray(r.payload),accounts=rows.map(a=>({id:idValue(a.id??a.Id),name:clean(a.name??a.Name),type:clean(a.type??a.Type),code:clean(a.code??a.Code)})).filter(a=>a.id);
  const ids=new Set(accounts.filter(a=>`${a.name} ${a.type} ${a.code}`.toLowerCase().match(/задолж.*сотруд|кредит.*сотруд|employee.*debt|employee.*credit/)).map(a=>a.id));
  return{ids,accounts,status:r.status};
}
async function fetchCounteragentBalances(connection,timestamp){
  const r=await iikoJson(connection,`/resto/api/v2/reports/balance/counteragents?timestamp=${encodeURIComponent(timestamp)}`);
  if(!r.ok||!r.payload)throw new Error(`iiko balance/counteragents HTTP ${r.status}: ${r.text.slice(0,300)}`);
  return asArray(r.payload);
}
function aggregateBalances(rows,employeeIds,debtAccountIds){
  const out=new Map();let matched=0;
  for(const r of rows){const employeeId=rowEmployeeId(r),accountId=rowAccountId(r);if(!employeeIds.has(employeeId))continue;if(debtAccountIds.size&&accountId&&!debtAccountIds.has(accountId))continue;const amount=rowAmount(r);out.set(employeeId,(out.get(employeeId)||0)+amount);matched++}
  return{out,matched};
}
async function syncIikoDebt(request,env,userId,month){
  const state=await loadRequestIikoState(request,env);if(!state?.user||String(state.user.id)!==String(userId))throw new Error('Требуется авторизация');if(!state.found||!hasPrivateConnection(state.state))throw new Error('Сначала подключите SH Server в настройках.');
  const connection=privateConnection(state.state),b=monthBounds(month),employeesR=await env.DB.prepare(`SELECT iiko_employee_id FROM hr_employees WHERE user_id=?1 AND is_deleted=0 AND TRIM(employee_code)<>''`).bind(userId).all(),ids=new Set((employeesR.results||[]).map(e=>String(e.iiko_employee_id).toLowerCase()));
  const accounts=await fetchDebtAccounts(connection),openTs=`${previousDate(b.from)}T23:59:59`,closeTs=`${b.to}T23:59:59`,[openRows,closeRows]=await Promise.all([fetchCounteragentBalances(connection,openTs),fetchCounteragentBalances(connection,closeTs)]),open=aggregateBalances(openRows,ids,accounts.ids),close=aggregateBalances(closeRows,ids,accounts.ids),t=now();
  const statements=[];for(const id of ids){const opening=money(open.out.get(id)||0),closing=money(close.out.get(id)||0),delta=Math.round((closing-opening)*100)/100;statements.push(env.DB.prepare(`INSERT INTO hr_employee_meal_monthly(user_id,iiko_employee_id,month,opening_debt,closing_debt,month_net_increase,source,synced_at,details_json) VALUES(?1,?2,?3,?4,?5,?6,'IIKO_COUNTERAGENT_BALANCE',?7,?8) ON CONFLICT(user_id,iiko_employee_id,month) DO UPDATE SET opening_debt=excluded.opening_debt,closing_debt=excluded.closing_debt,month_net_increase=excluded.month_net_increase,source=excluded.source,synced_at=excluded.synced_at,details_json=excluded.details_json`).bind(userId,id,month,opening,closing,delta,t,JSON.stringify({openTs,closeTs,debtAccountIds:[...accounts.ids]})))}
  for(let i=0;i<statements.length;i+=50)await env.DB.batch(statements.slice(i,i+50));
  return{matchedOpeningRows:open.matched,matchedClosingRows:close.matched,debtAccounts:[...accounts.ids],accountCandidates:accounts.accounts.filter(a=>accounts.ids.has(a.id)).slice(0,20)};
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){try{const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);await ensure(env.DB);const url=new URL(request.url),month=monthOnly(url.searchParams.get('month'))||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit'}).format(new Date());return json(await snapshot(env.DB,state.user.id,month))}catch(e){console.error('[HR-PAYROLL-ADJ-GET]',e);return json({success:false,message:e?.message||String(e)},500)}}
export async function onRequestPost({request,env}){try{const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);await ensure(env.DB);const userId=state.user.id,b=await request.json().catch(()=>({})),action=clean(b.action),month=monthOnly(b.month);if(!month)return json({success:false,message:'Укажите месяц YYYY-MM'},400),t=now();
  if(action==='saveAdjustment'){
    const employeeId=clean(b.employeeId),type=clean(b.type).toUpperCase(),amount=money(b.amount),reason=clean(b.reason),source=(clean(b.source)||'MANUAL').toUpperCase(),tax=(clean(b.taxTreatment)||'TAXABLE').toUpperCase(),basis=clean(b.legalBasis),status=(clean(b.status)||'DRAFT').toUpperCase();
    if(!employeeId||!['ADVANCE','DEDUCTION','REWARD'].includes(type)||amount<=0||!reason)return json({success:false,message:'Заполните сотрудника, тип, сумму и причину'},400);if(!['DRAFT','APPROVED'].includes(status))return json({success:false,message:'Некорректный статус'},400);if(type==='REWARD'&&tax==='EXEMPT_WITH_BASIS'&&!basis)return json({success:false,message:'Для необлагаемого вознаграждения укажите законное основание'},400);
    const emp=await env.DB.prepare(`SELECT 1 FROM hr_employees WHERE user_id=?1 AND iiko_employee_id=?2 AND is_deleted=0 LIMIT 1`).bind(userId,employeeId).first();if(!emp)return json({success:false,message:'Сотрудник не найден'},404);const id=clean(b.id)||uid('hpa');
    await env.DB.prepare(`INSERT INTO hr_payroll_adjustments(user_id,adjustment_id,iiko_employee_id,month,adjustment_type,amount,reason,source,tax_treatment,legal_basis,status,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?12) ON CONFLICT(user_id,adjustment_id) DO UPDATE SET iiko_employee_id=excluded.iiko_employee_id,month=excluded.month,adjustment_type=excluded.adjustment_type,amount=excluded.amount,reason=excluded.reason,source=excluded.source,tax_treatment=excluded.tax_treatment,legal_basis=excluded.legal_basis,status=excluded.status,updated_at=excluded.updated_at`).bind(userId,id,employeeId,month,type,amount,reason,source,tax,basis,status,t).run();return json(await snapshot(env.DB,userId,month));
  }
  if(action==='setAdjustmentStatus'){const id=clean(b.id),status=clean(b.status).toUpperCase();if(!id||!['DRAFT','APPROVED','CANCELLED'].includes(status))return json({success:false,message:'Некорректный статус'},400);await env.DB.prepare(`UPDATE hr_payroll_adjustments SET status=?3,updated_at=?4 WHERE user_id=?1 AND adjustment_id=?2`).bind(userId,id,status,t).run();return json(await snapshot(env.DB,userId,month))}
  if(action==='saveMealPolicy'){const scopeType=clean(b.scopeType).toUpperCase(),scopeKey=clean(b.scopeKey),limit=money(b.monthlyLimit),from=dateOnly(b.effectiveFrom)||`${month}-01`,to=dateOnly(b.effectiveTo);if(!['ROLE','EMPLOYEE'].includes(scopeType)||!scopeKey)return json({success:false,message:'Укажите уровень и должность/сотрудника'},400);if(to&&to<from)return json({success:false,message:'Дата окончания раньше даты начала'},400);const id=clean(b.id)||uid('hmp');await env.DB.prepare(`INSERT INTO hr_meal_policies(user_id,policy_id,scope_type,scope_key,monthly_limit,effective_from,effective_to,is_active,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,1,?8,?8) ON CONFLICT(user_id,policy_id) DO UPDATE SET scope_type=excluded.scope_type,scope_key=excluded.scope_key,monthly_limit=excluded.monthly_limit,effective_from=excluded.effective_from,effective_to=excluded.effective_to,is_active=1,updated_at=excluded.updated_at`).bind(userId,id,scopeType,scopeKey,limit,from,to,t).run();return json(await snapshot(env.DB,userId,month))}
  if(action==='syncIikoDebt'){const diagnostics=await syncIikoDebt(request,env,userId,month);return json({...await snapshot(env.DB,userId,month),syncDiagnostics:diagnostics})}
  if(action==='proposeMealDeduction'){const employeeId=clean(b.employeeId),snap=await snapshot(env.DB,userId,month),e=snap.employees.find(x=>String(x.id)===employeeId);if(!e||e.meal.pendingDeduction<=0)return json({success:false,message:'Нет сверхлимитной суммы для удержания'},400);const id=uid('hpa');await env.DB.prepare(`INSERT INTO hr_payroll_adjustments(user_id,adjustment_id,iiko_employee_id,month,adjustment_type,amount,reason,source,tax_treatment,legal_basis,status,created_at,updated_at) VALUES(?1,?2,?3,?4,'DEDUCTION',?5,'Питание сверх месячного лимита','MEAL_OVER_LIMIT','TAXABLE','Требуется подтверждение основания удержания','DRAFT',?6,?6)`).bind(userId,id,employeeId,month,e.meal.pendingDeduction,t).run();return json(await snapshot(env.DB,userId,month))}
  return json({success:false,message:'Неизвестное действие'},400);
}catch(e){console.error('[HR-PAYROLL-ADJ-POST]',e);return json({success:false,message:e?.message||String(e)},500)}}