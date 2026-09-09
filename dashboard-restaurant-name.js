(function(){
  'use strict';
  const CONNECTION_KEY='iikoConnection';
  const IDENTITY_KEY='iikoDepartmentIdentity';
  const clean=v=>String(v??'').trim();

  function readJson(key){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}

  function localName(){
    const identity=readJson(IDENTITY_KEY)||{};
    const connection=readJson(CONNECTION_KEY)||{};
    const mode=clean(connection.displayName?connection.connectionType:identity.mode||connection.connectionType||connection.detectedMode).toUpperCase();

    if(clean(connection.displayName))return clean(connection.displayName);
    if(clean(identity.displayName))return clean(identity.displayName);

    // iikoChain: use a saved corporation/network name captured during connection.
    if(mode==='CHAIN'){
      const corp=identity.organization||connection.organization||{};
      const chainName=clean(corp.name||corp.Name||corp.title||corp.Title||connection.networkName||identity.networkName);
      if(chainName)return chainName;
      const hierarchy=Array.isArray(identity.hierarchy)?identity.hierarchy:(Array.isArray(connection.hierarchy)?connection.hierarchy:[]);
      const corporation=hierarchy.find(x=>String(x?.type||'').toUpperCase()==='CORPORATION');
      return clean(corporation?.name||corporation?.Name||'');
    }

    // iikoRMS: use the restaurant / department name captured during connection.
    const restaurantName=clean(connection.restaurantName||identity.restaurantName);
    if(restaurantName)return restaurantName;
    const orgs=Array.isArray(identity.organizations)?identity.organizations:(Array.isArray(connection.organizations)?connection.organizations:[]);
    const deps=Array.isArray(identity.departments)?identity.departments:(Array.isArray(connection.departments)?connection.departments:[]);
    return clean(orgs[0]?.name||orgs[0]?.Name||deps[0]?.name||deps[0]?.Name||'');
  }

  function render(){
    const name=localName();
    if(!name)return;
    const title=document.querySelector('.pagehead h1');
    if(title)title.textContent=`Обзор ресторана — ${name}`;
    const crumb=document.querySelector('.topbar .crumb span');
    if(crumb)crumb.textContent=name;
  }

  // No API call here. The name must already be present in the saved connection identity.
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render);else render();
})();
