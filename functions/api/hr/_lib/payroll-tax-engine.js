function clean(v){return String(v??'').trim()}
function n(v,fallback=0){const x=Number(v);return Number.isFinite(x)?x:fallback}
function r(v){return Math.round((Number(v)||0)*100)/100}
const pct=v=>n(v)/100;

export const DEFAULT_PAYROLL_TAX_SETTINGS={
  incomeTaxThreshold1:2500,incomeTaxThreshold2:8000,personalAllowance:200,
  incomeTaxLowPercent:3,incomeTaxMidPercent:10,incomeTaxHighPercent:14,
  socialThreshold1:200,socialThreshold2:8000,
  employeeSocialLowPercent:3,employeeSocialMidPercent:10,employeeSocialHighPercent:10,
  employerSocialLowPercent:22,employerSocialMidPercent:15,employerSocialHighPercent:11,
  employeeUnemploymentPercent:0.5,employerUnemploymentPercent:0.5,
  medicalThreshold:2500,
  employeeMedicalLowPercent:2,employeeMedicalHighPercent:0.5,
  employerMedicalLowPercent:2,employerMedicalHighPercent:0.5
};

const PERCENT_KEYS=['incomeTaxLowPercent','incomeTaxMidPercent','incomeTaxHighPercent','employeeSocialLowPercent','employeeSocialMidPercent','employeeSocialHighPercent','employerSocialLowPercent','employerSocialMidPercent','employerSocialHighPercent','employeeUnemploymentPercent','employerUnemploymentPercent','employeeMedicalLowPercent','employeeMedicalHighPercent','employerMedicalLowPercent','employerMedicalHighPercent'];
const MONEY_KEYS=['incomeTaxThreshold1','incomeTaxThreshold2','personalAllowance','socialThreshold1','socialThreshold2','medicalThreshold'];

export function normalizePayrollTaxSettings(input={}){
  const out={...DEFAULT_PAYROLL_TAX_SETTINGS};
  for(const k of PERCENT_KEYS){const x=n(input[k],out[k]);out[k]=x>=0&&x<=100?Math.round(x*10000)/10000:out[k]}
  for(const k of MONEY_KEYS){const x=n(input[k],out[k]);out[k]=x>=0?Math.round(x*100)/100:out[k]}
  if(out.incomeTaxThreshold2<out.incomeTaxThreshold1)out.incomeTaxThreshold2=out.incomeTaxThreshold1;
  if(out.socialThreshold2<out.socialThreshold1)out.socialThreshold2=out.socialThreshold1;
  return out;
}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_payroll_tax_profiles (user_id TEXT NOT NULL,profile_id TEXT NOT NULL,effective_from TEXT NOT NULL,effective_to TEXT NOT NULL DEFAULT '',mode TEXT NOT NULL DEFAULT 'MANUAL',settings_json TEXT NOT NULL DEFAULT '{}',is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,profile_id))`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_payroll_tax_profiles_date ON hr_payroll_tax_profiles(user_id,is_active,effective_from,effective_to)`)
  ]);
}

function profileDto(row){
  if(!row)return null;let settings={...DEFAULT_PAYROLL_TAX_SETTINGS};
  try{settings=normalizePayrollTaxSettings(JSON.parse(row.settings_json||'{}'))}catch{}
  return{id:row.profile_id,effectiveFrom:row.effective_from,effectiveTo:row.effective_to||'',mode:row.mode||'MANUAL',settings,updatedAt:row.updated_at||''};
}

export async function loadPayrollTaxContext(db,userId,asOf){
  await ensure(db);const date=clean(asOf)||new Date().toISOString().slice(0,10);
  const row=await db.prepare(`SELECT * FROM hr_payroll_tax_profiles WHERE user_id=?1 AND is_active=1 AND effective_from<=?2 AND (effective_to='' OR effective_to>=?2) ORDER BY effective_from DESC LIMIT 1`).bind(userId,date).first();
  const active=profileDto(row);return{asOf:date,source:active?'SAVED_PROFILE':'SYSTEM_DEFAULT',mode:active?.mode||'DEFAULT',active,settings:active?.settings||{...DEFAULT_PAYROLL_TAX_SETTINGS}};
}

