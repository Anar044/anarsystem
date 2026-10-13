// Scope decisions for an explicit HR import. A department manager may update
// only staff whose primary HR department is already in their allowed scope.
const norm=v=>String(v??'').trim().toUpperCase();
const code=v=>String(v??'').trim();
export function canStartEmployeeImport(access){
  return Boolean(access?.allowed&&(access.isOwner||access.permissions?.includes('*')||access.permissions?.includes('hr.employees.manage')));
}
export function employeeImportScope(scope){
  const limited=Boolean(scope?.membershipRestricted||(scope?.isChain&&
    Array.isArray(scope.selectedDepartmentIds)&&Array.isArray(scope.allowedDepartmentIds)&&
    scope.selectedDepartmentIds.length<scope.allowedDepartmentIds.length));
  const allowedCodes=[...new Set((scope?.selectedDepartmentCodes||[]).map(code).filter(Boolean))];
  return{limited,allowedCodes};
}
export function targetEmployeeDepartment(employee,existingDepartment,allowedCodes){
  const codes=new Map((allowedCodes||[]).map(v=>[norm(v),code(v)]).filter(([k])=>k));
  const old=norm(existingDepartment);
  if(old&&!codes.has(old))return{allowed:false,reason:'EXISTING_OUTSIDE_SCOPE'};
  const preferred=norm(employee?.preferredDepartmentCode);
  const candidates=(employee?.departmentCodes||[]).map(norm).filter(v=>codes.has(v));
  const chosen=(preferred&&codes.has(preferred)?preferred:candidates[0])||old;
  if(!chosen||!codes.has(chosen))return{allowed:false,reason:'DEPARTMENT_NOT_MATCHED'};
  return{allowed:true,departmentCode:code(existingDepartment)||codes.get(chosen)};
}
