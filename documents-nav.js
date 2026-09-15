(()=>{
  'use strict';

  // Compatibility helper only. The sidebar itself remains owned by app-shell.js.
  // Cloudflare serves the cash page as /cash/, while the legacy route matcher
  // treats /cash (without the trailing slash) as the cash page. Use the concrete
  // index.html URL for the nav link and reconcile the already-rendered active
  // state once, without observers or repeated DOM mutations.
  function normalizeCashNav(){
    const nav=document.querySelector('.sidebar .unified-main-nav');
    if(!nav)return;

    const cash=nav.querySelector('a[data-unified-nav-item="cash.html"]');
    if(cash)cash.setAttribute('href','/cash/index.html');

    const path=location.pathname.toLowerCase().replace(/\/+$/,'');
    const isCash=path==='/cash'||path.endsWith('/cash.html')||path.endsWith('/cash/index.html');
    if(isCash&&cash){
      nav.querySelectorAll(':scope > a[data-unified-nav-item]').forEach(a=>a.classList.toggle('active',a===cash));
    }
  }

  normalizeCashNav();

  if(!window.SH_SidebarNav){
    window.SH_SidebarNav={
      sync(){ normalizeCashNav(); return true; },
      currentPage(){
        const path=location.pathname.toLowerCase().replace(/\/+$/,'');
        return path==='/cash'||path.endsWith('/cash.html')||path.endsWith('/cash/index.html')?'cash.html':null;
      }
    };
  }
})();
