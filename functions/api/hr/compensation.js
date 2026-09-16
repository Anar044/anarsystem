import { getUser } from '../iiko/_lib/user-state.js';
import { calculateCompensation, AZ_PAYROLL_RULE_PROFILE } from './_lib/az-payroll-rules.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function money(v){const n=Number(v);return Number.isFinite(n)?Math.round(Math.max(0,n)*100)/100:0}
function now(){return new Date().toISOString()}
function uid(){return `hct_${crypto.randomUUID()}`}
function dateOnly(v){const s=clean(v);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''}
function todayBaku(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}catch{return new Date().toISOString().slice(0,10)}}
function previousDate(v){const d=new Date(`${v}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_compensation_terms (
      user_id TEXT NOT NULL,
      term_id TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT NOT NULL DEFAULT '',
      official_gross REAL NOT NULL DEFAULT 0,
      additional_amount REAL NOT NULL DEFAULT 0,
      additional_payment_method TEXT NOT NULL DEFAULT 'CASH',
      additional_tax_treatment TEXT NOT NULL DEFAULT 'TAXABLE',
      additional_legal_basis TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,term_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_comp_terms_employee ON hr_compensation_terms(user_id,iiko_employee_id,is_active,effective_from)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_comp_terms_unique_start ON hr_compensation_terms(user_id,iiko_employee_id,effective_from)`)
  ]);
}

function termDto(r){return{id:r.term_id,employeeId:r.iiko_employee_id,effectiveFrom:r.effective_from,effectiveTo:r.effective_to||'',officialGross:money(r.official_gross),additionalAmount:money(r.additional_amount),additionalPaymentMethod:r.additional_payment_method||'CASH',additionalTaxTreatment:r.additional_tax_treatment||'TAXABLE',additionalLegalBasis:r.additional_legal_basis||'',note:r.note||'',active:Boolean(r.is_active),createdAt:r.created_at,updatedAt:r.updated_at}}

async function snapshot(db,userId,asOf){
  const [employeesResult,termsResult]=await Promise.all([
    db.prepare(`SELECT iiko_employee_id,employee_code,display_name,first_name,middle_name,last_name,role_code,role_name,department_code,hire_date,fire_date,is_deleted FROM hr_employees WHERE user_id=?1 AND TRIM(employee_code)<>'' ORDER BY is_deleted ASC,last_name COLLATE NOCASE,first_name COLLATE NOCASE,display_name COLLATE NOCASE`).bind(userId).all().catch(()=>({results:[]})),
    db.prepare(`SELECT * FROM hr_compensation_terms WHERE user_id=?1 AND is_active=1 ORDER BY iiko_employee_id,effective_from DESC`).bind(userId).all()
  ]);
  const terms=(termsResult.results||[]).map(termDto),byEmployee=new Map();
  for(const t of terms){if(t.effectiveFrom<=asOf&&(!t.effectiveTo||t.effectiveTo>=asOf)&&!byEmployee.has(t.employeeId))byEmployee.set(t.employeeId,t)}
  const employees=(employeesResult.results||[]).filter(e=>!Number(e.is_deleted)&&(!e.fire_date||e.fire_date>=asOf)).map(e=>{
    const full=[e.last_name,e.first_name,e.middle_name].filter(Boolean).join(' ')||e.display_name||e.employee_code||e.iiko_employee_id;
    const term=byEmployee.get(String(e.iiko_employee_id))||null;
    const calculation=term?calculateCompensation({officialGross:term.officialGross,additionalAmount:term.additionalAmount,additionalTaxTreatment:term.additionalTaxTreatment,calculationDate:asOf}):null;
    return{id:e.iiko_employee_id,code:e.employee_code,name:full,roleCode:e.role_code||'',roleName:e.role_name||'',departmentCode:e.department_code||'',hireDate:e.hire_date||'',fireDate:e.fire_date||'',term,calculation};
  });
  const configured=employees.filter(x=>x.term),officialGrossTotal=configured.reduce((a,x)=>a+(x.term?.officialGross||0),0),additionalTotal=configured.reduce((a,x)=>a+(x.term?.additionalAmount||0),0),employeeReceivesTotal=configured.reduce((a,x)=>a+(x.calculation?.totalEmployeeReceives||0),0),employerCostTotal=configured.reduce((a,x)=>a+(x.calculation?.totalEmployerCost||0),0);
  return{asOf,employees,terms,ruleProfile:AZ_PAYROLL_RULE_PROFILE,counts:{employees:employees.length,configured:configured.length,withoutTerms:employees.length-configured.length},totals:{officialGross:Math.round(officialGrossTotal*100)/100,additional:Math.round(additionalTotal*100)/100,employeeReceives:Math.round(employeeReceivesTotal*100)/100,employerCost:Math.round(employerCostTotal*100)/100}};
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{
    const a=await getUser(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);await ensure(env.DB);
    const url=new URL(request.url),asOf=dateOnly(url.searchParams.get('asOf'))||todayBaku();
    return json({success:true,source:'SMART_HORECA_COMPENSATION',...await snapshot(env.DB,a.user.id,asOf)});
  }catch(e){console.error('[HR-COMPENSATION-GET]',e);return json({success:false,message:e?.message||String(e)},500)}
}

