(function(){
 const root=document.documentElement;
 root.classList.add('hc-loading');
 root.style.background='#0b1017';
 root.style.visibility='hidden';
 const saved=localStorage.getItem('shReportsTheme');
 root.dataset.theme=saved==='light'?'light':'dark';

 function removeLegacyStyles(){
   document.querySelectorAll('link[rel="stylesheet"]').forEach(link=>{
     const href=(link.getAttribute('href')||'').toLowerCase();
     if(!href.includes('app-shell.css')) link.remove();
   });
   const path=location.pathname.toLowerCase();
   if(!path.endsWith('/index.html') && !path.endsWith('/')){
     document.querySelectorAll('head > style').forEach(style=>style.remove());
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
       <div class="logo unified-logo" style="margin-left:-41px;position:relative;z-index:2">SH</div>
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
})();
