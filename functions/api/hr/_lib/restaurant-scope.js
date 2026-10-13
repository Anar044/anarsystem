import { loadPrivateIikoState } from "../../iiko/_lib/user-state.js";
import { resolveRestaurantScope } from "../../iiko/_lib/restaurant-scope.js";

const clean=v=>String(v??"").trim();

export async function resolveHrRestaurantScope(request,env,userId,access=null){
  if(access&&!access.allowed){const error=new Error('Нет доступа к рабочему пространству');error.status=403;throw error}
  let scope=null;
  try{
    const stored=await loadPrivateIikoState(env.DB,userId,env);
    if(stored?.found&&stored.state)scope=resolveRestaurantScope({state:stored.state,request,strict:true});
  }catch(error){
    if(error?.status)throw error;
    // A missing iiko connection must not widen member permissions.
  }
  if(access?.scope?.mode!=='SELECTED')return scope;
  const memberCodes=new Set((access.scope.departmentCodes||[]).map(clean).filter(Boolean));
  const memberIds=new Set((access.scope.departmentIds||[]).map(clean).filter(Boolean));
  if(!memberCodes.size&&!memberIds.size){const error=new Error('У пользователя не выбраны доступные рестораны');error.status=403;throw error}
  const directory=scope?.selectedRestaurants||[];
  const selected=directory.filter(x=>memberIds.has(clean(x.id))||memberCodes.has(clean(x.code)));
  const selectedIds=selected.map(x=>clean(x.id));
  const selectedCodes=[...new Set(scope?.isChain?selected.map(x=>clean(x.code)).filter(Boolean):[...selected.map(x=>clean(x.code)).filter(Boolean),...memberCodes])];
  // Explicit CHAIN selection in the browser cannot override membership restrictions.
  if(scope?.isChain&&!selected.length){const error=new Error('Выбранный ресторан не разрешён пользователю');error.status=403;throw error}
  return{
    ...(scope||{mode:'RMS',isChain:false,allowedDepartmentIds:[],allRestaurants:[]}),
    selectedDepartmentIds:selectedIds,
    selectedDepartmentCodes:selectedCodes,
    selectedRestaurants:selected,
    membershipRestricted:true,
    workspaceMemberCodes:[...memberCodes],
    workspaceMemberIds:[...memberIds]
  };
}

export function hrScopeKeys(scope){
  return [...new Set([
    ...(Array.isArray(scope?.selectedDepartmentCodes)?scope.selectedDepartmentCodes:[]),
    ...(Array.isArray(scope?.selectedDepartmentIds)?scope.selectedDepartmentIds:[])
  ].map(clean).filter(Boolean))];
}

export function isHrSubsetScope(scope){
  return scope?.isChain===true
    && Array.isArray(scope?.selectedDepartmentIds)
    && Array.isArray(scope?.allowedDepartmentIds)
    && scope.selectedDepartmentIds.length<scope.allowedDepartmentIds.length;
}

export function filterEmployeesByScope(rows,scope){
  const source=Array.isArray(rows)?rows:[];
  if(!isHrSubsetScope(scope)&&!scope?.membershipRestricted)return source;
  const wanted=new Set(hrScopeKeys(scope));
  return source.filter(row=>wanted.has(clean(row?.department_code??row?.departmentCode)));
}

/**
 * Only use Face ID marks from the employee's own CHAIN restaurant.
 * A badge can be recognised on multiple devices, but its punches must never
 * be counted against a different restaurant's timesheet or payroll.
 * Unassigned and unknown devices fail closed in CHAIN mode.
 */
export function filterAttendanceEventsByRestaurant(events,devices,employees,scope){
  const source=Array.isArray(events)?events:[];
  if(scope?.isChain!==true)return source;
  const selectedIds=new Set((scope.selectedDepartmentIds||[]).map(clean).filter(Boolean));
  const restaurantCodes=new Map((scope.selectedRestaurants||[])
    .map(r=>[clean(r?.id),clean(r?.code).toLowerCase()])
    .filter(([id,code])=>id&&code&&selectedIds.has(id)));
  const deviceRestaurant=new Map((devices||[]).map(d=>[clean(d?.device_id??d?.id),clean(d?.restaurant_id??d?.restaurantId)]));
  const employeeCodes=new Map((employees||[]).map(e=>[clean(e?.iiko_employee_id??e?.id),clean(e?.department_code??e?.departmentCode).toLowerCase()]));
  return source.filter(e=>{
    const restaurantId=deviceRestaurant.get(clean(e?.device_id??e?.deviceId));
    const restaurantCode=restaurantCodes.get(restaurantId);
    const employeeCode=employeeCodes.get(clean(e?.iiko_employee_id??e?.employeeId));
    return Boolean(restaurantCode&&employeeCode&&restaurantCode===employeeCode);
  });
}