function tier(g,t1,t2,a,b,c){if(g<=t1)return g*pct(a);if(g<=t2)return t1*pct(a)+(g-t1)*pct(b);return t1*pct(a)+(t2-t1)*pct(b)+(g-t2)*pct(c)}

export function calculateGrossBySettings(gross,settings={}){
  const s=normalizePayrollTaxSettings(settings),g=Math.max(0,n(gross));
  const taxable=g<=s.incomeTaxThreshold1?Math.max(0,g-s.personalAllowance):g;
  let income=0;
  if(taxable<=s.incomeTaxThreshold1)income=taxable*pct(s.incomeTaxLowPercent);
  else if(taxable<=s.incomeTaxThreshold2)income=s.incomeTaxThreshold1*pct(s.incomeTaxLowPercent)+(taxable-s.incomeTaxThreshold1)*pct(s.incomeTaxMidPercent);
  else income=s.incomeTaxThreshold1*pct(s.incomeTaxLowPercent)+(s.incomeTaxThreshold2-s.incomeTaxThreshold1)*pct(s.incomeTaxMidPercent)+(taxable-s.incomeTaxThreshold2)*pct(s.incomeTaxHighPercent);
  const employee={incomeTax:r(income),socialInsurance:r(tier(g,s.socialThreshold1,s.socialThreshold2,s.employeeSocialLowPercent,s.employeeSocialMidPercent,s.employeeSocialHighPercent)),unemploymentInsurance:r(g*pct(s.employeeUnemploymentPercent)),medicalInsurance:r(Math.min(g,s.medicalThreshold)*pct(s.employeeMedicalLowPercent)+Math.max(0,g-s.medicalThreshold)*pct(s.employeeMedicalHighPercent))};
  employee.total=r(employee.incomeTax+employee.socialInsurance+employee.unemploymentInsurance+employee.medicalInsurance);
  const employer={socialInsurance:r(tier(g,s.socialThreshold1,s.socialThreshold2,s.employerSocialLowPercent,s.employerSocialMidPercent,s.employerSocialHighPercent)),unemploymentInsurance:r(g*pct(s.employerUnemploymentPercent)),medicalInsurance:r(Math.min(g,s.medicalThreshold)*pct(s.employerMedicalLowPercent)+Math.max(0,g-s.medicalThreshold)*pct(s.employerMedicalHighPercent))};
  employer.total=r(employer.socialInsurance+employer.unemploymentInsurance+employer.medicalInsurance);
  return{gross:r(g),taxableIncome:r(taxable),personalAllowanceApplied:g<=s.incomeTaxThreshold1?Math.min(s.personalAllowance,g):0,employee,net:r(g-employee.total),employer,totalEmployerCost:r(g+employer.total)};
}

export function calculateCompensationBySettings({officialGross,additionalAmount=0,additionalTaxTreatment='TAXABLE'},settings={}){
  const official=calculateGrossBySettings(officialGross,settings),additional=r(Math.max(0,n(additionalAmount))),treatment=String(additionalTaxTreatment||'TAXABLE').toUpperCase(),taxable=treatment==='TAXABLE';
  const combined=calculateGrossBySettings(official.gross+(taxable?additional:0),settings),extraEmployeeDeductions=r(combined.employee.total-official.employee.total),extraEmployerContributions=r(combined.employer.total-official.employer.total),additionalNet=taxable?r(additional-extraEmployeeDeductions):additional;
  return{official,combined,additional:{gross:additional,net:additionalNet,taxTreatment:treatment,employeeDeductions:extraEmployeeDeductions,employerContributions:extraEmployerContributions},totalEmployeeReceives:r(official.net+additionalNet),totalEmployerCost:r(official.gross+official.employer.total+additional+extraEmployerContributions)};
}
