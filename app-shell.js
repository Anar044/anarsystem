(function(){
 const root=document.documentElement;
 root.classList.add('hc-loading');
 root.style.background='#0b1017';
 root.style.visibility='hidden';
 const saved=localStorage.getItem('shReportsTheme');
 root.dataset.theme=saved==='light'?'light':'dark';

 function ensureMasterStyle(){
   if(document.getElementById('hc-master-style'))return;
   const link=document.createElement('link');
   link.id='hc-master-style';
   link.rel='stylesheet';
   link.href='app-shell.css?v=master';
   document.head.appendChild(link);
 }

 function removeLegacyStyles(){
   ensureMasterStyle();
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
 function buildUnifiedSidebar(){const sidebar=document.querySelector('.sidebar');if(!sidebar||sidebar.dataset.unifiedSidebar==='1')return;const page=currentPage();const active=x=>x===page?' class="active"':'';sidebar.innerHTML=`<div class="unified-brand"><div class="unified-logo">H</div><div><b>HorecaControl</b><small>Ресторан под контролем</small></div></div><div class="unified-label">Основное</div><nav class="side-nav unified-main-nav"><a href="index.html"${active('index.html')}><span class="side-icon">⌂</span>Dashboard</a><a href="reports.html"${active('reports.html')}><span class="side-icon">▥</span>OLAP Отчёты</a><a href="plugin-control.html"${active('plugin-control.html')}><span class="side-icon">▣</span>Кассы</a><a href="qr-menu.html"${active('qr-menu.html')}><span class="side-icon">▦</span>QR Menu</a><a href="settings.html"${active('settings.html')}><span class="side-icon">⚙</span>Настройки</a></nav><div class="sidebar-spacer"></div>`;sidebar.dataset.unifiedSidebar='1';}
 function loadQrMenuSync(){
   if(!location.pathname.endsWith('/qr-menu.html')&&!location.pathname.endsWith('/qr-menu'))return;
   const loadFix=()=>{if(!document.getElementById('qr-menu-fix-script')){const f=document.createElement('script');f.id='qr-menu-fix-script';f.src='qr-menu-fix.js?v=1';document.body.appendChild(f);}};
   const loadSyncFix=()=>{if(!document.getElementById('qr-menu-sync-fix-script')){const x=document.createElement('script');x.id='qr-menu-sync-fix-script';x.src='qr-menu-sync-fix.js?v=1';document.body.appendChild(x);}};
   const loadPublish=()=>{loadFix();loadSyncFix();if(!document.getElementById('qr-menu-publish-script')){const p=document.createElement('script');p.id='qr-menu-publish-script';p.src='qr-menu-publish.js?v=2';document.body.appendChild(p);}};
   if(!document.getElementById('qr-menu-sync-script')){const s=document.createElement('script');s.id='qr-menu-sync-script';s.src='qr-menu-sync.js?v=3';s.onload=loadPublish;document.body.appendChild(s);}else loadPublish();
 }

 function reveal(){root.classList.remove('hc-loading');root.style.visibility='visible';}

 ensureMasterStyle();
 removeLegacyStyles();
 if(document.readyState!=='loading')buildUnifiedSidebar();
 window.addEventListener('beforeunload',()=>{root.style.background='#0b1017';root.style.visibility='hidden';});
 document.addEventListener('DOMContentLoaded',()=>{
   removeLegacyStyles();
   update();
   buildUnifiedSidebar();
   loadQrMenuSync();
   update();
   requestAnimationFrame(()=>reveal());
   const menu=document.querySelector('[data-mobile-menu]')||document.getElementById('mobileMenu'),side=document.querySelector('.sidebar');
   if(menu&&side)menu.onclick=()=>side.classList.toggle('open');
 });
})();
