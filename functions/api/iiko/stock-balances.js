import { clean, getIikoAuth, iikoJson, iikoText } from "./_lib/iiko-client.js";

const metaCache = new Map();
const META_TTL_MS = 5 * 60 * 1000;

function corsHeaders(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization"}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...corsHeaders()}})}
function key(v){return String(v??"").trim().replace(/^\{+|\}+$/g,"").toLowerCase()}
function num(v){if(v===null||v===undefined||v==="")return null;const n=Number(String(v).replace(/\s/g,"").replace(",","."));return Number.isFinite(n)?n:null}
function list(v){if(Array.isArray(v))return v;if(Array.isArray(v?.items))return v.items;if(Array.isArray(v?.data))return v.data;if(Array.isArray(v?.response))return v.response;if(Array.isArray(v?.results))return v.results;return[]}
function escXml(s){return String(s??"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&")}
function localName(name){return String(name||"").split(":").pop().toLowerCase()}
function xmlTag(block,names){
  const source=String(block||"");
  for(const rawName of (Array.isArray(names)?names:[names])){
    const raw=String(rawName||"");
    const name=raw.replace(/[.*+?^$()|[\]\\]/g,ch=>"\\"+ch);
    if(!name)continue;
    const re=new RegExp("<(?:[A-Za-z][\\w.-]*:)?"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z][\\w.-]*:)?"+name+">","i");
    const m=source.match(re);
    if(m)return escXml(m[1].replace(/<[^>]*>/g,"").trim());
  }
  return"";
}
function xmlBlocks(source,names){
  const wanted=new Set((Array.isArray(names)?names:[names]).map(localName));
  const text=String(source||"");
  const out=[];
  const open=/<([A-Za-z][\w:.-]*)\b[^>]*>/gi;
  let m;
  while((m=open.exec(text))){
    const fullName=m[1];
    if(!wanted.has(localName(fullName)))continue;
    const escaped=fullName.replace(/[.*+?^$()|[\]\\]/g,"\\$&");
    const close=new RegExp("</"+escaped+">","ig");
    const tail=text.slice(open.lastIndex);
    const cm=close.exec(tail);
    if(cm)out.push(text.slice(m.index,open.lastIndex+cm.index+cm[0].length));
  }
  return out;
}
function xmlRootChildren(source){
  let text=String(source||"").replace(/^\uFEFF/,"").trim();
  text=text.replace(/^<\?xml[\s\S]*?\?>\s*/i,"").trim();
  const root=text.match(/^<([A-Za-z][\w:.-]*)\b[^>]*>([\s\S]*)<\/\1>\s*$/i);
  const body=root?root[2]:text;
  const out=[];
  const re=/<([A-Za-z][\w:.-]*)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while((m=re.exec(body)))out.push(m[0]);
  return out;
}
function idOf(x){return key(x?.id??x?.uuid??x?.entityId??x?.productId??x?.storeId)}
function nameOf(x){return clean(x?.name??x?.title??x?.description??x?.fullName)}
function refId(v){if(v&&typeof v==="object")return key(v.id??v.uuid??v.entityId??v.storeId??v.productId);return key(v)}
function inlineName(v){if(v&&typeof v==="object")return clean(v.name??v.title??v.description??v.fullName??v.shortName??v.code);return""}
function isGuidLike(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean(v))}
function visibleText(v){const s=clean(v);return s&&!isGuidLike(s)?s:""}
function unitRaw(v){if(v&&typeof v==="object")return clean(v.name??v.shortName??v.symbol??v.code??v.measureUnit??v.value??v.id);return clean(v)}
function compactStoreName(id){const s=key(id);return s?"Склад iiko · …"+s.slice(-6):"Склад iiko"}
function compactProductName(id){const s=key(id);return s?"Товар · …"+s.slice(-6):"Товар"}
function collectNamedRefs(value,out){
  if(Array.isArray(value)){for(const x of value)collectNamedRefs(x,out);return}
  if(!value||typeof value!=="object")return;
  const id=idOf(value),name=nameOf(value);
  if(id&&name)out.push({id,name,parentId:refId(value.parent??value.parentId??value.department??value.departmentId)});
  for(const v of Object.values(value))if(v&&typeof v==="object")collectNamedRefs(v,out);
}
function dedupeRefs(rows){
  const map=new Map();
  for(const x of rows||[])if(x?.id&&x?.name&&!map.has(x.id))map.set(x.id,x);
  return [...map.values()];
}

