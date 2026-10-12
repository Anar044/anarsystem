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