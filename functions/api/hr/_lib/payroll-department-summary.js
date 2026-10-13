// CHAIN payroll summary is a projection of restaurant-owned employee rows,
// not a second payroll register. Never create or post new accruals here.
const key=v=>String(v??'').trim().toUpperCase();
const amount=v=>{const n=Number(v);return Number.isFinite(n)?Math.round(n*100)/100:0};
const sum=(a,b)=>amount(a+b);
function emptyTotals(){return{employees:0,configured:0,review:0,withoutTerms:0,factualBaseGross:0,officialGross:0,additionalGross:0,extraDayPay:0,totalFactualGross:0}}
function accumulate(total,row){
  total.employees++;
  if(row.term)total.configured++;
  if(row.status==='REVIEW')total.review++;
  if(row.status==='NO_TERMS')total.withoutTerms++;
  total.factualBaseGross=sum(total.factualBaseGross,amount(row.accrual?.factualBaseGross));
  total.officialGross=sum(total.officialGross,amount(row.accrual?.officialAccruedGross));
  total.additionalGross=sum(total.additionalGross,amount(row.accrual?.additionalAccruedGross));
  total.extraDayPay=sum(total.extraDayPay,amount(row.accrual?.extraDayPay));
  total.totalFactualGross=sum(total.totalFactualGross,amount(row.accrual?.totalFactualGross));
}
export function buildPayrollDepartmentSummary(rows,scope,approvals=[]){
  if(scope?.isChain!==true)return null;
  const selected=new Set((scope.selectedDepartmentIds||[]).map(String));
  const directory=(scope.selectedRestaurants||[])
    .filter(d=>selected.has(String(d.id||'')))
    .map(d=>({id:String(d.id),code:String(d.code||''),name:String(d.name||d.code||d.id)}));
  const approvalById=new Map((approvals||[]).map(a=>[String(a.id||''),a]));
  const departments=directory.map(d=>{
    const approval=approvalById.get(d.id)||{};
    return{...d,status:approval.status||'DRAFT',approved:approval.approved===true,totals:emptyTotals()};
  });
  const codes=new Map();
  for(const dep of departments){
    const code=key(dep.code);
    if(!code)continue;
    if(codes.has(code))codes.set(code,null); // ambiguous code is not silently attributed
    else codes.set(code,dep);
  }
  const unattributed=emptyTotals(),network=emptyTotals();
  for(const row of rows||[]){
    accumulate(network,row);
    const dep=codes.get(key(row.departmentCode));
    accumulate(dep?dep.totals:unattributed,row);
  }
  return{mode:departments.length===1?'RESTAURANT':'NETWORK',departments,network,unattributed,
    reconciled:unattributed.employees===0,
    allApproved:departments.length>0&&departments.every(x=>x.approved)};
}
