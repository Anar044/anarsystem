(()=>{
  'use strict';
  const root=document.documentElement;
  // A single opt-in parent shell owns the sidebar. Legacy modules still
  // execute their own scripts and server-authorized actions in the content pane.
  try{
    if(window.frameElement?.dataset?.shPersistentWorkspace==='1'){
      root.classList.add('sh-pilot-embedded');
    }
  }catch(_){}
  // The protected child has finished site-access RBAC. Tell its SAME-ORIGIN
  // parent that the page can be displayed without waiting for unrelated
  // iframe load events (charts/fonts/other subresources).
  if(root.classList.contains('sh-pilot-embedded')){
    // UI-only instrumentation: milestones reveal where navigation latency
    // occurs without logging any user, restaurant, token or business data.
    const sendStage=stage=>{
      try{window.parent.postMessage({type:'sh:embedded-nav-stage',stage},location.origin)}catch(_){}
    };
    sendStage('frame-boot');
    document.addEventListener('sh-auth-ready',()=>sendStage('auth-ready'));
    document.addEventListener('sh-access-ready',()=>sendStage('access-ready'));
    window.addEventListener('sh:access-visibility-ready',()=>{
      if(window.SHAccess?.context?.allowed!==true)return;
      try{window.parent.postMessage({type:'sh:embedded-access-ready'},location.origin)}catch(_){}
    });
  }
  // The persistent workspace must not expose an unfinished business module.
  // Only opt-in modules publish a one-time initial-render-ready signal.
  // It never changes authorization, scope, navigation or user documents.
  let moduleInitialReady=false;
  window.SHModuleBootstrap={
    ready(){
      if(moduleInitialReady)return;
      moduleInitialReady=true;
      window.__SH_MODULE_INITIAL_RENDER_READY__=true;
      if(!root.classList.contains('sh-pilot-embedded'))return;
      try{window.parent.postMessage({type:'sh:embedded-module-ready'},location.origin)}catch(_){}
    }
  };
  function syncChainScopeCookie(ids=null){
    let values=Array.isArray(ids)?ids:null;
    if(!values){
      try{
        const raw=localStorage.getItem('shIikoSelectedRestaurants');
        const parsed=raw?JSON.parse(raw):null;
        values=Array.isArray(parsed)?parsed:[];
      }catch(_){values=[]}
    }
    values=[...new Set((values||[]).map(String).map(x=>x.trim()).filter(Boolean))];
    try{document.cookie=`sh_selected_departments=${encodeURIComponent(values.join(','))}; Path=/; SameSite=Lax; Max-Age=${values.length?31536000:0}`}catch(_){}
  }
  syncChainScopeCookie();
  window.addEventListener('sh:iiko-selection-changed',event=>syncChainScopeCookie(event?.detail?.departmentIds||[]));
  root.classList.add('hc-loading');
  root.style.background='#0b1017';
  root.style.visibility='hidden';
  try{localStorage.setItem('shReportsTheme','dark')}catch(e){}
  root.dataset.theme='dark';
  function isAuthPage(){return document.body&&document.body.dataset.authPage}
  function ensureMasterStyles(){if(isAuthPage())return Promise.resolve();if(document.querySelector('link[href*="app-shell.css"]'))return Promise.resolve();return new Promise(resolve=>{const link=document.createElement('link');link.rel='stylesheet';link.href='/app-shell.css?v=8';link.onload=resolve;link.onerror=resolve;document.head.appendChild(link)})}
  function installUnifiedStyle(){if(document.getElementById('hc-unified-style'))return;const style=document.createElement('style');style.id='hc-unified-style';style.textContent=`.sidebar{position:fixed!important;left:0!important;top:0!important;bottom:0!important;width:248px!important;height:100vh!important;display:flex!important;flex-direction:column!important;visibility:visible!important;opacity:1!important;transform:none!important;z-index:100!important;overflow-y:auto!important;overflow-x:hidden!important}.sidebar .unified-brand:before{content:none!important;display:none!important}.sidebar .unified-brand{display:flex!important;align-items:center!important;gap:10px!important;width:100%!important;min-width:0!important;height:auto!important;padding:7px 12px 28px!important;margin:0!important;box-sizing:border-box!important;color:#fff!important}.sidebar .unified-logo{width:31px!important;min-width:31px!important;height:31px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;flex:0 0 31px!important;margin:0!important;border-radius:9px!important;background:#42d392!important;color:#06110b!important;font-size:16px!important;font-weight:900!important;line-height:1!important;position:static!important}.sidebar .unified-brand .brand-copy{display:flex!important;flex-direction:column!important;justify-content:center!important;gap:2px!important;min-width:0!important;flex:1 1 auto!important;line-height:1.15!important}.sidebar .unified-brand .brand-copy b{display:block!important;margin:0!important;padding:0!important;color:#f4f7fa!important;font-size:17px!important;font-weight:850!important;white-space:nowrap!important;line-height:1.15!important}.sidebar .unified-brand .brand-copy small{display:block!important;margin:0!important;padding:0!important;color:#8994a3!important;font-size:11px!important;font-weight:500!important;white-space:nowrap!important;line-height:1.2!important}.documents-nav-group,.reports-nav-group{margin:0!important;padding:0!important;border:0!important}.documents-nav-toggle{appearance:none!important;-webkit-appearance:none!important;width:100%!important;min-height:42px!important;display:flex!important;align-items:center!important;justify-content:space-between!important;gap:10px!important;padding:10px 13px!important;margin:2px 0!important;border:1px solid transparent!important;border-radius:11px!important;background:transparent!important;color:#8fa0b3!important;font:600 13.5px/1 inherit!important;text-align:left!important;cursor:pointer!important;box-sizing:border-box!important}.documents-nav-toggle:hover{background:#121b25!important;color:#eef5fb!important;border-color:#1d2a37!important}.documents-nav-toggle.active{background:#15251f!important;color:#fff!important;border-color:#1f4a37!important;box-shadow:inset 3px 0 #42d392!important}.documents-nav-toggle-left{display:flex!important;align-items:center!important;gap:11px!important;min-width:0!important;flex:1 1 auto!important}.documents-nav-toggle-left>span:last-child{min-width:0!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}.documents-nav-folder{width:20px!important;min-width:20px!important;text-align:center!important;color:inherit!important}.documents-nav-chevron{width:18px!important;min-width:18px!important;height:18px!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;color:#8994a3!important;transition:transform .18s ease!important}.documents-nav-group.open .documents-nav-chevron,.reports-nav-group.open .documents-nav-chevron{transform:rotate(180deg)!important;color:#42d392!important}.documents-subnav{margin:3px 0 3px 8px!important;padding:2px 0 2px 8px!important;border-left:1px solid #26313d!important}.documents-subnav[hidden],.documents-nav-group:not(.open)>.documents-subnav,.reports-nav-group:not(.open)>.documents-subnav{display:none!important}.documents-subnav a{font-size:12px!important;min-height:38px!important}.main{margin-left:248px!important;width:calc(100% - 248px)!important;min-width:0!important;min-height:100vh!important;background:#0b1017!important}@media(max-width:760px){.sidebar{width:260px!important;transform:translateX(-100%)!important}.sidebar.open{transform:translateX(0)!important}.main{margin-left:0!important;width:100%!important}.topbar{padding:0 18px!important}.top-actions .icon-btn{display:none!important}}.sh-theme-toggle,.theme-btn,[data-theme-label]{display:none!important}@media(max-width:760px){html body .app-shell aside.sidebar,html body .app aside.sidebar{display:none!important;position:fixed!important;left:0!important;top:0!important;bottom:0!important;width:280px!important;height:100dvh!important;margin:0!important;transform:translate3d(-110%,0,0)!important;z-index:9999!important;overflow-y:auto!important;overflow-x:hidden!important}html body .app-shell aside.sidebar.open,html body .app aside.sidebar.open{display:flex!important;transform:translate3d(0,0,0)!important}html body .app-shell main.main,html body .app main.main{margin-left:0!important;width:100%!important;min-width:0!important}html body button[data-mobile-menu]{display:inline-flex!important;align-items:center!important;justify-content:center!important;width:40px!important;height:40px!important;flex:0 0 40px!important;padding:0!important;margin:0!important;visibility:visible!important;opacity:1!important;position:relative!important;z-index:20!important}}`;document.head.appendChild(style)}
  function removeLegacyStyles(){document.querySelectorAll('link[rel="stylesheet"]').forEach(link=>{const href=(link.getAttribute('href')||'').toLowerCase();if(href.includes('app-shell.css')||href.includes('hr-pnl.css')||href.includes('hr-employee.css')||href.includes('hr-timesheet.css')||href.includes('hr-payroll-v3.css')||href.includes('hr-payroll-v2.css')||href.includes('pnl.css')||href.includes('qr-menu.css')||href.includes('assets.css')||href.includes('plugin-control.css')||href.includes('supplier-balances.css')||href.includes('abc-xyz.css')||href.includes('cash.css')||href.includes('cash-history.css')||href.includes('cash-shifts.css')||href.includes('nakladnye.css')||href.includes('ai-documents.css')||href.includes('ai-assistant.css')||href.includes('rashodnye-nakladnye.css')||href.includes('nomenclature.css')||href.includes('stock-balances.css')||href.includes('stock-movements.css')||href.includes('procurement.css')||href.includes('procurement-trace.css')||href.includes('internal-orders.css')||href.includes('food-cost.css')||href.includes('labor-cost.css')||href.includes('reports-fields-scroll.css')||href.includes('reports-result.css')||href.includes('audit-log.css')||(isAuthPage()&&href.includes('auth.css')))return;link.remove()});const path=location.pathname.toLowerCase();if(!path.endsWith('/index.html')&&!path.endsWith('/')&&!isAuthPage())document.querySelectorAll('head > style').forEach(style=>{if(style.id!=='hc-unified-style'&&style.id!=='sh-workspace-shell-style'&&style.id!=='sh-mobile-responsive'&&style.id!=='cash-order-details-polish'&&style.id!=='incoming-invoices-critical-style'&&style.id!=='hrp-critical-styles'&&style.id!=='hrpa-critical-styles'&&style.id!=='wa-form-style'&&style.id!=='sh-product-picker-css'&&style.id!=='qr-orders-style')style.remove()})}
  function update(){
    root.dataset.theme='dark';
    document.querySelectorAll('[data-theme-label],.sh-theme-toggle,.theme-btn').forEach(e=>e.remove());
  }
  window.toggleSHTheme=function(){
    try{localStorage.setItem('shReportsTheme','dark')}catch(e){}
    root.dataset.theme='dark';
    update();
  };
  function currentPage(){const p=location.pathname.toLowerCase();if(p.endsWith('/ai-assistant')||p.endsWith('/ai-assistant.html'))return'ai-assistant.html';if(p.endsWith('/assets')||p.endsWith('/assets.html'))return'assets.html';if(p.endsWith('/ai-documents')||p.endsWith('/ai-documents.html'))return'ai-documents.html';if(p.endsWith('/nakladnye')||p.endsWith('/nakladnye.html'))return'nakladnye.html';if(p.endsWith('/rashodnye-nakladnye')||p.endsWith('/rashodnye-nakladnye.html'))return'rashodnye-nakladnye.html';if(p.endsWith('/akty-spisaniya')||p.endsWith('/akty-spisaniya.html'))return'akty-spisaniya.html';if(p.endsWith('/akty-realizatsii')||p.endsWith('/akty-realizatsii.html'))return'akty-realizatsii.html';if(p.endsWith('/vnutrennie-peremescheniya')||p.endsWith('/vnutrennie-peremescheniya.html'))return'vnutrennie-peremescheniya.html';if(p.endsWith('/nomenclature')||p.endsWith('/nomenclature.html'))return'nomenclature.html';if(p.endsWith('/stock-balances')||p.endsWith('/stock-balances.html'))return'stock-balances.html';if(p.endsWith('/stock-movements')||p.endsWith('/stock-movements.html'))return'stock-movements.html';if(p.endsWith('/internal-orders')||p.endsWith('/internal-orders.html'))return'internal-orders.html';if(p.endsWith('/procurement-trace')||p.endsWith('/procurement-trace.html'))return'procurement-trace.html';if(p.endsWith('/procurement')||p.endsWith('/procurement.html'))return'procurement.html';if(p.endsWith('/abc-xyz')||p.endsWith('/abc-xyz.html'))return'abc-xyz.html';if(p.endsWith('/menu-engineering')||p.endsWith('/menu-engineering.html'))return'menu-engineering.html';if(p.endsWith('/waiter-performance')||p.endsWith('/waiter-performance.html'))return'waiter-performance.html';if(p.endsWith('/pnl')||p.endsWith('/pnl.html'))return'pnl.html';if(p.endsWith('/reports')||p.endsWith('/reports.html'))return'reports.html';if(p.endsWith('/supplier-balances')||p.endsWith('/supplier-balances.html'))return'supplier-balances.html';if(p.endsWith('/food-cost')||p.endsWith('/food-cost.html'))return'food-cost.html';if(p.endsWith('/labor-cost')||p.endsWith('/labor-cost.html'))return'labor-cost.html';if(p.endsWith('/site-users')||p.endsWith('/site-users.html'))return'site-users.html';if(p.endsWith('/hr-employees')||p.endsWith('/hr-employees.html')||p.endsWith('/hr-employee')||p.endsWith('/hr-employee.html'))return'hr-employees.html';if(p.endsWith('/hr-role-schedules')||p.endsWith('/hr-role-schedules.html'))return'hr-role-schedules.html';if(p.endsWith('/hr-compensation')||p.endsWith('/hr-compensation.html'))return'hr-compensation.html';if(p.endsWith('/hr-payroll-adjustments')||p.endsWith('/hr-payroll-adjustments.html'))return'hr-payroll-adjustments.html';if(p.endsWith('/hr-payroll-accounting')||p.endsWith('/hr-payroll-accounting.html'))return'hr-payroll-accounting.html';if(p.endsWith('/hr-payroll')||p.endsWith('/hr-payroll.html'))return'hr-payroll.html';if(p.endsWith('/hr-timeclock')||p.endsWith('/hr-timeclock.html'))return'hr-timeclock.html';if(p.endsWith('/hr-timesheet')||p.endsWith('/hr-timesheet.html'))return'hr-timesheet.html';if(p.endsWith('/hr-calendar')||p.endsWith('/hr-calendar.html'))return'hr-calendar.html';if(p.endsWith('/cash')||p.endsWith('/cash.html')||p.endsWith('/cash/index.html'))return'cash.html';if(p.endsWith('/cash-shifts')||p.endsWith('/cash-shifts.html'))return'cash-shifts.html';if(p.endsWith('/settings')||p.endsWith('/settings.html'))return'settings.html';if(p.endsWith('/qr-order-admin')||p.endsWith('/qr-order-admin.html'))return'qr-order-admin.html';if(p.endsWith('/qr-menu')||p.endsWith('/qr-menu.html'))return'qr-menu.html';if(p.endsWith('/audit-log')||p.endsWith('/audit-log.html'))return'audit-log.html';if(p.endsWith('/finance')||p.endsWith('/finance.html'))return'finance.html';return'index.html'}
  // Standalone links (including deep HR links and clean Cloudflare URLs) must
  // enter the same persistent navigation as the Dashboard. Otherwise each
  // document rebuilds the menu and the workspace-only language selector is lost.
  // Never redirect embedded content, legacy hostnames, auth pages or settings.
  function persistentWorkspaceEntry(){
    const host=String(location.hostname||'').toLowerCase();
    if(host!=='smarthoreca.pages.dev'&&!host.endsWith('.smarthoreca.pages.dev'))return null;
    if(root.classList.contains('sh-pilot-embedded')||isAuthPage())return null;
    try{if(window.self!==window.top)return null}catch(_){return null}
    if(!document.querySelector('.app-shell > .sidebar'))return null;
    const page=currentPage();
    const path=location.pathname.replace(/\/+$/,'').toLowerCase();
    // currentPage uses index.html as a fallback for both Dashboard and unknown
    // admin/auth pages. Only the actual Dashboard is a workspace destination.
    const isDashboard=path==='/dashboard'||path==='/dashboard.html';
    // Only an explicit user recovery link may use the old protected Dashboard
    // when the parent shell cannot initialize. Normal navigation is unchanged.
    if(isDashboard&&new URLSearchParams(location.search).get('classic')==='1')return null;
    if((page==='index.html'&&!isDashboard)||page==='settings.html'||page==='cash.html')return null;
    // Permission filtering still happens only in the parent unified menu.
    const url=new URL('/persistent-workspace.html',location.origin);
    url.searchParams.set('target','/'+(isDashboard?'dashboard.html':page)+location.search+location.hash);
    return url.pathname+url.search;
  }
  const workspaceEntry=persistentWorkspaceEntry();
  if(workspaceEntry){
    location.replace(workspaceEntry);
    return;
  }
  const CANONICAL=['/index.html','/ai-assistant.html','/procurement.html','/finance.html','/reports.html','/abc-xyz.html','/pnl.html','/supplier-balances.html','/cash','/cash-shifts.html','/qr-menu.html','/audit-log.html'];
  // Preserve the navigation tree within the current browser tab. The full
  // page may reload, but its expanded groups and scroll position must not jump.
  const NAV_STATE_KEY='shUnifiedSidebarStateV1';
  function navGroupKey(group){
    if(group.classList.contains('procurement-nav-group'))return'procurement';
    if(group.classList.contains('internal-orders-nav-group'))return'internal-orders';
    if(group.classList.contains('reports-nav-group'))return'reports';
    if(group.classList.contains('hr-nav-group'))return'hr';
    return group.querySelector('.documents-subnav a[data-unified-nav-item]')?.dataset.unifiedNavItem||'other';
  }
  function readNavState(){
    try{
      const parsed=JSON.parse(sessionStorage.getItem(NAV_STATE_KEY)||'null');
      if(parsed&&typeof parsed==='object'&&parsed.groups&&typeof parsed.groups==='object'&&!Array.isArray(parsed.groups))
        return {groups:parsed.groups,scrollTop:Math.max(0,Number(parsed.scrollTop)||0)};
    }catch(_){}
    return {groups:{},scrollTop:0};
  }
  const savedNavState=readNavState();
  function writeNavState(){
    try{sessionStorage.setItem(NAV_STATE_KEY,JSON.stringify(savedNavState))}catch(_){}
  }
  function rememberSidebarNavigation(){
    const sidebar=document.querySelector('.sidebar');
    if(!sidebar)return;
    // A permission-hidden group must not overwrite the user's previous choice.
    sidebar.querySelectorAll('.documents-nav-group,.reports-nav-group').forEach(group=>{
      if(!group.hidden)savedNavState.groups[navGroupKey(group)]=group.classList.contains('open');
    });
    savedNavState.scrollTop=sidebar.scrollTop;
    writeNavState();
  }
  function restoreSidebarScroll(){
    const sidebar=document.querySelector('.sidebar');
    if(sidebar)sidebar.scrollTop=savedNavState.scrollTop;
  }
  function syncNavGroup(group,page){const toggle=group?.querySelector('.documents-nav-toggle');const sub=group?.querySelector('.documents-subnav');let activeItem=null;if(group?.classList.contains('procurement-nav-group')&&page==='procurement.html'){const view=new URLSearchParams(location.search).get('view')||'catalog';activeItem=sub?.querySelector(`a[data-procurement-view="${view}"]`)||sub?.querySelector('a[data-procurement-view="catalog"]')}else if(group?.classList.contains('internal-orders-nav-group')&&page==='internal-orders.html'){const view=new URLSearchParams(location.search).get('view')||'my';activeItem=sub?.querySelector(`a[data-internal-view="${view}"]`)||sub?.querySelector('a[data-internal-view="my"]')}else activeItem=sub?.querySelector(`a[data-unified-nav-item="${page}"]`);sub?.querySelectorAll('a[data-unified-nav-item]').forEach(a=>a.classList.toggle('active',a===activeItem));const key=navGroupKey(group);const hasChoice=Object.prototype.hasOwnProperty.call(savedNavState.groups,key);const open=hasChoice?!!savedNavState.groups[key]:!!activeItem;group?.classList.toggle('open',open);toggle?.classList.toggle('active',open);toggle?.setAttribute('aria-expanded',String(open));if(sub)sub.hidden=!open}
  function normalizeUnifiedSidebar(){const sidebar=document.querySelector('.sidebar');const nav=sidebar?.querySelector('.unified-main-nav');if(!nav)return;let auditLink=nav.querySelector(':scope > a[data-unified-nav-item="audit-log.html"]');if(!auditLink){auditLink=document.createElement('a');auditLink.href='/audit-log.html';auditLink.dataset.unifiedNavItem='audit-log.html';auditLink.innerHTML='<span class="side-icon">≣</span><span>Журнал действий</span>';nav.appendChild(auditLink)}const seen=new Set();nav.querySelectorAll(':scope > a').forEach(a=>{const href=(a.getAttribute('href')||'').split('#')[0].split('?')[0].replace(/\/$/,'').toLowerCase();if(!CANONICAL.includes(href)||seen.has(href)){a.remove();return}seen.add(href)});const page=currentPage();nav.querySelectorAll(':scope > a[data-unified-nav-item]').forEach(a=>a.classList.toggle('active',String(a.dataset.unifiedNavItem||'').toLowerCase()===page));nav.querySelectorAll('.documents-nav-group,.reports-nav-group').forEach(group=>syncNavGroup(group,page))}
  function buildUnifiedSidebar(){const sidebar=document.querySelector('.sidebar');if(!sidebar||sidebar.dataset.unifiedSidebar==='1')return;const page=currentPage();const active=x=>x===page?' class="active"':'';sidebar.innerHTML=`<div class="brand unified-brand"><div class="unified-logo">SH</div><div class="brand-copy"><b>Smart Horeca</b><small>Restaurant Management</small></div></div><div class="nav-title">ОСНОВНОЕ</div><nav class="side-nav nav unified-main-nav"><a href="/index.html" data-unified-nav-item="index.html" data-permission="dashboard.view"${active('index.html')}><span class="side-icon">⌂</span><span>Dashboard</span></a><a href="/ai-assistant.html" data-unified-nav-item="ai-assistant.html" data-permission="assistant.use"${active('ai-assistant.html')}><span class="side-icon">AI</span><span>AI Smart Horeca Assistent</span></a><a href="/cash" data-unified-nav-item="cash.html" data-permission="cash.view"${active('cash.html')}><span class="side-icon">▣</span><span>Кассы</span></a><a href="/cash-shifts.html" data-unified-nav-item="cash-shifts.html" data-permission="cash_shifts.view"${active('cash-shifts.html')}><span class="side-icon">▤</span><span>Кассовые смены</span></a><div class="documents-nav-group procurement-nav-group"><button type="button" class="documents-nav-toggle" aria-expanded="false"><span class="documents-nav-toggle-left"><span class="documents-nav-folder">◫</span><span>Внешние закупки</span></span><span class="documents-nav-chevron">⌄</span></button><nav class="side-nav nav documents-subnav" hidden><a href="/procurement.html?view=catalog" data-unified-nav-item="procurement.html" data-procurement-view="catalog" data-permission="procurement.request.create"><span class="side-icon">＋</span><span>Заказать товары</span></a><a href="/procurement.html?view=requests" data-unified-nav-item="procurement.html" data-procurement-view="requests" data-permission="procurement.request.view_own|procurement.request.view_all"><span class="side-icon">▤</span><span>Заявки PR</span></a><a href="/procurement.html?view=approvals" data-unified-nav-item="procurement.html" data-procurement-view="approvals" data-permission="procurement.approve"><span class="side-icon">✓</span><span>Согласование</span></a><a href="/procurement.html?view=sourcing" data-unified-nav-item="procurement.html" data-procurement-view="sourcing" data-permission="procurement.sourcing"><span class="side-icon">◈</span><span>RFQ и цены</span></a><a href="/procurement.html?view=suppliers" data-unified-nav-item="procurement.html" data-procurement-view="suppliers" data-permission="procurement.sourcing"><span class="side-icon">♢</span><span>Поставщики</span></a><a href="/procurement.html?view=orders" data-unified-nav-item="procurement.html" data-procurement-view="orders" data-permission="procurement.po.manage"><span class="side-icon">▣</span><span>Заказы PO</span></a><a href="/procurement.html?view=receiving" data-unified-nav-item="procurement.html" data-procurement-view="receiving" data-permission="procurement.receive"><span class="side-icon">↓</span><span>Приёмка</span></a><a href="/procurement-trace.html" data-unified-nav-item="procurement-trace.html" data-permission="procurement.receive|inventory.stock.view|procurement.settings.manage"><span class="side-icon">▦</span><span>Партии и хранение</span></a><a href="/procurement.html?view=analytics" data-unified-nav-item="procurement.html" data-procurement-view="analytics" data-permission="procurement.analytics"><span class="side-icon">▥</span><span>Аналитика</span></a><a href="/procurement.html?view=norms" data-unified-nav-item="procurement.html" data-procurement-view="norms" data-permission="procurement.norms.manage"><span class="side-icon">≋</span><span>Нормы запаса</span></a><a href="/procurement.html?view=settings" data-unified-nav-item="procurement.html" data-procurement-view="settings" data-permission="procurement.settings.manage"><span class="side-icon">⚙</span><span>Настройки закупок</span></a></nav></div><div class="documents-nav-group internal-orders-nav-group"><button type="button" class="documents-nav-toggle" aria-expanded="false"><span class="documents-nav-toggle-left"><span class="documents-nav-folder">⇄</span><span>Внутренние заказы</span></span><span class="documents-nav-chevron">⌄</span></button><nav class="side-nav nav documents-subnav" hidden><a href="/internal-orders.html?view=my" data-unified-nav-item="internal-orders.html" data-internal-view="my" data-permission="procurement.internal.request|procurement.internal.fulfill|procurement.internal.configure"><span class="side-icon">▤</span><span>Мои заявки</span></a><a href="/internal-orders.html?view=incoming" data-unified-nav-item="internal-orders.html" data-internal-view="incoming" data-permission="procurement.internal.fulfill|procurement.internal.configure"><span class="side-icon">↓</span><span>Входящие заказы</span></a><a href="/internal-orders.html?view=preparing" data-unified-nav-item="internal-orders.html" data-internal-view="preparing" data-permission="procurement.internal.fulfill|procurement.internal.configure"><span class="side-icon">▦</span><span>Комплектация</span></a><a href="/internal-orders.html?view=shipments" data-unified-nav-item="internal-orders.html" data-internal-view="shipments" data-permission="procurement.internal.fulfill|procurement.internal.configure"><span class="side-icon">⇧</span><span>Отгрузки</span></a><a href="/internal-orders.html?view=receiving" data-unified-nav-item="internal-orders.html" data-internal-view="receiving" data-permission="procurement.internal.request|procurement.internal.fulfill|procurement.internal.configure"><span class="side-icon">⇩</span><span>Приёмка</span></a><a href="/internal-orders.html?view=all" data-unified-nav-item="internal-orders.html" data-internal-view="all" data-permission="procurement.internal.configure"><span class="side-icon">≣</span><span>Все заказы</span></a><a href="/internal-orders.html?view=settings" data-unified-nav-item="internal-orders.html" data-internal-view="settings" data-permission="procurement.internal.configure"><span class="side-icon">⚙</span><span>Настройки</span></a></nav></div><div class="documents-nav-group"><button type="button" class="documents-nav-toggle" aria-expanded="false"><span class="documents-nav-toggle-left"><span class="documents-nav-folder">▣</span><span>Склад и справочники</span></span><span class="documents-nav-chevron">⌄</span></button><nav class="side-nav nav documents-subnav" hidden><a href="/nomenclature.html" data-unified-nav-item="nomenclature.html" data-permission="inventory.nomenclature.view"><span class="side-icon">▦</span><span>Номенклатура</span></a><a href="/stock-balances.html" data-unified-nav-item="stock-balances.html" data-permission="inventory.stock.view"><span class="side-icon">▤</span><span>Остатки на складах</span></a><a href="/stock-movements.html" data-unified-nav-item="stock-movements.html" data-permission="inventory.movements.view"><span class="side-icon">⇅</span><span>Движение товара</span></a><a href="/assets.html" data-unified-nav-item="assets.html" data-permission="inventory.assets.view"><span class="side-icon">▣</span><span>Инвентарь и основные средства</span></a><a href="/ai-documents.html" data-unified-nav-item="ai-documents.html" data-permission="inventory.ai_documents"><span class="side-icon">AI</span><span>AI Документы</span></a><a href="/nakladnye.html" data-unified-nav-item="nakladnye.html" data-permission="inventory.incoming.view"><span class="side-icon">▤</span><span>Приходные накладные</span></a><a href="/rashodnye-nakladnye.html" data-unified-nav-item="rashodnye-nakladnye.html" data-permission="inventory.outgoing.view"><span class="side-icon">▧</span><span>Расходные накладные</span></a><a href="/akty-spisaniya.html" data-unified-nav-item="akty-spisaniya.html" data-permission="inventory.writeoff.view"><span class="side-icon">▥</span><span>Акты списания</span></a><a href="/akty-realizatsii.html" data-unified-nav-item="akty-realizatsii.html" data-permission="inventory.outgoing.view"><span class="side-icon">▤</span><span>Акты реализации</span></a><a href="/vnutrennie-peremescheniya.html" data-unified-nav-item="vnutrennie-peremescheniya.html" data-permission="inventory.transfer.view"><span class="side-icon">⇄</span><span>Внутренние перемещения</span></a></nav></div><a href="/finance.html" data-unified-nav-item="finance.html" data-permission="finance.view"${active('finance.html')}><span class="side-icon">₽</span><span>Финансы</span></a><div class="reports-nav-group"><button type="button" class="documents-nav-toggle" aria-expanded="false"><span class="documents-nav-toggle-left"><span class="documents-nav-folder">▥</span><span>Отчёты</span></span><span class="documents-nav-chevron">⌄</span></button><nav class="side-nav nav documents-subnav" hidden><a href="/reports.html" data-unified-nav-item="reports.html" data-permission="reports.olap"><span class="side-icon">▥</span><span>OLAP Отчёты</span></a><a href="/abc-xyz.html" data-unified-nav-item="abc-xyz.html" data-permission="reports.abc_xyz"><span class="side-icon">◫</span><span>ABC / XYZ анализ</span></a><a href="/menu-engineering.html" data-unified-nav-item="menu-engineering.html" data-permission="reports.menu_engineering"><span class="side-icon">◩</span><span>Матрица BCG / Меню-инжиниринг</span></a><a href="/waiter-performance.html" data-unified-nav-item="waiter-performance.html" data-permission="reports.waiters"><span class="side-icon">♙</span><span>Рейтинг официантов / Средний чек</span></a><a href="/supplier-balances.html" data-unified-nav-item="supplier-balances.html" data-permission="reports.supplier_balances"><span class="side-icon">◈</span><span>Баланс по поставщикам</span></a><a href="/food-cost.html" data-unified-nav-item="food-cost.html" data-permission="reports.food_cost"><span class="side-icon">%</span><span>Фудкост и отклонения</span></a><a href="/labor-cost.html" data-unified-nav-item="labor-cost.html" data-permission="reports.labor_cost"><span class="side-icon">⌁</span><span>Лаборкост и производительность</span></a><a href="/pnl.html" data-unified-nav-item="pnl.html" data-permission="reports.pnl"><span class="side-icon">▤</span><span>Прибыли и убытки</span></a></nav></div><div class="documents-nav-group hr-nav-group"><button type="button" class="documents-nav-toggle" aria-expanded="false"><span class="documents-nav-toggle-left"><span class="documents-nav-folder">♟</span><span>Сотрудники</span></span><span class="documents-nav-chevron">⌄</span></button><nav class="side-nav nav documents-subnav" hidden><a href="/hr-employees.html" data-unified-nav-item="hr-employees.html" data-permission="hr.employees.view"><span class="side-icon">♙</span><span>Справочник сотрудников</span></a><a href="/site-users.html" data-unified-nav-item="site-users.html" data-permission="access.manage"><span class="side-icon">🔐</span><span>Доступ к Smart Horeca</span></a><a href="/hr-role-schedules.html" data-unified-nav-item="hr-role-schedules.html" data-permission="hr.schedules.view"><span class="side-icon">▤</span><span>Должности и нормы</span></a><a href="/hr-compensation.html" data-unified-nav-item="hr-compensation.html" data-permission="hr.compensation.view"><span class="side-icon">₼</span><span>Условия оплаты</span></a><a href="/hr-payroll-adjustments.html" data-unified-nav-item="hr-payroll-adjustments.html" data-permission="hr.payroll.view"><span class="side-icon">±</span><span>Авансы и корректировки</span></a><a href="/hr-payroll.html" data-unified-nav-item="hr-payroll.html" data-permission="hr.payroll.view"><span class="side-icon">≋</span><span>Расчёт зарплаты</span></a><a href="/hr-payroll-accounting.html" data-unified-nav-item="hr-payroll-accounting.html" data-permission="hr.payroll.view"><span class="side-icon">↔</span><span>Бухгалтерия Payroll</span></a><a href="/hr-timeclock.html" data-unified-nav-item="hr-timeclock.html" data-permission="hr.attendance.view"><span class="side-icon">◷</span><span>Учёт времени / Face ID</span></a><a href="/hr-timesheet.html" data-unified-nav-item="hr-timesheet.html" data-permission="hr.timesheet.view"><span class="side-icon">▦</span><span>Табель</span></a></nav></div><a href="/qr-menu.html" data-unified-nav-item="qr-menu.html" data-permission="qr.manage"${active('qr-menu.html')}><span class="side-icon">▦</span><span>QR Menu</span></a><a href="/qr-order-admin.html" data-unified-nav-item="qr-order-admin.html" data-permission="qr.manage"${active('qr-order-admin.html')}><span class="side-icon">▦</span><span>QR-заказы</span></a><a href="/audit-log.html" data-unified-nav-item="audit-log.html" data-permission="audit.view"${active('audit-log.html')}><span class="side-icon">≣</span><span>Журнал действий</span></a></nav><div class="sidebar-spacer"></div>`;sidebar.dataset.unifiedSidebar='1';sidebar.querySelectorAll('.documents-nav-group,.reports-nav-group').forEach(group=>{const toggle=group.querySelector('.documents-nav-toggle');const sub=group.querySelector('.documents-subnav');syncNavGroup(group,page);toggle?.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));toggle.classList.toggle('active',open);group.classList.toggle('open',open);sub.hidden=!open;savedNavState.groups[navGroupKey(group)]=open;rememberSidebarNavigation()})});normalizeUnifiedSidebar();sidebar.addEventListener('click',event=>{if(event.target.closest('a[href]'))rememberSidebarNavigation()},true);let pendingScroll=false;sidebar.addEventListener('scroll',()=>{if(pendingScroll)return;pendingScroll=true;requestAnimationFrame(()=>{pendingScroll=false;rememberSidebarNavigation()})},{passive:true});window.addEventListener('pagehide',rememberSidebarNavigation)}
  function applySHBranding(){
    const blocked=new Set(['SCRIPT','STYLE','PRE','CODE','NOSCRIPT']);
    const branded=value=>String(value??'').replace(/iiko/gi,'Smart Horeca');
    const replaceAttributes=element=>{
      if(!(element instanceof Element)||blocked.has(element.tagName))return;
      ['title','placeholder','aria-label','data-tooltip'].forEach(name=>{
        if(element.hasAttribute(name)&&/iiko/i.test(element.getAttribute(name)||''))element.setAttribute(name,branded(element.getAttribute(name)));
      });
    };
    const replaceVisibleText=node=>{
      if(node.nodeType===Node.TEXT_NODE){
        const parent=node.parentElement;
        if(parent&&!blocked.has(parent.tagName)&&/iiko/i.test(node.nodeValue||''))node.nodeValue=branded(node.nodeValue);
        return;
      }
      if(node.nodeType!==Node.ELEMENT_NODE||blocked.has(node.tagName))return;
      replaceAttributes(node);
      const walker=document.createTreeWalker(node,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT);
      const nodes=[];
      while(walker.nextNode())nodes.push(walker.currentNode);
      nodes.forEach(current=>current.nodeType===Node.TEXT_NODE?replaceVisibleText(current):replaceAttributes(current));
    };
    if(/iiko/i.test(document.title))document.title=branded(document.title);
    replaceVisibleText(document.body);
    if(window.__shBrandObserver)return;

    const pendingNodes=new Set();
    let brandFrame=0;
    const mayContainBrand=node=>{
      if(!node)return false;
      if(node.nodeType===Node.TEXT_NODE)return /iiko/i.test(node.nodeValue||'');
      if(node.nodeType!==Node.ELEMENT_NODE||blocked.has(node.tagName))return false;
      for(const name of ['title','placeholder','aria-label','data-tooltip']){
        if(node.hasAttribute?.(name)&&/iiko/i.test(node.getAttribute(name)||''))return true;
      }
      return /iiko/i.test(node.textContent||'');
    };
    const queueBrand=node=>{
      if(!mayContainBrand(node))return;
      pendingNodes.add(node);
      if(brandFrame)return;
      brandFrame=requestAnimationFrame(()=>{
        brandFrame=0;
        const nodes=[...pendingNodes];
        pendingNodes.clear();
        const roots=nodes.filter(node=>!nodes.some(other=>other!==node&&other.nodeType===Node.ELEMENT_NODE&&other.contains?.(node)));
        roots.forEach(replaceVisibleText);
      });
    };
    const observer=new MutationObserver(mutations=>{
      for(const mutation of mutations){
        if(mutation.type==='characterData')queueBrand(mutation.target);
        else if(mutation.type==='attributes'){
          if(mayContainBrand(mutation.target))replaceAttributes(mutation.target);
        }else{
          mutation.addedNodes.forEach(queueBrand);
        }
      }
    });
    observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['title','placeholder','aria-label','data-tooltip']});
    window.__shBrandObserver=observer;
  }
  function reveal(){root.classList.remove('hc-loading');root.style.visibility='visible'}
  async function markNetworkSharedPage(){
    const shared=new Set(["nomenclature.html","hr-calendar.html"]);
    if(!shared.has(currentPage())||!window.SH_IikoContext?.getBinding)return;
    try{
      const b=await window.SH_IikoContext.getBinding();
      const mode=String(b?.identity?.mode||b?.connection?.connectionType||"RMS").toUpperCase();
      if(mode!=="CHAIN")return;
      const sub=document.querySelector(".topbar-sub");
      if(sub&&!sub.dataset.chainShared){sub.dataset.chainShared="1";sub.textContent=(sub.textContent?sub.textContent+" · ":"")+"Общий для всей сети CHAIN"}
    }catch(_){}
  }

  function ensureMobileResponsive(){
    if(isAuthPage()||!document.body?.dataset.protected||window.__SH_MOBILE_RESPONSIVE__)return;
    // Most pages include the script themselves. Load it for protected pages
    // without that include as well (notably QR Menu).
    if(document.querySelector('script[src*="mobile-responsive.js"]'))return;
    const script=document.createElement('script');
    script.src='/mobile-responsive.js?v=20261009-role-aware-v2';
    script.async=true;
    document.body.appendChild(script);
  }
  function init(){ensureMasterStyles().then(()=>{
    if(root.classList.contains('sh-pilot-embedded')){
      // This document lives in the authenticated first-party content frame.
      // The parent already owns the only visible sidebar. Avoid rebuilding,
      // filtering and normalizing an entirely invisible duplicate 50+ link
      // tree for every navigation. Keep styles, branding, access and the
      // original business module initialization untouched.
      // Preserve the exact shared styling of existing modules; only skip
      // duplicate sidebar DOM work and its navigation event listeners.
      installUnifiedStyle();
      removeLegacyStyles();
      ensureMobileResponsive();
      applySHBranding();
      markNetworkSharedPage();
      reveal();
      return;
    }
    installUnifiedStyle();removeLegacyStyles();buildUnifiedSidebar();normalizeUnifiedSidebar();
    ensureMobileResponsive();applySHBranding();markNetworkSharedPage();
    const menu=document.querySelector('[data-mobile-menu]')||document.getElementById('mobileMenu'),side=document.querySelector('.sidebar');
    if(menu&&side)menu.onclick=()=>side.classList.toggle('open');
    // Restore the original fast navigation: do not block page rendering on
    // an asynchronous /api/access/me request on every full-page link.
    // Server-side APIs still authorize every privileged operation.
    // Keep the expansion/scroll preferences from the earlier sidebar fix.
    window.SHAccess?.applyVisibility?.(document.querySelector('.sidebar'));
    restoreSidebarScroll();
    reveal();
    requestAnimationFrame(restoreSidebarScroll);
  })}
  init();
})();
