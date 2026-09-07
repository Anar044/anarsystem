(function(){
  'use strict';

  function addPnlLink(){
    const sidebar=document.querySelector('.sidebar');
    const nav=sidebar?.querySelector('.unified-main-nav');
    if(!nav) return;

    const existing=[...nav.children].find(el=>{
      const href=String(el.getAttribute?.('href')||'').split('#')[0].split('?')[0].split('/').pop().toLowerCase();
      return href==='pnl.html';
    });
    if(existing) return;

    const link=document.createElement('a');
    link.href='pnl.html';
    link.className='pnl-direct-nav-link';
    link.innerHTML='<span class="side-icon">▤</span><span>Прибыли и убытки</span>';

    const cashes=[...nav.children].find(el=>{
      const href=String(el.getAttribute?.('href')||'').split('#')[0].split('?')[0].split('/').pop().toLowerCase();
      return href==='plugin-control.html';
    });
    if(cashes) nav.insertBefore(link,cashes);
    else nav.appendChild(link);

    const page=location.pathname.toLowerCase();
    if(page.endsWith('/pnl.html') || page.endsWith('/pnl')) link.classList.add('active');
  }

  function boot(){
    addPnlLink();
    const observer=new MutationObserver(()=>addPnlLink());
    observer.observe(document.body,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),30000);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot,{once:true});
  else boot();
})();