function normalizeStores(rawText,payload){
  const jsonRows=[];
  collectNamedRefs(payload,jsonRows);
  const direct=list(payload).map(x=>({
    id:idOf(x),
    name:nameOf(x),
    parentId:refId(x.parent??x.parentId??x.department??x.departmentId)
  })).filter(x=>x.id&&x.name);
  const parseStoreBlock=b=>({
    id:key(xmlTag(b,["id","uuid","entityId","storeId","warehouseId"])),
    name:clean(xmlTag(b,["name","title","description","fullName"])),
    parentId:key(xmlTag(b,["parent","parentId","department","departmentId"]))
  });
  const topLevelRows=xmlRootChildren(rawText).map(parseStoreBlock).filter(x=>x.id&&x.name);
  const namedRows=xmlBlocks(rawText,["corporateItemDto","corporateItem","store","storeDto","warehouse","department","item"]).map(parseStoreBlock).filter(x=>x.id&&x.name);
  return dedupeRefs([...direct,...jsonRows,...topLevelRows,...namedRows]);
}

function normalizeUnitMap(payload){
  const rows=list(payload);
  const map=new Map();
  for(const x of rows){
    const id=idOf(x);
    const name=visibleText(nameOf(x))||visibleText(x?.code);
    if(id&&name&&!map.has(id))map.set(id,name);
  }
  return map;
}

function normalizeProducts(payload,groupMap,categoryMap,unitMap){
  return list(payload).map(x=>{
    const id=idOf(x);
    const parentId=refId(x.parent??x.parentId??x.group??x.groupId);
    const categoryId=refId(x.category??x.categoryId);
    const unitRef=x.mainUnit??x.unit??x.measureUnit;
    const unitId=refId(unitRef);
    const rawUnit=unitRaw(unitRef);
    const unit=visibleText(inlineName(unitRef))||visibleText(unitMap.get(unitId))||visibleText(rawUnit);
    return{
      id,
      name:visibleText(nameOf(x))||compactProductName(id),
      num:clean(x.num??x.number??x.article??x.productNum),
      code:clean(x.code??x.quickCode),
      type:clean(x.type??x.productType).toUpperCase(),
      unit,
      groupId:parentId,
      groupName:visibleText(groupMap.get(parentId)),
      categoryId,
      categoryName:visibleText(categoryMap.get(categoryId)),
      deleted:Boolean(x.deleted??x.isDeleted),
      notInStoreMovement:Boolean(x.notInStoreMovement)
    }
  }).filter(x=>x.id&&!x.deleted);
}

