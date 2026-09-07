(function(){
  'use strict';
  function load(){
    if(document.getElementById('pnl-nav-script')) return;
    const s=document.createElement('script');
    s.id='pnl-nav-script';
    s.src='documents-nav.js?v=7';
    document.body.appendChild(s);
  }
  function boot(){
    let n=0;
    const timer=setInterval(()=>{
      n++;
      const sidebar=document.querySelector('.sidebar');
      if(sidebar && sidebar.querySelector('.unified-main-nav,.side-nav')){clearInterval(timer);load();}
      else if(n>=100){clearInterval(timer);load();}
    },100);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
