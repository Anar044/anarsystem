import { getUser } from '../iiko/_lib/user-state.js';
import { loadPayrollTaxContext, calculateCompensationBySettings } from './_lib/payroll-tax-engine.js';

function r(v){return Math.round((Number(v)||0)*100)/100}
function money(v){return Math.max(0,r(v))}
function monthEnd(month){if(!/^\d{4}-\d{2}$/.test(String(month||'')))return'';const[y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m,0)).getUTCDate();return`${month}-${String(d).padStart(2,'0')}`}
function target(path){return path.endsWith('/api/hr/compensation')||path.endsWith('/api/hr/payroll')||path.endsWith('/api/hr/payroll-adjustments')}
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
  const path=new URL(context.request.url).pathname;if(!target(path))return context.next();
  let body={};if(context.request.method!=='GET'&&context.request.method!=='HEAD')body=await context.request.clone().json().catch(()=>({}));
  const auth=await getUser(context.request,context.env);const response=await context.next();if(!auth||!response.ok)return response;
  const data=await response.clone().json().catch(()=>null);if(!data?.success)return response;
  const asOf=String(data.asOf||body.asOf||data.period?.to||monthEnd(data.month)||new Date().toISOString().slice(0,10)),tax=await loadPayrollTaxContext(context.env.DB,auth.user.id,asOf);
  if(path.endsWith('/compensation'))patchCompensation(data,tax);else if(path.endsWith('/payroll-adjustments'))patchAdjustments(data,tax);else if(path.endsWith('/payroll'))patchPayroll(data,tax);
  const headers=new Headers(response.headers);headers.delete('content-length');headers.set('Content-Type','application/json; charset=utf-8');headers.set('Cache-Control','no-store');
  return new Response(JSON.stringify(data),{status:response.status,statusText:response.statusText,headers});
}
