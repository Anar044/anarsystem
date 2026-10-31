import {pluginBackendUrl,pluginBackendHeaders} from '../../plugin/_lib/backend-upstream.js';
import {fail,clean} from './orders.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const same=(a,b)=>clean(a,100).toLowerCase()===clean(b,100).toLowerCase();
const limit=(value,n=96)=>clean(value,n);
const rows=data=>Array.isArray(data)?data:
  Array.isArray(data?.plugins)?data.plugins:
  Array.isArray(data?.data)?data.data:
  Array.isArray(data?.items)?data.items:[];

/**
 * The user's POS choice must come from the authenticated server-side registry,
 * never from the browser, localStorage or a cross-restaurant plugin list.
 * Only a minimal sanitized set of display fields is returned; POS event
 * payloads, backend tokens and restaurant-wide group data are not exposed.
 */
export async function registeredPosRegisters(env,restaurantId){
  const departmentId=clean(restaurantId,100);
  if(!uuid.test(departmentId))
    throw fail('QR_RESTAURANT_ID_INVALID','Выбранный ресторан не имеет корректного ID',409);
  const url=new URL(pluginBackendUrl(env,'/api/plugin/data'));
  url.searchParams.set('departmentIds',departmentId);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),8000);
  let reply;
  try{
    reply=await fetch(url.toString(),{
      method:'GET',
      headers:pluginBackendHeaders(env,{Accept:'application/json'}),
      signal:controller.signal
    });
    if(!reply.ok)throw new Error('Registry HTTP '+reply.status);
    const data=await reply.json();
    if(data?.success===false)throw new Error('Registry rejected request');
    const found=new Map();
    for(const raw of rows(data).slice(0,500)){
      const item=raw?.data&&typeof raw.data==='object'?{...raw.data,...raw}:raw;
      const pluginId=limit(item?.pluginId,100);
      if(!uuid.test(pluginId)||!same(item?.departmentId,departmentId))continue;
      const candidate={
        pluginId,
        name:limit(item?.pluginName)||'Касса без имени',
        departmentId,
        departmentName:limit(item?.departmentName),
        groupName:limit(item?.groupName),
        version:limit(item?.version,48),
        online:item?.online===true,
        lastEventAt:limit(item?.lastEventAt,48)
      };
      const key=pluginId.toLowerCase();
      const previous=found.get(key);
      if(!previous||(!previous.online&&candidate.online))found.set(key,candidate);
    }
    return [...found.values()].sort((a,b)=>Number(b.online)-Number(a.online)||
      a.name.localeCompare(b.name,'ru'));
  }catch(error){
    // Diagnose the upstream failure in server-only logs. Never log the URL,
    // upstream response body, request headers, access tokens or restaurant data.
    const reason = /^Registry HTTP ([0-9]{3})$/.exec(String(error?.message||''))?.[1];
    const kind = reason ? 'UPSTREAM_HTTP_'+reason
      : error?.name==='AbortError' ? 'UPSTREAM_TIMEOUT'
      : error?.name==='SyntaxError' ? 'UPSTREAM_INVALID_JSON'
      : error?.message==='Registry rejected request' ? 'UPSTREAM_REJECTED'
      : 'UPSTREAM_FETCH_FAILED';
    console.error('QR_POS_REGISTER_LOOKUP_FAILED',kind,String(error?.name||'unknown').slice(0,40));
    // No raw backend details (URL, credentials or response) reach the client.
    throw fail('QR_PLUGIN_REGISTRY_UNAVAILABLE',
      'Не удалось получить кассы выбранного ресторана. Проверьте связь Smart Horeca с сервером.',502);
  }finally{clearTimeout(timer)}
}
