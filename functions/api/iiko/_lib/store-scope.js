import { iikoText, iikoJson } from "./iiko-client.js";

function clean(v){return String(v??"").trim()}
function key(v){return clean(v).replace(/^\{+|\}+$/g,"").toLowerCase()}
function uniq(values){return [...new Set((values||[]).map(key).filter(Boolean))]}
function xmlDecode(v){return String(v??"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&")}
function tag(block,names){
  for(const name of (Array.isArray(names)?names:[names])){
    const m=String(block||"").match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,"i"));
    if(m)return xmlDecode(m[1]).replace(/<[^>]+>/g,"").trim();
  }
  return "";
}
function blocks(source,names){
  const out=[];
  for(const name of (Array.isArray(names)?names:[names])){
    const re=new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${name}>`,"gi");
    let m;while((m=re.exec(String(source||""))))out.push(m[0]);
  }
  return out;
}
function collectJsonEntities(payload){
  const stores=[],nodes=[],seenS=new Set(),seenN=new Set();
  const walk=v=>{
    if(Array.isArray(v)){v.forEach(walk);return}
    if(!v||typeof v!=="object")return;
    const id=key(v.id??v.uuid??v.entityId??v.storeId??v.warehouseId);
    const name=clean(v.name??v.title??v.description??v.fullName);
    const type=clean(v.type??v.entityType??v.kind).toUpperCase();
    const parentId=key(v.parentId??v.parentID??v.ParentId??v.parent?.id??v.departmentId??v.department?.id);
    const looksStore=["STORE","CENTRALSTORE","WAREHOUSE"].includes(type)||v.storeId!=null||v.warehouseId!=null;
    if(id&&!seenN.has(id)){seenN.add(id);nodes.push({id,parentId,type,name})}
    if(id&&looksStore&&!seenS.has(id)){seenS.add(id);stores.push({id,parentId,name,type:type||"STORE"})}
    Object.values(v).forEach(x=>{if(x&&typeof x==="object")walk(x)});
  };
  walk(payload);
  return{stores,nodes};
}
function collectXmlEntities(text){
  const stores=[],nodes=[],seenS=new Set(),seenN=new Set();
  const candidates=blocks(text,["store","storeDto","warehouse","corporateItemDto","corporateItem","department","item","entity"]);
  for(const b of candidates){
    const id=key(tag(b,["id","uuid","entityId","storeId","warehouseId"]));
    if(!id)continue;
    const name=clean(tag(b,["name","title","description","fullName"]));
    const type=clean(tag(b,["type","entityType","kind"])).toUpperCase();
    const parentId=key(tag(b,["parentId","parentID","departmentId","department"]));
    if(!seenN.has(id)){seenN.add(id);nodes.push({id,parentId,type,name})}
    const opening=String(b).match(/^<([A-Za-z][\w:.-]*)/i)?.[1]?.toLowerCase()||"";
    const looksStore=["STORE","CENTRALSTORE","WAREHOUSE"].includes(type)||["store","storedto","warehouse"].includes(opening);
    if(looksStore&&!seenS.has(id)){seenS.add(id);stores.push({id,parentId,name,type:type||"STORE"})}
  }
  return{stores,nodes};
}
function authoritativeJsonStores(payload){
  const out=[],seen=new Set();
  const roots=Array.isArray(payload)?payload:(Array.isArray(payload?.items)?payload.items:Array.isArray(payload?.stores)?payload.stores:Array.isArray(payload?.data)?payload.data:[]);
  const add=v=>{
    if(!v||typeof v!=="object"||Array.isArray(v))return;
    const id=key(v.id??v.uuid??v.entityId??v.storeId??v.warehouseId);
    const name=clean(v.name??v.title??v.description??v.fullName??v.code);
    const parent=v.parentId??v.parentID??v.ParentId??v.parentCorporateId??v.departmentId??v.organizationId??v.parent?.id??v.department?.id;
    const parentId=key(parent);
    const type=clean(v.type??v.departmentType??v.entityType??v.kind).toUpperCase();
    if(id&&!seen.has(id)){seen.add(id);out.push({id,parentId,name,type:type||"STORE"})}
  };
  for(const x of roots)add(x);
  return out;
}
function authoritativeXmlStores(text){
  const out=[],seen=new Set();
  for(const b of blocks(text,["corporateItemDto","corporateItem","store","storeDto","warehouse","item"])){
    const id=key(tag(b,["id","uuid","entityId","storeId","warehouseId"]));
    if(!id||seen.has(id))continue;
    const name=clean(tag(b,["name","title","description","fullName","code"]));
    const parentId=key(tag(b,["parentId","parentID","parentCorporateId","departmentId","organizationId"]));
    const type=clean(tag(b,["type","departmentType","entityType","kind"])).toUpperCase();
    seen.add(id);out.push({id,parentId,name,type:type||"STORE"});
  }
  return out;
}
async function loadEntities(connection,path){
  const r=await iikoText(connection,path,{headers:{Accept:"application/json, application/xml, text/xml, */*"}});
  if(!r.ok)return{ok:false,status:r.status,stores:[],nodes:[],preview:String(r.text||"").slice(0,500)};
  try{
    const parsed=JSON.parse(r.text||"{}");
    const base=collectJsonEntities(parsed);
    if(path.includes("/corporation/stores")){
      const forced=authoritativeJsonStores(parsed),seen=new Set(base.stores.map(x=>x.id));
      for(const s of forced)if(!seen.has(s.id)){seen.add(s.id);base.stores.push(s)}
    }
    return{ok:true,status:r.status,...base,preview:String(r.text||"").slice(0,900)};
  }catch{
    const base=collectXmlEntities(r.text);
    if(path.includes("/corporation/stores")){
      const forced=authoritativeXmlStores(r.text),seen=new Set(base.stores.map(x=>x.id));
      for(const s of forced)if(!seen.has(s.id)){seen.add(s.id);base.stores.push(s)}
    }
    return{ok:true,status:r.status,...base,preview:String(r.text||"").slice(0,900)};
  }
}
function payloadRows(payload){
  if(Array.isArray(payload))return payload;
  for(const k of ["items","data","rows","response","results"])if(Array.isArray(payload?.[k]))return payload[k];
  return [];
}
function storeRefId(v){
  if(v&&typeof v==="object")return key(v.id??v.uuid??v.entityId??v.storeId??v.warehouseId);
  return key(v);
}
async function balanceStoreFallback(connection,departmentIds){
  const d=new Date(),pad=n=>String(n).padStart(2,"0");
  const timestamp=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T23:59:59`;
  const q=new URLSearchParams({timestamp});
  for(const id of departmentIds)q.append("department",id);
  const r=await iikoJson(connection,"/resto/api/v2/reports/balance/stores?"+q.toString(),{timeoutMs:60000});
  const ids=[],seen=new Set();
  if(r.ok)for(const row of payloadRows(r.payload)){
    const id=storeRefId(row?.store??row?.storeId??row?.warehouse??row?.warehouseId);
    if(id&&!seen.has(id)){seen.add(id);ids.push(id)}
  }
  return{storeIds:ids,status:r.status,ok:r.ok,timestamp,rowCount:payloadRows(r.payload).length};
}

function belongsToSelected(store,nodeMap,wanted){
  let current=store?.parentId||"";
  if(current&&wanted.has(current))return true;
  const visited=new Set();
  while(current&&!visited.has(current)){
    visited.add(current);
    const node=nodeMap.get(current);
    if(!node)break;
    if(wanted.has(node.id))return true;
    current=node.parentId||"";
  }
  return false;
}
export async function resolveStoreScope(connection,departmentIds=[]){
  const selected=uniq(departmentIds);
  if(!selected.length)return{selectedDepartmentIds:[],storeIds:[],resolved:true,stores:[],diagnostics:{reason:"no-department-filter"}};

  const [storesResult,departmentsResult]=await Promise.all([
    loadEntities(connection,"/resto/api/corporation/stores?revisionFrom=-1"),
    loadEntities(connection,"/resto/api/corporation/departments?revisionFrom=-1")
  ]);
  const stores=[...storesResult.stores];
  const nodes=[...departmentsResult.nodes,...storesResult.nodes];
  const nodeMap=new Map(nodes.map(x=>[x.id,x]));
  const wanted=new Set(selected);
  const matched=stores.filter(s=>belongsToSelected(s,nodeMap,wanted)||wanted.has(s.id));
  const hasRelationship=stores.some(s=>s.parentId);
  const fallback=matched.length?{storeIds:[],ok:false,status:0,rowCount:0,timestamp:""}:await balanceStoreFallback(connection,selected);
  const fallbackIds=uniq(fallback.storeIds||[]);
  const knownById=new Map(stores.map(s=>[s.id,s]));
  const fallbackStores=fallbackIds.map(id=>knownById.get(id)||{id,parentId:"",name:"",type:"STORE"});
  const scopedStores=matched.length?matched:fallbackStores;
  return{
    selectedDepartmentIds:selected,
    storeIds:uniq(scopedStores.map(x=>x.id)),
    stores:scopedStores,
    resolved:scopedStores.length>0,
    diagnostics:{
      scopeSource:matched.length?"corporation-tree":(fallbackIds.length?"balance/stores-department":"unresolved"),
      storeEndpointStatus:storesResult.status,
      departmentEndpointStatus:departmentsResult.status,
      totalStores:stores.length,
      matchedStores:matched.length,
      fallbackStoreCount:fallbackIds.length,
      fallback,
      hasRelationship,
      storePreview:storesResult.preview,
      departmentPreview:departmentsResult.preview
    }
  };
}