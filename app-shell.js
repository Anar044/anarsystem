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
     link.href='app-shell.css?v=5';
     link.onload=resolve;
     link.onerror=resolve;
     document.head.appendChild(link);
   });
 }

 function installUnifiedStyle(){
   if(document.getElementById('hc-unified-style'))return;
   const style=document.createElement('style');
   style.id='hc-unified-style';
   style.textContent=`
     /* ===== ONE UNIFIED HORECACONTROL STYLE ===== */
     .sidebar{position:fixed!important;left:0!important;top:0!important;bottom:0!important;width:248px!important;height:100vh!important;display:flex!important;flex-direction:column!important;visibility:visible!important;opacity:1!important;transform:none!important;z-index:100!important}
     .sidebar .unified-brand:before{content:none!important;display:none!important}
     .sidebar .unified-brand{display:flex!important;align-items:center!important;gap:10px!important;width:100%!important;min-width:0!important;height:auto!important;padding:7px 12px 28px!important;margin:0!important;box-sizing:border-box!important;color:#fff!important}
     .sidebar .unified-logo{width:31px!important;min-width:31px!important;height:31px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 31px!important;margin:0!important;border-radius:9px!important;background:#42d392!important;color:#06110b!important;font-size:16px!important;font-weight:900!important;line-height:1!important;position:static!important}
     .sidebar .unified-brand .brand-copy{display:flex!important;flex-direction:column!important;justify-content:center!important;gap:2px!important;min-width:0!important;flex:1 1 auto!important;line-height:1.15!important}
     .sidebar .unified-brand .brand-copy b{display:block!important;margin:0!important;padding:0!important;color:#f4f7fa!important;font-size:17px!important;font-weight:850!important;white-space:nowrap!important;line-height:1.15!important}
     .sidebar .unified-brand .brand-copy small{display:block!important;margin:0!important;padding:0!important;color:#8994a3!important;font-size:11px!important;font-weight:500!important;white-space:nowrap!important;line-height:1.2!important}
     .main{margin-left:248px!important;width:calc(100% - 248px)!important;min-width:0!important;min-height:100vh!important;background:#0b1017!important}
     .page.app-content{width:100%!important;max-width:1650px!important;margin:0 auto!important}
     .shift-summary-panel{overflow:visible!important}
     .shift-summary-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:10px!important;margin-top:13px!important}
     .shift-summary-card{display:flex!important;flex-direction:column!important;align-items:flex-start!important;justify-content:center!important;min-height:78px!important;padding:13px 15px!important;gap:4px!important;overflow:hidden!important}
     .shift-summary-card span{display:block!important;font-size:9px!important;text-transform:uppercase!important;letter-spacing:.06em!important;font-weight:800!important;line-height:1.2!important;color:#8994a3!important;white-space:nowrap!important}
     .shift-summary-card strong{display:block!important;font-size:18px!important;line-height:1.25!important;color:#f4f7fa!important;font-weight:850!important;white-space:nowrap!important}
     .shift-summary-card small{display:block!important;font-size:9px!important;line-height:1.2!important;color:#8994a3!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;max-width:100%!important}
     .shift-summary-card.closed{border-color:#244637!important;background:linear-gradient(145deg,#14231e,#111923)!important}
     .shift-summary-card.open{background:#121b25!important}
     .shift-summary-card.expected{background:linear-gradient(145deg,#17251f,#111923)!important}
     .overview-grid{margin-bottom:12px!important}
     .overview-card{min-height:78px!important}
     .request-panel,.result-panel{overflow:visible!important}
     .request-grid{align-items:end!important}
     .request-grid label{min-width:0!important}
     .request-grid select,.request-grid input{width:100%!important;min-width:0!important}
     .result-summary{min-width:0!important;overflow:hidden!important}
     .result-headline{grid-template-columns:repeat(auto-fit,minmax(140px,1fr))!important}
     .data-table-wrap{max-width:100%!important;overflow:auto!important}
     .data-table{min-width:700px!important}
     .result-output{max-width:100%!important;overflow:auto!important;white-space:pre!important}
     @media(max-width:900px){.shift-summary-grid{grid-template-columns:1fr 1fr!important}}
     @media(max-width:760px){.sidebar{width:260px!important;transform:translateX(-100%)!important}.sidebar.open{transform:translateX(0)!important}.main{margin-left:0!important;width:100%!important}}
     @media(max-width:620px){.shift-summary-grid{grid-template-columns:1fr!important}}
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
       if(style.id!=='hc-unified-style') style.remove();
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
     installUnifiedStyle();
     removeLegacyStyles();
     buildUnifiedSidebar();
     window.addEventListener('beforeunload',()=>{root.style.background='#0b1017';root.style.visibility='hidden';});
     document.addEventListener('DOMContentLoaded',()=>{
       removeLegacyStyles();update();buildUnifiedSidebar();loadQrMenuSync();update();reveal();
       const menu=document.querySelector('[data-mobile-menu]')||document.getElementById('mobileMenu'),side=document.querySelector('.sidebar');
       if(menu&&side)menu.onclick=()=>side.classList.toggle('open');
     });
     if(document.readyState!=='loading'){update();buildUnifiedSidebar();loadQrMenuSync();reveal();}
   });
 }
 init();
})();
