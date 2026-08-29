(function(){
 const root=document.documentElement;
 const saved=localStorage.getItem('shReportsTheme');
 root.dataset.theme=saved==='light'?'light':'dark';
 function update(){document.querySelectorAll('[data-theme-label]').forEach(e=>e.textContent=root.dataset.theme==='dark'?'☀️ Светлая тема':'🌙 Светлая тема');}
 function addCSS(id,href){if(document.getElementById(id))return;const link=document.createElement('link');link.id=id;link.rel='stylesheet';link.href=href;document.head.appendChild(link);}
 function loadUnifiedUI(){addCSS('anarsystem-site-modern','site-modern.css?v=3');addCSS('anarsystem-site-modern-fix','site-modern-fix.css?v=1');}
 function loadModernUI(){if(document.getElementById('anarsystem-modern-ui'))return;addCSS('anarsystem-modern-ui','modern-ui.css?v=3');addCSS('anarsystem-modern-ui-v3','modern-ui-v3.css?v=2');}
 function currentPage(){const p=location.pathname.toLowerCase();if(p.endsWith('/reports')||p.endsWith('/reports.html'))return'reports.html';if(p.endsWith('/plugin-control')||p.endsWith('/plugin-control.html'))return'plugin-control.html';if(p.endsWith('/plugin-events')||p.endsWith('/plugin-events.html'))return'plugin-events.html';if(p.endsWith('/settings')||p.endsWith('/settings.html'))return'settings.html';if(p.endsWith('/debug')||p.endsWith('/debug.html'))return'debug.html';return'index.html';}
 function buildUnifiedSidebar(){
   const sidebar=document.querySelector('.sidebar');if(!sidebar||sidebar.dataset.unifiedSidebar==='1')return;
   const page=currentPage();const active=x=>x===page?' class="active"':'';
   sidebar.innerHTML=`<div class="brand"><span class="brand-mark">H</span><span class="brand-text">HorecaControl<small>Restaurant Analytics</small></span></div><div class="nav-section">Основное</div><nav class="side-nav"><a href="index.html"${active('index.html')}><span class="side-icon">⌂</span>Dashboard</a><a href="reports.html"${active('reports.html')}><span class="side-icon">▥</span>OLAP Отчёты</a><a href="plugin-control.html"${active('plugin-control.html')}><span class="side-icon">▣</span>Кассы</a><a href="plugin-events.html"${active('plugin-events.html')}><span class="side-icon">⇄</span>События плагина</a></nav><div class="nav-section unified-management">Управление</div><nav class="side-nav"><a href="reports.html"><span class="side-icon">⌁</span>Аналитика</a><a href="reports.html"><span class="side-icon">◇</span>Конструктор OLAP</a><a href="reports.html"><span class="side-icon">₼</span>Финансы</a><a href="settings.html"${active('settings.html')}><span class="side-icon">⚙</span>Настройки</a><a href="debug.html"${active('debug.html')}><span class="side-icon">⌁</span>Debug iiko</a></nav><div class="sidebar-spacer"></div><button class="theme-btn" onclick="toggleSHTheme()" data-theme-label>🌙 Светлая тема</button>`;
   sidebar.dataset.unifiedSidebar='1';
 }
 function loadReportsModern(){if(!location.pathname.endsWith('/reports.html')&&!location.pathname.endsWith('/reports'))return;document.body.classList.add('reports-modern');addCSS('reports-modern-css','reports-modern.css?v=4');}
 loadUnifiedUI();loadModernUI();
 document.addEventListener('DOMContentLoaded',()=>{update();loadUnifiedUI();loadModernUI();buildUnifiedSidebar();loadReportsModern();update();const menu=document.querySelector('[data-mobile-menu]'),side=document.querySelector('.sidebar');if(menu&&side)menu.onclick=()=>side.classList.toggle('open');});
})();