export async function onRequestPost({request,env}){
  try{
    const a=await getUser(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);await ensure(env.DB);const userId=a.user.id;
    const body=await request.json().catch(()=>({})),action=clean(body.action),asOf=dateOnly(body.asOf)||todayBaku();
    if(action==='preview'){
      const treatment=(clean(body.additionalTaxTreatment)||'TAXABLE').toUpperCase();
      if(!['TAXABLE','EXEMPT_WITH_BASIS'].includes(treatment))return json({success:false,message:'Неизвестный налоговый режим дополнительной выплаты'},400);
      if(treatment==='EXEMPT_WITH_BASIS'&&!clean(body.additionalLegalBasis))return json({success:false,message:'Для необлагаемой выплаты укажите законное основание'},400);
      return json({success:true,calculation:calculateCompensation({officialGross:money(body.officialGross),additionalAmount:money(body.additionalAmount),additionalTaxTreatment:treatment,calculationDate:asOf}),ruleProfile:AZ_PAYROLL_RULE_PROFILE});
    }
    if(action==='saveTerm'){
      const employeeId=clean(body.employeeId),effectiveFrom=dateOnly(body.effectiveFrom),effectiveTo=dateOnly(body.effectiveTo),officialGross=money(body.officialGross),additionalAmount=money(body.additionalAmount),method=(clean(body.additionalPaymentMethod)||'CASH').toUpperCase(),treatment=(clean(body.additionalTaxTreatment)||'TAXABLE').toUpperCase(),basis=clean(body.additionalLegalBasis),note=clean(body.note);
      if(!employeeId||!effectiveFrom)return json({success:false,message:'Укажите сотрудника и дату начала действия'},400);
      if(effectiveTo&&effectiveTo<effectiveFrom)return json({success:false,message:'Дата окончания не может быть раньше даты начала'},400);
      if(!['CASH','BANK','OTHER'].includes(method))return json({success:false,message:'Неизвестный способ выплаты'},400);
      if(!['TAXABLE','EXEMPT_WITH_BASIS'].includes(treatment))return json({success:false,message:'Неизвестный налоговый режим дополнительной выплаты'},400);
      if(treatment==='EXEMPT_WITH_BASIS'&&!basis)return json({success:false,message:'Для необлагаемой выплаты обязательно укажите законное основание'},400);
      const emp=await env.DB.prepare(`SELECT iiko_employee_id FROM hr_employees WHERE user_id=?1 AND iiko_employee_id=?2 AND TRIM(employee_code)<>'' LIMIT 1`).bind(userId,employeeId).first();if(!emp)return json({success:false,message:'Сотрудник не найден. Сначала синхронизируйте справочник сотрудников.'},404);
      let termId=clean(body.id);if(!termId){const same=await env.DB.prepare(`SELECT term_id FROM hr_compensation_terms WHERE user_id=?1 AND iiko_employee_id=?2 AND effective_from=?3 LIMIT 1`).bind(userId,employeeId,effectiveFrom).first();termId=same?.term_id||uid()}
      const t=now();
      if(!clean(body.id)){
        await env.DB.prepare(`UPDATE hr_compensation_terms SET effective_to=?4,updated_at=?5 WHERE user_id=?1 AND iiko_employee_id=?2 AND is_active=1 AND effective_from<?3 AND (effective_to='' OR effective_to>=?3)`).bind(userId,employeeId,effectiveFrom,previousDate(effectiveFrom),t).run();
      }
      await env.DB.prepare(`INSERT INTO hr_compensation_terms(user_id,term_id,iiko_employee_id,effective_from,effective_to,official_gross,additional_amount,additional_payment_method,additional_tax_treatment,additional_legal_basis,note,is_active,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,1,?12,?12)
        ON CONFLICT(user_id,term_id) DO UPDATE SET iiko_employee_id=excluded.iiko_employee_id,effective_from=excluded.effective_from,effective_to=excluded.effective_to,official_gross=excluded.official_gross,additional_amount=excluded.additional_amount,additional_payment_method=excluded.additional_payment_method,additional_tax_treatment=excluded.additional_tax_treatment,additional_legal_basis=excluded.additional_legal_basis,note=excluded.note,is_active=1,updated_at=excluded.updated_at`)
        .bind(userId,termId,employeeId,effectiveFrom,effectiveTo,officialGross,additionalAmount,method,treatment,basis,note,t).run();
      return json({success:true,termId,...await snapshot(env.DB,userId,asOf)});
    }
    if(action==='disableTerm'){
      const id=clean(body.id);if(!id)return json({success:false,message:'Не указаны условия оплаты'},400);
      await env.DB.prepare(`UPDATE hr_compensation_terms SET is_active=0,updated_at=?3 WHERE user_id=?1 AND term_id=?2`).bind(userId,id,now()).run();
      return json({success:true,...await snapshot(env.DB,userId,asOf)});
    }
    return json({success:false,message:'Неизвестное действие'},400);
  }catch(e){console.error('[HR-COMPENSATION-POST]',e);return json({success:false,message:e?.message||String(e)},500)}
}
