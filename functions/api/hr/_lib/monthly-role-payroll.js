// Monthly payroll calculation contract (PREVIEW, not a payment posting).
// For restaurant workers: monthly gross / planned days * (accepted minutes / daily minutes).
// For office workers: fixed monthly gross, processed by separate office Payroll policy.
const clean=v=>String(v??'').trim();
const number=v=>Number(v);
const cents=v=>Math.round((Number(v)||0)*100)/100;
export const OFFICE_RESTAURANT_ID='NETWORK_OFFICE';
export const MODES=Object.freeze({RESTAURANT:'RESTAURANT_HOURS',OFFICE:'OFFICE_FIXED'});
export function validMonth(v){return /^20\d\d-(0[1-9]|1[0-2])$/.test(clean(v))}
export function parseNorm(body){
  const mode=clean(body?.payrollMode);
  if(!Object.values(MODES).includes(mode))throw new Error('Выберите тип: ресторан по часам или офисный оклад');
  if(mode===MODES.OFFICE)return{payrollMode:mode,normDays:0,dailyNormMinutes:0,plannedMinutes:0};
  const days=number(body?.normDays),dailyMinutes=number(body?.dailyNormMinutes);
  if(!Number.isInteger(days)||days<1||days>31)throw new Error('Норма рабочих дней должна быть от 1 до 31');
  if(!Number.isInteger(dailyMinutes)||dailyMinutes<15||dailyMinutes>1440)throw new Error('Норма дня должна быть от 15 минут до 24 часов');
  return{payrollMode:mode,normDays:days,dailyNormMinutes:dailyMinutes,plannedMinutes:days*dailyMinutes};
}
export function calculateRestaurantGross({monthlyOfficialGross=0,monthlyAdditionalGross=0,actualMinutes=0,normDays,dailyNormMinutes,hasIssues=false}){
  const config=parseNorm({payrollMode:MODES.RESTAURANT,normDays,dailyNormMinutes});
  for(const val of [monthlyOfficialGross,monthlyAdditionalGross,actualMinutes])
    if(!Number.isFinite(number(val))||number(val)<0)throw new Error('Денежная сумма и время не могут быть отрицательными');
  const actual=number(actualMinutes);
  if(!Number.isInteger(actual))throw new Error('Время должно быть в целых минутах');
  const ratio=actual/config.plannedMinutes;
  const official=cents(number(monthlyOfficialGross)*ratio);
  const additional=cents(number(monthlyAdditionalGross)*ratio);
  const gross=cents(official+additional);
  return{
    payrollMode:MODES.RESTAURANT,plannedMinutes:config.plannedMinutes,actualMinutes:actual,
    normDays:config.normDays,dailyNormMinutes:config.dailyNormMinutes,
    equivalentDays:Math.round((actual/config.dailyNormMinutes)*10000)/10000,
    monthFactor:Math.round(ratio*1000000)/1000000,
    officialGross:official,additionalGross:additional,totalGross:gross,
    status:hasIssues?'REVIEW_REQUIRED':'PREVIEW_NOT_APPROVED',postingAllowed:false
  };
}
export function calculateOfficeGross({monthlyOfficialGross=0,monthlyAdditionalGross=0}){
  const official=number(monthlyOfficialGross),additional=number(monthlyAdditionalGross);
  if(!Number.isFinite(official)||!Number.isFinite(additional)||official<0||additional<0)throw new Error('Недопустимый оклад');
  return{payrollMode:MODES.OFFICE,officialGross:cents(official),additionalGross:cents(additional),
    totalGross:cents(official+additional),status:'PREVIEW_OFFICE',postingAllowed:false,
    note:'Офисный оклад не зависит от ресторанной нормы; кадровые удержания и налоги рассчитываются отдельно'};
}
export function previewRmsRolePayroll({hourRows=[],employees=[],norms=[],employeeTerms=[],roleTerms=[],month,scope}){
  if(!validMonth(month))throw new Error('Некорректный месяц');
  const employeeMap=new Map(employees.map(e=>[clean(e.iiko_employee_id??e.id),e]));
  const cfgByKey=new Map(norms.filter(n=>n.payroll_mode===MODES.RESTAURANT).map(n=>[
    clean(n.restaurant_id)+'|'+clean(n.role_code),n]));
  const activeTerm=(list,col,val)=>list.find(t=>clean(t[col])===val&&t.effective_from<=month+'-31'&&(!t.effective_to||t.effective_to>=month+'-01')&&Number(t.is_active)!==0);
  const rows=[],missingNorms=[],missingSalary=[];
  for(const item of hourRows){
    const employee=employeeMap.get(clean(item.employeeId));
    if(!employee||Number(employee.is_deleted))continue;
    const roleCode=clean(employee.role_code);
    const cfg=cfgByKey.get(clean(item.restaurantId)+'|'+roleCode);
    const base={employeeId:clean(item.employeeId),employeeName:clean(item.employeeName)||clean(employee.display_name),
      restaurantId:clean(item.restaurantId),restaurantName:clean(item.restaurantName),roleCode,
      recordedMinutes:Number(item.recordedMinutes||0),acceptedMinutes:Number(item.nonOverlappingMinutes||0),
      incompleteShifts:Number(item.incompleteShifts||0),overlapShifts:Number(item.overlapShifts||0)};
    if(!cfg){missingNorms.push(base);rows.push({...base,status:'NORM_NOT_CONFIGURED',postingAllowed:false});continue}
    const salary=activeTerm(employeeTerms,'iiko_employee_id',base.employeeId)||
      activeTerm(roleTerms,'role_code',roleCode);
    if(!salary){missingSalary.push(base);rows.push({...base,status:'SALARY_NOT_CONFIGURED',postingAllowed:false});continue}
    const issues=base.incompleteShifts>0||base.overlapShifts>0;
    const c=calculateRestaurantGross({
      monthlyOfficialGross:salary.official_gross,monthlyAdditionalGross:salary.additional_amount,
      actualMinutes:base.acceptedMinutes,normDays:cfg.norm_days,dailyNormMinutes:cfg.daily_norm_minutes,
      hasIssues:issues
    });
    rows.push({...base,...c});
  }
  const selected=new Set((scope?.selectedDepartmentIds||[]).map(clean));
  const departments=(scope?.selectedRestaurants||[]).filter(r=>selected.has(clean(r.id))).map(r=>{
    const group=rows.filter(x=>x.restaurantId===clean(r.id));
    return{restaurantId:clean(r.id),restaurantName:clean(r.name||r.code||r.id),
      employeeRows:group.length,uniqueEmployees:new Set(group.map(x=>x.employeeId)).size,
      acceptedMinutes:group.reduce((a,x)=>a+x.acceptedMinutes,0),
      previewGross:cents(group.reduce((a,x)=>a+Number(x.totalGross||0),0)),
      attention:group.filter(x=>x.status!=='PREVIEW_NOT_APPROVED').length};
  });
  return{
    mode:'PER_RMS_ROLE_NORM_PREVIEW',appliedToPayroll:false,postingAllowed:false,rows,departments,
    network:{uniqueEmployees:new Set(rows.map(x=>x.employeeId)).size,employeeRestaurantRows:rows.length,
      acceptedMinutes:departments.reduce((a,x)=>a+x.acceptedMinutes,0),
      previewGross:cents(departments.reduce((a,x)=>a+x.previewGross,0)),
      attention:departments.reduce((a,x)=>a+x.attention,0)},
    missingNorms:missingNorms.length,missingSalary:missingSalary.length
  };
}
