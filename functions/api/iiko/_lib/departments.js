// SH Server corporation directory parser. Keep this pure for both RMS and CHAIN.
// Both namespaced XML and JSON wrapper shapes occur on /corporation/departments.
const clean=v=>String(v??'').trim();
const allowedTypes=new Set(['DEPARTMENT']);
const LIST_KEYS=new Set(['items','data','results','departments','department',
  'corporateitems','corporateitem','corporateitemdtos','corporateitemdtoes',
  'corporateitemdto','corporation','organizations','organization']);
function normalize(item){
  if(!item||typeof item!=='object'||Array.isArray(item))return null;
  if(item.deleted===true||item.isDeleted===true)return null;
  const type=clean(item.type??item.Type??item.departmentType??item.itemType??item.entityType??'DEPARTMENT').toUpperCase();
  if(!allowedTypes.has(type))return null;
  const id=clean(item.id??item.Id??item.ID??item.uuid??item.UUID);
  if(!id)return null;
  return{id,parentId:clean(item.parentId??item.parentID??item.ParentId)||null,
    code:clean(item.code??item.Code),name:clean(item.name??item.Name??item.code??item.Code??id),type:'DEPARTMENT'};
}
function deduplicate(items){
  const found=new Set(),out=[];
  for(const entry of items){
    if(!entry||found.has(entry.id))continue;
    found.add(entry.id);out.push(entry);
    if(out.length>=3000)break;
  }
  return out;
}
export function normalizeDepartmentsPayload(payload){
  const found=[],visited=new Set();
  function walk(value,depth){
    if(depth>8||found.length>=3000||!value||typeof value!=='object'||visited.has(value))return;
    visited.add(value);
    if(Array.isArray(value)){
      for(const node of value)walk(node,depth+1);
      return;
    }
    const item=normalize(value);
    if(item)found.push(item);
    // Look only in known response containers, not arbitrary nested unrelated data.
    for(const [key,child] of Object.entries(value)){
      if(LIST_KEYS.has(key.toLowerCase())&&child&&typeof child==='object')walk(child,depth+1);
    }
  }
  walk(payload,0);
  return deduplicate(found);
}
function unescapeXml(value){
  return clean(value).replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
}
function tagValue(block,name){
  // Namespaces such as ns2:corporateItemDto and ns2:type are legitimate XML.
  const pattern=new RegExp('<(?:[\\w.-]+:)?'+name+'\\b[^>]*>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?'+name+'\\s*>','i');
  const match=block.match(pattern);
  return match?unescapeXml(match[1].replace(/<[^>]*>/g,'')):'';
}
export function parseDepartmentsXml(xml){
  const result=[],str=String(xml||'');
  const element=/<(?:[\w.-]+:)?(department|corporateItemDto|corporateItem|item|entity)\b[^>]*>([\s\S]*?)<\/(?:[\w.-]+:)?\1\s*>/gi;
  let match;
  while((match=element.exec(str))&&result.length<3000){
    const block=match[2];
    const type=tagValue(block,'type')||tagValue(block,'departmentType')||'DEPARTMENT';
    if(type.toUpperCase()!=='DEPARTMENT')continue;
    const item=normalize({
      id:tagValue(block,'id'),parentId:tagValue(block,'parentId'),
      name:tagValue(block,'name'),code:tagValue(block,'code'),type
    });
    if(item)result.push(item);
  }
  return deduplicate(result);
}
export function safeDepartmentDiagnostic(payload,format='json'){
  // Never include raw server responses or credentials in diagnostic output.
  const data=format==='xml'?String(payload||''):payload;
  const types=new Set();
  let candidates=0;
  if(format==='xml'){
    const re=/<(?:[\w.-]+:)?(?:type|departmentType)\b[^>]*>([^<]{1,60})<\/(?:[\w.-]+:)?(?:type|departmentType)\s*>/gi;
    let m;
    while((m=re.exec(data))&&candidates<3000){
      candidates++;if(types.size<12)types.add(clean(m[1]).toUpperCase());
    }
  }else{
    const seen=new Set();
    function walk(value,depth){
      if(depth>8||!value||typeof value!=='object'||seen.has(value)||candidates>=3000)return;
      seen.add(value);
      if(Array.isArray(value)){for(const x of value)walk(x,depth+1);return;}
      if(value.id||value.Id||value.ID||value.uuid){
        candidates++;const type=clean(value.type??value.Type??value.departmentType??value.itemType??'DEPARTMENT').toUpperCase();
        if(types.size<12)types.add(type);
      }
      for(const [key,child] of Object.entries(value)){
        if(LIST_KEYS.has(key.toLowerCase()))walk(child,depth+1);
      }
    }
    walk(data,0);
  }
  return{format,candidates,types:[...types]};
}
