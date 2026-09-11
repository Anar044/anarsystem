(function(){
 const root=document.documentElement;
 root.classList.add('hc-loading');
 root.style.background='#0b1017';
 root.style.visibility='hidden';
 const saved=localStorage.getItem('shReportsTheme');
 root.dataset.theme=saved==='light'?'light':'dark';
 function isAuthPage(){return document.body&&document.body.dataset.authPage;}
 function ensureMasterStyles(){
   if(isAuthPage()) return Promise.resolve();
   if(document.querySelector('link[href*="app-shell.css"]')) return Promise.resolve();
   return new Promise(resolve=>{const link=document.createElement('link');link.rel='stylesheet';link.href='/app-shell.css?v=5';link.onload=resolve;link.onerror=resolve;document.head.appendChild(link);});
 }
 function installUnifiedStyle(){
   if(document.getElementById('hc-unified-style'))return;
   const style=document.createElement('style');style.id='hc-unified-style';style.textContent=`
     .sidebar{position:fixed!important;left:0!important;top:0!important;bottom:0!important;width:248px!important;height:100vh!important;display:flex!important;flex-direction:column!important;visibility:visible!important;opacity:1!important;transform:none!important;z-index:100!important}
     .sidebar .unified-brand:before{content:none!important;display:none!important}
     .sidebar .unified-brand{display:flex!important;align-items:center!important;gap:10px!important;width:100%!important;min-width:0!important;height:auto!important;padding:7px 12px 28px!important;margin:0!important;box-sizing:border-box!important;color:#fff!important}
     .sidebar .unified-logo{width:31px!important;min-width:31px!important;height:31px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 31px!important;margin:0!important;border-radius:9px!important;background:#42d392!important;color:#06110b!important;font-size:16px!important;font-weight:900!important;line-height:1!important;position:static!important}
     .sidebar .unified-brand .brand-copy{display:flex!important;flex-direction:column!important;justify-content:center!important;gap:2px!important;min-width:0!important;flex:1 1 auto!important;line-height:1.15!important}
     .sidebar .unified-brand .brand-copy b{display:block!important;margin:0!important;padding:0!important;color:#f4f7fa!important;font-size:17px!important;font-weight:850!important;white-space:nowrap!important;line-height:1.15!important}
     .sidebar .unified-brand .brand-copy small{display:block!important;margin:0!important;padding:0!important;color:#8994a3!important;font-size:11px!important;font-weight:500!important;white-space:nowrap!important;line-height:1.2!important}
     .main{margin-left:248px!important;width:calc(100% - 248px)!important;min-width:0!important;min-height:100vh!important;background:#0b1017!important}
     @media(max-width:760px){.sidebar{width:260px!important;transform:translateX(-100%)!important}.sidebar.open{transform:translateX(0)!important}.main{margin-left:0!important;width:100%!important}.topbar{padding:0 18px!important}.top-actions .icon-btn{display:none!important}}
     @media(max-width:760px){html body .app-shell aside.sidebar,html body .app aside.sidebar{display:none!important;position:fixed!important;left:0!important;top:0!important;bottom:0!important;width:280px!important;height:100dvh!important;margin:0!important;transform:translate3d(-110%,0,0)!important;z-index:9999!important;overflow-y:auto!important;overflow-x:hidden!important}html body .app-shell aside.sidebar.open,html body .app-shell aside.sidebar.open{display:flex!important;transform:translate3d(0,0,0)!important}html body .app-shell main.main,html body .app main.main{margin-left:0!important;width:100%!important;min-width:0!important}html body button[data-mobile-menu]{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:40px!important;height:40px!important;flex:0 0 40px!important;padding:0!important;margin:0!important;visibility:visible!important;opacity:1!important;position:relative!important;z-index:20!important}}
   `;document.head.appendChild(style);
 }
 function removeLegacyStyles(){document.querySelectorAll('link[rel="stylesheet"]').forEach(link=>{const href=(link.getAttribute('href')||'').toLowerCase();if(href.includes('app-shell.css'))return;if(href.includes('pnl.css'))return;if(href.includes('qr-menu.css'))return;if(href.includes('plugin-control.css'))return;if(href.includes('supplier-balances.css'))return;if(href.includes('abc-xyz.css'))return;if(href.includes('cash.css'))return;if(href.includes('cash-history.css'))return;if(href.includes('cash-shifts.css'))return;if(isAuthPage()&&href.includes('auth.css'))return;link.remove();});const path=location.pathname.toLowerCase();if(!path.endsWith('/index.html')&&!path.endsWith('/')&&!isAuthPage())document.querySelectorAll('head > style').forEach(style=>{if(style.id!=='hc-unified-style'&&style.id!=='sh-mobile-responsive'&&style.id!=='cash-order-details-polish')style.remove();});}
 function update(){document.querySelectorAll('[data-theme-label]').forEach(e=>e.textContent=root.dataset.theme==='dark'?'☀️ Светлая тема':'🌙 Светлая тема');}
 window.toggleSHTheme=function(){const next=root.dataset.theme==='dark'?'light':'dark';localStorage.setItem('shReportsTheme',next);root.dataset.theme=next;update();};
 function currentPage(){const p=location.pathname.toLowerCase();if(p.endsWith('/abc-xyz')||p.endsWith('/abc-xyz.html'))return'abc-xyz.html';if(p.endsWith('/pnl')||p.endsWith('/pnl.html'))return'pnl.html';if(p.endsWith('/reports')||p.endsWith('/reports.html'))return'reports.html';if(p.endsWith('/supplier-balances')||p.endsWith('/supplier-balances.html'))return'supplier-balances.html';if(p.endsWith('/cash')||p.endsWith('/cash.html')||p.endsWith('/cash/index.html'))return'cash.html';if(p.endsWith('/plugin-control')||p.endsWith('/plugin-control.html'))return'cash.html';if(p.endsWith('/plugin-events')||p.endsWith('/plugin-events.html'))return'plugin-events.html';if(p.endsWith('/settings')||p.endsWith('/settings.html'))return'settings.html';if(p.endsWith('/debug')||p.endsWith('/debug.html'))return'debug.html';if(p.endsWith('/qr-menu')||p.endsWith('/qr-menu.html'))return'qr-menu.html';if(p.endsWith('/cash-shifts')||p.endsWith('/cash-shifts.html'))return'cash-shifts.html';if(p.endsWith('/finance')||p.endsWith('/finance.html'))return'finance.html';return'index.html';}
 function removeDuplicateFinanceLinks(){
   const sidebar=document.querySelector('.sidebar');
   if(!sidebar)return;
   const seen=new Set();
   sidebar.querySelectorAll('a').forEach(link=>{
     const href=(link.getAttribute('href')||'').toLowerCase().split('?')[0].replace(/\/$/,'');
     const text=(link.textContent||'').replace(/\s+/g,' ').trim().toLowerCase();
     const isFinance=href==='/finance.html'||href==='/finance'||text==='финансы';
     if(!isFinance)return;
     if(seen.has('finance'))link.remove();
     else seen.add('finance');
   });
 }
 function buildUnifiedSidebar(){
   const sidebar=document.querySelector('.sidebar');if(!sidebar||sidebar.dataset.unifiedSidebar==='1')return;
   const page=currentPage();const active=x=>x===page?' class="active"':'';
   sidebar.innerHTML=`<div class="brand unified-brand"><div class="unified-logo">SH</div><div class="brand-copy"><b>Smart Horeca Control</b><small>Restaurant Management</small></div></div><div class="nav-title">ОСНОВНОЕ</div><nav class="side-nav nav unified-main-nav"><a href="/index.html"${active('index.html')}><span class="side-icon">⌂</span><span>Dashboard</span></a><a href="/finance.html"${active('finance.html')}><span class="side-icon">₽</span><span>Финансы</span></a><a href="/reports.html"${active('reports.html')}><span class="side-icon">▥</span><span>OLAP Отчёты</span></a><a href="/pnl.html"${active('pnl.html')}><span class="side-icon">▤</span><span>Прибыли и убытки</span></a><a href="/supplier-balances.html"${active('supplier-balances.html')}><span class="side-icon">◈</span><span>Баланс по поставщикам</span></a><a href="/cash"${active('cash.html')}><span class="side-icon">▣</span><span>Кассы</span></a><a href="/qr-menu.html"${active('qr-menu.html')}><span class="side-icon">▦</span><span>QR Menu</span></a><a href="/settings.html"${active('settings.html')}><span class="side-icon">⚙</span><span>Настройки</span></a></nav><div class="sidebar-spacer"></div>`;
   sidebar.dataset.unifiedSidebar='1';
   removeDuplicateFinanceLinks();
 }
 function loadQrMenuSync(){if(!location.pathname.endsWith('/qr-menu.html')&&!location.pathname.endsWith('/qr-menu'))return;}
 function applySHBranding(){const replaceVisibleText=node=>{if(node.nodeType===Node.TEXT_NODE){const parent=node.parentElement;if(parent&&!['SCRIPT','STYLE','PRE','CODE','NOSCRIPT'].includes(parent.tagName))node.nodeValue=node.nodeValue.replace(/iiko/gi,'SH');return;}if(node.nodeType!==Node.ELEMENT_NODE)return;if(['SCRIPT','STYLE','PRE','CODE','NOSCRIPT'].includes(node.tagName))return;const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);const texts=[];while(walker.nextNode())texts.push(walker.currentNode);texts.forEach(replaceVisibleText);['title','aria-label','placeholder'].forEach(attr=>{if(node.hasAttribute(attr))node.setAttribute(attr,node.getAttribute(attr).replace(/iiko/gi,'SH'));});};replaceVisibleText(document.body);if(document.title)document.title=document.title.replace(/iiko/gi,'SH');if(!document.body.dataset.shBrandingObserver){const observer=new MutationObserver(mutations=>mutations.forEach(m=>{m.addedNodes.forEach(replaceVisibleText);if(m.target&&m.target.closest&&m.target.closest('.sidebar'))removeDuplicateFinanceLinks();}));observer.observe(document.body,{childList:true,subtree:true});document.body.dataset.shBrandingObserver='1';}}
 function reveal(){root.classList.remove('hc-loading');root.style.visibility='visible';}
 function init(){ensureMasterStyles().then(()=>{installUnifiedStyle();removeLegacyStyles();buildUnifiedSidebar();removeDuplicateFinanceLinks();loadQrMenuSync();applySHBranding();reveal();document.addEventListener('DOMContentLoaded',()=>{removeLegacyStyles();update();buildUnifiedSidebar();removeDuplicateFinanceLinks();loadQrMenuSync();applySHBranding();reveal();const menu=document.querySelector('[data-mobile-menu]')||document.getElementById('mobileMenu'),side=document.querySelector('.sidebar');if(menu&&side)menu.onclick=()=>side.classList.toggle('open');});if(document.readyState!=='loading'){update();buildUnifiedSidebar();removeDuplicateFinanceLinks();loadQrMenuSync();applySHBranding();reveal();}});}
 init();
})();
