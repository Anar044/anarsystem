// Read-only classification: never guess employee eligibility based on display name,
// internal code, or access role. CHAIN requires an unambiguous restaurant mapping.
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLocaleLowerCase();
export function employeeRestaurantStatus(employee,scope){
  const departmentCode=clean(employee?.department_code??employee?.departmentCode);
  if(scope?.isChain!==true)return{status:'RMS',departmentCode,restaurantId:'',restaurantName:'',ready:true};
  const selected=new Set((scope.selectedDepartmentIds||[]).map(clean));
  const directory=(scope.selectedRestaurants||[]).filter(r=>selected.has(clean(r?.id)));
  if(!departmentCode)return{status:'UNASSIGNED',departmentCode:'',restaurantId:'',restaurantName:'',ready:false};
  const matches=directory.filter(r=>norm(r?.code)===norm(departmentCode)||norm(r?.id)===norm(departmentCode));
  if(matches.length===0)return{status:'UNKNOWN_DEPARTMENT',departmentCode,restaurantId:'',restaurantName:'',ready:false};
  if(matches.length>1)return{status:'AMBIGUOUS_DEPARTMENT',departmentCode,restaurantId:'',restaurantName:'',ready:false};
  return{status:'ASSIGNED',departmentCode,restaurantId:clean(matches[0].id),restaurantName:clean(matches[0].name)||departmentCode,ready:true};
}
export function employeeDepartmentSummary(employees,scope){
  const totals={assigned:0,unassigned:0,unknown:0,ambiguous:0};
  if(scope?.isChain!==true)return totals;
  for(const e of employees||[]){
    const status=employeeRestaurantStatus(e,scope).status;
    if(status==='ASSIGNED')totals.assigned++;
    else if(status==='UNASSIGNED')totals.unassigned++;
    else if(status==='AMBIGUOUS_DEPARTMENT')totals.ambiguous++;
    else totals.unknown++;
  }
  return totals;
}
