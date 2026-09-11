function corsHeaders(){return {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...corsHeaders()}})}
async function sha1(text){const h=await crypto.subtle.digest('SHA-1',new TextEncoder().encode(text));return Array.from(new Uint8Array(h)).map(x=>x.toString(16).padStart(2,'0')).join('')}
async function auth(connection){const ip=String(connection?.ip||'').trim(),port=String(connection?.port||'').trim(),login=String(connection?.login||'').trim(),password=String(connection?.password||'');if(!ip||!port||!login||!password)throw new Error('Нет подключения iiko Server');const base=`http://${ip}:${port}`,pass=await sha1(password),r=await fetch(`${base}/resto/api/auth?login=${encodeURIComponent(login)}&pass=${pass}`),token=(await r.text()).trim();if(!r.ok||!token)throw new Error(`Ошибка авторизации iiko Server: HTTP ${r.status}`);return{base,token}}
function url(base,path,token,params={}){const q=new URLSearchParams({key:token});for(const[k,v]of Object.entries(params)){if(v===undefined||v===null||v==='')continue;if(Array.isArray(v))v.forEach(x=>q.append(k,String(x)));else q.set(k,String(v))}return`${base}${path}?${q}`}
async function call(action,connection,params={},payload=null){const{base,token}=await auth(connection);let path,method='GET',body;
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
const r=await fetch(url(base,path,token,params),{method,headers:{Accept:'application/json',...(method==='POST'?{'Content-Type':'application/json'}:{})},body:method==='POST'?JSON.stringify(body??{}):undefined});const text=(await r.text()).trim();let data;try{data=text?JSON.parse(text):null}catch{data={raw:text}}if(!r.ok)throw new Error(`iiko API HTTP ${r.status}: ${text.slice(0,1200)}`);return data}
export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()})}
export async function onRequestPost({request}){try{const b=await request.json();const data=await call(String(b.action||''),b.connection,b.params||{},b.payload??null);return json({success:true,data})}catch(e){return json({success:false,message:e?.message||'Ошибка iiko API'},502)}}
export async function onRequestGet({request}){try{const q=new URL(request.url).searchParams,connection=JSON.parse(q.get('connection')||'{}'),action=q.get('action')||'',params={};q.forEach((v,k)=>{if(k==='connection'||k==='action')return;if(params[k]===undefined)params[k]=v;else params[k]=Array.isArray(params[k])?[...params[k],v]:[params[k],v]});const data=await call(action,connection,params,null);return json({success:true,data})}catch(e){return json({success:false,message:e?.message||'Ошибка iiko API'},502)}}