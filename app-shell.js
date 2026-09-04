(function(){
 const root=document.documentElement;
 root.classList.add('hc-loading');
 root.style.background='#0b1017';
 root.style.visibility='hidden';
 const saved=localStorage.getItem('shReportsTheme');
 root.dataset.theme=saved==='light'?'light':'dark';

 function ensureMasterStyles(){
   if(document.querySelector('link[href*="app-shell.css"]')) return Promise.resolve();
   return new Promise(resolve=>{
     const link=document.createElement('link');
     link.rel='stylesheet';
     link.href='app-shell.css';
     link.onload=resolve;
     link.onerror=resolve;
     document.head.appendChild(link);
   });
 }

 function installUnifiedBrandStyle(){
   if(document.getElementById('hc-unified-brand-style'))return;
   const style=document.createElement('style');
   style.id='hc-unified-brand-style';
   style.textContent=`
     .sidebar .unified-brand:before{content:none!important;display:none!important}
     .sidebar .unified-brand{display:flex!important;align-items:center!important;gap:10px!important;width:100%!important;min-width:0!important;padding:7px 12px 28px!important;margin:0!important;box-sizing:border-box!important;color:#fff!important}
     .sidebar .unified-logo{width:31px!important;min-width:31px!important;height:31px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 31px!important;margin:0!important;border-radius:9px!important;background:#42d392!important;color:#06110b!important;font-size:16px!important;font-weight:900!important;line-height:1!important;position:static!important}
     .sidebar .unified-brand .brand-copy{display:flex!important;flex-direction:column!important;justify-content:center!important;gap:2px!important;min-width:0!important;flex:1 1 auto!important;line-height:1.15!important}
     .sidebar .unified-brand .brand-copy b{display:block!important;margin:0!important;padding:0!important;color:#f4f7fa!important;font-size:17px!important;font-weight:850!important;white-space:nowrap!important;line-height:1.15!important}
     .sidebar .unified-brand .brand-copy small{display:block!important;margin:0!important;padding:0!important;color:#8994a3!important;font-size:11px!important;font-weight:500!important;white-space:nowrap!important;line-height:1.2!important}
   `;
   document.head.appendChild(style);
 }

 function removeLegacyStyles(){
   document.querySelectorAll('link[rel="stylesheet"]').forEach(link=>{
     const href=(link.getAttribute('href')||'').toLowerCase();
     if(!href.includes('app-shell.css')) link.remove();
   });
   const path=location.pathname.toLowerCase();
   if(!path.endsWith('/index.html') && !path.endsWith('/')){
     document.querySelectorAll('head > style').forEach(style=>{
       if(style.id!=='hc-unified-brand-style') style.remove();
     });
   }
 }

 function update(){document.querySelectorAll('[data-theme-label]').forEach(e=>e.textContent=root.dataset.theme==='dark'?'☀️ Светлая тема':'🌙 Светлая тема');}
 window.toggleSHTheme=function(){const next=root.dataset.theme==='dark'?'light':'dark';localStorage.setItem('shReportsTheme',next);root.dataset.theme=next;update();};

 function currentPage(){const p=location.pathname.toLowerCase();if(p.endsWith('/reports')||p.endsWith('/reports.html'))return'reports.html';if(p.endsWith('/plugin-control')||p.endsWith('/plugin-control.html'))return'plugin-control.html';if(p.endsWith('/plugin-events')||p.endsWith('/plugin-events.html'))return'plugin-events.html';if(p.endsWith('/settings')||p.endsWith('/settings.html'))return'settings.html';if(p.endsWith('/debug')||p.endsWith('/debug.html'))return'debug.html';if(p.endsWith('/qr-menu')||p.endsWith('/qr-menu.html'))return'qr-menu.html';return'index.html';}
 function buildUnifiedSidebar(){
   const sidebar=document.querySelector('.sidebar');
   if(!sidebar||sidebar.dataset.unifiedSidebar==='1')return;
   const page=currentPage();
   const active=x=>x===page?' class="active"':'';
   sidebar.innerHTML=`
     <div class="brand unified-brand">
       <div class="unified-logo">SH</div>
       <div class="brand-copy">
         <b>Smart Horeca Control</b>
         <small>Restaurant Management</small>
       </div>
     </div>
     <div class="nav-title">ОСНОВНОЕ</div>
     <nav class="side-nav nav unified-main-nav">
       <a href="index.html"${active('index.html')}><span class="side-icon">⌂</span><span>Dashboard</span></a>
       <a href="reports.html"${active('reports.html')}><span class="side-icon">▥</span><span>OLAP Отчёты</span></a>
       <a href="plugin-control.html"${active('plugin-control.html')}><span class="side-icon">▣</span><span>Кассы</span></a>
       <a href="qr-menu.html"${active('qr-menu.html')}><span class="side-icon">▦</span><span>QR Menu</span></a>
       <a href="settings.html"${active('settings.html')}><span class="side-icon">⚙</span><span>Настройки</span></a>
     </nav>
     <div class="sidebar-spacer"></div>`;
   sidebar.dataset.unifiedSidebar='1';
 }
 function loadQrMenuSync(){
   if(!location.pathname.endsWith('/qr-menu.html')&&!location.pathname.endsWith('/qr-menu'))return;
   const loadFix=()=>{if(!document.getElementById('qr-menu-fix-script')){const f=document.createElement('script');f.id='qr-menu-fix-script';f.src='qr-menu-fix.js?v=1';document.body.appendChild(f);}};
   const loadSyncFix=()=>{if(!document.getElementById('qr-menu-sync-fix-script')){const x=document.createElement('script');x.id='qr-menu-sync-fix-script';x.src='qr-menu-sync-fix.js?v=1';document.body.appendChild(x);}};
   const loadPublish=()=>{loadFix();loadSyncFix();if(!document.getElementById('qr-menu-publish-script')){const p=document.createElement('script');p.id='qr-menu-publish-script';p.src='qr-menu-publish.js?v=2';document.body.appendChild(p);}};
   if(!document.getElementById('qr-menu-sync-script')){const s=document.createElement('script');s.id='qr-menu-sync-script';s.src='qr-menu-sync.js?v=3';s.onload=loadPublish;document.body.appendChild(s);}else loadPublish();
 }

 function reveal(){root.classList.remove('hc-loading');root.style.visibility='visible';}

 function init(){
   ensureMasterStyles().then(()=>{
     installUnifiedBrandStyle();
     removeLegacyStyles();
     if(document.readyState!=='loading')buildUnifiedSidebar();
     window.addEventListener('beforeunload',()=>{root.style.background='#0b1017';root.style.visibility='hidden';});
     document.addEventListener('DOMContentLoaded',()=>{
       removeLegacyStyles();
       update();
       buildUnifiedSidebar();
       loadQrMenuSync();
       update();
       reveal();
       const menu=document.querySelector('[data-mobile-menu]')||document.getElementById('mobileMenu'),side=document.querySelector('.sidebar');
       if(menu&&side)menu.onclick=()=>side.classList.toggle('open');
     });
     if(document.readyState!=='loading'){
       update();
       buildUnifiedSidebar();
       loadQrMenuSync();
       reveal();
     }
   });
 }

 init();
})();
