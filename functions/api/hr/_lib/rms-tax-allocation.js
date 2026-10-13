import {calculateCompensationBySettings} from './payroll-tax-engine.js';
// Distribute a tax calculation performed ONCE per person over their restaurant
// accruals. This is a read-only provisional allocation, not a statutory return.
const clean=v=>String(v??'').trim();
const cents=v=>Math.round(Number(v||0)*100);
const val=v=>Math.round(Number(v||0)*100)/100;
function distribute(totalCents,weights){
  const sum=weights.reduce((a,n)=>a+n,0);
  if(totalCents<=0||sum<=0)return weights.map(()=>0);
  const raw=weights.map(w=>totalCents*w/sum);
  const floors=raw.map(Math.floor),remaining=totalCents-floors.reduce((a,b)=>a+b,0);
  const order=raw.map((x,i)=>({i,fraction:x-floors[i]})).sort((a,b)=>b.fraction-a.fraction||a.i-b.i);
  for(let i=0;i<remaining;i++)floors[order[i%order.length].i]++;
  return floors;
}
export function allocateNetworkPayrollTax({rmsRows=[],officeRows=[],employeeTerms=[],roleTerms=[],settings={}}){
  const all=[...rmsRows.map(x=>({...x,source:'RMS'})),...officeRows.map(x=>({...x,source:'OFFICE',restaurantId:'NETWORK_OFFICE'}))]
    .filter(x=>clean(x.employeeId)&&Number.isFinite(Number(x.totalGross))&&Number(x.totalGross)>=0);
  const terms=new Map(employeeTerms.map(x=>[clean(x.iiko_employee_id),x]));
  const roles=new Map(roleTerms.map(x=>[clean(x.role_code),x]));
  const groups=new Map();
  for(const row of all){
    const id=clean(row.employeeId);
    if(!groups.has(id))groups.set(id,[]);
    groups.get(id).push(row);
  }
  const lines=[],personSummary=[];
  for(const [employeeId,parts] of groups){
    const term=terms.get(employeeId)||roles.get(clean(parts[0].roleCode))||{};
    const taxTreatment=clean(term.additional_tax_treatment||'TAXABLE').toUpperCase();
    const official=val(parts.reduce((a,x)=>a+Number(x.officialGross||0),0));
    const additional=val(parts.reduce((a,x)=>a+Number(x.additionalGross||0),0));
    const tax=calculateCompensationBySettings({officialGross:official,additionalAmount:additional,
      additionalTaxTreatment:taxTreatment},settings);
    const taxableShares=parts.map(x=>cents(Number(x.officialGross||0)+(taxTreatment==='TAXABLE'?Number(x.additionalGross||0):0)));
    const weights=taxableShares.some(Boolean)?taxableShares:parts.map(x=>cents(x.totalGross));
    const employeeDeduction=cents(tax.combined.employee.total);
    const employerContribution=cents(tax.combined.employer.total);
    const distributedDeduction=distribute(employeeDeduction,weights);
    const distributedEmployer=distribute(employerContribution,weights);
    for(let i=0;i<parts.length;i++){
      const p=parts[i],gross=cents(p.totalGross),withheld=distributedDeduction[i],employer=distributedEmployer[i];
      lines.push({
        employeeId,employeeName:clean(p.employeeName),roleCode:clean(p.roleCode),
        restaurantId:clean(p.restaurantId),source:p.source,
        officialGross:val(p.officialGross),additionalGross:val(p.additionalGross),
        gross:val(gross/100),withheld:val(withheld/100),net:val((gross-withheld)/100),
        employerContributions:val(employer/100),
        employerCost:val((gross+employer)/100),status:'TAX_PREVIEW_ONLY'
      });
    }
    personSummary.push({
      employeeId,employeeName:clean(parts[0].employeeName),gross:val(official+additional),
      withheld:val(employeeDeduction/100),net:val(tax.totalEmployeeReceives),
      employerCost:val(tax.totalEmployerCost),sourceRows:parts.length
    });
  }
  return{
    mode:'NETWORK_TAX_ALLOCATION_PREVIEW',postingAllowed:false,
    lines,persons:personSummary,network:{
      uniqueEmployees:personSummary.length,gross:val(personSummary.reduce((a,x)=>a+x.gross,0)),
      withheld:val(personSummary.reduce((a,x)=>a+x.withheld,0)),
      net:val(personSummary.reduce((a,x)=>a+x.net,0)),
      employerCost:val(personSummary.reduce((a,x)=>a+x.employerCost,0))
    },
    requiresLegalTaxProfileReview:true,
    note:'Удержания рассчитаны один раз на сотрудника по выбранному налоговому профилю и предварительно распределены между RMS. Не использовать для выплаты без проверки и утверждения профиля.'
  };
}
