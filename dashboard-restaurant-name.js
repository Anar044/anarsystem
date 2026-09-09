(function(){
  'use strict';
  const KEY='iikoConnection';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function load(){
    let c=null;try{c=JSON.parse(localStorage.getItem(KEY)||'null')}catch{}
    if(!c?.ip||!c?.port||!c?.login||!c?.password)return;
    try{
      const r=await fetch('/api/iiko/restaurant-name',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(c),cache:'no-store'});
      const d=await r.json().catch(()=>({}));
      if(!r.ok||!d.success||!d.restaurantName)return;
      const title=document.querySelector('.pagehead h1');
      if(title){
        let el=$('restaurant-name');
        if(!el){el=document.createElement('div');el.id='restaurant-name';el.className='restaurant-name';title.parentNode.insertBefore(el,title);}
        el.textContent=d.restaurantName;
      }
      const crumb=document.querySelector('.topbar .crumb');
      if(crumb){
        let badge=$('restaurant-name-top');
        if(!badge){badge=document.createElement('span');badge.id='restaurant-name-top';badge.className='restaurant-name-top';crumb.appendChild(document.createTextNode(' • '));crumb.appendChild(badge)}
        badge.textContent=d.restaurantName;
      }
    }catch(e){console.warn('Restaurant name:',e)}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load);else load();
})();