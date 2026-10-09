// Workspace access scopes are always resolved against the owner's SAVED server
// connection, not HR employee records or any browser-supplied department codes.
const clean=v=>String(v??'').trim();
export function accessDepartmentDirectory(state){
  const identity=state?.identity||{},connection=state?.connection||{};
  const source=[identity.departments,identity.organizations,connection.departments,connection.organizations];
  const rows=[],seen=new Set();
  for(const list of source){
    if(!Array.isArray(list))continue;
    for(const item of list){
      const id=clean(item?.id);if(!id||seen.has(id))continue;
      seen.add(id);
      rows.push({id,name:clean(item?.name)||clean(item?.code)||id,code:clean(item?.code),parentId:clean(item?.parentId)});
    }
  }
  return rows.sort((a,b)=>a.name.localeCompare(b.name,'ru',{numeric:true}));
}
export function normalizeWorkspaceMemberScope(scope,departments){
  const mode=String(scope?.mode||'ALL').toUpperCase()==='SELECTED'?'SELECTED':'ALL';
  if(mode==='ALL')return{mode:'ALL',departmentIds:[],departmentCodes:[],warehouseIds:[]};
  const ids=[...new Set((scope?.departmentIds||[]).map(clean).filter(Boolean))];
  const codes=[...new Set((scope?.departmentCodes||[]).map(clean).filter(Boolean))];
  const valid=Array.isArray(departments)?departments:[];
  const byId=new Map(valid.map(d=>[clean(d.id),d]));
  const byCode=new Map(valid.filter(d=>clean(d.code)).map(d=>[clean(d.code),d]));
  // Callers may submit both ID and code; validate both to prevent malicious cross-scope additions.
  if(ids.some(id=>!byId.has(id))||codes.some(code=>!byCode.has(code))){
    const error=new Error('Выбрано подразделение, которого нет в подключённом SH Chain. Обновите страницу.');
    error.status=403;throw error;
  }
  const chosen=[...new Map([...ids.map(id=>byId.get(id)),...codes.map(code=>byCode.get(code))].map(d=>[d.id,d])).values()];
  if(!chosen.length){
    const error=new Error('Выберите хотя бы одно подразделение для ограничения доступа.');
    error.status=400;throw error;
  }
  return{mode:'SELECTED',departmentIds:chosen.map(d=>d.id),departmentCodes:[...new Set(chosen.map(d=>clean(d.code)).filter(Boolean))],warehouseIds:[]};
}
