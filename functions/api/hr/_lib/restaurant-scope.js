import { loadPrivateIikoState } from "../../iiko/_lib/user-state.js";
import { resolveRestaurantScope } from "../../iiko/_lib/restaurant-scope.js";

const clean=v=>String(v??"").trim();

export async function resolveHrRestaurantScope(request,env,userId){
  try{
    const stored=await loadPrivateIikoState(env.DB,userId,env);
    if(!stored?.found||!stored.state)return null;
    return resolveRestaurantScope({state:stored.state,request,strict:true});
  }catch(error){
    if(error?.status)throw error;
    return null;
  }
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
  if(!isHrSubsetScope(scope))return source;
  const wanted=new Set(hrScopeKeys(scope));
  return source.filter(row=>wanted.has(clean(row?.department_code??row?.departmentCode)));
}