(function(){
  'use strict';
  const KEY='iikoConnection';
  const clean=v=>String(v??'').trim();
  async function load(){
    let c=null;try{c=JSON.parse(localStorage.getItem(KEY)||'null')}catch{}
    if(!c?.ip||!c?.port||!c?.login||!c?.password)return;
    try{
      const r=await fetch('/api/iiko/restaurant-name',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(c),cache:'no-store'});
      const d=await r.json().catch(()=>({}));
      if(!r.ok||!d.success||!clean(d.restaurantName))return;
      const name=clean(d.restaurantName);
      const title=document.querySelector('.pagehead h1');
      if(title)title.textContent=`Обзор ресторана — ${name}`;
      const crumb=document.querySelector('.topbar .crumb span');
      if(crumb)crumb.textContent=name;
    }catch(e){console.warn('Restaurant name:',e)}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load);else load();
})();