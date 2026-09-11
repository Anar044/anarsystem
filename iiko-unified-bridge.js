(function(){
  'use strict';
  const KEYS=new Set(['iikoConnection','iikoDepartmentIdentity']);
  const storage=window.localStorage;
  const get0=Storage.prototype.getItem,set0=Storage.prototype.setItem,remove0=Storage.prototype.removeItem;
  const shadow={iikoConnection:null,iikoDepartmentIdentity:null};
  let loaded=false;
  function patchStorage(){
    Storage.prototype.getItem=function(key){if(this===storage&&KEYS.has(String(key))){const v=shadow[String(key)];return v==null?null:JSON.stringify(v)}return get0.call(this,key)};
    Storage.prototype.setItem=function(key,value){if(this===storage&&KEYS.has(String(key))){try{shadow[String(key)]=JSON.parse(String(value))}catch{shadow[String(key)]=String(value)}return}return set0.call(this,key,value)};
    Storage.prototype.removeItem=function(key){if(this===storage&&KEYS.has(String(key))){shadow[String(key)]=null;return}return remove0.call(this,key)};
  }
  function selectedIds(){try{return window.SH_IikoContext?.getSelectedDepartmentIds?.()||window.SH_IikoContext?.departmentIds?.(window.SH_IikoContext?.getCached?.())||[]}catch{return[]}}
  const fetch0=window.fetch.bind(window);
  function isIikoApi(url){try{return new URL(url,location.href).pathname.startsWith('/api/iiko/')}catch{return false}}
  window.fetch=async function(input,init){
    if(!init||String(init.method||'GET').toUpperCase()!=='POST'||!isIikoApi(typeof input==='string'?input:input?.url||'')) return fetch0(input,init);
    const ids=selectedIds();
    if(!ids.length) return fetch0(input,init);
    const headers=new Headers(init.headers||{}); const ct=headers.get('Content-Type')||headers.get('content-type')||'';
    if(!ct.includes('application/json')||typeof init.body!=='string') return fetch0(input,init);
    try{
      const body=JSON.parse(init.body);
      if(body&&typeof body==='object'&&!Array.isArray(body)){
        body.departmentIds=ids;
        body.departmentId=ids.length===1?ids[0]:undefined;
        init={...init,body:JSON.stringify(body)};
      }
    }catch{}
    return fetch0(input,init);
  };
  async function load(){
    if(loaded)return;
    try{
      const state=await window.SH_IikoContext?.get?.();
      shadow.iikoConnection=state?.connection||null;
      shadow.iikoDepartmentIdentity=state?.identity||null;
      window.SH_IikoUnified={connection:shadow.iikoConnection,identity:shadow.iikoDepartmentIdentity,state};
    }catch(e){console.warn('[iiko-unified] D1 state unavailable',e)}
    loaded=true;
  }
  patchStorage();
  window.SH_IikoUnifiedLoad=load;
  load();
})();
