// CHAIN approval documents are keyed to ONE restaurant, never to a merged
// selection (A,B,C) or to the signer's personal membership/workspace ID.
const clean=v=>String(v??'').trim();
export function approvalDepartments(scope){
  const allowedIds=new Set((scope?.selectedDepartmentIds||[]).map(clean).filter(Boolean));
  const codes=new Set((scope?.selectedDepartmentCodes||[]).map(clean).filter(Boolean));
  const source=scope?.selectedRestaurants||[];
  const rows=source.filter(x=>allowedIds.has(clean(x.id))||codes.has(clean(x.code)))
    .map(x=>({id:clean(x.id),code:clean(x.code),name:clean(x.name)||clean(x.code)||clean(x.id)}))
    .filter(x=>x.id);
  const seen=new Set();
  return rows.filter(x=>!seen.has(x.id)&&seen.add(x.id));
}
export function approvalTarget(scope,requestedId=''){
  const selection=approvalDepartments(scope),id=clean(requestedId);
  if(scope?.isChain){
    if(id){
      const found=selection.find(x=>x.id===id);
      if(!found){const e=new Error('Подразделение не входит в разрешённую область доступа');e.status=403;throw e}
      return {key:found.id,department:found,available:selection};
    }
    if(selection.length===1)return{key:selection[0].id,department:selection[0],available:selection};
    return{key:'',department:null,available:selection};
  }
  return{key:'ACCOUNT',department:null,available:selection};
}
export function approvalMonthClosed(month,now=new Date()){
  if(!/^\d{4}-\d{2}$/.test(String(month||'')))return false;
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit'}).formatToParts(now);
  const year=parts.find(x=>x.type==='year')?.value||'',m=parts.find(x=>x.type==='month')?.value||'';
  return month<year+'-'+m;
}
export function approvalScopeKey(scope,departmentId=''){
  return approvalTarget(scope,departmentId).key;
}
