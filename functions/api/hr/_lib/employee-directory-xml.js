// The SH employee record may contain a nested <employee>true</employee> boolean.
// A non-balancing XML regex truncates that record at the inner closing tag.
const clean=v=>String(v??'').trim();
function decode(v){return String(v??'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')}
function tag(v,name){
  const m=String(v||'').match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','i'));
  return m?decode(m[1]).trim():'';
}
function elements(xml,name){
  const text=String(xml||''),token=new RegExp('<\\/?'+name+'\\b[^>]*>','gi'),out=[];
  let match,depth=0,start=-1;
  while((match=token.exec(text))){
    const isClose=match[0].startsWith('</'),selfClosing=/\/\s*>$/.test(match[0]);
    if(!isClose){
      if(depth===0)start=token.lastIndex;
      if(!selfClosing)depth++;
      else if(depth===0)out.push('');
    }else if(depth>0){
      depth--;
      if(depth===0){out.push(text.slice(start,match.index));start=-1}
    }
  }
  return out;
}
function list(xml,name){
  const values=[];
  for(const inner of elements(xml,name)){
    const nested=[...elements(inner,'string'),...elements(inner,'code')].map(v=>decode(v.replace(/<[^>]*>/g,'')).trim()).filter(Boolean);
    if(nested.length)values.push(...nested);
    else{const direct=decode(inner.replace(/<[^>]*>/g,'')).trim();if(direct)values.push(direct)}
  }
  return [...new Set(values)];
}
function date(v){const m=clean(v).match(/^\d{4}-\d{2}-\d{2}/);return m?m[0]:''}
export function employeeInternalCode(id,code){
  const original=clean(code);
  if(original)return original;
  const stable=clean(id).replace(/[^a-zA-Z0-9_-]/g,'').toUpperCase();
  return stable?'SH-ID-'+stable:'';
}
export function parseEmployeeDirectory(xml){
  const blocks=elements(xml,'employee'),items=[],stats={sourceRecords:blocks.length,skippedMissingId:0,skippedNonEmployee:0,assignedInternalCodes:0};
  for(const row of blocks){
    const id=tag(row,'id');
    if(!id){stats.skippedMissingId++;continue}
    const kind=tag(row,'employee');
    if(kind&&/^(false|0)$/i.test(kind)){stats.skippedNonEmployee++;continue}
    const rawCode=tag(row,'code'),code=employeeInternalCode(id,rawCode);
    if(!rawCode)stats.assignedInternalCodes++;
    items.push({
      id,code,internalCode:!rawCode,displayName:tag(row,'name'),
      firstName:tag(row,'firstName'),middleName:tag(row,'middleName'),lastName:tag(row,'lastName'),
      mainRoleCode:tag(row,'mainRoleCode'),roleCodes:list(row,'roleCodes'),
      hireDate:date(tag(row,'hireDate')),fireDate:date(tag(row,'fireDate')),
      preferredDepartmentCode:tag(row,'preferredDepartmentCode'),
      departmentCodes:list(row,'departmentCodes'),deleted:/^true$/i.test(tag(row,'deleted')),
      isEmployee:true
    });
  }
  return{employees:items,stats};
}
