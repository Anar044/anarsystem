function num(v){const n=Number(v);return Number.isFinite(n)?Math.max(0,n):0}
function r(v){return Math.round((Number(v)||0)*100)/100}
function dateYear(v){const m=/^(\d{4})-\d{2}-\d{2}$/.exec(String(v||''));return m?Number(m[1]):new Date().getUTCFullYear()}

function incomeTax(gross,calculationDate){
  const g=num(gross),year=dateYear(calculationDate);
  let lowRate=0.03,lowBase=75,midBase=625;
  if(year===2027){lowRate=0.05;lowBase=125;midBase=675}
  else if(year>=2028){lowRate=0.07;lowBase=175;midBase=725}
  const taxable=g<=2500?Math.max(0,g-200):g;
  let tax=0;
  if(taxable<=2500)tax=taxable*lowRate;
  else if(taxable<=8000)tax=lowBase+(taxable-2500)*0.10;
  else tax=midBase+(taxable-8000)*0.14;
  return{taxableIncome:r(taxable),amount:r(tax),personalAllowanceApplied:g<=2500?Math.min(200,g):0,rateProfile:year<=2026?'2026':year===2027?'2027':'2028+'};
}

function employeeSocial(gross){
  const g=num(gross);if(g<=200)return r(g*0.03);if(g<=8000)return r(6+(g-200)*0.10);return r(786+(g-8000)*0.10);
}
function employerSocial(gross){
  const g=num(gross);if(g<=200)return r(g*0.22);if(g<=8000)return r(44+(g-200)*0.15);return r(1214+(g-8000)*0.11);
}
function medical(gross){const g=num(gross);return r(Math.min(g,2500)*0.02+Math.max(0,g-2500)*0.005)}
function unemployment(gross){return r(num(gross)*0.005)}

export function calculateAzPrivateNonOilPayroll(gross,calculationDate){
  const g=r(num(gross)),it=incomeTax(g,calculationDate),employee={incomeTax:it.amount,socialInsurance:employeeSocial(g),unemploymentInsurance:unemployment(g),medicalInsurance:medical(g)};
  employee.total=r(employee.incomeTax+employee.socialInsurance+employee.unemploymentInsurance+employee.medicalInsurance);
  const employer={socialInsurance:employerSocial(g),unemploymentInsurance:unemployment(g),medicalInsurance:medical(g)};
  employer.total=r(employer.socialInsurance+employer.unemploymentInsurance+employer.medicalInsurance);
  return{gross:g,taxableIncome:it.taxableIncome,personalAllowanceApplied:r(it.personalAllowanceApplied),incomeTaxRateProfile:it.rateProfile,employee,net:r(g-employee.total),employer,totalEmployerCost:r(g+employer.total)};
}

export function calculateCompensation({officialGross,additionalAmount=0,additionalTaxTreatment='TAXABLE',calculationDate}){
  const official=calculateAzPrivateNonOilPayroll(officialGross,calculationDate),additional=r(num(additionalAmount)),treatment=String(additionalTaxTreatment||'TAXABLE').toUpperCase();
  const taxableAdditional=treatment==='TAXABLE';
  const combined=calculateAzPrivateNonOilPayroll(official.gross+(taxableAdditional?additional:0),calculationDate);
  const extraEmployeeDeductions=r(combined.employee.total-official.employee.total),extraEmployerContributions=r(combined.employer.total-official.employer.total);
  const additionalNet=taxableAdditional?r(additional-extraEmployeeDeductions):additional;
  return{
    official,
    combined,
    additional:{gross:additional,net:additionalNet,taxTreatment:treatment,employeeDeductions:r(extraEmployeeDeductions),employerContributions:r(extraEmployerContributions)},
    totalEmployeeReceives:r(official.net+additionalNet),
    totalEmployerCost:r(official.gross+official.employer.total+additional+extraEmployerContributions)
  };
}

export const AZ_PAYROLL_RULE_PROFILE={
  jurisdiction:'AZ',sector:'PRIVATE_NON_OIL_GAS',currency:'AZN',effectiveFrom:'2026-01-01',
  incomeTax:{phase2026:{upTo2500:0.03,from2500To8000:0.10,above8000:0.14,allowanceUpTo2500:200},phase2027:{upTo2500:0.05,from2500To8000:0.10,above8000:0.14},phase2028Plus:{upTo2500:0.07,from2500To8000:0.10,above8000:0.14}},
  socialInsurance:{employee:'3% <=200; 6 + 10% above 200 to 8000; 786 + 10% above 8000',employer:'22% <=200; 44 + 15% above 200 to 8000; 1214 + 11% above 8000'},
  unemploymentInsurance:{employeeRate:0.005,employerRate:0.005},
  medicalInsurance:{employee:'2% up to 2500; 0.5% above',employer:'2% up to 2500; 0.5% above'},
  sources:['Azərbaycan Respublikası Dövlət Vergi Xidməti — 2026 vergi və sığorta dəyişiklikləri','ƏƏSMN — İşsizlikdən sığorta tarifləri']
};
