(function(){
 const root=document.documentElement;
 const saved=localStorage.getItem('shReportsTheme');
 root.dataset.theme=saved==='light'?'light':'dark';
 root.style.background='#0b1017';

 /* One visual layer: remove legacy visual layers before revealing the page. */
 function reveal(){requestAnimationFrame(()=>root.classList.add('hc-ready'));}

 function removeLegacyLayers(){
   const legacy=['pages.css','olap-ui.css','site-modern.css','dashboard.css','dashboard-modern.css','modern-ui.css','modern-ui-v3.css','reports-modern.css','reports-modern-fix.css','site-modern-fix.css'];
   document.querySelectorAll('link[rel="stylesheet"]').forEach(link=>{
     const href=(link.getAttribute('href')||'').toLowerCase();
     if(legacy.some(name=>href.includes(name))) link.remove();
   });
   const path=location.pathname.toLowerCase();
   if(path.endsWith('/settings')||path.endsWith('/settings.html')||path.endsWith('/reports')||path.endsWith('/reports.html')){
     document.querySelectorAll('head > style').forEach(style=>style.remove());
   }
 }

 function loadHorecaModern(){
   const existing=document.getElementById('anarsystem-horeca-modern');
   if(existing){
     if(existing.sheet) reveal();
     else existing.addEventListener('load',reveal,{once:true});
     return;
   }
   const link=document.createElement('link');
   link.id='anarsystem-horeca-modern';
   link.rel='stylesheet';
   link.href='horeca-modern.css?v=9';
   link.onload=reveal;
   link.onerror=reveal;
   document.head.appendChild(link);
 }

 function update(){document.querySelectorAll('[data-theme-label]').forEach(e=>e.textContent=root.dataset.theme==='dark'?'☀️ Светлая тема':'🌙 Светлая тема');}
 window.toggleSHTheme=function(){const next=root.dataset.theme==='dark'?'light':'dark';localStorage.setItem('shReportsTheme',next);root.dataset.theme=next;update();};

 function currentPage(){const p=location.pathname.toLowerCase();if(p.endsWith('/reports')||p.endsWith('/reports.html'))return'reports.html';if(p.endsWith('/plugin-control')||p.endsWith('/plugin-control.html'))return'plugin-control.html';if(p.endsWith('/plugin-events')||p.endsWith('/plugin-events.html'))return'plugin-events.html';if(p.endsWith('/settings')||p.endsWith('/settings.html'))return'settings.html';if(p.endsWith('/debug')||p.endsWith('/debug.html'))return'debug.html';if(p.endsWith('/qr-menu')||p.endsWith('/qr-menu.html'))return'qr-menu.html';return'index.html';}
 function buildUnifiedSidebar(){const sidebar=document.querySelector('.sidebar');if(!sidebar||sidebar.dataset.unifiedSidebar==='1')return;const page=currentPage();const active=x=>x===page?' class="active"':'';sidebar.innerHTML=`<nav class="side-nav unified-main-nav"><a href="index.html"${active('index.html')}><span class="side-icon">⌂</span>Dashboard</a><a href="reports.html"${active('reports.html')}><span class="side-icon">▥</span>OLAP Отчёты</a><a href="plugin-control.html"${active('plugin-control.html')}><span class="side-icon">▣</span>Кассы</a><a href="qr-menu.html"${active('qr-menu.html')}><span class="side-icon">▦</span>QR Menu</a><a href="settings.html"${active('settings.html')}><span class="side-icon">⚙</span>Настройки</a></nav><div class="sidebar-spacer"></div>`;sidebar.dataset.unifiedSidebar='1';}
 function loadQrMenuSync(){
   if(!location.pathname.endsWith('/qr-menu.html')&&!location.pathname.endsWith('/qr-menu'))return;
   const loadFix=()=>{if(!document.getElementById('qr-menu-fix-script')){const f=document.createElement('script');f.id='qr-menu-fix-script';f.src='qr-menu-fix.js?v=1';document.body.appendChild(f);}};
   const loadSyncFix=()=>{if(!document.getElementById('qr-menu-sync-fix-script')){const x=document.createElement('script');x.id='qr-menu-sync-fix-script';x.src='qr-menu-sync-fix.js?v=1';document.body.appendChild(x);}};
   const loadPublish=()=>{loadFix();loadSyncFix();if(!document.getElementById('qr-menu-publish-script')){const p=document.createElement('script');p.id='qr-menu-publish-script';p.src='qr-menu-publish.js?v=2';document.body.appendChild(p);}};
   if(!document.getElementById('qr-menu-sync-script')){const s=document.createElement('script');s.id='qr-menu-sync-script';s.src='qr-menu-sync.js?v=3';s.onload=loadPublish;document.body.appendChild(s);}else loadPublish();
 }

 removeLegacyLayers();
 loadHorecaModern();
 if(document.readyState!=='loading')buildUnifiedSidebar();
 document.addEventListener('DOMContentLoaded',()=>{
   removeLegacyLayers();
   update();
   loadHorecaModern();
   buildUnifiedSidebar();
   loadQrMenuSync();
   update();
   const menu=document.querySelector('[data-mobile-menu]')||document.getElementById('mobileMenu'),side=document.querySelector('.sidebar');
   if(menu&&side)menu.onclick=()=>side.classList.toggle('open');
 });
})();