async function loadMetadata(connection){
  const auth=await getIikoAuth(connection);
  const cacheKey=auth.serverUrl.toLowerCase();
  const cached=metaCache.get(cacheKey);
  if(cached&&cached.expiresAt>Date.now())return{...cached.data,cacheHit:true};

  const results=await Promise.all([
    iikoText(connection,"/resto/api/corporation/stores?revisionFrom=-1",{headers:{Accept:"application/xml, text/xml, application/json, */*"}}),
    iikoJson(connection,"/resto/api/v2/entities/products/list?includeDeleted=false"),
    iikoJson(connection,"/resto/api/v2/entities/products/group/list?includeDeleted=false"),
    iikoJson(connection,"/resto/api/v2/entities/products/category/list?includeDeleted=false"),
    iikoJson(connection,"/resto/api/v2/entities/list?rootType=MeasureUnit")
  ]);
  const storesRaw=results[0],productsRaw=results[1],groupsRaw=results[2],categoriesRaw=results[3],unitsRaw=results[4];

  if(!storesRaw.ok)throw new Error("Список складов: HTTP "+storesRaw.status);
  if(!productsRaw.ok||!productsRaw.payload)throw new Error("Номенклатура: HTTP "+productsRaw.status);

  let storePayload=null;
  try{storePayload=JSON.parse(storesRaw.text||"null")}catch(_){}

  const groups=list(groupsRaw.payload);
  const categories=list(categoriesRaw.payload);
  const groupMap=new Map(groups.map(x=>[idOf(x),nameOf(x)]).filter(x=>x[0]&&x[1]));
  const categoryMap=new Map(categories.map(x=>[idOf(x),nameOf(x)]).filter(x=>x[0]&&x[1]));
  const stores=normalizeStores(storesRaw.text,storePayload);
  const unitMap=unitsRaw?.ok&&unitsRaw.payload?normalizeUnitMap(unitsRaw.payload):new Map();
  const products=normalizeProducts(productsRaw.payload,groupMap,categoryMap,unitMap);

  const data={
    stores,
    products,
    unitCount:unitMap.size,
    storeReferenceStatus:storesRaw.status,
    unitReferenceStatus:unitsRaw?.status??0
  };
  metaCache.set(cacheKey,{data,expiresAt:Date.now()+META_TTL_MS});
  return{...data,cacheHit:false};
}

function balanceList(payload){return list(payload).map(x=>({
  storeId:refId(x.store??x.storeId??x.warehouse??x.warehouseId),
  storeName:visibleText(x.storeName??x.warehouseName??inlineName(x.store)??inlineName(x.warehouse)),
  productId:refId(x.product??x.productId),
  productName:visibleText(x.productName??inlineName(x.product)),
  productNum:clean(x.productNum??x.num),
  productCode:clean(x.productCode??x.code),
  unit:visibleText(unitRaw(x.unit??x.measureUnit??x.productMeasureUnit)),
  amount:num(x.amount??x.quantity??x.qty)??0,
  sum:num(x.sum??x.costSum??x.value)??0,
  minAmount:num(x.minAmount??x.minimum??x.min),
  maxAmount:num(x.maxAmount??x.maximum??x.max)
})).filter(x=>x.storeId&&x.productId)}

function buildTimestamp(date,time){
  const d=clean(date).slice(0,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d))throw new Error("Укажите корректную дату");
  const t=/^\d{2}:\d{2}:\d{2}$/.test(clean(time))?clean(time):"23:59:59";
  return d+"T"+t;
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()})}

