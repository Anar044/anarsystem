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

     /* ===== CASH PAGE: PRESENTATION ONLY ===== */
     .connected-panel,.shift-summary-panel,.request-panel,.result-panel{padding:17px 18px!important;margin-bottom:12px!important}
     .panel-head{gap:16px!important;margin-bottom:12px!important}
     .section-kicker{font-size:9px!important;font-weight:850!important;letter-spacing:.12em!important;color:#647080!important;text-transform:uppercase!important}
     .panel-title{font-size:14px!important;font-weight:800!important;line-height:1.25!important;color:#f4f7fa!important}
     .panel-muted{font-size:10px!important;line-height:1.45!important;color:#8994a3!important}
     .plugins-list{display:grid!important;gap:9px!important}
     .plugin-card{padding:12px 13px!important;border-radius:12px!important;background:#111923!important;border:1px solid #222c38!important}
     .plugin-card-head{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;margin-bottom:10px!important}
     .plugin-name{display:flex!important;align-items:center!important;gap:7px!important;font-size:12px!important;font-weight:800!important;color:#f4f7fa!important}
     .online-dot{color:#42d392!important;font-size:9px!important}
     .plugin-card .status-pill{font-size:9px!important;padding:5px 8px!important;white-space:nowrap!important}
     .plugin-meta{grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:7px!important}
     .meta-box{min-width:0!important;padding:8px 9px!important;border-radius:9px!important;background:#0f171f!important;border:1px solid #202a35!important}
     .meta-label{font-size:8px!important;text-transform:uppercase!important;letter-spacing:.05em!important;color:#6f7c8b!important;margin-bottom:3px!important}
     .meta-value{font-size:10px!important;line-height:1.25!important;color:#dce4eb!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}

     .shift-summary-panel .panel-head{align-items:center!important}
     .shift-live-status{display:inline-flex!important;align-items:center!important;gap:6px!important;padding:5px 8px!important;font-size:9px!important;white-space:nowrap!important}
     .shift-summary-card{min-height:67px!important;padding:11px 13px!important;border-radius:11px!important}
     .shift-summary-card strong{font-size:17px!important}

     .request-head{align-items:center!important}
     .request-grid{grid-template-columns:2fr 1.15fr 1fr 1fr!important;gap:9px!important;margin-top:3px!important}
     .request-grid label{display:flex!important;flex-direction:column!important;gap:5px!important;font-size:9px!important;font-weight:750!important;color:#aeb9c5!important}
     .request-grid input,.request-grid select{height:34px!important;padding:7px 9px!important;font-size:10px!important;border-radius:8px!important}
     .request-actions{display:flex!important;align-items:center!important;gap:10px!important;margin-top:9px!important}
     .request-actions .primary-btn{height:32px!important;padding:7px 11px!important;font-size:10px!important}
     .request-status-box{display:inline-flex!important;align-items:center!important;gap:6px!important;font-size:9px!important;color:#8994a3!important}
     .request-status-dot{width:6px!important;height:6px!important;border-radius:50%!important;background:#42d392!important;box-shadow:0 0 0 3px rgba(66,211,146,.08)!important}

     .result-panel .panel-head{margin-bottom:10px!important}
     .result-live-label{display:inline-flex!important;align-items:center!important;gap:5px!important;font-size:8px!important;font-weight:800!important;letter-spacing:.08em!important;color:#42d392!important}
     .result-live-label span{width:6px!important;height:6px!important;border-radius:50%!important;background:#42d392!important}
     .result-headline{display:grid!important;gap:8px!important;margin-bottom:10px!important}
     .result-stat{min-width:0!important;padding:9px 10px!important;border:1px solid #222c38!important;border-radius:9px!important;background:#0f171f!important}
     .result-stat span{display:block!important;margin-bottom:4px!important;font-size:8px!important;text-transform:uppercase!important;letter-spacing:.05em!important;color:#6f7c8b!important}
     .result-stat strong{display:block!important;font-size:12px!important;color:#e9eef3!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
     .result-table-title{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;margin:7px 0 7px!important;color:#dce4eb!important;font-size:10px!important;font-weight:750!important}
     .result-table-title b{font-size:8px!important;font-weight:700!important;color:#6f7c8b!important}
     .data-table-wrap{border:1px solid #202a35!important;border-radius:10px!important;background:#0f171f!important}
     .data-table{min-width:640px!important;font-size:9px!important}
     .data-table th{padding:7px 9px!important;background:#111923!important;color:#6f7c8b!important;border-bottom:1px solid #202a35!important;font-size:8px!important;text-transform:uppercase!important;letter-spacing:.05em!important;white-space:nowrap!important}
     .data-table td{padding:7px 9px!important;color:#dce4eb!important;border-bottom:1px solid #1b2530!important;vertical-align:top!important;max-width:260px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}
     .data-table tbody tr:last-child td{border-bottom:0!important}
     .data-table tbody tr:hover td{background:#121d26!important}
     .raw-details{margin-top:9px!important;border-top:1px solid #1d2732!important;padding-top:8px!important}
     .raw-details summary{cursor:pointer!important;font-size:9px!important;color:#6f7c8b!important}
     .result-output{margin-top:7px!important;padding:10px!important;border-radius:8px!important;background:#0a1016!important;border:1px solid #1d2732!important;color:#9eabb8!important;font-size:9px!important;line-height:1.45!important}
     .empty-note{padding:18px!important;text-align:center!important;color:#6f7c8b!important;font-size:10px!important;border:1px dashed #26313d!important;border-radius:9px!important;background:#0e151c!important}

     @media(max-width:1100px){.plugin-meta{grid-template-columns:repeat(2,minmax(0,1fr))!important}.request-grid{grid-template-columns:2fr 1.2fr 1fr 1fr!important}}
     @media(max-width:900px){.shift-summary-grid{grid-template-columns:1fr 1fr!important}.overview-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.request-grid{grid-template-columns:1fr 1fr!important}}
     @media(max-width:760px){.sidebar{width:260px!important;transform:translateX(-100%)!important}.sidebar.open{transform:translateX(0)!important}.main{margin-left:0!important;width:100%!important}.plugin-meta{grid-template-columns:1fr 1fr!important}.request-grid{grid-template-columns:1fr!important}.topbar{padding:0 18px!important}.top-actions .icon-btn{display:none!important}}
     @media(max-width:620px){.shift-summary-grid{grid-template-columns:1fr!important}.overview-grid{grid-template-columns:1fr!important}.plugin-meta{grid-template-columns:1fr!important}.connected-panel,.shift-summary-panel,.request-panel,.result-panel{padding:14px!important}}

     /* ===== MOBILE NAV FIX ===== */
     @media(max-width:760px){
       html body .app-shell aside.sidebar,
       html body .app aside.sidebar{
         display:none!important;
         position:fixed!important;
         left:0!important;
         top:0!important;
         bottom:0!important;
         width:280px!important;
         height:100dvh!important;
         margin:0!important;
         transform:translate3d(-110%,0,0)!important;
         z-index:9999!important;
         overflow-y:auto!important;
         overflow-x:hidden!important;
       }
       html body .app-shell aside.sidebar.open,
       html body .app aside.sidebar.open{
         display:flex!important;
         transform:translate3d(0,0,0)!important;
       }
       html body .app-shell main.main,
       html body .app main.main{
         margin-left:0!important;
         width:100%!important;
         min-width:0!important;
       }
       html body .app-shell .mobile,
       html body .app .mobile,
       html body .app-shell .mobile-menu,
       html body .app .mobile-menu,
       html body button[data-mobile-menu]{
         display:inline-flex!important;
         align-items:center!important;
         justify-content:center!important;
         width:40px!important;
         height:40px!important;
         flex:0 0 40px!important;
         padding:0!important;
         margin:0!important;
         visibility:visible!important;
         opacity:1!important;
         position:relative!important;
         z-index:20!important;
       }
       html body .app-shell .topbar,
       html body .app .topbar{
         padding:0 14px!important;
       }
       html body .app-shell .topbar>div:first-child,
       html body .app .topbar>div:first-child{
         min-width:0!important;
         display:flex!important;
         align-items:center!important;
         gap:10px!important;
       }
       html body .app-shell .title,
       html body .app .title{
         min-width:0!important;
         white-space:nowrap!important;
       }
     }
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
 function applySHBranding(){
   const replaceVisibleText=node=>{
     if(node.nodeType===Node.TEXT_NODE){
       const parent=node.parentElement;
       if(parent && !['SCRIPT','STYLE','PRE','CODE','NOSCRIPT'].includes(parent.tagName)){
         node.nodeValue=node.nodeValue.replace(/iiko/gi,'SH');
       }
       return;
     }
     if(node.nodeType!==Node.ELEMENT_NODE)return;
     if(['SCRIPT','STYLE','PRE','CODE','NOSCRIPT'].includes(node.tagName))return;
     const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT);
     const texts=[];
     while(walker.nextNode())texts.push(walker.currentNode);
     texts.forEach(replaceVisibleText);
     ['title','aria-label','placeholder'].forEach(attr=>{
       if(node.hasAttribute(attr))node.setAttribute(attr,node.getAttribute(attr).replace(/iiko/gi,'SH'));
     });
   };
   replaceVisibleText(document.body);
   if(document.title)document.title=document.title.replace(/iiko/gi,'SH');
   if(!document.body.dataset.shBrandingObserver){
     const observer=new MutationObserver(mutations=>mutations.forEach(m=>m.addedNodes.forEach(replaceVisibleText)));
     observer.observe(document.body,{childList:true,subtree:true});
     document.body.dataset.shBrandingObserver='1';
   }
 }
 function reveal(){root.classList.remove('hc-loading');root.style.visibility='visible';}
 function init(){
   ensureMasterStyles().then(()=>{
     installUnifiedStyle();
     removeLegacyStyles();
     buildUnifiedSidebar();
     window.addEventListener('beforeunload',()=>{root.style.background='#0b1017';root.style.visibility='hidden';});
     document.addEventListener('DOMContentLoaded',()=>{
       removeLegacyStyles();update();buildUnifiedSidebar();loadQrMenuSync();applySHBranding();update();reveal();
       const menu=document.querySelector('[data-mobile-menu]')||document.getElementById('mobileMenu'),side=document.querySelector('.sidebar');
       if(menu&&side)menu.onclick=()=>side.classList.toggle('open');
     });
     if(document.readyState!=='loading'){update();buildUnifiedSidebar();loadQrMenuSync();applySHBranding();reveal();}
   });
 }
 init();
})();
