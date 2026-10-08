import { getUser } from '../iiko/_lib/user-state.js';
import { loadPayrollTaxContext, calculateCompensationBySettings } from './_lib/payroll-tax-engine.js';
import { resolveAccessForUser, hasPermission } from '../access/_lib/access-control.js';

function r(v){return Math.round((Number(v)||0)*100)/100}
function money(v){return Math.max(0,r(v))}
function monthEnd(month){if(!/^\d{4}-\d{2}$/.test(String(month||'')))return'';const[y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m,0)).getUTCDate();return`${month}-${String(d).padStart(2,'0')}`}
function target(path){return path.endsWith('/api/hr/compensation')||path.endsWith('/api/hr/payroll')||path.endsWith('/api/hr/payroll-adjustments')}
function accessRule(path,method,action=''){
  const write=!['GET','HEAD','OPTIONS'].includes(String(method||'GET').toUpperCase());
  const operation=String(action||'').trim().toUpperCase();
  if(path.endsWith('/api/hr/device-ingest'))return null;
  if(path.endsWith('/api/hr/employees'))return write?'hr.employees.manage':'hr.employees.view';
  if(path.endsWith('/api/hr/role-schedules'))return write?'hr.schedules.manage':'hr.schedules.view';
  if(path.endsWith('/api/hr/work-calendar'))return write?'hr.schedules.manage':'hr.schedules.view';
  if(path.endsWith('/api/hr/timeclock'))return write?'hr.attendance.manage':'hr.attendance.view';
  if(path.endsWith('/api/hr/timesheet'))return write?'hr.timesheet.manage':'hr.timesheet.view';
  if(path.endsWith('/api/hr/employee-profile'))return write?'hr.employees.manage':'hr.employees.view';
  if(path.endsWith('/api/hr/employee-leaves'))return write?'hr.timesheet.manage':'hr.timesheet.view';
  if(path.endsWith('/api/hr/employee-schedule'))return write?'hr.schedules.manage':'hr.schedules.view';
  if(path.endsWith('/api/hr/timesheet-approval')){
    if(!write)return'hr.timesheet.view';
    if(operation==='HR_APPROVE')return'hr.payroll.approve';
    if(operation==='REOPEN')return'hr.timesheet.manage';
    if(operation==='MANAGER_APPROVE')return'hr.timesheet.manage';
    return'hr.timesheet.manage';
  }
  if(path.endsWith('/api/hr/timesheet-adjustments')){
    if(!write)return'hr.timesheet.view';
    if(operation==='HR_APPROVE_OVERTIME'||operation==='HR_REJECT_OVERTIME')return'hr.payroll.approve';
    return'hr.timesheet.manage';
  }
  if(path.endsWith('/api/hr/overtime-settlements'))return write?'hr.payroll.pay':'hr.payroll.view';
  if(path.endsWith('/api/hr/payroll-accounting-settings'))return write?'hr.payroll.calculate':'hr.payroll.view';

  if(path.endsWith('/api/hr/payroll-tax-settings'))return write?'hr.tax_settings.manage':'hr.payroll.view';
  if(path.endsWith('/api/hr/meal-transactions-v2'))return write?'hr.payroll.calculate':'hr.payroll.view';
  if(path.endsWith('/api/hr/compensation'))return write?'hr.compensation.manage':'hr.compensation.view';
  if(path.endsWith('/api/hr/payroll-adjustments'))return write?'hr.payroll.calculate':'hr.payroll.view';
  if(path.endsWith('/api/hr/payroll'))return write?'hr.payroll.calculate':'hr.payroll.view';

  if(path.includes('/api/hr/meal-transactions'))return write?'hr.payroll.calculate':'hr.payroll.view';
  return null;
}
function denied(message,status=403){return new Response(JSON.stringify({success:false,message}),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
function profileMeta(t){return{asOf:t.asOf,source:t.source,mode:t.mode,active:t.active?{id:t.active.id,effectiveFrom:t.active.effectiveFrom,effectiveTo:t.active.effectiveTo,mode:t.active.mode,updatedAt:t.active.updatedAt}:null,settings:t.settings}}
function calcTerm(term,tax){return term?calculateCompensationBySettings({officialGross:term.officialGross,additionalAmount:term.additionalAmount,additionalTaxTreatment:term.additionalTaxTreatment},tax.settings):null}

function patchCompensation(data,tax){
  if(data.calculation){const old=data.calculation;data.calculation=calculateCompensationBySettings({officialGross:old.official?.gross||0,additionalAmount:old.additional?.gross||0,additionalTaxTreatment:old.additional?.taxTreatment||'TAXABLE'},tax.settings)}
  for(const role of data.roles||[])role.calculation=calcTerm(role.term,tax);
  for(const employee of data.employees||[])employee.calculation=calcTerm(employee.term,tax);
  if(Array.isArray(data.employees)){
    const configured=data.employees.filter(x=>x.term&&x.calculation);
    data.totals={officialGross:r(configured.reduce((a,x)=>a+Number(x.term?.officialGross||0),0)),additional:r(configured.reduce((a,x)=>a+Number(x.term?.additionalAmount||0),0)),employeeReceives:r(configured.reduce((a,x)=>a+Number(x.calculation?.totalEmployeeReceives||0),0)),employerCost:r(configured.reduce((a,x)=>a+Number(x.calculation?.totalEmployerCost||0),0))};
  }
  data.taxProfile=profileMeta(tax);return data;
}

function patchPayroll(data,tax){
  for(const row of data.rows||[])row.calculation=calcTerm(row.term,tax);
  const configured=(data.rows||[]).filter(x=>x.term&&x.calculation);
  if(configured.length||Array.isArray(data.rows))data.totals={officialGross:r(configured.reduce((a,x)=>a+Number(x.calculation?.official?.gross||0),0)),officialNet:r(configured.reduce((a,x)=>a+Number(x.calculation?.official?.net||0),0)),additional:r(configured.reduce((a,x)=>a+Number(x.term?.additionalAmount||0),0)),employeeReceives:r(configured.reduce((a,x)=>a+Number(x.calculation?.totalEmployeeReceives||0),0)),employerCost:r(configured.reduce((a,x)=>a+Number(x.calculation?.totalEmployerCost||0),0))};
  data.taxProfile=profileMeta(tax);return data;
}

function patchAdjustments(data,tax){
  for(const e of data.employees||[]){
    const p=e.payroll||{},old=p.calculation;if(!p.baseConfigured||!old)continue;
    const calc=calculateCompensationBySettings({officialGross:old.official?.gross||0,additionalAmount:old.additional?.gross||0,additionalTaxTreatment:old.additional?.taxTreatment||'TAXABLE'},tax.settings),tot=e.totals||{},exempt=Number(tot.exemptRewards||0),advances=Number(tot.advances||0),deductions=Number(tot.deductions||0),before=money(calc.totalEmployeeReceives+exempt),finalPayable=money(before-advances-deductions),employerCost=money(calc.totalEmployerCost+exempt),cap=money(before*.20);
    e.payroll={...p,calculation:calc,beforeDeductions:before,finalPayable,employerCost,deductionCap:cap,deductionOverCap:deductions>cap+.009};
  }
  if(data.summary&&Array.isArray(data.employees)){data.summary.finalPayable=money(data.employees.reduce((s,e)=>s+Number(e.payroll?.finalPayable||0),0));data.summary.employerCost=money(data.employees.reduce((s,e)=>s+Number(e.payroll?.employerCost||0),0));data.summary.review=data.employees.filter(e=>e.payroll?.deductionOverCap||Number(e.meal?.pendingDeduction||0)>0||Number(e.totals?.drafts||0)>0).length}
  data.taxProfile=profileMeta(tax);return data;
}

export async function onRequest(context){
  const path=new URL(context.request.url).pathname;
  const isWrite=!['GET','HEAD','OPTIONS'].includes(context.request.method.toUpperCase());
  let body=null;
  if(isWrite&&(target(path)||path.endsWith('/api/hr/timesheet-adjustments')||path.endsWith('/api/hr/timesheet-approval')))
    body=await context.request.clone().json().catch(()=>({}));
  const rule=accessRule(path,context.request.method,body?.action);
  let auth=null,access=null;
  if(rule){
    auth=await getUser(context.request,context.env);
    if(!auth?.user)return denied('Требуется авторизация.',401);
    access=await resolveAccessForUser(context.env.DB,auth.user,{claimInvite:true,request:context.request});
    if(!access.allowed)return denied('Доступ к Smart Horeca не назначен.',403);
    if(!hasPermission(access,rule))return denied('Недостаточно прав: '+rule,403);
  }

  if(!target(path))return context.next();
  if(body===null)body=isWrite?await context.request.clone().json().catch(()=>({})):{};
  if(!auth)auth=await getUser(context.request,context.env);
  if(!auth)return context.next();
  if(!access)access=await resolveAccessForUser(context.env.DB,auth.user,{claimInvite:true,request:context.request});
  const response=await context.next();if(!response.ok)return response;
  const data=await response.clone().json().catch(()=>null);if(!data?.success)return response;
  const asOf=String(data.asOf||body.asOf||data.period?.to||monthEnd(data.month)||new Date().toISOString().slice(0,10)),tax=await loadPayrollTaxContext(context.env.DB,access?.storageUserId||access?.ownerUserId||auth.user.id,asOf);
  if(path.endsWith('/compensation'))patchCompensation(data,tax);else if(path.endsWith('/payroll-adjustments'))patchAdjustments(data,tax);else if(path.endsWith('/payroll'))patchPayroll(data,tax);
  const headers=new Headers(response.headers);headers.delete('content-length');headers.set('Content-Type','application/json; charset=utf-8');headers.set('Cache-Control','no-store');
  return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});
}
