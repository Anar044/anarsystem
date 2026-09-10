(function(){
  'use strict';
  const KEYS=new Set(['iikoConnection','iikoDepartmentIdentity']);
  const storage=window.localStorage;
  const get0=Storage.prototype.getItem;
  const set0=Storage.prototype.setItem;
  const remove0=Storage.prototype.removeItem;
  const shadow={iikoConnection:null,iikoDepartmentIdentity:null};
  let loaded=false;
  function patch(){
    Storage.prototype.getItem=function(key){if(this===storage&&KEYS.has(String(key))){const v=shadow[String(key)];return v==null?null:JSON.stringify(v)}return get0.call(this,key)};
    Storage.prototype.setItem=function(key,value){if(this===storage&&KEYS.has(String(key))){try{shadow[String(key)]=JSON.parse(String(value))}catch{shadow[String(key)]=String(value)}return}return set0.call(this,key,value)};
    Storage.prototype.removeItem=function(key){if(this===storage&&KEYS.has(String(key))){shadow[String(key)]=null;return}return remove0.call(this,key)};
  }
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
  patch();
  window.SH_IikoUnifiedLoad=load;
  load();
})();
