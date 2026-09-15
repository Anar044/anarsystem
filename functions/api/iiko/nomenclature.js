import { clean, iikoJson, sha1 } from './_lib/iiko-client.js';

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
async function call(action,connection,params={},payload=null){const c=normalizeConnection(connection);const spec=actionSpec(action,params,payload);const r=await iikoJson(c,spec.path,{method:spec.method,headers:spec.method==='POST'?{'Content-Type':'application/json'}:{},body:spec.method==='POST'?JSON.stringify(spec.body??{}):undefined});if(!r.ok)throw new Error(`iiko API HTTP ${r.status}: ${r.text.slice(0,1200)}`);return r.payload}
async function bootstrap(connection,params={}){const listParams={includeDeleted:params.includeDeleted!==false};const [products,groups,categories,scales]=await Promise.all([call('products.list',connection,listParams),call('groups.list',connection,listParams),call('categories.list',connection,listParams),call('scales.list',connection,listParams)]);return{products,groups,categories,scales}}
async function cachedBootstrap(connection,params={},options={}){const baseKey=await connectionCacheKey(connection);const includeDeleted=params.includeDeleted!==false;const key=`${baseKey}|bootstrap|${includeDeleted?'all':'active'}`;const now=Date.now();const cached=bootstrapCache.get(key);if(!options.force&&cached?.data&&cached.expiresAt>now)return{...cached.data,__cacheHit:true};if(!options.force){const pending=bootstrapInFlight.get(key);if(pending)return pending}const pending=(async()=>{const data=await bootstrap(connection,{includeDeleted});bootstrapCache.set(key,{data,expiresAt:Date.now()+BOOTSTRAP_TTL_MS});return{...data,__cacheHit:false}})().finally(()=>{if(bootstrapInFlight.get(key)===pending)bootstrapInFlight.delete(key)});bootstrapInFlight.set(key,pending);return pending}
async function clearBootstrapCache(connection){const baseKey=await connectionCacheKey(connection);for(const key of [...bootstrapCache.keys()])if(key.startsWith(`${baseKey}|bootstrap|`))bootstrapCache.delete(key);for(const key of [...bootstrapInFlight.keys()])if(key.startsWith(`${baseKey}|bootstrap|`))bootstrapInFlight.delete(key)}
function canUseListBundle(params={}){return Object.keys(params||{}).every(key=>key==='includeDeleted')}
function isMutation(action){return /\.(save|update|delete|restore|assign)$/.test(action)||/^charts\.(save|update|delete)$/.test(action)}
async function resolveAction(action,connection,params={},payload=null){if(action==='bootstrap')return cachedBootstrap(connection,params);const bundleKey=LIST_ACTIONS[action];if(bundleKey&&canUseListBundle(params)){const bundle=await cachedBootstrap(connection,params);return bundle[bundleKey]}const data=await call(action,connection,params,payload);if(isMutation(action))await clearBootstrapCache(connection);return data}
export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()})}
export async function onRequestPost({request}){try{const b=await request.json();const action=String(b.action||'');const data=await resolveAction(action,b.connection,b.params||{},b.payload??null);return json({success:true,data})}catch(e){return json({success:false,message:e?.message||'Ошибка iiko API'},502)}}
export async function onRequestGet({request}){try{const q=new URL(request.url).searchParams,connection=JSON.parse(q.get('connection')||'{}'),action=q.get('action')||'',params={};q.forEach((v,k)=>{if(k==='connection'||k==='action')return;if(params[k]===undefined)params[k]=v;else params[k]=Array.isArray(params[k])?[...params[k],v]:[params[k],v]});const data=await resolveAction(action,connection,params,null);return json({success:true,data})}catch(e){return json({success:false,message:e?.message||'Ошибка iiko API'},502)}}
