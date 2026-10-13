// iikoChain employee department membership is many-to-many. A primary HR department
// is separate from membership: it is the accounting home and must not be inferred
// from all assigned departments.
const clean=v=>String(v??'').trim();
const norm=v=>clean(v).toUpperCase();
export function employeeMembershipCodes(employee){
  const list=[...(employee?.departmentCodes||[]),employee?.preferredDepartmentCode]
    .map(clean).filter(Boolean);
  const seen=new Set();
  return list.filter(code=>{const k=norm(code);if(seen.has(k))return false;seen.add(k);return true});
}
export function mergeEmployeeMembership(codes,departmentCode){
  const seen=new Set();
  return [...(codes||[]),departmentCode].map(clean).filter(v=>{
    if(!v||seen.has(norm(v)))return false;
    seen.add(norm(v));return true;
  });
}
export function visibleEmployeeMembership(codes,scope){
  const list=mergeEmployeeMembership(codes,'');
  if(!scope?.membershipRestricted&&!(scope?.isChain&&
    (scope.selectedDepartmentIds||[]).length<(scope.allowedDepartmentIds||[]).length))return list;
  const allowed=new Set((scope?.selectedDepartmentCodes||[]).map(norm).filter(Boolean));
  return list.filter(v=>allowed.has(norm(v)));
}
export function employeeWithinMembershipScope(employee,scope){
  if(!scope?.membershipRestricted&&!(scope?.isChain&&
    (scope.selectedDepartmentIds||[]).length<(scope.allowedDepartmentIds||[]).length))return true;
  const allowed=new Set((scope?.selectedDepartmentCodes||[]).map(norm).filter(Boolean));
  if(!allowed.size)return false;
  return mergeEmployeeMembership(employee?.departmentCodes,employee?.department_code??employee?.departmentCode)
    .some(v=>allowed.has(norm(v)));
}
