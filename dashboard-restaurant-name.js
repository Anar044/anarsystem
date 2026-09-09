(function(){
  'use strict';
  const CONNECTION_KEY='iikoConnection';
  const IDENTITY_KEY='iikoDepartmentIdentity';
  const clean=v=>String(v??'').trim();
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function readJson(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}

  function localName(){
    const identity=readJson(IDENTITY_KEY)||{};
    const connection=readJson(CONNECTION_KEY)||{};
    const mode=clean(identity.mode||connection.connectionType||connection.detectedMode).toUpperCase();

    // iikoChain: use the corporation/network name, never the first restaurant name.
    if(mode==='CHAIN'){
      const corp=identity.organization||connection.organization||{};
      const chainName=clean(corp.name||corp.Name||corp.title||corp.Title);
      if(chainName)return chainName;
    }

    // iikoRMS: use the connected restaurant / department name.
    const orgs=Array.isArray(identity.organizations)?identity.organizations:(Array.isArray(connection.organizations)?connection.organizations:[]);
    const deps=Array.isArray(identity.departments)?identity.departments:(Array.isArray(connection.departments)?connection.departments:[]);
    return clean(orgs[0]?.name||orgs[0]?.Name||deps[0]?.name||deps[0]?.Name||'');
  }

  function render(name){
    name=clean(name); if(!name)return false;
    const title=document.querySelector('.pagehead h1');
    if(title)title.textContent=`Обзор ресторана — ${name}`;
    const crumb=document.querySelector('.topbar .crumb span');
    if(crumb)crumb.textContent=name;
    return true;
  }

  async function load(){
    // First use the real identity already received from the currently connected server.
    if(render(localName()))return;

    let c=readJson(CONNECTION_KEY);
    if(!c?.ip||!c?.port||!c?.login||!c?.password)return;

    // Fallback for older saved connections that do not yet contain identity data.
    try{
      const r=await fetch('/api/iiko/restaurant-name',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(c),cache:'no-store'});
      const d=await r.json().catch(()=>({}));
      if(r.ok&&d.success&&clean(d.restaurantName))render(d.restaurantName);
    }catch(e){console.warn('Restaurant name:',e)}
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load);else load();
})();