import { clean, iikoText } from './_lib/iiko-client.js';

function corsHeaders(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...corsHeaders()}})}
function xmlDecode(v){return String(v||"").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim()}
function xmlChild(block,name){const m=block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`,`i`));return m?xmlDecode(m[1].replace(/<[^>]+>/g,"")):""}
function parseCorporateXml(text){const out=[];const re=/<(?:corporateItemDto|corporateItem|item|entity)\b[^>]*>([\s\S]*?)<\/(?:corporateItemDto|corporateItem|item|entity)>/gi;let m;while((m=re.exec(text))){const b=m[1]||"",id=xmlChild(b,"id"),type=xmlChild(b,"type").toUpperCase();if(!id)continue;out.push({id,parentId:xmlChild(b,"parentId")||null,code:xmlChild(b,"code"),name:xmlChild(b,"name")||xmlChild(b,"code")||id,type:type||"UNKNOWN"})}return out}
function xmlBlocks(source,names){const out=[];for(const name of names){const re=new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`,"gi");let m;while((m=re.exec(String(source||""))))out.push(m[1]||"")}return out}
function parseGroupsXml(text){
  const groups=[],pointsOfSale=[],restaurantSections=[],seenG=new Set(),seenP=new Set(),seenS=new Set();
  const groupBlocks=xmlBlocks(text,["groupDto","group"]);
  for(const b of groupBlocks){
    const id=xmlChild(b,"id");if(!id||seenG.has(id))continue;
    seenG.add(id);
    const departmentId=xmlChild(b,"departmentId")||null;
    groups.push({id,name:xmlChild(b,"name")||id,departmentId});
    for(const pb of xmlBlocks(b,["pointOfSaleDtoes","pointOfSaleDto"])){
      const pid=xmlChild(pb,"id");if(!pid||seenP.has(pid))continue;
      seenP.add(pid);
      const cash=xmlBlocks(pb,["cashRegisterInfo"])[0]||"";
      pointsOfSale.push({id:pid,name:xmlChild(pb,"name")||pid,main:/^true$/i.test(xmlChild(pb,"main")),groupId:id,cashRegisterInfo:cash?{id:xmlChild(cash,"id"),name:xmlChild(cash,"name")}:null});
    }
    for(const sb of xmlBlocks(b,["restaurantSectionInfos","restaurantSectionInfo"])){
      const sid=xmlChild(sb,"id");if(!sid||seenS.has(sid))continue;
      seenS.add(sid);restaurantSections.push({id:sid,name:xmlChild(sb,"name")||sid,groupId:id,pointOfSaleId:null});
    }
  }
  return{groups,pointsOfSale,restaurantSections};
}
function corporateObjects(payload){const out=[],seen=new Set();function walk(v){if(!v||typeof v!=="object")return;if(Array.isArray(v)){v.forEach(walk);return}const type=clean(v.type??v.Type??v.itemType??v.entityType).toUpperCase(),id=v.id??v.Id??v.ID??v.uuid??v.UUID,name=v.name??v.Name,known=["CORPORATION","JURPERSON","ORGDEVELOPMENT","DEPARTMENT"].includes(type);if(id!=null&&(known||name)&&!seen.has(String(id))){out.push({id:String(id),parentId:v.parentId??v.parentID??v.ParentId??null,code:clean(v.code??v.Code),name:clean(name||v.code||v.Code||id),type:type||"UNKNOWN"});seen.add(String(id))}Object.values(v).forEach(walk)}walk(payload);return out}
function groupObjects(payload){const groups=[],pos=[],sections=[],seenG=new Set(),seenP=new Set(),seenS=new Set();function walk(v,parent){if(!v||typeof v!=="object")return;if(Array.isArray(v)){v.forEach(x=>walk(x,parent));return}const type=clean(v.type??v.Type).toUpperCase(),id=v.id??v.Id??v.ID,name=v.name??v.Name,looksGroup=type==="GROUP"||type==="GROUPDTO"||Array.isArray(v.pointOfSaleDtoes)||Array.isArray(v.pointOfSaleDto)||v.pointOfSaleDtoes?.pointOfSaleDto;if(id!=null&&looksGroup&&!seenG.has(String(id))){groups.push({id:String(id),name:clean(name||id),departmentId:v.departmentId??v.DepartmentId??null});seenG.add(String(id))}const p=v.pointOfSaleDtoes?.pointOfSaleDto??v.pointOfSaleDtoes??v.pointOfSaleDto??null,parr=Array.isArray(p)?p:[p];for(const x of parr){if(!x||typeof x!=="object")continue;const pid=x.id??x.Id??x.ID;if(pid!=null&&!seenP.has(String(pid))){pos.push({id:String(pid),name:clean(x.name??x.Name??pid),main:x.main===true||x.Main===true,groupId:id!=null?String(id):null,cashRegisterInfo:x.cashRegisterInfo??x.CashRegisterInfo??null});seenP.add(String(pid))}walk(x.restaurantSectionIds??x.restaurantSectionInfos,{posId:pid,groupId:id})}const rsi=v.restaurantSectionInfos?.restaurantSectionInfo??v.restaurantSectionInfo??v.restaurantSectionIds??null,ra=Array.isArray(rsi)?rsi:[rsi];for(const s of ra){if(!s)continue;const sid=s.id??s.Id??s.ID??s.i;if(sid!=null&&!seenS.has(String(sid))){sections.push({id:String(sid),name:clean(s.name??s.Name??sid),groupId:parent?.groupId??(id!=null?String(id):null),pointOfSaleId:parent?.posId??null});seenS.add(String(sid))}}for(const[k,x]of Object.entries(v))if(!["pointOfSaleDtoes","pointOfSaleDto","restaurantSectionInfos","restaurantSectionInfo","restaurantSectionIds"].includes(k))walk(x,parent)}walk(payload,null);return{groups,pointsOfSale:pos,restaurantSections:sections}}
async function getJsonOrXml(connection,path){
  // The iikoServer corporation endpoints are XML DTO APIs (unlike v2 JSON OLAP).
  // Some 2023 Chain installations serialize an Accept: application/json request as [{},{}].
  const r=await iikoText(connection,path,{headers:{Accept:"application/xml, text/xml;q=0.9"}});
  if(!r.ok)throw Error(`HTTP ${r.status}${r.text?` — ${r.text.slice(0,250)}`:""}`);
  if(!r.text)return{payload:{},rawFormat:"empty",rawPreview:"",authCacheHit:Boolean(r.auth?.cacheHit)};
  if(r.text.trimStart().startsWith("<"))return{payload:null,rawFormat:"xml",rawPreview:r.text.slice(0,1200),xml:r.text,authCacheHit:Boolean(r.auth?.cacheHit)};
  try{return{payload:JSON.parse(r.text),rawFormat:"json",rawPreview:r.text.slice(0,1200),authCacheHit:Boolean(r.auth?.cacheHit)}}catch{throw Error("CHAIN API вернул нераспознанный формат структуры (не XML и не JSON)")}
}
function parsedCorporateResponse(result){
  return result.rawFormat==="xml"?parseCorporateXml(result.xml):corporateObjects(result.payload);
}
function emptyCorporateDtoCount(response){
  return Array.isArray(response?.payload)?response.payload.filter(x=>x&&typeof x==="object"&&!Array.isArray(x)&&Object.keys(x).length===0).length:0;
}
async function fetchCorporationDepartments(connection){
  const attempts=[],paths=["/resto/api/corporation/departments?revisionFrom=-1","/resto/api/corporation/departments"];
  let best={response:null,hierarchy:[],attempts};
  for(const path of paths){
    try{
      const response=await getJsonOrXml(connection,path);
      const hierarchy=parsedCorporateResponse(response);
      attempts.push({endpoint:path,format:response.rawFormat,parsed:hierarchy.length,emptyJsonObjects:emptyCorporateDtoCount(response)});
      if(hierarchy.length>best.hierarchy.length)best={response,hierarchy,attempts};
      if(hierarchy.some(x=>x.type==="DEPARTMENT"))return{response,hierarchy,attempts};
    }catch(error){
      attempts.push({endpoint:path,error:String(error?.message||error).slice(0,260)});
      // Authentication/authorization failures must not be silently treated as format problems.
      if(/HTTP (401|403)\b/.test(String(error?.message||error)))throw error;
    }
  }
  return best;
}
// Shared CHAIN directory discovery. The old CHAIN connection flow is the
// source of truth for RMS/CHAIN organization provisioning. Do not replace it
// with the generic connect endpoint or an OLAP-only identity check.
export async function discoverChainStructure(connection){
  const departmentFetch=await fetchCorporationDepartments(connection);
  const dep=departmentFetch.response;
  let grp=null,groupWarning="";
  try{
    grp=await getJsonOrXml(connection,"/resto/api/corporation/groups?revisionFrom=-1");
  }catch(error){
    // Groups are optional when establishing the department identities.
    groupWarning=/HTTP (401|403)\b/.test(String(error?.message||error))
      ?"Недостаточно прав для получения групп":"Не удалось загрузить группы";
  }
  const hierarchy=departmentFetch.hierarchy;
  const departments=hierarchy.filter(x=>x.type==="DEPARTMENT").map(x=>({
    id:x.id,parentId:x.parentId,code:x.code,name:x.name,type:x.type
  }));
  const corporation=hierarchy.find(x=>x.type==="CORPORATION")||null;
  const groupData=grp?(grp.rawFormat==="xml"?parseGroupsXml(grp.xml):groupObjects(grp.payload))
    :{groups:[],pointsOfSale:[],restaurantSections:[]};
  return{
    departments,corporation,hierarchy,
    restaurants:departments.map(x=>({id:x.id,name:x.name,code:x.code,parentId:x.parentId})),
    groups:groupData.groups,pointsOfSale:groupData.pointsOfSale,
    restaurantSections:groupData.restaurantSections,
    detectedMode:departments.length>1?"CHAIN":"RMS",
    departmentAuthCacheHit:Boolean(dep?.authCacheHit),
    groupAuthCacheHit:Boolean(grp?.authCacheHit),
    diagnostics:{
      format:dep?.rawFormat||"unknown",hierarchyCount:hierarchy.length,
      types:[...new Set(hierarchy.map(x=>x.type))],
      attempts:departmentFetch.attempts.map(x=>({
        endpoint:x.endpoint,format:x.format||null,parsed:x.parsed||0,
        emptyJsonObjects:x.emptyJsonObjects||0,failed:!!x.error
      })),
      groupWarning
    }
  };
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()})}
export async function onRequestPost({request}){
  try{
    const b=await request.json();
    const connection={ip:clean(b.ip),port:clean(b.port),
      login:clean(b.login),password:String(b.password??"")};
    if(!connection.ip||!connection.port||!connection.login||!connection.password){
      return json({success:false,message:"Заполните IP, порт, логин и пароль SH Server"},400);
    }
    const result=await discoverChainStructure(connection);
    if(!result.departments.length){
      return json({success:false,
        message:"CHAIN API доступен, но список ресторанов с типом DEPARTMENT пуст. Проверьте права пользователя CHAIN и структуру сервера.",
        source:"iiko-corporation-api",diagnostics:result.diagnostics},422);
    }
    return json({success:true,mode:result.detectedMode,
      detectedMode:result.detectedMode,organization:result.corporation,
      departments:result.departments,restaurants:result.restaurants,
      hierarchy:result.hierarchy,groups:result.groups,
      pointsOfSale:result.pointsOfSale,restaurantSections:result.restaurantSections,
      source:"iiko-corporation-api",server:{ip:connection.ip,port:connection.port},
      loadedAt:new Date().toISOString(),
      meta:{departmentAuthCacheHit:result.departmentAuthCacheHit,
        groupAuthCacheHit:result.groupAuthCacheHit,
        discoveryAttempts:result.diagnostics.attempts,
        groupWarning:result.diagnostics.groupWarning}});
  }catch(error){
    return json({success:false,message:error?.message||"Не удалось определить тип SH Server"},502);
  }
}
