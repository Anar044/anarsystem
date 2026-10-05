(function(){
  'use strict';
  const clean=v=>String(v??'').trim();

  async function contextLabel(){
    if(!window.SH_IikoContext?.getBinding)return null;
    const binding=await window.SH_IikoContext.getBinding();
    const identity=binding?.identity||{};
    const connection=binding?.connection||{};
    const mode=clean(identity.mode||connection.connectionType||'RMS').toUpperCase();
    const ids=new Set((binding?.departmentIds||[]).map(String));
    const restaurants=Array.isArray(binding?.restaurants)?binding.restaurants:[];
    const selected=restaurants.filter(x=>ids.has(String(x?.id||'')));
    const names=[...new Set(selected.map(x=>clean(x?.name)).filter(Boolean))];

    if(mode==='CHAIN'){
      if(names.length===1)return {title:`Обзор ресторана — ${names[0]}`,crumb:names[0]};
      if(names.length>1){
        const short=names.length<=3?names.join(' · '):`${names.slice(0,2).join(' · ')} · ещё ${names.length-2}`;
        return {title:`Обзор сети — ${names.length} ресторанов`,crumb:short};
      }
      return {title:'Обзор сети',crumb:clean(identity.displayName||connection.displayName||'Smart Horeca')};
    }

    const name=names[0]||clean(identity.restaurantName||connection.restaurantName||identity.displayName||connection.displayName);
    return name?{title:`Обзор ресторана — ${name}`,crumb:name}:null;
  }

  async function render(){
    try{
      const label=await contextLabel();
      if(!label)return;
      const title=document.querySelector('.pagehead h1');
      if(title)title.textContent=label.title;
      const crumb=document.querySelector('.topbar .crumb span');
      if(crumb)crumb.textContent=label.crumb;
    }catch(error){console.warn('[dashboard-name] context unavailable',error)}
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',render,{once:true});else render();
  window.addEventListener('sh:iiko-selection-changed',()=>render());
})();