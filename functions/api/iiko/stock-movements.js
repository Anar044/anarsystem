import { iikoJson, iikoText } from "./_lib/iiko-client.js";

const metaCache = new Map();
const META_TTL_MS = 5 * 60 * 1000;

function corsHeaders(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization"}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...corsHeaders()}})}
function clean(v){return String(v??"").trim()}
function key(v){return clean(v).replace(/^\{+|\}+$/g,"").toLowerCase()}
function num(v){if(v===null||v===undefined||v==="")return null;const n=Number(String(v).replace(/\s/g,"").replace(",","."));return Number.isFinite(n)?n:null}
function list(v){if(Array.isArray(v))return v;if(Array.isArray(v?.items))return v.items;if(Array.isArray(v?.data))return v.data;if(Array.isArray(v?.response))return v.response;if(Array.isArray(v?.results))return v.results;if(Array.isArray(v?.documents))return v.documents;return[]}
function localName(name){return String(name||"").split(":").pop().toLowerCase()}
function xmlDecode(s){return String(s??"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&")}
function xmlTag(block,names){
  const source=String(block||"");
  for(const rawName of (Array.isArray(names)?names:[names])){
    const raw=String(rawName||"");
    const name=raw.replace(/[.*+?^$()|[\]\\]/g,ch=>"\\"+ch);
    if(!name)continue;
    const re=new RegExp("<(?:[A-Za-z][\\w.-]*:)?"+name+"(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z][\\w.-]*:)?"+name+">","i");
    const m=source.match(re);
    if(m)return xmlDecode(m[1].replace(/<[^>]*>/g,"").trim());
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
    const full=m[1];
    if(!wanted.has(localName(full)))continue;
    const escaped=full.replace(/[.*+?^$()|[\]\\]/g,ch=>"\\"+ch);
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
function idOf(x){if(x&&typeof x==="object")return key(x.id??x.uuid??x.entityId??x.productId??x.storeId);return key(x)}
function nameOf(x){return clean(x?.name??x?.title??x?.description??x?.fullName)}
function refId(v){return idOf(v)}
function inlineName(v){return v&&typeof v==="object"?clean(v.name??v.title??v.description??v.fullName??v.shortName??v.code):""}
function unitRaw(v){return v&&typeof v==="object"?clean(v.name??v.shortName??v.symbol??v.code??v.value??v.id):clean(v)}
function visible(v){const s=clean(v);return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(s)?"":s}
function dateOnly(v){const s=clean(v);if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);if(/^\d{2}\.\d{2}\.\d{4}/.test(s)){const [d,m,y]=s.slice(0,10).split(".");return y+"-"+m+"-"+d}return s.slice(0,10)}
function ruDate(v){const s=dateOnly(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return clean(v);const [y,m,d]=s.split("-");return d+"."+m+"."+y}

function parseStores(rawText,payload){
  const rows=[];
  const add=(id,name,parentId="")=>{id=key(id);name=visible(name);if(id&&name)rows.push({id,name,parentId:key(parentId)})};
  const walk=v=>{
    if(Array.isArray(v)){v.forEach(walk);return}
    if(!v||typeof v!=="object")return;
    add(v.id??v.uuid??v.entityId??v.storeId??v.warehouseId,v.name??v.title??v.description??v.fullName,v.parent??v.parentId??v.department??v.departmentId);
    for(const x of Object.values(v))if(x&&typeof x==="object")walk(x);
  };
  walk(payload);
  const parseBlock=b=>add(xmlTag(b,["id","uuid","entityId","storeId","warehouseId"]),xmlTag(b,["name","title","description","fullName"]),xmlTag(b,["parent","parentId","department","departmentId"]));
  xmlRootChildren(rawText).forEach(parseBlock);
  xmlBlocks(rawText,["corporateItemDto","corporateItem","store","storeDto","warehouse","department","item"]).forEach(parseBlock);
  return [...new Map(rows.map(x=>[x.id,x])).values()];
}
function parseUnits(payload){
  const map=new Map();
  for(const x of list(payload)){const id=idOf(x),name=visible(nameOf(x)||x?.code);if(id&&name)map.set(id,name)}
  return map;
}
function parseGroups(payload){
  const map=new Map();
  for(const x of list(payload)){const id=idOf(x),name=visible(nameOf(x));if(id&&name)map.set(id,name)}
  return map;
}
function parseProducts(payload,groups,categories,units){
  const map=new Map();
  for(const x of list(payload)){
    const id=idOf(x);if(!id)continue;
    const groupId=refId(x.parent??x.parentId??x.group??x.groupId);
    const categoryId=refId(x.category??x.categoryId);
    const unitRef=x.mainUnit??x.unit??x.measureUnit;
    const unitId=refId(unitRef);
    map.set(id,{
      id,
      name:visible(nameOf(x))||("Товар · …"+id.slice(-6)),
      num:clean(x.num??x.number??x.article??x.productNum),
      code:clean(x.code??x.quickCode),
      unit:visible(inlineName(unitRef))||visible(units.get(unitId))||visible(unitRaw(unitRef)),
      groupId,groupName:groups.get(groupId)||"",
      categoryId,categoryName:categories.get(categoryId)||""
    });
  }
  return map;
}

async function metadata(connection){
  const cacheKey=[connection.ip,connection.port,connection.login].join("|").toLowerCase();
  const cached=metaCache.get(cacheKey);
  if(cached&&cached.expiresAt>Date.now())return{...cached.data,cacheHit:true};

  const [storesRaw,productsRaw,groupsRaw,categoriesRaw,unitsRaw]=await Promise.all([
    iikoText(connection,"/resto/api/corporation/stores?revisionFrom=-1",{headers:{Accept:"application/xml,text/xml,application/json,*/*"}}),
    iikoJson(connection,"/resto/api/v2/entities/products/list?includeDeleted=false"),
    iikoJson(connection,"/resto/api/v2/entities/products/group/list?includeDeleted=false"),
    iikoJson(connection,"/resto/api/v2/entities/products/category/list?includeDeleted=false"),
    iikoJson(connection,"/resto/api/v2/entities/list?rootType=MeasureUnit")
  ]);

  let storesPayload=null;try{storesPayload=JSON.parse(storesRaw.text||"null")}catch(_){}
  const groups=parseGroups(groupsRaw.payload),categories=parseGroups(categoriesRaw.payload),units=parseUnits(unitsRaw.payload);
  const stores=parseStores(storesRaw.text,storesPayload);
  const storeMap=new Map(stores.map(x=>[x.id,x]));
  const products=parseProducts(productsRaw.payload,groups,categories,units);

  const data={stores,storeMap,products,unitCount:units.size};
  metaCache.set(cacheKey,{data,expiresAt:Date.now()+META_TTL_MS});
  return{...data,cacheHit:false};
}

function productMeta(meta,id){
  const k=key(id);return meta.products.get(k)||{id:k,name:k?("Товар · …"+k.slice(-6)):"—",num:"",code:"",unit:"",groupName:"",categoryName:""}
}
function storeMeta(meta,id){
  const k=key(id);const x=meta.storeMap.get(k);return{xId:k,name:x?.name||visible(id)|| (k?("Склад iiko · …"+k.slice(-6)):"—")}
}
function movementId(type,docId,itemIndex,productId){return[type,key(docId),String(itemIndex),key(productId)].join(":")}

function parseInvoiceItems(block){
  return xmlBlocks(block,"item").map((b,i)=>({
    index:i,
    productId:xmlTag(b,["product","productId"]),
    amount:num(xmlTag(b,["amount","actualAmount"]))??0,
    price:num(xmlTag(b,["price","priceWithoutVat"])),
    sum:num(xmlTag(b,["sum","sumWithoutNds","sumWithoutVat"])),
    storeId:xmlTag(b,["store","storeId"])
  }));
}
function parseInvoiceDocs(xml,kind){
  let docs=xmlBlocks(xml,"document");
  if(!docs.length)docs=xmlBlocks(xml,kind==="incoming"?"incomingInvoice":"outgoingInvoice");
  return docs.map((b,i)=>({
    id:xmlTag(b,["id"])||kind+"-"+i,
    documentNumber:xmlTag(b,["documentNumber","number"]),
    date:xmlTag(b,["dateIncoming","incomingDate","date"]),
    status:xmlTag(b,["status"]),
    storeId:xmlTag(b,["defaultStore","defaultStoreId","store","storeId"]),
    counteragentId:xmlTag(b,["supplier","supplierId","counteragent","counteragentId"]),
    comment:xmlTag(b,["comment"]),
    items:parseInvoiceItems(b)
  }));
}
async function loadInvoice(connection,kind,from,to){
  const endpoint=kind==="incoming"?"/resto/api/documents/export/incomingInvoice":"/resto/api/documents/export/outgoingInvoice";
  const attempts=[];
  for(const pair of [[from,to],[ruDate(from),ruDate(to)]]){
    const q=new URLSearchParams({from:pair[0],to:pair[1]});
    const r=await iikoText(connection,endpoint+"?"+q.toString(),{headers:{Accept:"application/xml,text/xml,*/*"}});
    const docs=r.ok?parseInvoiceDocs(r.text,kind):[];
    attempts.push({path:endpoint,status:r.status,count:docs.length});
    if(r.ok&&docs.length)return{ok:true,docs,attempts};
  }
  const r=await iikoText(connection,endpoint,{headers:{Accept:"application/xml,text/xml,*/*"}});
  const docs=r.ok?parseInvoiceDocs(r.text,kind).filter(d=>{const dt=dateOnly(d.date);return(!dt||dt>=from)&&(!dt||dt<=to)}):[];
  attempts.push({path:endpoint,status:r.status,count:docs.length,fallback:true});
  return{ok:r.ok,docs,attempts};
}

function docStoreId(d,names){
  for(const n of names){const v=d?.[n];if(v!==undefined&&v!==null&&v!=="")return refId(v)}
  return"";
}
function normalizeV2Docs(payload,type){
  return list(payload).map((d,di)=>{
    const fromId=docStoreId(d,["storeFromId","storeFrom","fromStoreId","fromStore"]);
    const toId=docStoreId(d,["storeToId","storeTo","toStoreId","toStore"]);
    const storeId=docStoreId(d,["storeId","store","defaultStoreId","defaultStore"]);
    const items=list(d.items??d.positions??d.products).map((x,ii)=>{
      const productId=refId(x.productId??x.product);
      const amount=num(x.amount??x.quantity??x.qty??x.actualAmount)??0;
      const actualAmount=num(x.actualAmount??x.factAmount??x.factQuantity);
      const accountingAmount=num(x.accountingAmount??x.bookAmount??x.expectedAmount??x.calculatedAmount);
      let differenceAmount=num(x.differenceAmount??x.deltaAmount??x.amountDifference??x.diffAmount);
      if(differenceAmount===null&&actualAmount!==null&&accountingAmount!==null)differenceAmount=actualAmount-accountingAmount;
      const sum=num(x.sum??x.costSum??x.value??x.cost);
      const price=num(x.price??x.unitCost??x.costPrice);
      return{index:ii,productId,amount,actualAmount,accountingAmount,differenceAmount,sum,price,storeId:refId(x.storeId??x.store)||storeId,fromStoreId:refId(x.storeFromId??x.storeFrom)||fromId,toStoreId:refId(x.storeToId??x.storeTo)||toId}
    });
    return{
      id:clean(d.id??d.uuid??d.entityId??(type+"-"+di)),
      documentNumber:clean(d.documentNumber??d.number??d.num),
      date:clean(d.dateIncoming??d.date??d.timestamp??d.createdAt),
      status:clean(d.status??d.documentStatus),
      comment:clean(d.comment??d.description),
      storeId,fromStoreId:fromId,toStoreId:toId,items
    };
  });
}
async function loadV2(connection,type,from,to){
  const candidates=type==="inventory"
    ?["/resto/api/v2/documents/inventory","/resto/api/v2/documents/inventoryDocument"]
    :[type==="transfer"?"/resto/api/v2/documents/internalTransfer":"/resto/api/v2/documents/writeoff"];
  const attempts=[];
  for(const endpoint of candidates){
    const q=new URLSearchParams({dateFrom:from,dateTo:to});
    const r=await iikoJson(connection,endpoint+"?"+q.toString(),{timeoutMs:60000});
    const docs=r.ok?normalizeV2Docs(r.payload,type):[];
    attempts.push({path:endpoint,status:r.status,count:docs.length});
    if(r.ok)return{ok:true,docs,attempts};
  }
  return{ok:false,docs:[],attempts};
}

function enrichInvoice(meta,source,kind){
  const type=kind==="incoming"?"incoming":"outgoing";
  const label=kind==="incoming"?"Приход":"Расход";
  const sign=kind==="incoming"?1:-1;
  const rows=[];
  for(const d of source.docs)for(const x of d.items){
    const p=productMeta(meta,x.productId);
    const sid=refId(x.storeId)||refId(d.storeId);
    const s=storeMeta(meta,sid);
    const amount=Math.abs(Number(x.amount||0));
    const value=x.sum!==null&&x.sum!==undefined?Math.abs(Number(x.sum||0)):x.price!==null?Math.abs(amount*Number(x.price||0)):null;
    rows.push({
      id:movementId(type,d.id,x.index,x.productId),type,label,date:d.date,documentId:d.id,documentNumber:d.documentNumber,status:d.status,comment:d.comment,
      productId:p.id,productName:p.name,productNum:p.num,productCode:p.code,groupName:p.groupName,categoryName:p.categoryName,unit:p.unit,
      storeId:s.xId,storeName:s.name,fromStoreId:kind==="outgoing"?s.xId:"",fromStoreName:kind==="outgoing"?s.name:"",toStoreId:kind==="incoming"?s.xId:"",toStoreName:kind==="incoming"?s.name:"",
      amount,signedAmount:sign*amount,unitCost:x.price!==null?Math.abs(Number(x.price||0)):(amount&&value!==null?value/amount:null),value
    });
  }
  return rows;
}
function enrichV2(meta,source,type){
  const rows=[];
  const labels={writeoff:"Списание",transfer:"Перемещение",inventory:"Инвентаризация"};
  for(const d of source.docs)for(const x of d.items){
    const p=productMeta(meta,x.productId);
    const fromId=refId(x.fromStoreId)||refId(d.fromStoreId);
    const toId=refId(x.toStoreId)||refId(d.toStoreId);
    const baseStoreId=refId(x.storeId)||refId(d.storeId);
    const from=storeMeta(meta,fromId),to=storeMeta(meta,toId),base=storeMeta(meta,baseStoreId);
    let amount=Math.abs(Number(x.amount||0)),signedAmount=null,storeId=base.xId,storeName=base.name;
    if(type==="writeoff")signedAmount=-amount;
    if(type==="inventory"){
      if(x.differenceAmount!==null&&x.differenceAmount!==undefined){signedAmount=Number(x.differenceAmount);amount=Math.abs(signedAmount)}
      else signedAmount=null;
    }
    const value=x.sum!==null&&x.sum!==undefined?Math.abs(Number(x.sum||0)):x.price!==null?Math.abs(amount*Number(x.price||0)):null;
    rows.push({
      id:movementId(type,d.id,x.index,x.productId),type,label:labels[type],date:d.date,documentId:d.id,documentNumber:d.documentNumber,status:d.status,comment:d.comment,
      productId:p.id,productName:p.name,productNum:p.num,productCode:p.code,groupName:p.groupName,categoryName:p.categoryName,unit:p.unit,
      storeId,storeName,fromStoreId:from.xId,fromStoreName:fromId?from.name:"",toStoreId:to.xId,toStoreName:toId?to.name:"",
      amount,signedAmount,unitCost:x.price!==null?Math.abs(Number(x.price||0)):(amount&&value!==null?value/amount:null),value,
      actualAmount:x.actualAmount,accountingAmount:x.accountingAmount,differenceAmount:x.differenceAmount
    });
  }
  return rows;
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()})}

export async function onRequestPost({request}){
  try{
    const b=await request.json();
    const connection={ip:clean(b.ip),port:clean(b.port),login:clean(b.login),password:String(b.password??"")};
    if(!connection.ip||!connection.port||!connection.login||!connection.password)return json({success:false,message:"Нет подключения к iiko Server"},400);
    const from=dateOnly(b.from),to=dateOnly(b.to);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to))return json({success:false,message:"Укажите корректный период"},400);
    if(to<from)return json({success:false,message:"Дата «По» раньше даты «С»"},400);

    const [meta,incoming,outgoing,writeoff,transfer,inventory]=await Promise.all([
      metadata(connection),
      loadInvoice(connection,"incoming",from,to),
      loadInvoice(connection,"outgoing",from,to),
      loadV2(connection,"writeoff",from,to),
      loadV2(connection,"transfer",from,to),
      loadV2(connection,"inventory",from,to)
    ]);

    const movements=[
      ...enrichInvoice(meta,incoming,"incoming"),
      ...enrichInvoice(meta,outgoing,"outgoing"),
      ...enrichV2(meta,writeoff,"writeoff"),
      ...enrichV2(meta,transfer,"transfer"),
      ...enrichV2(meta,inventory,"inventory")
    ].filter(x=>!x.date||dateOnly(x.date)>=from&&dateOnly(x.date)<=to)
     .sort((a,b)=>String(b.date||"").localeCompare(String(a.date||""))||String(a.productName).localeCompare(String(b.productName),"ru"));

    const stores=[...new Map(movements.flatMap(x=>[
      x.storeId?[x.storeId,{id:x.storeId,name:x.storeName}]:null,
      x.fromStoreId?[x.fromStoreId,{id:x.fromStoreId,name:x.fromStoreName}]:null,
      x.toStoreId?[x.toStoreId,{id:x.toStoreId,name:x.toStoreName}]:null
    ]).filter(Boolean)).values()].sort((a,b)=>a.name.localeCompare(b.name,"ru"));

    const products=[...new Map(movements.map(x=>[x.productId,{id:x.productId,name:x.productName}])).values()].sort((a,b)=>a.name.localeCompare(b.name,"ru"));
    const sourceStatus={
      incoming:{ok:incoming.ok,count:incoming.docs.length,attempts:incoming.attempts},
      outgoing:{ok:outgoing.ok,count:outgoing.docs.length,attempts:outgoing.attempts},
      writeoff:{ok:writeoff.ok,count:writeoff.docs.length,attempts:writeoff.attempts},
      transfer:{ok:transfer.ok,count:transfer.docs.length,attempts:transfer.attempts},
      inventory:{ok:inventory.ok,count:inventory.docs.length,attempts:inventory.attempts}
    };

    return json({
      success:true,from,to,movements,stores,products,sourceStatus,
      summary:{
        rows:movements.length,
        incomingValue:movements.filter(x=>x.type==="incoming").reduce((s,x)=>s+Number(x.value||0),0),
        outgoingValue:movements.filter(x=>x.type==="outgoing").reduce((s,x)=>s+Number(x.value||0),0),
        writeoffValue:movements.filter(x=>x.type==="writeoff").reduce((s,x)=>s+Number(x.value||0),0),
        transferValue:movements.filter(x=>x.type==="transfer").reduce((s,x)=>s+Number(x.value||0),0),
        inventoryValue:movements.filter(x=>x.type==="inventory").reduce((s,x)=>s+Number(x.value||0),0)
      },
      meta:{metadataCacheHit:meta.cacheHit===true,warehouseCount:meta.stores.length,unitCount:meta.unitCount}
    });
  }catch(e){
    console.error("IIKO STOCK MOVEMENTS ERROR",e);
    return json({success:false,message:e?.message||"Ошибка получения движения товара"},502);
  }
}
