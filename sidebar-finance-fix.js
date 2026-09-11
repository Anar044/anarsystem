(function(){
  'use strict';
  function fix(){
    const nav=document.querySelector('.sidebar .unified-main-nav');
    if(!nav)return;
    let found=false;
    [...nav.children].forEach(el=>{
      if(el.tagName!=='A')return;
      const href=String(el.getAttribute('href')||'').toLowerCase();
      const path=href.replace(/^https?:\/\/[^/]+/,'').split('?')[0].replace(/\/$/,'');
      const text=String(el.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
      const finance=path==='/finance.html'||path==='/finance'||path.endsWith('/finance.html')||text==='₽ финансы'||text==='финансы';
      if(!finance)return;
      if(found)el.remove(); else found=true;
    });
  }
  function boot(){
    fix();
    const observer=new MutationObserver(fix);
    observer.observe(document.body,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
