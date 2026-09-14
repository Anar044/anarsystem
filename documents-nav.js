(()=>{
  'use strict';

  const PAGE_MAP=[
    ['/nomenclature','nomenclature.html'],
    ['/nakladnye','nakladnye.html'],
    ['/rashodnye-nakladnye','rashodnye-nakladnye.html'],
    ['/akty-spisaniya','akty-spisaniya.html'],
    ['/vnutrennie-peremescheniya','vnutrennie-peremescheniya.html'],
    ['/abc-xyz','abc-xyz.html'],
    ['/pnl','pnl.html'],
    ['/supplier-balances','supplier-balances.html'],
    ['/cash-shifts','cash-shifts.html'],
    ['/finance','finance.html'],
    ['/reports','reports.html'],
    ['/qr-menu','qr-menu.html'],
    ['/settings','settings.html']
  ];
  const DOCUMENT_PAGES=new Set([
    'nomenclature.html','nakladnye.html','rashodnye-nakladnye.html',
    'akty-spisaniya.html','vnutrennie-peremescheniya.html'
  ]);

  function currentPage(){
    const p=location.pathname.toLowerCase().replace(/\/$/,'');
    if(p==='/cash'||p.endsWith('/cash.html')||p.endsWith('/cash/index.html'))return'cash.html';
    if(p==='/dashboard'||p.endsWith('/dashboard.html')||p==='/index'||p.endsWith('/index.html')||p==='')return'index.html';
    for(const [path,key] of PAGE_MAP){
      if(p===path||p.endsWith(path+'.html'))return key;
    }
    return'index.html';
  }

  function installStyle(){
    let style=document.getElementById('documents-nav-style');
    if(!style){
      style=document.createElement('style');
      style.id='documents-nav-style';
      document.head.appendChild(style);
    }
    style.textContent=`
      .sidebar{overflow-y:auto!important;overflow-x:hidden!important;scrollbar-width:thin;scrollbar-color:#263442 transparent}
      .sidebar::-webkit-scrollbar{width:5px}.sidebar::-webkit-scrollbar-thumb{background:#263442;border-radius:999px}
      .unified-main-nav{width:100%!important;min-width:0!important}
      .unified-main-nav> a{min-width:0!important}
      .unified-main-nav> a>span:last-child{min-width:0!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      .documents-nav-group{width:100%!important;min-width:0!important;margin:0!important;padding:0!important;border:0!important}
      .documents-nav-toggle{appearance:none!important;-webkit-appearance:none!important;width:100%!important;min-width:0!important;min-height:42px!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:8px!important;padding:10px 13px!important;margin:2px 0!important;border:1px solid transparent!important;border-radius:11px!important;background:transparent!important;color:#8fa0b3!important;font:600 13px/1.2 inherit!important;text-align:left!important;cursor:pointer!important;box-sizing:border-box!important}
      .documents-nav-toggle:hover{background:#121b25!important;color:#eef5fb!important;border-color:#1d2a37!important}
      .documents-nav-toggle.active{background:#15251f!important;color:#fff!important;border-color:#1f4a37!important;box-shadow:inset 3px 0 #42d392!important}
      .documents-nav-toggle[aria-expanded="true"]:not(.active){background:transparent!important;color:#8fa0b3!important;border-color:transparent!important;box-shadow:none!important}
      .documents-nav-toggle[aria-expanded="true"]:not(.active):hover{background:#121b25!important;color:#eef5fb!important;border-color:#1d2a37!important}
      .documents-nav-toggle-left{display:flex!important;align-items:center!important;gap:11px!important;min-width:0!important;flex:1 1 auto!important}
      .documents-nav-toggle-left>span:last-child{min-width:0!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
      .documents-nav-folder{width:20px!important;min-width:20px!important;text-align:center!important;color:inherit!important}
      .documents-nav-chevron{width:18px!important;min-width:18px!important;height:18px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;color:#8994a3!important;transition:transform .18s ease!important}
      .documents-nav-group.open .documents-nav-chevron{transform:rotate(180deg)!important;color:#42d392!important}
      .documents-subnav{margin:3px 0 3px 8px!important;padding:2px 0 2px 8px!important;border-left:1px solid #26313d!important}
      .documents-subnav[hidden],.documents-nav-group:not(.open)>.documents-subnav{display:none!important}
      .documents-subnav a{font-size:12px!important;min-height:38px!important}
    `;
  }

  function sync(){
    installStyle();
    const sidebar=document.querySelector('.sidebar');
    const nav=sidebar?.querySelector('.unified-main-nav');
    if(!nav)return false;

    const page=currentPage();
    nav.querySelectorAll(':scope > a[data-unified-nav-item]').forEach(a=>{
      a.classList.toggle('active',String(a.dataset.unifiedNavItem||'').toLowerCase()===page);
    });

    const group=nav.querySelector(':scope > .documents-nav-group');
    const toggle=group?.querySelector('.documents-nav-toggle');
    const sub=group?.querySelector('.documents-subnav');
    if(!group||!toggle||!sub)return true;

    let activeDocument=null;
    sub.querySelectorAll('a[data-unified-nav-item]').forEach(a=>{
      const active=String(a.dataset.unifiedNavItem||'').toLowerCase()===page;
      a.classList.toggle('active',active);
      if(active)activeDocument=a;
    });

    const isDocumentPage=DOCUMENT_PAGES.has(page)&&!!activeDocument;
    group.classList.toggle('open',isDocumentPage);
    toggle.classList.toggle('active',isDocumentPage);
    toggle.setAttribute('aria-expanded',isDocumentPage?'true':'false');
    sub.hidden=!isDocumentPage;
    return true;
  }

  function boot(){
    if(sync())return;
    const sidebar=document.querySelector('.sidebar');
    if(!sidebar)return;
    const observer=new MutationObserver(()=>{
      if(sync())observer.disconnect();
    });
    observer.observe(sidebar,{childList:true,subtree:true});
    setTimeout(()=>observer.disconnect(),5000);
  }

  window.SH_SidebarNav={sync,currentPage};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.addEventListener('pageshow',sync,{passive:true});
})();
