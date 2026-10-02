function clean(value){return String(value??"").trim()}
function uniq(values){return [...new Set((values||[]).map(clean).filter(Boolean))]}

export const CHAIN_SCOPE_COOKIE="sh_selected_departments";
export const LEGACY_REPORT_SCOPE_COOKIE="sh_reports_departments";

export function connectionMode(state){
  const identity=state?.identity&&typeof state.identity==="object"?state.identity:{};
  const connection=state?.connection&&typeof state.connection==="object"?state.connection:{};
  return clean(identity.mode||connection.connectionType||"RMS").toUpperCase()==="CHAIN"?"CHAIN":"RMS";
}

export function allowedDepartmentIds(state){
  const identity=state?.identity&&typeof state.identity==="object"?state.identity:{};
  const connection=state?.connection&&typeof state.connection==="object"?state.connection:{};
  return uniq([
    ...(Array.isArray(identity.departmentIds)?identity.departmentIds:[]),
    ...(Array.isArray(identity.departments)?identity.departments.map(x=>x?.id):[]),
    ...(Array.isArray(identity.organizations)?identity.organizations.map(x=>x?.id):[]),
    ...(Array.isArray(connection.departmentIds)?connection.departmentIds:[]),
    ...(Array.isArray(connection.departments)?connection.departments.map(x=>x?.id):[]),
    ...(Array.isArray(connection.organizations)?connection.organizations.map(x=>x?.id):[]),
    identity.organizationId,
    connection.organizationId
  ]);
}

export function restaurantDirectory(state){
  const identity=state?.identity&&typeof state.identity==="object"?state.identity:{};
  const connection=state?.connection&&typeof state.connection==="object"?state.connection:{};
  const rows=[];
  const seen=new Set();
  const add=(item)=>{
    const id=clean(item?.id??item);
    if(!id||seen.has(id))return;
    seen.add(id);
    rows.push({id,name:clean(item?.name||item?.code||id),code:clean(item?.code),parentId:clean(item?.parentId)||null});
  };
  for(const list of [identity.departments,identity.organizations,connection.departments,connection.organizations]){
    if(Array.isArray(list))list.forEach(add);
  }
  allowedDepartmentIds(state).forEach(id=>add({id}));
  return rows;
}

export function parseCookies(request){
  const out={};
  for(const part of (request?.headers?.get("Cookie")||"").split(";")){
    const i=part.indexOf("=");if(i<0)continue;
    const key=part.slice(0,i).trim(),raw=part.slice(i+1).trim();
    if(!key)continue;
    try{out[key]=decodeURIComponent(raw)}catch{out[key]=raw}
  }
  return out;
}

export function cookieDepartmentIds(request){
  const cookies=parseCookies(request);
  const raw=cookies[CHAIN_SCOPE_COOKIE]||cookies[LEGACY_REPORT_SCOPE_COOKIE]||"";
  return uniq(raw.split(","));
}

export function resolveRestaurantScope({state,request=null,requestedIds=null,strict=true}={}){
  const allowed=allowedDepartmentIds(state);
  const mode=connectionMode(state);
  const requested=uniq(Array.isArray(requestedIds)?requestedIds:cookieDepartmentIds(request));
  const invalid=requested.filter(id=>!allowed.includes(id));
  if(strict&&invalid.length){
    const error=new Error("Выбрано подразделение, которое не принадлежит текущему подключению Smart Horeca.");
    error.status=403;
    error.code="CHAIN_SCOPE_FORBIDDEN";
    error.invalidDepartmentIds=invalid;
    throw error;
  }
  const valid=requested.filter(id=>allowed.includes(id));
  const selected=valid.length?valid:allowed;
  const directory=restaurantDirectory(state);
  const selectedRestaurants=directory.filter(x=>selected.includes(x.id));
  return {
    mode,
    isChain:mode==="CHAIN",
    allowedDepartmentIds:allowed,
    selectedDepartmentIds:selected,
    selectedDepartmentCodes:uniq(selectedRestaurants.map(x=>x.code)),
    selectedRestaurants,
    allRestaurants:directory
  };
}

export function applyDepartmentScopeToBody(body,scope){
  const next=body&&typeof body==="object"?{...body}:{};
  next.departmentIds=[...(scope?.selectedDepartmentIds||[])];
  next.chainScope={
    mode:scope?.mode||"RMS",
    selectedDepartmentIds:[...(scope?.selectedDepartmentIds||[])],
    allowedDepartmentIds:[...(scope?.allowedDepartmentIds||[])]
  };
  return next;
}