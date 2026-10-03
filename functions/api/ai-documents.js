import { getUser, loadPrivateIikoState, privateConnection } from "./iiko/_lib/user-state.js";
import { getIikoAuth } from "./iiko/_lib/iiko-client.js";
import { getIikoSuppliers } from "./iiko/_lib/iiko-suppliers.js";
import { syncReferences } from "./iiko/references.js";
import { loadCachedReferenceMaps } from "./iiko/_lib/reference-cache.js";
import { aiProviderStatus, processPurchaseDocument } from "./iiko/_lib/ai-document-providers.js";
import { resolveRestaurantScope } from "./iiko/_lib/restaurant-scope.js";
import { resolveStoreScope } from "./iiko/_lib/store-scope.js";

function cors(){return{
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type, Authorization"
}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...cors()}})}
function clean(v){return String(v??"").trim()}
function id(){return crypto.randomUUID()}
function safeName(name){return clean(name).replace(/[^a-zA-Z0-9._-]+/g,"-").replace(/-+/g,"-").slice(0,120)||"document"}
function key(v){return clean(v).replace(/^\{+|\}+$/g,"").toLowerCase()}
function norm(v){return clean(v).toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[^\p{L}\p{N}]+/gu," ").trim()}
function tokenList(v){return norm(v).split(/\s+/).filter(x=>x.length>1)}
function tokens(v){return new Set(tokenList(v))}
function editSimilarity(a,b){
  const x=norm(a),y=norm(b); if(!x||!y)return 0;
  const m=x.length,n=y.length,prev=Array.from({length:n+1},(_,i)=>i),cur=new Array(n+1);
  for(let i=1;i<=m;i++){
    cur[0]=i;
    for(let j=1;j<=n;j++)cur[j]=Math.min(cur[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));
    for(let j=0;j<=n;j++)prev[j]=cur[j];
  }
  return 1-prev[n]/Math.max(m,n);
}
function tokenSimilarity(a,b){
  const A=tokenList(a),B=tokenList(b); if(!A.length||!B.length)return 0;
  let sum=0;
  for(const x of A){
    let best=0;
    for(const y of B){
      let s=editSimilarity(x,y);
      if(x===y)s=1;
      else if(x.startsWith(y)||y.startsWith(x))s=Math.max(s,.88*Math.min(x.length,y.length)/Math.max(x.length,y.length));
      if(s>best)best=s;
    }
    sum+=best;
  }
  return sum/Math.max(A.length,B.length);
}
function scoreText(a,b){
  const x=norm(a),y=norm(b); if(!x||!y)return 0;
  if(x===y)return 1;
  if(x.includes(y)||y.includes(x))return Math.min(x.length,y.length)/Math.max(x.length,y.length)*.95;
  const A=tokens(x),B=tokens(y);
  let inter=0; for(const t of A)if(B.has(t))inter++;
  const union=new Set([...A,...B]).size;
  const jaccard=union?inter/union:0;
  const edit=editSimilarity(x,y);
  const token=tokenSimilarity(x,y);
  return Math.max(jaccard,edit*.92,token*.96);
}
async function ensure(db){
  if(!db)throw new Error("D1 binding DB не настроен.");
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_documents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      restaurant_id TEXT NOT NULL DEFAULT '',
      file_name TEXT NOT NULL,
      content_type TEXT NOT NULL,
      object_key TEXT NOT NULL,
      size INTEGER NOT NULL DEFAULT 0,
      provider_requested TEXT NOT NULL DEFAULT 'AUTO',
      provider_used TEXT,
      model TEXT,
      status TEXT NOT NULL DEFAULT 'UPLOADED',
      document_type TEXT,
      supplier_name TEXT,
      supplier_id TEXT,
      document_number TEXT,
      invoice_number TEXT,
      incoming_number TEXT,
      document_date TEXT,
      due_date TEXT,
      currency TEXT,
      total REAL,
      vat_total REAL,
      confidence REAL,
      result_json TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_ai_documents_user_created ON ai_documents(user_id, created_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS ai_product_aliases (
      user_id TEXT NOT NULL,
      supplier_key TEXT NOT NULL DEFAULT '',
      source_name TEXT NOT NULL,
      normalized_source TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL,
      times_used INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT NOT NULL,
      PRIMARY KEY(user_id, supplier_key, normalized_source)
    )`)
  ]);
  try{await db.prepare("ALTER TABLE ai_documents ADD COLUMN restaurant_id TEXT NOT NULL DEFAULT ''").run()}catch(_){}
  try{await db.prepare("CREATE INDEX IF NOT EXISTS idx_ai_documents_user_restaurant_created ON ai_documents(user_id, restaurant_id, created_at DESC)").run()}catch(_){}
}
async function auth(request,env){const a=await getUser(request,env);if(!a)return null;await ensure(env.DB);return a}
function publicRow(r){
  if(!r)return null;
  let result=null; try{result=r.result_json?JSON.parse(r.result_json):null}catch{}
  return {
    id:r.id,restaurantId:r.restaurant_id||'',fileName:r.file_name,contentType:r.content_type,size:r.size,
    providerRequested:r.provider_requested,providerUsed:r.provider_used,model:r.model,
    status:r.status,documentType:r.document_type,supplierName:r.supplier_name,supplierId:r.supplier_id,
    documentNumber:r.document_number,invoiceNumber:r.invoice_number,incomingNumber:r.incoming_number,
    documentDate:r.document_date,dueDate:r.due_date,currency:r.currency,total:r.total,vatTotal:r.vat_total,
    confidence:r.confidence,result,errorMessage:r.error_message,createdAt:r.created_at,updatedAt:r.updated_at
  };
}
async function loadPrivateConnection(env,userId){
  const stored=await loadPrivateIikoState(env.DB,userId,env);
  if(!stored?.found)throw new Error("Подключение iiko не найдено.");
  const connection=privateConnection(stored.state);
  if(!connection.ip||!connection.port||!connection.login||!connection.password)throw new Error("Подключение iiko заполнено не полностью.");
  return connection;
}
async function restaurantContext(request,env,userId){
  const stored=await loadPrivateIikoState(env.DB,userId,env);
  if(!stored?.found||!stored?.state)throw new Error("Подключение iiko не найдено.");
  const scope=resolveRestaurantScope({state:stored.state,request,strict:true});
  return {state:stored.state,scope};
}
function rowAllowedForScope(row,scope){
  if(!scope?.isChain)return true;
  const restaurantId=clean(row?.restaurant_id);
  return Boolean(restaurantId&&scope.selectedDepartmentIds.includes(restaurantId));
}
function requireSingleRestaurant(scope){
  if(scope?.isChain&&scope.selectedDepartmentIds.length!==1){
    const error=new Error("Для AI накладных в CHAIN выберите один ресторан.");
    error.status=409;
    error.code="AI_DOCUMENT_SINGLE_RESTAURANT_REQUIRED";
    throw error;
  }
  return clean(scope?.selectedDepartmentIds?.[0]);
}
async function referenceData(env,connection,scope=null){
  const auth=await getIikoAuth(connection);

  // The AI page already warms these D1 reference tables when it loads.
  // Re-downloading and reparsing the whole CHAIN catalog during every OCR
  // request can exceed the Worker CPU budget, especially with large menus.
  let refs=await loadCachedReferenceMaps(env,auth.serverUrl,[],{
    ttlMs:6*60*60*1000,
    requiredKeys:["suppliers","warehouses","products"]
  });
  if(!refs)refs=await syncReferences(env,auth.serverUrl,auth.token);

  const maps=refs.maps||{};
  let suppliers=[...(maps.suppliers?.entries?.()||[])].map(([sid,name])=>({id:key(sid),name:clean(name)})).filter(x=>x.id&&x.name);
  if(!suppliers.length){
    const supplierResult=await getIikoSuppliers(connection);
    suppliers=(supplierResult.rows||[]).map(x=>({id:key(x.id),name:clean(x.name)})).filter(x=>x.id&&x.name);
  }

  const products=[...(maps.products?.entries?.()||[])].map(([pid,name])=>({id:key(pid),name:clean(name)})).filter(x=>x.id&&x.name);
  let warehouses=[...(maps.warehouses?.entries?.()||[])].map(([wid,name])=>({id:key(wid),name:clean(name)})).filter(x=>x.id&&x.name);
  let storeScope=null;
  if(scope?.isChain){
    storeScope=await resolveStoreScope(connection,scope.selectedDepartmentIds||[]);
    if(!storeScope.resolved){
      const error=new Error("Не удалось определить склады выбранного ресторана для AI накладной.");
      error.status=409;
      error.code="AI_DOCUMENT_STORE_SCOPE_UNAVAILABLE";
      throw error;
    }
    const allowed=new Set((storeScope.storeIds||[]).map(key).filter(Boolean));
    warehouses=warehouses.filter(x=>allowed.has(key(x.id)));
  }
  return {suppliers,products,warehouses,storeScope,referenceCacheHit:refs.cacheHit===true};
}
function cheapCandidateScore(sourceNorm,sourceTokens,rowName){
  const rowNorm=norm(rowName);
  if(!sourceNorm||!rowNorm)return{score:0,rowNorm};
  if(rowNorm===sourceNorm)return{score:1,rowNorm};

  let score=0;
  if(rowNorm.includes(sourceNorm)||sourceNorm.includes(rowNorm)){
    score=Math.max(score,.8*Math.min(rowNorm.length,sourceNorm.length)/Math.max(rowNorm.length,sourceNorm.length));
  }

  const rowTokens=tokenList(rowNorm);
  if(sourceTokens.length&&rowTokens.length){
    const wanted=new Set(sourceTokens);
    let inter=0;
    for(const t of rowTokens)if(wanted.has(t))inter++;
    if(inter)score=Math.max(score,.55*inter/Math.max(sourceTokens.length,rowTokens.length));
  }

  let prefix=0;
  while(prefix<sourceNorm.length&&prefix<rowNorm.length&&sourceNorm[prefix]===rowNorm[prefix])prefix++;
  if(prefix>=2)score=Math.max(score,.42*prefix/Math.max(sourceNorm.length,rowNorm.length));
  else if(sourceNorm[0]===rowNorm[0]){
    const ratio=Math.min(sourceNorm.length,rowNorm.length)/Math.max(sourceNorm.length,rowNorm.length);
    if(ratio>=.6)score=Math.max(score,.08*ratio);
  }

  return{score,rowNorm};
}
function bestMatch(source,rows,min=.45){
  const sourceNorm=norm(source);
  if(!sourceNorm)return {match:null,candidates:[]};
  const sourceTokens=tokenList(sourceNorm);
  const shortlist=[];

  for(const r of rows||[]){
    const cheap=cheapCandidateScore(sourceNorm,sourceTokens,r?.name);
    if(cheap.rowNorm===sourceNorm){
      const exact={...r,score:1,exact:true};
      return {match:exact,candidates:[exact]};
    }
    if(cheap.score>0)shortlist.push({r,cheap:cheap.score});
  }

  shortlist.sort((a,b)=>b.cheap-a.cheap);
  const pool=shortlist.slice(0,120).map(x=>x.r);
  const ranked=pool
    .map(r=>({...r,score:Number(scoreText(source,r.name).toFixed(4)),exact:false}))
    .sort((a,b)=>b.score-a.score)
    .slice(0,5);
  const best=ranked[0]||null;
  if(!best||best.score<min)return {match:null,candidates:ranked};

  // Only auto-select a fuzzy result when it is the only genuinely plausible
  // candidate. Generic names such as "pomidor" must not silently choose
  // between Pomidor iri / Pomidor cherry / Pomodor yerli.
  const plausibleFloor=Math.max(min,Math.min(.72,best.score-.16));
  const plausible=ranked.filter(x=>x.score>=plausibleFloor);
  if(plausible.length!==1)return {match:null,candidates:ranked};

  if(best.score<.64)return {match:null,candidates:ranked};
  return {match:best,candidates:ranked};
}
async function aliasMap(db,userId,supplierKey){
  const r=await db.prepare(`SELECT normalized_source,product_id,product_name FROM ai_product_aliases WHERE user_id=?1 AND (supplier_key=?2 OR supplier_key='')`).bind(userId,supplierKey||"").all();
  return new Map((r.results||[]).map(x=>[x.normalized_source,{id:key(x.product_id),name:x.product_name,score:1,source:"MEMORY"}]));
}

function nullableNumber(value){
  if(value===null||value===undefined||String(value).trim()==="")return null;
  const n=Number(value);
  return Number.isFinite(n)?n:null;
}
function moneyCents(value){
  const n=nullableNumber(value);
  return n===null?null:Math.round(n*100);
}
function arithmeticCheck(raw,items){
  const lineIssues=[];
  let expectedCents=0;
  let sourceRowsCents=0;
  let complete=true;

  (items||[]).forEach((item,index)=>{
    const q=nullableNumber(item?.quantity),p=nullableNumber(item?.unitPrice),sourceTotal=nullableNumber(item?.total);
    if(q===null||p===null){
      complete=false;
      return;
    }
    const expected=Math.round(q*p*100);
    expectedCents+=expected;
    const source=moneyCents(sourceTotal);
    if(source===null){
      complete=false;
      return;
    }
    sourceRowsCents+=source;
    if(source!==expected){
      lineIssues.push({
        index:index+1,
        sourceName:item?.sourceName||`Строка ${index+1}`,
        quantity:q,
        unitPrice:p,
        sourceTotal:source/100,
        expectedTotal:expected/100,
        difference:(source-expected)/100
      });
    }
  });

  const declared=moneyCents(raw?.total);
  const totalIssues=[];
  if(declared!==null&&complete){
    if(declared!==expectedCents){
      totalIssues.push({
        type:"DECLARED_VS_CALCULATED",
        declaredTotal:declared/100,
        calculatedTotal:expectedCents/100,
        difference:(declared-expectedCents)/100
      });
    }
    if(declared!==sourceRowsCents){
      totalIssues.push({
        type:"DECLARED_VS_ROWS",
        declaredTotal:declared/100,
        rowsTotal:sourceRowsCents/100,
        difference:(declared-sourceRowsCents)/100
      });
    }
  }

  return {
    valid:lineIssues.length===0&&totalIssues.length===0,
    checked:complete,
    declaredTotal:declared===null?null:declared/100,
    rowsTotal:sourceRowsCents/100,
    calculatedTotal:expectedCents/100,
    lineIssues,
    totalIssues
  };
}

function confirmedDraftFromInput(value){
  const d=value&&typeof value==="object"?value:{};
  const items=Array.isArray(d.items)?d.items.slice(0,500).map((x,index)=>({
    num:Number.isFinite(Number(x?.num))?Number(x.num):index+1,
    sourceName:clean(x?.sourceName),
    productId:key(x?.productId),
    productName:clean(x?.productName),
    amount:Number.isFinite(Number(x?.amount))?Number(x.amount):null,
    actualAmount:Number.isFinite(Number(x?.actualAmount))?Number(x.actualAmount):null,
    price:Number.isFinite(Number(x?.price))?Number(x.price):null,
    sum:Number.isFinite(Number(x?.sum))?Number(x.sum):null
  })).filter(x=>x.productId&&x.amount!==null&&x.price!==null&&x.sum!==null):[];

  return {
    documentNumber:clean(d.documentNumber),
    dateIncoming:clean(d.dateIncoming),
    supplierId:key(d.supplierId),
    defaultStore:key(d.defaultStore||d.defaultStoreId||d.storeId),
    invoice:clean(d.invoice),
    incomingDocumentNumber:clean(d.incomingDocumentNumber),
    dueDate:clean(d.dueDate),
    documentTotal:Number.isFinite(Number(d.documentTotal))?Number(d.documentTotal):null,
    items
  };
}

async function enrich(env,userId,raw,scope=null){
  const connection=await loadPrivateConnection(env,userId);
  const refs=await referenceData(env,connection,scope);
  const supplierResult=bestMatch(raw.supplierName||"",refs.suppliers,.42);
  const supplier=supplierResult.match;
  const aliases=await aliasMap(env.DB,userId,supplier?.id||"");
  const items=(Array.isArray(raw.items)?raw.items:[]).map((x,index)=>{
    const sourceName=clean(x?.sourceName);
    const remembered=aliases.get(norm(sourceName));
    const productResult=remembered?{match:remembered,candidates:[remembered]}:bestMatch(sourceName,refs.products,.48);
    return {
      index:index+1,
      sourceName,
      article:clean(x?.article),
      quantity:nullableNumber(x?.quantity),
      unit:clean(x?.unit),
      unitPrice:nullableNumber(x?.unitPrice),
      total:nullableNumber(x?.total),
      vatPercent:nullableNumber(x?.vatPercent),
      confidence:nullableNumber(x?.confidence),
      productId:productResult.match?.id||null,
      productName:productResult.match?.name||null,
      matchScore:productResult.match?.score??null,
      matchSource:productResult.match?.source||"FUZZY",
      candidates:(productResult.candidates||[]).slice(0,5)
    };
  });
  const unresolved=items.filter(x=>!x.productId).length;
  const arithmetic=arithmeticCheck(raw,items);
  return {
    extracted:raw,
    matching:{
      supplierId:supplier?.id||null,
      supplierName:supplier?.name||raw.supplierName||null,
      supplierMatchScore:supplier?.score??null,
      supplierCandidates:(supplierResult.candidates||[]).slice(0,5),
      // Never auto-pick a warehouse just because only one was returned.
      // Warehouse choice changes inventory balances and must be explicit unless
      // a future trusted rule/memory identifies it.
      defaultStoreId:null,
      defaultStoreName:null,
      storeSelectionRequired:true,
      warehouses:refs.warehouses,
      restaurantId:clean(scope?.selectedDepartmentIds?.[0]),
      warehouseScope:refs.storeScope?{storeIds:refs.storeScope.storeIds||[]}:null,
      items,
      unresolvedItems:unresolved,
      arithmetic,
      ready:Boolean(supplier?.id&&items.length&&!unresolved&&arithmetic.valid)
    }
  };
}
async function rowById(db,userId,docId){return db.prepare(`SELECT * FROM ai_documents WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(docId,userId).first()}
async function objectAsFile(env,row){
  if(!env.ASSET_FILES)throw new Error("R2 binding ASSET_FILES не настроен.");
  const obj=await env.ASSET_FILES.get(row.object_key); if(!obj)throw new Error("Файл не найден в R2.");
  const bytes=await obj.arrayBuffer();
  return new File([bytes],row.file_name,{type:row.content_type||"application/octet-stream"});
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){
  try{
    const a=await auth(request,env); if(!a)return json({success:false,message:"Требуется авторизация"},401);
    const {scope}=await restaurantContext(request,env,a.user.id);
    const u=new URL(request.url),docId=clean(u.searchParams.get("id")),fileId=clean(u.searchParams.get("file"));
    if(fileId){
      const row=await rowById(env.DB,a.user.id,fileId); if(!row||!rowAllowedForScope(row,scope))return json({success:false,message:"Документ не найден в выбранном ресторане"},404);
      if(!env.ASSET_FILES)return json({success:false,message:"R2 binding ASSET_FILES не настроен"},503);
      const obj=await env.ASSET_FILES.get(row.object_key); if(!obj)return json({success:false,message:"Файл отсутствует в R2"},404);
      return new Response(obj.body,{headers:{"Content-Type":row.content_type||"application/octet-stream","Content-Disposition":`inline; filename="${safeName(row.file_name)}"`,"Cache-Control":"private, max-age=300",...cors()}});
    }
    if(docId){
      const row=await rowById(env.DB,a.user.id,docId); if(!row||!rowAllowedForScope(row,scope))return json({success:false,message:"Документ не найден в выбранном ресторане"},404);
      return json({success:true,document:publicRow(row),providers:aiProviderStatus(env),storageConfigured:Boolean(env.ASSET_FILES)});
    }
    const selected=scope.isChain?scope.selectedDepartmentIds:[];
    let r;
    if(scope.isChain){
      const placeholders=selected.map((_,i)=>`?${i+2}`).join(",");
      r=selected.length
        ?await env.DB.prepare(`SELECT * FROM ai_documents WHERE user_id=?1 AND restaurant_id IN (${placeholders}) ORDER BY created_at DESC LIMIT 100`).bind(a.user.id,...selected).all()
        :{results:[]};
    }else{
      r=await env.DB.prepare(`SELECT * FROM ai_documents WHERE user_id=?1 ORDER BY created_at DESC LIMIT 100`).bind(a.user.id).all();
    }
    return json({success:true,documents:(r.results||[]).map(publicRow),providers:aiProviderStatus(env),storageConfigured:Boolean(env.ASSET_FILES),restaurantScope:{mode:scope.mode,departmentIds:scope.selectedDepartmentIds}});
  }catch(e){return json({success:false,message:e.message||String(e)},500)}
}
export async function onRequestPost({request,env}){
  try{
    const a=await auth(request,env); if(!a)return json({success:false,message:"Требуется авторизация"},401);
    const {scope}=await restaurantContext(request,env,a.user.id);
    const contentType=request.headers.get("Content-Type")||"";
    if(contentType.includes("multipart/form-data")){
      if(!env.ASSET_FILES)return json({success:false,message:"R2 binding ASSET_FILES не настроен."},503);
      const form=await request.formData(),file=form.get("file"),provider=clean(form.get("provider")||"AUTO").toUpperCase();
      if(!(file instanceof File))return json({success:false,message:"Выберите PDF или изображение."},400);
      const type=clean(file.type)||"application/octet-stream";
      if(!(type==="application/pdf"||type.startsWith("image/")))return json({success:false,message:"Поддерживаются PDF и изображения."},400);
      if(file.size>20*1024*1024)return json({success:false,message:"Максимальный размер документа 20 МБ."},400);
      if(!["AUTO","LOCAL","OPENAI"].includes(provider))return json({success:false,message:"Неизвестный AI-провайдер."},400);
      const restaurantId=requireSingleRestaurant(scope);
      const docId=id(),now=new Date().toISOString(),objectKey=`ai-documents/${a.user.id}/${docId}-${safeName(file.name)}`;
      await env.ASSET_FILES.put(objectKey,await file.arrayBuffer(),{httpMetadata:{contentType:type},customMetadata:{userId:a.user.id,documentId:docId}});
      await env.DB.prepare(`INSERT INTO ai_documents(id,user_id,restaurant_id,file_name,content_type,object_key,size,provider_requested,status,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'UPLOADED',?9,?9)`)
        .bind(docId,a.user.id,restaurantId,clean(file.name),type,objectKey,file.size,provider,now).run();
      const row=await rowById(env.DB,a.user.id,docId);
      return json({success:true,document:publicRow(row)},201);
    }

    const b=await request.json().catch(()=>({})),action=clean(b.action);
    if(action==="process"){
      const docId=clean(b.id),row=await rowById(env.DB,a.user.id,docId); if(!row||!rowAllowedForScope(row,scope))return json({success:false,message:"Документ не найден в выбранном ресторане"},404);
      const provider=clean(b.provider||row.provider_requested||"AUTO").toUpperCase(),now=new Date().toISOString();
      await env.DB.prepare(`UPDATE ai_documents SET status='PROCESSING',provider_requested=?1,error_message=NULL,updated_at=?2 WHERE id=?3 AND user_id=?4`).bind(provider,now,docId,a.user.id).run();
      try{
        const file=await objectAsFile(env,row);
        const processed=await processPurchaseDocument(env,file,provider);
        const result=await enrich(env,a.user.id,processed.data||{},scope);
        const raw=result.extracted||{},matching=result.matching||{};
        const status=matching.ready?"READY":(matching.items?.length?"REVIEW":"REVIEW");
        await env.DB.prepare(`UPDATE ai_documents SET provider_used=?1,model=?2,status=?3,document_type=?4,supplier_name=?5,supplier_id=?6,document_number=?7,invoice_number=?8,incoming_number=?9,document_date=?10,due_date=?11,currency=?12,total=?13,vat_total=?14,confidence=?15,result_json=?16,error_message=NULL,updated_at=?17 WHERE id=?18 AND user_id=?19`)
          .bind(processed.provider,processed.model,status,clean(raw.documentType),clean(matching.supplierName||raw.supplierName),clean(matching.supplierId),clean(raw.documentNumber),clean(raw.invoiceNumber),clean(raw.incomingNumber),clean(raw.date),clean(raw.dueDate),clean(raw.currency),raw.total??null,raw.vatTotal??null,raw.confidence??null,JSON.stringify({...result,provider:{name:processed.provider,model:processed.model,usage:processed.usage||null,responseId:processed.providerResponseId||null}}),new Date().toISOString(),docId,a.user.id).run();
      }catch(error){
        await env.DB.prepare(`UPDATE ai_documents SET status='ERROR',error_message=?1,updated_at=?2 WHERE id=?3 AND user_id=?4`).bind(String(error?.message||error).slice(0,1500),new Date().toISOString(),docId,a.user.id).run();
      }
      const updated=await rowById(env.DB,a.user.id,docId);
      return json({success:updated.status!=="ERROR",document:publicRow(updated),message:updated.error_message||null},updated.status==="ERROR"?422:200);
    }
    if(action==="saveAlias"){
      const sourceName=clean(b.sourceName),productId=key(b.productId),productName=clean(b.productName),supplierKey=key(b.supplierId);
      if(!sourceName||!productId||!productName)return json({success:false,message:"Недостаточно данных для запоминания сопоставления."},400);
      const n=norm(sourceName),now=new Date().toISOString();
      await env.DB.prepare(`INSERT INTO ai_product_aliases(user_id,supplier_key,source_name,normalized_source,product_id,product_name,times_used,last_used_at) VALUES(?1,?2,?3,?4,?5,?6,1,?7) ON CONFLICT(user_id,supplier_key,normalized_source) DO UPDATE SET product_id=excluded.product_id,product_name=excluded.product_name,times_used=ai_product_aliases.times_used+1,last_used_at=excluded.last_used_at`)
        .bind(a.user.id,supplierKey,sourceName,n,productId,productName,now).run();
      return json({success:true});
    }
    if(action==="markImported"){
      const docId=clean(b.id),row=await rowById(env.DB,a.user.id,docId); if(!row||!rowAllowedForScope(row,scope))return json({success:false,message:"Документ не найден в выбранном ресторане"},404);
      const result=publicRow(row).result||{};
      const confirmedDraft=confirmedDraftFromInput(b.draft);
      result.confirmedDraft=confirmedDraft;
      result.imported={
        documentNumber:clean(b.documentNumber)||confirmedDraft.documentNumber,
        processed:Boolean(b.processed),
        at:new Date().toISOString()
      };
      await env.DB.prepare(`UPDATE ai_documents
        SET status='IMPORTED',
            document_number=COALESCE(NULLIF(?1,''),document_number),
            supplier_id=COALESCE(NULLIF(?2,''),supplier_id),
            document_date=COALESCE(NULLIF(?3,''),document_date),
            due_date=COALESCE(NULLIF(?4,''),due_date),
            total=COALESCE(?5,total),
            result_json=?6,
            error_message=NULL,
            updated_at=?7
        WHERE id=?8 AND user_id=?9`)
        .bind(
          clean(b.documentNumber)||confirmedDraft.documentNumber,
          confirmedDraft.supplierId,
          confirmedDraft.dateIncoming?confirmedDraft.dateIncoming.slice(0,10):"",
          confirmedDraft.dueDate?confirmedDraft.dueDate.slice(0,10):"",
          confirmedDraft.documentTotal,
          JSON.stringify(result),
          new Date().toISOString(),
          docId,
          a.user.id
        ).run();
      return json({success:true,document:publicRow(await rowById(env.DB,a.user.id,docId))});
    }
    if(action==="delete"){
      const docId=clean(b.id),row=await rowById(env.DB,a.user.id,docId); if(!row||!rowAllowedForScope(row,scope))return json({success:false,message:"Документ не найден в выбранном ресторане"},404);
      if(env.ASSET_FILES)await env.ASSET_FILES.delete(row.object_key);
      await env.DB.prepare(`DELETE FROM ai_documents WHERE id=?1 AND user_id=?2`).bind(docId,a.user.id).run();
      return json({success:true});
    }
    return json({success:false,message:"Неизвестное действие"},400);
  }catch(e){return json({success:false,message:e.message||String(e)},500)}
}
