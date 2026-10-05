import { clean, iikoText } from "./_lib/iiko-client.js";

function corsHeaders(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...corsHeaders()}})}
function xmlDecode(v){return String(v||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").trim()}
function xmlName(text){const m=String(text||'').match(/<(?:department|corporateItemDto|corporateItem|item|entity)\b[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/\1>/i);return m?xmlDecode(m[1].replace(/<[^>]+>/g,'')):''}
export async function onRequestOptions(){return new Response(null,{status:204,headers:corsHeaders()})}
export async function onRequestPost({request}){try{
  const b=await request.json();
  const connection={ip:clean(b.ip),port:clean(b.port),login:clean(b.login),password:String(b.password??'')};
  if(!connection.ip||!connection.port||!connection.login||!connection.password)throw Error('Заполните IP, порт, логин и пароль iiko');
  const r=await iikoText(connection,'/resto/api/corporation/departments',{headers:{Accept:'application/json, application/xml, text/xml'}});
  const text=r.text;if(!r.ok)throw Error(`Не удалось получить название ресторана: HTTP ${r.status}`);
  const wanted=new Set((Array.isArray(b.departmentIds)?b.departmentIds:[]).map(String).filter(Boolean));
  let rows=[];
  try{
    const p=JSON.parse(text||'{}');
    const items=Array.isArray(p)?p:(Array.isArray(p.items)?p.items:Array.isArray(p.departments)?p.departments:Array.isArray(p.corporateItems)?p.corporateItems:Array.isArray(p.data)?p.data:[]);
    rows=items.map(x=>({id:clean(x?.id??x?.Id??x?.uuid??x?.UUID),name:clean(x?.name??x?.Name??x?.code??x?.Code)})).filter(x=>x.id&&x.name);
  }catch{}
  if(wanted.size&&rows.length)rows=rows.filter(x=>wanted.has(x.id));
  const names=[...new Set(rows.map(x=>x.name).filter(Boolean))];
  let name=names.length===1?names[0]:(names.length>1?`${names.length} ресторанов`:xmlName(text));
  if(!name)throw Error('iiko Server не вернул название ресторана');
  return json({success:true,restaurantName:name,restaurantNames:names,departments:rows,source:'iiko-server-local-departments',meta:{sharedIikoClient:true,authCacheHit:r.auth?.cacheHit===true,departmentIds:[...wanted],departmentScopeApplied:wanted.size>0}});
}catch(e){return json({success:false,message:e?.message||'Ошибка получения названия ресторана'},502)}}