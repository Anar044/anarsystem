// Employee may belong to multiple iikoChain restaurants, while payroll has
// one primary accounting department until approved cost allocation is enabled.
import { mergeEmployeeMembership } from './employee-department-membership.js';
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toLocaleLowerCase();
export function employeeRestaurantStatus(employee,scope){
  const departmentCode=clean(employee?.department_code??employee?.departmentCode);
  const departmentCodes=mergeEmployeeMembership(employee?.departmentCodes,departmentCode);
  if(scope?.isChain!==true)return{status:'RMS',departmentCode,restaurantId:'',restaurantName:'',restaurants:[],ready:true};
  const selected=new Set((scope.selectedDepartmentIds||[]).map(clean));
  const directory=(scope.selectedRestaurants||[]).filter(r=>selected.has(clean(r?.id)));
  if(!departmentCodes.length)return{status:'UNASSIGNED',departmentCode:'',restaurantId:'',restaurantName:'',restaurants:[],ready:false};
  const mapped=[],unknown=[];
  for(const code of departmentCodes){
    const matches=directory.filter(r=>norm(r?.code)===norm(code)||norm(r?.id)===norm(code));
    if(matches.length>1)return{status:'AMBIGUOUS_DEPARTMENT',departmentCode,restaurantId:'',restaurantName:'',restaurants:[],ready:false};
    if(matches.length===1){
      const restaurant=matches[0];
      if(!mapped.some(r=>r.id===clean(restaurant.id)))mapped.push({id:clean(restaurant.id),code:clean(restaurant.code),name:clean(restaurant.name)||code});
    }else unknown.push(code);
  }
  if(!mapped.length)return{status:'UNKNOWN_DEPARTMENT',departmentCode,restaurantId:'',restaurantName:'',restaurants:[],ready:false};
  const primary=mapped.find(r=>norm(r.code)===norm(departmentCode))||mapped[0];
  return{
    status:mapped.length>1?'ASSIGNED_MULTIPLE':'ASSIGNED',
    departmentCode,restaurantId:primary.id,restaurantName:primary.name,
    restaurants:mapped,unmatchedDepartmentCodes:unknown,ready:true
  };
}
export function employeeDepartmentSummary(employees,scope){
  const totals={assigned:0,multiple:0,unassigned:0,unknown:0,ambiguous:0};
  if(scope?.isChain!==true)return totals;
  for(const e of employees||[]){
    const status=employeeRestaurantStatus(e,scope).status;
    if(status==='ASSIGNED'||status==='ASSIGNED_MULTIPLE')totals.assigned++;
    if(status==='ASSIGNED_MULTIPLE')totals.multiple++;
    else if(status==='UNASSIGNED')totals.unassigned++;
    else if(status==='AMBIGUOUS_DEPARTMENT')totals.ambiguous++;
    else if(status==='UNKNOWN_DEPARTMENT')totals.unknown++;
  }
  return totals;
}