export async function onRequestPost({request}){
  try{
    const b=await request.json();
    const connection={ip:clean(b.ip),port:clean(b.port),login:clean(b.login),password:String(b.password??"")};
    if(!connection.ip||!connection.port||!connection.login||!connection.password)return json({success:false,message:"Нет подключения к iiko Server"},400);

    const timestamp=buildTimestamp(b.date,b.time);
    const departmentIds=Array.isArray(b.departmentIds)?[...new Set(b.departmentIds.map(key).filter(Boolean))]:[];
    const selectedStore=key(b.storeId);

    const q=new URLSearchParams({timestamp});
    if(selectedStore)q.set("store",selectedStore);
    for(const id of departmentIds)q.append("department",id);

    const results=await Promise.all([
      iikoJson(connection,"/resto/api/v2/reports/balance/stores?"+q.toString(),{timeoutMs:60000}),
      loadMetadata(connection)
    ]);
    const balanceResult=results[0],meta=results[1];

    if(!balanceResult.ok||!balanceResult.payload){
      const suffix=balanceResult.text?" — "+balanceResult.text.slice(0,500):"";
      throw new Error("Остатки iiko: HTTP "+balanceResult.status+suffix);
    }

    const balances=balanceList(balanceResult.payload);
    const productMap=new Map(meta.products.map(x=>[x.id,x]));
    const storeMap=new Map(meta.stores.map(x=>[x.id,x]));
    const rows=[];
    const seen=new Set();

    for(const x of balances){
      const p=productMap.get(x.productId)||{id:x.productId,name:"",num:"",code:"",type:"",unit:"",groupId:"",groupName:"",categoryId:"",categoryName:""};
      const s=storeMap.get(x.storeId)||{id:x.storeId,name:"",parentId:""};
      const productName=visibleText(x.productName)||visibleText(p.name)||compactProductName(x.productId);
      const storeName=visibleText(x.storeName)||visibleText(s.name)||compactStoreName(x.storeId);
      const unit=visibleText(x.unit)||visibleText(p.unit)||"";
      const unitCost=Math.abs(x.amount)>1e-12?x.sum/x.amount:null;
      const belowMin=x.minAmount!==null&&x.amount<x.minAmount;
      rows.push({...x,productName,productNum:x.productNum||p.num,productCode:x.productCode||p.code,productType:p.type,unit,groupId:p.groupId,groupName:p.groupName,categoryId:p.categoryId,categoryName:p.categoryName,storeName,storeParentId:s.parentId,unitCost,belowMin,syntheticZero:false});
      seen.add(x.storeId+"|"+x.productId);
    }

    const activeStores=[...new Set(balances.map(x=>x.storeId))];
    const inventoryProducts=meta.products.filter(p=>!p.notInStoreMovement&&!["SERVICE","RATE"].includes(p.type));
    const ZERO_LIMIT=20000;
    let zeroExpansionTruncated=false;
    let syntheticCount=0;
    if(b.includeZero!==false&&activeStores.length){
      outer:for(const storeId of activeStores){
        const s=storeMap.get(storeId)||{id:storeId,name:"",parentId:""};
        const storeName=visibleText(s.name)||compactStoreName(storeId);
        for(const p of inventoryProducts){
          const k=storeId+"|"+p.id;
          if(seen.has(k))continue;
          if(syntheticCount>=ZERO_LIMIT){zeroExpansionTruncated=true;break outer}
          rows.push({storeId,productId:p.id,amount:0,sum:0,minAmount:null,maxAmount:null,productName:p.name,productNum:p.num,productCode:p.code,productType:p.type,unit:visibleText(p.unit),groupId:p.groupId,groupName:p.groupName,categoryId:p.categoryId,categoryName:p.categoryName,storeName,storeParentId:s.parentId,unitCost:null,belowMin:false,syntheticZero:true});
          syntheticCount++;
        }
      }
    }

    rows.sort((a,b)=>a.storeName.localeCompare(b.storeName,"ru")||a.productName.localeCompare(b.productName,"ru"));
    const totalValue=rows.reduce((s,x)=>s+Number(x.sum||0),0);
    const nonZeroCount=rows.filter(x=>Math.abs(Number(x.amount||0))>1e-12).length;
    const negativeCount=rows.filter(x=>Number(x.amount||0)<0).length;
    const zeroCount=rows.filter(x=>Math.abs(Number(x.amount||0))<=1e-12).length;
    const belowMinCount=rows.filter(x=>x.belowMin).length;

    const warehouses=[...new Map(rows.map(x=>[x.storeId,{id:x.storeId,name:x.storeName}])).values()]
      .sort((a,b)=>a.name.localeCompare(b.name,"ru"));

    return json({
      success:true,
      timestamp,
      rows,
      warehouses,
      summary:{totalValue,positions:rows.length,nonZeroCount,zeroCount,negativeCount,belowMinCount},
      source:"/resto/api/v2/reports/balance/stores",
      meta:{
        departmentIds,
        selectedStore:selectedStore||null,
        realBalanceRows:balances.length,
        syntheticZeroRows:syntheticCount,
        zeroExpansionTruncated,
        metadataCacheHit:meta.cacheHit===true,
        resolvedStoreCount:meta.stores.length,
        resolvedUnitCount:Number(meta.unitCount||0),
        storeReferenceStatus:Number(meta.storeReferenceStatus||0),
        unitReferenceStatus:Number(meta.unitReferenceStatus||0),
        authCacheHit:balanceResult.auth?.cacheHit===true
      }
    });
  }catch(e){
    console.error("IIKO STOCK BALANCES ERROR",e);
    return json({success:false,message:e?.message||"Ошибка получения остатков iiko"},502);
  }
}
