import { clean, iikoJson, sha1 } from './_lib/iiko-client.js';
import { logAuditEvent } from '../_lib/audit-log.js';

const bootstrapCache=new Map();
const bootstrapInFlight=new Map();
const BOOTSTRAP_TTL_MS=20*1000;
const LIST_ACTIONS={
  'products.list':'products',
  'groups.list':'groups',
  'categories.list':'categories',
  'scales.list':'scales'
};

function corsHeaders(){return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...corsHeaders()}})}
function buildPath(path,params={}){const q=new URLSearchParams();for(const[k,v]of Object.entries(params)){if(v===undefined||v===null||v==='')continue;if(Array.isArray(v))v.forEach(x=>q.append(k,String(x)));else q.set(k,String(v))}const s=q.toString();return s?`${path}?${s}`:path}
function normalizeConnection(connection){const c={ip:clean(connection?.ip),port:clean(connection?.port),login:clean(connection?.login),password:String(connection?.password||'')};if(!c.ip||!c.port||!c.login||!c.password)throw new Error('Нет подключения iiko Server');return c}
async function connectionCacheKey(connection){const c=normalizeConnection(connection);return `${c.ip}:${c.port}|${c.login}|${await sha1(c.password)}`}
function actionSpec(action,params={},payload=null){let path,method='GET',body;
switch(action){
case'products.list':path='/resto/api/v2/entities/products/list';break;
case'products.save':path='/resto/api/v2/entities/products/save';method='POST';body=payload;break;
case'products.update':path='/resto/api/v2/entities/products/update';method='POST';body=payload;break;
case'products.delete':path='/resto/api/v2/entities/products/delete';method='POST';body=payload;break;
case'products.restore':path='/resto/api/v2/entities/products/restore';method='POST';body=payload;break;
case'groups.list':path='/resto/api/v2/entities/products/group/list';break;
case'groups.save':path='/resto/api/v2/entities/products/group/save';method='POST';body=payload;break;
case'groups.update':path='/resto/api/v2/entities/products/group/update';method='POST';body=payload;break;
case'groups.delete':path='/resto/api/v2/entities/products/group/delete';method='POST';body=payload;break;
case'groups.restore':path='/resto/api/v2/entities/products/group/restore';method='POST';body=payload;break;
case'categories.list':path='/resto/api/v2/entities/products/category/list';break;
case'categories.save':path='/resto/api/v2/entities/products/category/save';method='POST';body=payload;break;
case'categories.update':path='/resto/api/v2/entities/products/category/update';method='POST';body=payload;break;
case'categories.delete':path='/resto/api/v2/entities/products/category/delete';method='POST';body=payload;break;
case'categories.restore':path='/resto/api/v2/entities/products/category/restore';method='POST';body=payload;break;
case'scales.list':path='/resto/api/v2/entities/productScales';break;
case'scales.save':path='/resto/api/v2/entities/productScales/save';method='POST';body=payload;break;
case'scales.update':path='/resto/api/v2/entities/productScales/update';method='POST';body=payload;break;
case'scales.delete':path='/resto/api/v2/entities/productScales/delete';method='POST';body=payload;break;
case'scales.restore':path='/resto/api/v2/entities/productScales/restore';method='POST';body=payload;break;
case'scales.byProduct':path=`/resto/api/v2/entities/products/${encodeURIComponent(params.productId)}/productScale`;break;
case'scales.byProducts':path='/resto/api/v2/entities/products/productScales';break;
case'scales.assign':path=`/resto/api/v2/entities/products/${encodeURIComponent(params.productId)}/productScale`;method='POST';body=payload;break;
case'images.load':path='/resto/api/v2/images/load';break;
case'charts.all':path='/resto/api/v2/assemblyCharts/getAll';break;
case'charts.allUpdate':path='/resto/api/v2/assemblyCharts/getAllUpdate';break;
case'charts.byId':path='/resto/api/v2/assemblyCharts/byId';break;
case'charts.tree':path='/resto/api/v2/assemblyCharts/getTree';break;
case'charts.assembled':path='/resto/api/v2/assemblyCharts/getAssembled';break;
case'charts.prepared':path='/resto/api/v2/assemblyCharts/getPrepared';break;
case'charts.history':path='/resto/api/v2/assemblyCharts/getHistory';break;
case'charts.save':path='/resto/api/v2/assemblyCharts/save';method='POST';body=payload;break;
case'charts.update':path='/resto/api/v2/assemblyCharts/update';method='POST';body=payload;break;
case'charts.delete':path='/resto/api/v2/assemblyCharts/delete';method='POST';body=payload;break;
default:throw new Error('Неизвестная операция номенклатурного API')}
return{path:buildPath(path,params),method,body}}
function sanitizeContainerForWrite(x={}){
  return{
    num:clean(x.num),
    name:clean(x.name),
    count:Number(x.count||0),
    minContainerWeight:Number(x.minContainerWeight||0),
    maxContainerWeight:Number(x.maxContainerWeight||0),
    containerWeight:Number(x.containerWeight||0),
    fullContainerWeight:Number(x.fullContainerWeight||0),
    useInFront:x.useInFront===true
  };
}
function sanitizeMutationPayload(action,payload){
  if(!payload||typeof payload!=="object")return payload;
  if(action==="products.save"||action==="products.update"){
    const next={...payload};
    if(Array.isArray(payload.containers)){
      next.containers=payload.containers
        .filter(x=>x&&x.deleted!==true&&Number(x.count)>0)
        .map(sanitizeContainerForWrite);
    }
    delete next.deleted;
    delete next.useBalanceForSell;
    return next;
  }
  return payload;
}
async function call(action,connection,params={},payload=null){const c=normalizeConnection(connection);const safePayload=sanitizeMutationPayload(action,payload);const spec=actionSpec(action,params,safePayload);const r=await iikoJson(c,spec.path,{method:spec.method,headers:spec.method==='POST'?{'Content-Type':'application/json'}:{},body:spec.method==='POST'?JSON.stringify(spec.body??{}):undefined});if(!r.ok)throw new Error(`iiko API HTTP ${r.status}: ${r.text.slice(0,1200)}`);return r.payload}
async function bootstrap(connection,params={}){const listParams={includeDeleted:params.includeDeleted!==false};const [products,groups,categories,scales]=await Promise.all([call('products.list',connection,listParams),call('groups.list',connection,listParams),call('categories.list',connection,listParams),call('scales.list',connection,listParams)]);return{products,groups,categories,scales}}
async function cachedBootstrap(connection,params={},options={}){const baseKey=await connectionCacheKey(connection);const includeDeleted=params.includeDeleted!==false;const key=`${baseKey}|bootstrap|${includeDeleted?'all':'active'}`;const now=Date.now();const cached=bootstrapCache.get(key);if(!options.force&&cached?.data&&cached.expiresAt>now)return{...cached.data,__cacheHit:true};if(!options.force){const pending=bootstrapInFlight.get(key);if(pending)return pending}const pending=(async()=>{const data=await bootstrap(connection,{includeDeleted});bootstrapCache.set(key,{data,expiresAt:Date.now()+BOOTSTRAP_TTL_MS});return{...data,__cacheHit:false}})().finally(()=>{if(bootstrapInFlight.get(key)===pending)bootstrapInFlight.delete(key)});bootstrapInFlight.set(key,pending);return pending}
async function clearBootstrapCache(connection){const baseKey=await connectionCacheKey(connection);for(const key of [...bootstrapCache.keys()])if(key.startsWith(`${baseKey}|bootstrap|`))bootstrapCache.delete(key);for(const key of [...bootstrapInFlight.keys()])if(key.startsWith(`${baseKey}|bootstrap|`))bootstrapInFlight.delete(key)}
function canUseListBundle(params={}){return Object.keys(params||{}).every(key=>key==='includeDeleted'||key==='force')}
function isMutation(action){return /\.(save|update|delete|restore|assign)$/.test(action)||/^charts\.(save|update|delete)$/.test(action)}
function rowsOf(value){return Array.isArray(value)?value:Array.isArray(value?.items)?value.items:Array.isArray(value?.data)?value.data:Array.isArray(value?.response)?value.response:[]}
function mutationEntityType(action){
  if(action.startsWith('products.'))return 'NOMENCLATURE_PRODUCT';
  if(action.startsWith('groups.'))return 'NOMENCLATURE_GROUP';
  if(action.startsWith('categories.'))return 'NOMENCLATURE_CATEGORY';
  if(action.startsWith('scales.'))return 'PRODUCT_SCALE';
  if(action.startsWith('charts.'))return 'ASSEMBLY_CHART';
  return 'NOMENCLATURE';
}
function mutationVerb(action){return String(action.split('.').pop()||'UPDATE').toUpperCase()}
function payloadEntityId(action,params={},payload=null){
  if(action==='scales.assign')return clean(params.productId);
  const candidates=[
    payload?.id,
    payload?.items?.[0]?.id,
    payload?.productGroups?.items?.[0]?.id,
    payload?.products?.items?.[0]?.id,
    params?.id,
    params?.productId
  ];
  return clean(candidates.find(Boolean));
}
async function mutationBefore(action,connection,params={},payload=null){
  const id=payloadEntityId(action,params,payload);
  if(!id)return null;
  if(action.startsWith('charts.')){
    if(action==='charts.save')return null;
    try{
      const raw=await call('charts.byId',connection,{id},null);
      return raw?.assemblyCharts?.[0]||raw?.response||raw?.data||raw||null;
    }catch{return null}
  }
  if(action==='scales.assign'){
    try{
      const raw=await call('scales.byProduct',connection,{productId:id},null);
      return raw?.response||raw?.data||raw||null;
    }catch{return null}
  }
  const bucket=action.startsWith('products.')?'products':action.startsWith('groups.')?'groups':action.startsWith('categories.')?'categories':action.startsWith('scales.')?'scales':null;
  if(!bucket)return null;
  try{
    const bundle=await cachedBootstrap(connection,{includeDeleted:true});
    return rowsOf(bundle?.[bucket]).find(x=>clean(x?.id)===id)||null;
  }catch{return null}
}
function mutationAfter(action,before,payload){
  const verb=mutationVerb(action);
  if(verb==='DELETE')return before?{...before,deleted:true}:payload;
  if(verb==='RESTORE')return before?{...before,deleted:false}:payload;
  if(verb==='UPDATE')return before&&payload&&typeof payload==='object'?{...before,...payload}:payload;
  return payload;
}
async function resolveAction(action,connection,params={},payload=null){
  if(action==='bootstrap'){
    const {force=false,...listParams}=params||{};
    return cachedBootstrap(connection,listParams,{force:force===true});
  }
  const bundleKey=LIST_ACTIONS[action];
  if(bundleKey&&canUseListBundle(params)){
    const {force=false,...listParams}=params||{};
    const bundle=await cachedBootstrap(connection,listParams,{force:force===true});
    return bundle[bundleKey];
  }
  const data=await call(action,connection,params,payload);
  if(isMutation(action))await clearBootstrapCache(connection);
  return data
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()})}
export async function onRequestPost(context){try{
  const b=await context.request.json();
  const action=String(b.action||'');
  const params=b.params||{},payload=b.payload??null;
  const mutation=isMutation(action);
  const before=mutation?await mutationBefore(action,b.connection,params,payload):null;
  const data=await resolveAction(action,b.connection,params,payload);
  let audit=null;
  if(mutation){
    const id=payloadEntityId(action,params,payload)||clean(data?.id);
    const after=mutationAfter(action,before,payload);
    const label=clean(after?.name||before?.name||after?.assembledProductId||before?.assembledProductId||id);
    audit=await logAuditEvent({
      request:context.request,
      env:context.env,
      connection:b.connection,
      action:mutationVerb(action),
      entityType:mutationEntityType(action),
      entityId:id,
      entityLabel:label,
      before,
      after,
      restaurantIds:Array.isArray(b.departmentIds)?b.departmentIds:[],
      restaurantNames:Array.isArray(b?.chainScope?.selectedDepartmentNames)?b.chainScope.selectedDepartmentNames:[],
      metadata:{apiAction:action,params,scope:String(b?.chainScope?.mode||'').toUpperCase()==='CHAIN'?'CHAIN_SHARED':'RMS'}
    });
  }
  return json({success:true,data,audit:audit?{logged:audit.logged===true,changes:audit.changes||0}:undefined});
}catch(e){return json({success:false,message:e?.message||'Ошибка iiko API'},502)}}
export async function onRequestGet({request}){try{const q=new URL(request.url).searchParams,connection=JSON.parse(q.get('connection')||'{}'),action=q.get('action')||'',params={};q.forEach((v,k)=>{if(k==='connection'||k==='action')return;if(params[k]===undefined)params[k]=v;else params[k]=Array.isArray(params[k])?[...params[k],v]:[params[k],v]});const data=await resolveAction(action,connection,params,null);return json({success:true,data})}catch(e){return json({success:false,message:e?.message||'Ошибка iiko API'},502)}}
