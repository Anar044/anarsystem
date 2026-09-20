import { clean, getOlapFields, iikoJson, iikoText } from "./_lib/iiko-client.js";

const cache=new Map();
const CACHE_TTL_MS=5*60*1000;

function cors(){return{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type, Authorization"}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...cors()}})}
function num(v){if(v===null||v===undefined||v==="")return 0;const n=Number(String(v).replace(/\s/g,"").replace(",","."));return Number.isFinite(n)?n:0}
function maybeNum(v){if(v===null||v===undefined||v==="")return null;const n=Number(String(v).replace(/\s/g,"").replace(",","."));return Number.isFinite(n)?n:null}
function list(v){if(Array.isArray(v))return v;if(Array.isArray(v?.items))return v.items;if(Array.isArray(v?.data))return v.data;if(Array.isArray(v?.response))return v.response;if(Array.isArray(v?.results))return v.results;if(Array.isArray(v?.documents))return v.documents;return[]}
function key(v){if(v&&typeof v==="object")v=v.id??v.uuid??v.entityId??v.productId??v.storeId;return String(v??"").trim().replace(/^\{+|\}+$/g,"").toLowerCase()}
function nameOf(x){return clean(x?.name??x?.title??x?.description??x?.fullName)}
function visible(v){const s=clean(v);return /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(s)?"":s}
function norm(v){return clean(v).toLowerCase().replace(/[\s._()\-:/]+/g,"")}
function dateOnly(v){const s=clean(v);if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);if(/^\d{2}\.\d{2}\.\d{4}/.test(s)){const[d,m,y]=s.slice(0,10).split(".");return y+"-"+m+"-"+d}return s.slice(0,10)}
function shiftDate(v,days){const d=new Date(v+"T00:00:00Z");d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function nextDate(v){return shiftDate(v,1)}
function fieldName(fields,candidates){
  for(const c of candidates){const q=norm(c),x=fields.find(f=>norm(f?.name)===q||norm(f?.title)===q);if(x)return x.name}
  for(const c of candidates){const q=norm(c),x=fields.find(f=>norm(f?.name).includes(q)||norm(f?.title).includes(q));if(x)return x.name}
  return null;
}
function rowObject(row,columns){if(!Array.isArray(row))return row&&typeof row==="object"?row:{};const out={};row.forEach((v,i)=>{const c=columns?.[i];out[typeof c==="string"?c:c?.name||c?.field||c?.key||("col"+i)]=v});return out}
function extractRows(report){if(!report)return[];if(Array.isArray(report.data))return report.data.map(x=>rowObject(x,report.columns||report.columnNames||report.headers));if(Array.isArray(report.rows))return report.rows.map(x=>rowObject(x,report.columns||report.columnNames||report.headers));if(Array.isArray(report))return report.map(x=>rowObject(x,[]));return[]}
function xmlDecode(s){return String(s??"").replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,"&")}
function localName(name){return String(name||"").split(":").pop().toLowerCase()}
function xmlTag(block,names){
  const source=String(block||"");
  for(const rawName of (Array.isArray(names)?names:[names])){
    const raw=String(rawName||"");
    const n=raw.replace(/[.*+?^$()|[\]\\]/g,ch=>"\\"+ch);
    if(!n)continue;
    const re=new RegExp("<(?:[A-Za-z][\\w.-]*:)?"+n+"(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[A-Za-z][\\w.-]*:)?"+n+">","i");
    const m=source.match(re);if(m)return xmlDecode(m[1].replace(/<[^>]*>/g,"").trim());
  }
  return"";
}
function xmlBlocks(source,names){
  const wanted=new Set((Array.isArray(names)?names:[names]).map(localName)),text=String(source||""),out=[];
  const open=/<([A-Za-z][\w:.-]*)\b[^>]*>/gi;let m;
  while((m=open.exec(text))){
    const full=m[1];if(!wanted.has(localName(full)))continue;
    const escaped=full.replace(/[.*+?^$()|[\]\\]/g,ch=>"\\"+ch),close=new RegExp("</"+escaped+">","ig"),tail=text.slice(open.lastIndex),cm=close.exec(tail);
    if(cm)out.push(text.slice(m.index,open.lastIndex+cm.index+cm[0].length));
  }
  return out;
}
function xmlRootChildren(source){
  let text=String(source||"").replace(/^\uFEFF/,"").trim().replace(/^<\?xml[\s\S]*?\?>\s*/i,"").trim();
  const root=text.match(/^<([A-Za-z][\w:.-]*)\b[^>]*>([\s\S]*)<\/\1>\s*$/i),body=root?root[2]:text,out=[],re=/<([A-Za-z][\w:.-]*)\b[^>]*>([\s\S]*?)<\/\1>/gi;let m;
  while((m=re.exec(body)))out.push(m[0]);return out;
}
function inlineName(v){return v&&typeof v==="object"?clean(v.name??v.title??v.description??v.fullName??v.shortName??v.code):""}
function unitRaw(v){return v&&typeof v==="object"?clean(v.name??v.shortName??v.symbol??v.code??v.value??v.id):clean(v)}

function parseStores(raw,payload){
  const rows=[],add=(id,name,parentId="")=>{id=key(id);name=visible(name);if(id&&name)rows.push({id,name,parentId:key(parentId)})};
  const walk=v=>{if(Array.isArray(v)){v.forEach(walk);return}if(!v||typeof v!=="object")return;add(v.id??v.uuid??v.entityId??v.storeId??v.warehouseId,v.name??v.title??v.description??v.fullName,v.parent??v.parentId??v.department??v.departmentId);for(const x of Object.values(v))if(x&&typeof x==="object")walk(x)};
  walk(payload);
  const parse=b=>add(xmlTag(b,["id","uuid","entityId","storeId","warehouseId"]),xmlTag(b,["name","title","description","fullName"]),xmlTag(b,["parent","parentId","department","departmentId"]));
  xmlRootChildren(raw).forEach(parse);xmlBlocks(raw,["corporateItemDto","corporateItem","store","storeDto","warehouse","department","item"]).forEach(parse);
  return [...new Map(rows.map(x=>[x.id,x])).values()];
}
function parseSimpleMap(payload){const m=new Map();for(const x of list(payload)){const id=key(x),name=visible(nameOf(x)||x?.code);if(id&&name)m.set(id,name)}return m}
function parseProducts(payload,groups,categories,units){
  const map=new Map(),byName=new Map();
  for(const x of list(payload)){
    const id=key(x);if(!id)continue;
    const groupId=key(x.parent??x.parentId??x.group??x.groupId),categoryId=key(x.category??x.categoryId),unitRef=x.mainUnit??x.unit??x.measureUnit,unitId=key(unitRef);
    const p={id,name:visible(nameOf(x))||("Товар · …"+id.slice(-6)),num:clean(x.num??x.number??x.article??x.productNum),code:clean(x.code??x.quickCode),type:clean(x.type??x.productType).toUpperCase(),unit:visible(inlineName(unitRef))||visible(units.get(unitId))||visible(unitRaw(unitRef)),groupId,groupName:groups.get(groupId)||"",categoryId,categoryName:categories.get(categoryId)||""};
    map.set(id,p);const nk=norm(p.name);if(nk&&!byName.has(nk))byName.set(nk,id);else if(nk)byName.set(nk,null);
  }
  return{map,byName};
}
function chartProductId(c){return key(c?.assembledProduct??c?.product??c?.dish??c?.assembledProductId??c?.productId??c?.dishId)}
function chartItems(c){for(const v of [c?.items,c?.ingredients,c?.ingredientItems,c?.components,c?.composition])if(Array.isArray(v))return v;return[]}
function chartItemProductId(x){return key(x?.product??x?.nomenclatureItem??x?.ingredient??x?.item??x?.productId??x?.nomenclatureItemId??x?.ingredientId??x?.itemId)}
function chartItemAmount(x){
  const amountIn=Math.abs(num(x?.amountIn));
  if(amountIn>1e-12)return amountIn;
  const amountMiddle=Math.abs(num(x?.amountMiddle));
  if(amountMiddle>1e-12)return amountMiddle;
  const amountOut=Math.abs(num(x?.amountOut));
  if(amountOut>1e-12)return amountOut;
  return Math.abs(num(x?.amount??x?.quantity??x?.qty??x?.grossAmount??x?.netAmount??x?.productAmount));
}
function chartOutput(c){const n=Math.abs(num(c?.amount??c?.output??c?.outputAmount??c?.assembledAmount??c?.yield??c?.productAmount));return n>1e-12?n:1}
function chartFrom(c){return dateOnly(c?.dateFrom??c?.startDate??c?.from??c?.effectiveFrom)}
function chartTo(c){return dateOnly(c?.dateTo??c?.endDate??c?.to??c?.effectiveTo)}
function collectCharts(v,out,seen=new Set()){
  if(!v||typeof v!=="object"||seen.has(v))return;seen.add(v);
  if(Array.isArray(v)){for(const x of v)collectCharts(x,out,seen);return}
  const pid=chartProductId(v),items=chartItems(v);if(pid&&items.length)out.push(v);
  for(const x of Object.values(v))if(x&&typeof x==="object")collectCharts(x,out,seen);
}
function makeChartMap(payload){
  const all=[];collectCharts(payload,all);const map=new Map();
  for(const c of all){const pid=chartProductId(c);if(!map.has(pid))map.set(pid,[]);map.get(pid).push(c)}
  for(const arr of map.values())arr.sort((a,b)=>chartFrom(b).localeCompare(chartFrom(a)));
  return{map,count:all.length};
}
function chooseChart(chartMap,productId,date){
  const arr=chartMap.get(key(productId))||[];if(!arr.length)return null;
  const dated=arr.filter(c=>{const f=chartFrom(c),t=chartTo(c);return(!f||f<=date)&&(!t||date<=t)});
  return dated[0]||arr[0]||null;
}
function expandRecipe(chartMap,productId,qty,date,out,visited=new Set(),depth=0){
  const pid=key(productId);if(!pid||!qty)return false;
  if(depth>8||visited.has(pid)){out.set(pid,(out.get(pid)||0)+qty);return false}
  const chart=chooseChart(chartMap,pid,date);
  if(!chart){out.set(pid,(out.get(pid)||0)+qty);return false}

  // DIRECT means iiko writes off the assembled product itself rather than recipe ingredients.
  if(clean(chart?.productWriteoffStrategy).toUpperCase()==="DIRECT"){
    out.set(pid,(out.get(pid)||0)+qty);
    return true;
  }

  const items=chartItems(chart).filter(x=>chartItemProductId(x)&&chartItemAmount(x)>0);
  if(!items.length)return false;

  const next=new Set(visited);next.add(pid);const divisor=chartOutput(chart);
  for(const item of items){
    const iid=chartItemProductId(item);
    const iq=qty*chartItemAmount(item)/divisor;
    const nested=chooseChart(chartMap,iid,date);
    if(nested)expandRecipe(chartMap,iid,iq,date,out,next,depth+1);
    else out.set(iid,(out.get(iid)||0)+iq);
  }
  return true;
}

async function loadMeta(connection,from,to){
  const ck=[connection.ip,connection.port,connection.login,from,to].join("|").toLowerCase(),cached=cache.get(ck);
  if(cached&&cached.expiresAt>Date.now())return{...cached.data,cacheHit:true};
  const [storesRaw,productsRaw,groupsRaw,catsRaw,unitsRaw,chartsRaw]=await Promise.all([
    iikoText(connection,"/resto/api/corporation/stores?revisionFrom=-1",{headers:{Accept:"application/xml,text/xml,application/json,*/*"}}),
    iikoJson(connection,"/resto/api/v2/entities/products/list?includeDeleted=false"),
    iikoJson(connection,"/resto/api/v2/entities/products/group/list?includeDeleted=false"),
    iikoJson(connection,"/resto/api/v2/entities/products/category/list?includeDeleted=false"),
    iikoJson(connection,"/resto/api/v2/entities/list?rootType=MeasureUnit"),
    iikoJson(connection,"/resto/api/v2/assemblyCharts/getAll?"+new URLSearchParams({
      dateFrom:from,
      dateTo:to,
      includeDeletedProducts:"true",
      includePreparedCharts:"false"
    }).toString(),{timeoutMs:60000})
  ]);
  let sp=null;try{sp=JSON.parse(storesRaw.text||"null")}catch(_){}
  const groups=parseSimpleMap(groupsRaw.payload),categories=parseSimpleMap(catsRaw.payload),units=parseSimpleMap(unitsRaw.payload),products=parseProducts(productsRaw.payload,groups,categories,units),stores=parseStores(storesRaw.text,sp),storeMap=new Map(stores.map(x=>[x.id,x])),charts=makeChartMap(chartsRaw.payload);
  const data={products:products.map,productByName:products.byName,stores,storeMap,charts:charts.map,chartCount:charts.count,chartStatus:chartsRaw.status,unitCount:units.size};
  cache.set(ck,{data,expiresAt:Date.now()+CACHE_TTL_MS});return{...data,cacheHit:false};
}
function balanceRows(payload){return list(payload).map(x=>({storeId:key(x.store??x.storeId??x.warehouse??x.warehouseId),productId:key(x.product??x.productId),amount:num(x.amount??x.quantity??x.qty),sum:num(x.sum??x.costSum??x.value)})).filter(x=>x.productId)}
async function balance(connection,timestamp,departmentIds,storeId){
  const q=new URLSearchParams({timestamp});if(storeId)q.set("store",storeId);for(const id of departmentIds)q.append("department",id);
  const r=await iikoJson(connection,"/resto/api/v2/reports/balance/stores?"+q.toString(),{timeoutMs:60000});
  if(!r.ok)throw new Error("Остатки iiko HTTP "+r.status);
  const rows=balanceRows(r.payload),byProduct=new Map();for(const x of rows){const prev=byProduct.get(x.productId)||{amount:0,sum:0};prev.amount+=x.amount;prev.sum+=x.sum;byProduct.set(x.productId,prev)}
  return{rows,byProduct,authCacheHit:r.auth?.cacheHit===true};
}
function parseInvoiceItems(block){return xmlBlocks(block,"item").map((b,i)=>({index:i,productId:key(xmlTag(b,["product","productId"])),amount:num(xmlTag(b,["amount","actualAmount"])),price:maybeNum(xmlTag(b,["price","priceWithoutVat"])),sum:maybeNum(xmlTag(b,["sum","sumWithoutNds","sumWithoutVat"])),storeId:key(xmlTag(b,["store","storeId"]))}))}
function parseInvoiceDocs(xml,kind){
  let docs=xmlBlocks(xml,"document");if(!docs.length)docs=xmlBlocks(xml,kind==="incoming"?"incomingInvoice":"outgoingInvoice");
  return docs.map((b,i)=>({id:xmlTag(b,["id"])||kind+"-"+i,date:xmlTag(b,["dateIncoming","incomingDate","date"]),storeId:key(xmlTag(b,["defaultStore","defaultStoreId","store","storeId"])),items:parseInvoiceItems(b)}));
}
async function loadInvoices(connection,kind,from,to){
  const endpoint=kind==="incoming"?"/resto/api/documents/export/incomingInvoice":"/resto/api/documents/export/outgoingInvoice",q=new URLSearchParams({from,to});
  let r=await iikoText(connection,endpoint+"?"+q.toString(),{headers:{Accept:"application/xml,text/xml,*/*"}});
  let docs=r.ok?parseInvoiceDocs(r.text,kind):[];
  if(!docs.length){r=await iikoText(connection,endpoint,{headers:{Accept:"application/xml,text/xml,*/*"}});docs=r.ok?parseInvoiceDocs(r.text,kind).filter(d=>{const dt=dateOnly(d.date);return(!dt||dt>=from)&&(!dt||dt<=to)}):[]}
  return{ok:r.ok,status:r.status,docs};
}
function normalizeV2Docs(payload){
  return list(payload).map((d,di)=>({id:clean(d.id??d.uuid??d.entityId??("doc-"+di)),date:clean(d.date??d.timestamp??d.createdAt),storeId:key(d.storeId??d.store??d.defaultStoreId??d.defaultStore),fromStoreId:key(d.storeFromId??d.storeFrom??d.fromStoreId??d.fromStore),toStoreId:key(d.storeToId??d.storeTo??d.toStoreId??d.toStore),items:list(d.items??d.positions??d.products).map((x,ii)=>({index:ii,productId:key(x.productId??x.product),amount:num(x.amount??x.quantity??x.qty??x.actualAmount),sum:maybeNum(x.sum??x.costSum??x.value??x.cost),price:maybeNum(x.price??x.unitCost??x.costPrice),storeId:key(x.storeId??x.store),fromStoreId:key(x.storeFromId??x.storeFrom),toStoreId:key(x.storeToId??x.storeTo)}))}));
}
async function loadV2Docs(connection,path,from,to){
  const q=new URLSearchParams({dateFrom:from,dateTo:to}),r=await iikoJson(connection,path+"?"+q.toString(),{timeoutMs:60000});
  return{ok:r.ok,status:r.status,docs:r.ok?normalizeV2Docs(r.payload):[]};
}
async function loadSales(connection,from,to,departmentIds,productByName,products,chartMap){
  const meta=await getOlapFields(connection,"SALES"),fields=meta.fields||[];
  const dateField=fieldName(fields,["OpenDate.Typed","OpenDate"]);
  const dishIdField=fieldName(fields,["Dish.Id","DishId","Product.Id","ProductId"]);
  const dishNameField=fieldName(fields,["DishName","Product.Name","Dish","ProductName"]);
  const qtyField=fieldName(fields,["DishAmountInt","DishAmount","Quantity","DishQuantity"]);
  const revenueField=fieldName(fields,["DishDiscountSumInt","DishSumInt","Sales","DishDiscountSum"]);
  const costField=fieldName(fields,["ProductCostBase.Cost","ProductCostBaseCost","DishCost","Cost","ProductCost"]);
  const departmentField=fieldName(fields,["Department.Id","DepartmentId","Department.ID"]);
  const missing=[];if(!dateField)missing.push("дата");if(!dishNameField&&!dishIdField)missing.push("блюдо");if(!qtyField)missing.push("количество");if(!revenueField)missing.push("выручка");if(missing.length)throw new Error("Не найдены SALES OLAP поля: "+missing.join(", "));
  if(departmentIds.length&&!departmentField)throw new Error("Не найден Department.Id для ограничения ресторана");
  const filters={[dateField]:{filterType:"DateRange",periodType:"CUSTOM",from,to:nextDate(to),includeLow:true,includeHigh:false}};
  if(departmentIds.length)filters[departmentField]={filterType:"IncludeValues",values:departmentIds};
  const deleted=fieldName(fields,["DeletedWithWriteoff"]);if(deleted)filters[deleted]={filterType:"ExcludeValues",values:["DELETED_WITHOUT_WRITEOFF"]};
  const orderDeleted=fieldName(fields,["OrderDeleted","Order.Deleted"]);if(orderDeleted)filters[orderDeleted]={filterType:"IncludeValues",values:["NOT_DELETED"]};
  const groups=[dateField,...(dishIdField?[dishIdField]:[]),...(dishNameField?[dishNameField]:[])],measures=[qtyField,revenueField,...(costField?[costField]:[])];
  const req={reportType:"SALES",buildSummary:false,groupByRowFields:[...new Set(groups)],groupByColFields:[],aggregateFields:[...new Set(measures)],filters};
  let r=await iikoJson(connection,"/resto/api/v2/reports/olap",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(req)});
  if(!r.ok&&dishIdField){
    req.groupByRowFields=[dateField,...(dishNameField?[dishNameField]:[])];
    r=await iikoJson(connection,"/resto/api/v2/reports/olap",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(req)});
  }
  if(!r.ok)throw new Error("SALES OLAP HTTP "+r.status+": "+String(r.text||"").slice(0,500));
  const matchStats={chartById:0,chartByName:0,productById:0,productByName:0,unmapped:0};
  const rows=extractRows(r.payload).map(raw=>{
    const dishName=clean(dishNameField?raw[dishNameField]:"");
    const rawId=key(dishIdField?raw[dishIdField]:"");
    const nameId=productByName.get(norm(dishName))||"";
    let mapped="",matchMode="unmapped";
    if(rawId&&chartMap.has(rawId)){mapped=rawId;matchMode="chartById"}
    else if(nameId&&chartMap.has(nameId)){mapped=nameId;matchMode="chartByName"}
    else if(rawId&&products.has(rawId)){mapped=rawId;matchMode="productById"}
    else if(nameId){mapped=nameId;matchMode="productByName"}
    else if(rawId){mapped=rawId}
    if(matchMode==="unmapped")matchStats.unmapped++;else matchStats[matchMode]++;
    return{date:dateOnly(raw[dateField]),dishId:mapped,dishName,rawDishId:rawId,matchMode,quantity:num(raw[qtyField]),revenue:num(raw[revenueField]),cost:costField?num(raw[costField]):0};
  }).filter(x=>x.quantity!==0||x.revenue!==0||x.cost!==0);
  const unmatched=rows.filter(x=>!x.dishId||!chartMap.has(x.dishId)).slice(0,12).map(x=>({dishName:x.dishName,rawDishId:x.rawDishId,mappedDishId:x.dishId,matchMode:x.matchMode}));
  return{rows,matchStats,unmatched,fields:{dateField,dishIdField,dishNameField,qtyField,revenueField,costField,departmentField},fieldsCacheHit:meta.cacheHit===true,authCacheHit:r.auth?.cacheHit===true};
}
function aggregateDocs(docs,kind,storeId,relevantStores){
  const map=new Map(),includeStore=sid=>storeId?sid===storeId:(!relevantStores.size||!sid||relevantStores.has(sid));
  for(const d of docs)for(const x of d.items){
    const sid=x.storeId||d.storeId;if(!includeStore(sid)||!x.productId)continue;
    const a=Math.abs(x.amount),v=x.sum!==null?Math.abs(x.sum):(x.price!==null?Math.abs(a*x.price):0),p=map.get(x.productId)||{amount:0,value:0};p.amount+=a;p.value+=v;map.set(x.productId,p);
  }
  return map;
}
function aggregateTransfers(docs,storeId){
  const map=new Map();if(!storeId)return map;
  for(const d of docs)for(const x of d.items){
    const from=x.fromStoreId||d.fromStoreId,to=x.toStoreId||d.toStoreId;if(!x.productId)continue;
    const a=Math.abs(x.amount),v=x.sum!==null?Math.abs(x.sum):(x.price!==null?Math.abs(a*x.price):0),p=map.get(x.productId)||{amount:0,value:0};
    if(to===storeId){p.amount+=a;p.value+=v}if(from===storeId){p.amount-=a;p.value-=v}map.set(x.productId,p);
  }
  return map;
}
function sumMap(map,field){let s=0;for(const x of map.values())s+=num(x[field]);return s}
function get(map,id){return map.get(id)||{amount:0,value:0,sum:0}}
function percent(n,d){return Math.abs(d)>1e-12?n/d*100:null}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestPost({request}){
  const requestId=crypto.randomUUID?.()||Date.now().toString(36);
  try{
    const b=await request.json(),connection={ip:clean(b.ip),port:clean(b.port),login:clean(b.login),password:String(b.password??"")};
    const from=dateOnly(b.from),to=dateOnly(b.to),departmentIds=[...new Set((Array.isArray(b.departmentIds)?b.departmentIds:[]).map(key).filter(Boolean))],storeId=key(b.storeId);
    if(!connection.ip||!connection.port||!connection.login||!connection.password)return json({success:false,message:"Нет подключения к iiko Server",requestId},400);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)return json({success:false,message:"Проверьте период",requestId},400);

    const meta=await loadMeta(connection,from,to);
    const startTs=from+"T00:00:00",endTs=to+"T23:59:59";
    const [sales,opening,closing,incoming,outgoing,transfers,writeoffs]=await Promise.all([
      loadSales(connection,from,to,departmentIds,meta.productByName,meta.products,meta.charts),
      balance(connection,startTs,departmentIds,storeId),
      balance(connection,endTs,departmentIds,storeId),
      loadInvoices(connection,"incoming",from,to),
      loadInvoices(connection,"outgoing",from,to),
      loadV2Docs(connection,"/resto/api/v2/documents/internalTransfer",from,to),
      loadV2Docs(connection,"/resto/api/v2/documents/writeoff",from,to)
    ]);

    const relevantStores=new Set([...opening.rows,...closing.rows].map(x=>x.storeId).filter(Boolean));
    const inMap=aggregateDocs(incoming.docs,"incoming",storeId,relevantStores),outMap=aggregateDocs(outgoing.docs,"outgoing",storeId,relevantStores),transferMap=aggregateTransfers(transfers.docs,storeId);
    const writeoffMap=aggregateDocs(writeoffs.docs,"writeoff",storeId,relevantStores);

    const theoryQty=new Map();let soldQty=0,coveredQty=0,revenue=0,olapCost=0;
    for(const s of sales.rows){
      const q=Math.abs(s.quantity);soldQty+=q;revenue+=s.revenue;olapCost+=s.cost;
      if(!s.dishId||!chooseChart(meta.charts,s.dishId,s.date||from))continue;
      const ok=expandRecipe(meta.charts,s.dishId,q,s.date||from,theoryQty);
      if(ok)coveredQty+=q;
    }

    const productIds=new Set([...opening.byProduct.keys(),...closing.byProduct.keys(),...inMap.keys(),...outMap.keys(),...transferMap.keys(),...writeoffMap.keys(),...theoryQty.keys()]);
    const rows=[];
    for(const id of productIds){
      const p=meta.products.get(id)||{id,name:"Товар · …"+id.slice(-6),num:"",code:"",unit:"",groupName:"",categoryName:"",type:""};
      const op=get(opening.byProduct,id),cl=get(closing.byProduct,id),inc=get(inMap,id),out=get(outMap,id),tr=get(transferMap,id);
      const actualQty=op.amount+inc.amount-out.amount+tr.amount-cl.amount;
      const tq=theoryQty.get(id)||0;
      const basisQty=Math.abs(op.amount)+Math.abs(cl.amount)+Math.abs(inc.amount);
      const basisValue=Math.abs(op.sum)+Math.abs(cl.sum)+Math.abs(inc.value);
      const fallbackQty=Math.abs(op.amount)+Math.abs(inc.amount)+Math.abs(cl.amount);
      const fallbackValue=Math.abs(op.sum)+Math.abs(inc.value)+Math.abs(cl.sum);
      const unitCost=basisQty>1e-12?basisValue/basisQty:(fallbackQty>1e-12?fallbackValue/fallbackQty:0);
      // External outgoing invoices affect quantity, but their document amount can be a sale/issue price,
      // not warehouse cost. Value the calculated physical usage at warehouse cost to keep qty/value consistent.
      const actualValue=actualQty*unitCost;
      const theoreticalValue=tq*unitCost,varianceQty=actualQty-tq,varianceValue=actualValue-theoreticalValue,variancePct=Math.abs(theoreticalValue)>1e-12?varianceValue/Math.abs(theoreticalValue)*100:null;
      if(Math.abs(actualQty)<1e-9&&Math.abs(tq)<1e-9&&Math.abs(actualValue)<0.005)continue;
      const outgoingValueAtCost=out.amount*unitCost;
      const writeoffQty=get(writeoffMap,id).amount;
      const writeoffValueAtCost=writeoffQty*unitCost;
      rows.push({productId:id,productName:p.name,productNum:p.num,productCode:p.code,unit:p.unit,groupName:p.groupName,categoryName:p.categoryName,productType:p.type,openingQty:op.amount,incomingQty:inc.amount,outgoingQty:out.amount,outgoingValueAtCost,transferQty:tr.amount,closingQty:cl.amount,theoreticalQty:tq,actualQty,varianceQty,unitCost,theoreticalValue,actualValue,varianceValue,variancePct,writeoffQty,writeoffValueAtCost});
    }
    rows.sort((a,b)=>Math.abs(b.varianceValue)-Math.abs(a.varianceValue)||a.productName.localeCompare(b.productName,"ru"));

    const recipeTheoryValue=rows.reduce((s,x)=>s+x.theoreticalValue,0),actualValue=rows.reduce((s,x)=>s+x.actualValue,0),theoreticalCost=sales.fields.costField?olapCost:recipeTheoryValue,varianceValue=actualValue-theoreticalCost;
    const writeoffValue=rows.reduce((s,x)=>s+Number(x.writeoffValueAtCost||0),0);
    const outgoingValueAtCost=rows.reduce((s,x)=>s+Number(x.outgoingValueAtCost||0),0);
    const unexplainedVariance=varianceValue-writeoffValue;
    const stores=meta.stores.map(x=>({id:x.id,name:x.name})).sort((a,b)=>a.name.localeCompare(b.name,"ru"));
    return json({
      success:true,requestId,from,to,storeId:storeId||null,rows,stores,
      summary:{
        revenue,theoreticalCost,recipeTheoryValue,actualCost:actualValue,varianceValue,variancePct:percent(varianceValue,theoreticalCost),
        theoreticalFoodCostPct:percent(theoreticalCost,revenue),actualFoodCostPct:percent(actualValue,revenue),
        openingValue:[...opening.byProduct.values()].reduce((s,x)=>s+x.sum,0),closingValue:[...closing.byProduct.values()].reduce((s,x)=>s+x.sum,0),
        incomingValue:sumMap(inMap,"value"),outgoingValue:outgoingValueAtCost,transferAdjustmentValue:sumMap(transferMap,"value"),
        documentedWriteoffValue:writeoffValue,unexplainedVariance,soldQty,coveredQty,recipeCoveragePct:soldQty?coveredQty/soldQty*100:0,
        ingredientCount:rows.length
      },
      sources:{
        sales:{ok:true,rows:sales.rows.length,costField:sales.fields.costField||null,matchStats:sales.matchStats,unmatched:sales.unmatched},
        recipes:{ok:meta.chartStatus>=200&&meta.chartStatus<300,count:meta.chartCount,status:meta.chartStatus,from,to},
        openingBalance:{ok:true,rows:opening.rows.length,timestamp:startTs},
        closingBalance:{ok:true,rows:closing.rows.length,timestamp:endTs},
        incoming:{ok:incoming.ok,status:incoming.status,documents:incoming.docs.length},
        outgoing:{ok:outgoing.ok,status:outgoing.status,documents:outgoing.docs.length},
        transfers:{ok:transfers.ok,status:transfers.status,documents:transfers.docs.length},
        writeoffs:{ok:writeoffs.ok,status:writeoffs.status,documents:writeoffs.docs.length}
      },
      meta:{departmentIds,departmentScopeApplied:departmentIds.length>0,metadataCacheHit:meta.cacheHit===true,olapFieldsCacheHit:sales.fieldsCacheHit,theoreticalCostSource:sales.fields.costField?"SALES_OLAP_COST":"RECIPE_ESTIMATE",salesFields:sales.fields,salesMatchStats:sales.matchStats}
    });
  }catch(e){
    console.error("[FOOD-COST]",requestId,e);
    return json({success:false,message:e?.message||"Ошибка расчёта Food Cost",requestId},502);
  }
}
