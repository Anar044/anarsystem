import { clean, getIikoAuth, iikoJson, iikoText } from "./_lib/iiko-client.js";

const metaCache = new Map();
const META_TTL_MS = 5 * 60 * 1000;

function corsHeaders(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization"}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...corsHeaders()}})}
function key(v){return String(v??"").trim().replace(/^\{+|\}+$/g,"").toLowerCase()}
function num(v){if(v===null||v===undefined||v==="")return null;const n=Number(String(v).replace(/\s/g,"").replace(",","."));return Number.isFinite(n)?n:null}
function list(v){if(Array.isArray(v))return v;if(Array.isArray(v?.items))return v.items;if(Array.isArray(v?.data))return v.data;if(Array.isArray(v?.response))return v.response;if(Array.isArray(v?.results))return v.results;return[]}
function escXml(s){return String(s??"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&")}
function xmlTag(block,names){for(const name of names){const m=String(block||"").match(new RegExp("<"+name+"(?:\\\\s[^>]*)?>([\\\\s\\\\S]*?)</"+name+">","i"));if(m)return escXml(m[1].trim())}return""}
function xmlBlocks(source,names){const out=[];for(const name of names){const re=new RegExp("<"+name+"(?:\\\\s[^>]*)?>[\\\\s\\\\S]*?</"+name+">","gi");let m;while((m=re.exec(String(source||""))))out.push(m[0])}return out}
function idOf(x){return key(x?.id??x?.uuid??x?.entityId??x?.productId??x?.storeId)}
function nameOf(x){return clean(x?.name??x?.title??x?.description??x?.fullName)}
function refId(v){if(v&&typeof v==="object")return key(v.id??v.uuid??v.entityId);return key(v)}
function unitName(v){if(v&&typeof v==="object")return clean(v.name??v.shortName??v.code??v.id);return clean(v)}

function normalizeStores(rawText,payload){
  const rows=list(payload).map(x=>({
    id:idOf(x),
    name:nameOf(x),
    parentId:refId(x.parent??x.parentId??x.department??x.departmentId)
  })).filter(x=>x.id&&x.name);
  if(rows.length)return rows;
  return xmlBlocks(rawText,["corporateItemDto","store","storeDto","department"]).map(b=>({
    id:key(xmlTag(b,["id","uuid","entityId","storeId"])),
    name:clean(xmlTag(b,["name","title","description"])),
    parentId:key(xmlTag(b,["parent","parentId","department","departmentId"]))
  })).filter(x=>x.id&&x.name);
}

function normalizeProducts(payload,groupMap,categoryMap){
  return list(payload).map(x=>{
    const id=idOf(x);
    const parentId=refId(x.parent??x.parentId??x.group??x.groupId);
    const categoryId=refId(x.category??x.categoryId);
    return{
      id,
      name:nameOf(x)||id,
      num:clean(x.num??x.number??x.article??x.productNum),
      code:clean(x.code??x.quickCode),
      type:clean(x.type??x.productType).toUpperCase(),
      unit:unitName(x.mainUnit??x.unit??x.measureUnit),
      groupId:parentId,
      groupName:groupMap.get(parentId)||"",
      categoryId,
      categoryName:categoryMap.get(categoryId)||"",
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
    iikoText(connection,"/resto/api/corporation/stores",{headers:{Accept:"application/json, application/xml, text/xml, */*"}}),
    iikoJson(connection,"/resto/api/v2/entities/products/list?includeDeleted=false"),
    iikoJson(connection,"/resto/api/v2/entities/products/group/list?includeDeleted=false"),
    iikoJson(connection,"/resto/api/v2/entities/products/category/list?includeDeleted=false")
  ]);
  const storesRaw=results[0],productsRaw=results[1],groupsRaw=results[2],categoriesRaw=results[3];

  if(!storesRaw.ok)throw new Error("Список складов: HTTP "+storesRaw.status);
  if(!productsRaw.ok||!productsRaw.payload)throw new Error("Номенклатура: HTTP "+productsRaw.status);

  let storePayload=null;
  try{storePayload=JSON.parse(storesRaw.text||"null")}catch(_){}

  const groups=list(groupsRaw.payload);
  const categories=list(categoriesRaw.payload);
  const groupMap=new Map(groups.map(x=>[idOf(x),nameOf(x)]).filter(x=>x[0]&&x[1]));
  const categoryMap=new Map(categories.map(x=>[idOf(x),nameOf(x)]).filter(x=>x[0]&&x[1]));
  const stores=normalizeStores(storesRaw.text,storePayload);
  const products=normalizeProducts(productsRaw.payload,groupMap,categoryMap);

  const data={stores,products};
  metaCache.set(cacheKey,{data,expiresAt:Date.now()+META_TTL_MS});
  return{...data,cacheHit:false};
}

function balanceList(payload){return list(payload).map(x=>({
  storeId:key(x.store??x.storeId??x.warehouse??x.warehouseId),
  productId:key(x.product??x.productId),
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
      const p=productMap.get(x.productId)||{id:x.productId,name:x.productId,num:"",code:"",type:"",unit:"",groupId:"",groupName:"",categoryId:"",categoryName:""};
      const s=storeMap.get(x.storeId)||{id:x.storeId,name:x.storeId,parentId:""};
      const unitCost=Math.abs(x.amount)>1e-12?x.sum/x.amount:null;
      const belowMin=x.minAmount!==null&&x.amount<x.minAmount;
      rows.push({...x,productName:p.name,productNum:p.num,productCode:p.code,productType:p.type,unit:p.unit,groupId:p.groupId,groupName:p.groupName,categoryId:p.categoryId,categoryName:p.categoryName,storeName:s.name,storeParentId:s.parentId,unitCost,belowMin,syntheticZero:false});
      seen.add(x.storeId+"|"+x.productId);
    }

    const activeStores=[...new Set(balances.map(x=>x.storeId))];
    const inventoryProducts=meta.products.filter(p=>!p.notInStoreMovement&&!["SERVICE","RATE"].includes(p.type));
    const ZERO_LIMIT=20000;
    let zeroExpansionTruncated=false;
    let syntheticCount=0;
    if(b.includeZero!==false&&activeStores.length){
      outer:for(const storeId of activeStores){
        const s=storeMap.get(storeId)||{id:storeId,name:storeId,parentId:""};
        for(const p of inventoryProducts){
          const k=storeId+"|"+p.id;
          if(seen.has(k))continue;
          if(syntheticCount>=ZERO_LIMIT){zeroExpansionTruncated=true;break outer}
          rows.push({storeId,productId:p.id,amount:0,sum:0,minAmount:null,maxAmount:null,productName:p.name,productNum:p.num,productCode:p.code,productType:p.type,unit:p.unit,groupId:p.groupId,groupName:p.groupName,categoryId:p.categoryId,categoryName:p.categoryName,storeName:s.name,storeParentId:s.parentId,unitCost:null,belowMin:false,syntheticZero:true});
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
        authCacheHit:balanceResult.auth?.cacheHit===true
      }
    });
  }catch(e){
    console.error("IIKO STOCK BALANCES ERROR",e);
    return json({success:false,message:e?.message||"Ошибка получения остатков iiko"},502);
  }
}
