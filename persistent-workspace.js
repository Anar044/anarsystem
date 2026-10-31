(()=>{
  'use strict';
  if(!document.body?.classList.contains('sh-workspace-page'))return;

  // Opt-in legacy bridge: first-party pages retain their independently protected HTML.
  // The shell only retains the menu and frames approved sections; it never grants access.
  const PROCUREMENT=Object.freeze({
    catalog:['procurement.request.create'],
    requests:['procurement.request.view_own','procurement.request.view_all'],
    approvals:['procurement.approve'],
    sourcing:['procurement.sourcing'],
    suppliers:['procurement.sourcing'],
    orders:['procurement.po.manage'],
    receiving:['procurement.receive'],
    analytics:['procurement.analytics'],
    norms:['procurement.norms.manage'],
    settings:['procurement.settings.manage']
  });
  const INTERNAL=['procurement.internal.request','procurement.internal.fulfill','procurement.internal.configure'];
  const host=document.getElementById('sh-workspace-host');
  const empty=document.getElementById('sh-workspace-empty');
  const status=document.getElementById('sh-workspace-status');
  const shellPath='/persistent-workspace.html';
  let currentFrame=null;
  let currentRoute=null;
  let pendingFrame=null;
  let pendingMode=null;
  let serial=0;
  let started=false;
  let navObserver=null;
  let routeWatch=null;
  // Opt-in performance trace: no tokens, user IDs or response payloads.
  // Add ?navDebug=1 on the workspace URL to log first render timings.
  const NAV_DEBUG=new URLSearchParams(location.search).get('navDebug')==='1';
  const routeTimings=new WeakMap();
  const timingPanel=document.getElementById('sh-nav-performance');
  if(NAV_DEBUG&&timingPanel){
    timingPanel.hidden=false;
    timingPanel.textContent='Диагностика переходов включена. Откройте раздел меню.';
  }
  function markNavigation(frame,stage){
    if(!NAV_DEBUG||!frame)return;
    const entry=routeTimings.get(frame);
    if(!entry)return;
    entry[stage]=Math.round(performance.now()-entry.start);
    if(timingPanel){
      const num=key=>entry[key]===undefined?'…':entry[key]+' мс';
      const apiElapsed=entry['access-response']!==undefined&&entry['access-request']!==undefined
        ?entry['access-response']-entry['access-request']+' мс':'…';
      timingPanel.textContent='Переход: '+entry.page+
        ' · начало '+num('frame-boot')+
        ' · авторизация '+num('auth-ready')+
        ' · запрос '+num('access-request')+
        ' · сервер '+apiElapsed+
        (entry.serverAuthMs===undefined?'':' · Supabase '+entry.serverAuthMs+' мс')+
        (entry.serverDbMs===undefined?'':' · D1 '+entry.serverDbMs+' мс')+
        ' · права '+num('access-ready')+
        ' · показ '+num('verified');
    }
    if(stage==='verified'||stage==='loaded'){
      console.info('[Smart Horeca Navigation]',{
        page:entry.page,
        step:stage,
        elapsedMs:entry[stage],
        frameBootMs:entry['frame-boot'],
        authMs:entry['auth-ready'],
        accessMs:entry['access-ready'],
        firstDisplayMs:entry.verified
      });
    }
  }


  // Cloudflare Pages serves HTML routes as clean URLs (e.g. /dashboard)
  // even when the sidebar links to /dashboard.html. Match both forms,
  // without changing the route loaded by any existing business module.
  function canonicalPagePath(path){
    const normalized=String(path||'/').replace(/\/+$/,'')||'/';
    if(normalized==='/'||normalized==='/index')return '/dashboard.html';
    if(normalized==='/cash'||normalized==='/cash/index.html')return '/cash';
    if(normalized.endsWith('.html'))return normalized;
    if(!normalized.split('/').pop().includes('.'))return normalized+'.html';
    return normalized;
  }
  function resolvePilotRoute(raw){
    let url;
    try{url=new URL(raw,location.origin)}catch(_){return null}
    if(url.origin!==location.origin)return null;
    const path=canonicalPagePath(url.pathname);
    if(path==='/index.html'||path==='/dashboard.html'){
      return{href:'/dashboard.html',label:'Dashboard',permissions:['dashboard.view']};
    }
    // QR Orders is a protected child of QR Menu, not a separate sidebar item.
    // Without an explicit route, opening it redirects to the default Dashboard.
    // Require the SAME qr.manage permission as the parent editor.
    if(path==='/qr-order-admin.html'){
      if(url.search||url.hash)return null;
      return{href:'/qr-order-admin.html',label:'QR-заказы и столы',permissions:['qr.manage']};
    }
    if(path==='/procurement.html'){
      const view=url.searchParams.get('view')||'catalog';
      if(!Object.prototype.hasOwnProperty.call(PROCUREMENT,view))return null;
      return{href:'/procurement.html?view='+encodeURIComponent(view),
        label:'Внешние закупки',permissions:PROCUREMENT[view]};
    }
    if(path==='/internal-orders.html'){
      const view=url.searchParams.get('view')||'my';
      const allowed=['my','incoming','preparing','shipments','receiving','all','settings'];
      if(!allowed.includes(view))return null;
      const permissions=view==='my'||view==='receiving'
        ? INTERNAL : view==='all'||view==='settings'
          ? ['procurement.internal.configure']
          : ['procurement.internal.fulfill','procurement.internal.configure'];
      return{href:'/internal-orders.html?view='+encodeURIComponent(view),
        label:'Внутренние заказы',permissions};
    }
    // Legacy modules retain their own protected HTML and business code.
    // Derive the remaining routes from the ONE permission-filtered sidebar,
    // not a second hand-maintained list of names and permission strings.
    const nav=document.querySelector('.sidebar .unified-main-nav');
    if(!nav)return null;
    const link=[...nav.querySelectorAll('a[href][data-unified-nav-item]')].find(a=>{
      try{
        const target=new URL(a.href,location.origin);
        return target.origin===url.origin&&canonicalPagePath(target.pathname)===path
          && !['/login.html','/register.html','/persistent-workspace.html'].includes(path);
      }catch(_){return false}
    });
    if(!link||link.hidden||link.closest('[hidden]')
       ||link.dataset.shAccessChecked!=='1')return null;
    // User-controlled query parameters cannot introduce authentication flows
    // or override a dedicated view; those must be checked as separate routes.
    if(['invite','access_token','refresh_token','code','token_hash'].some(key=>url.searchParams.has(key)))return null;
    const permissions=(link.dataset.permission||'').split('|').map(x=>x.trim()).filter(Boolean);
    if(!permissions.length)return null;
    return{href:(path==='/cash'?'/cash':path)+url.search,label:link.textContent.trim()||'Smart Horeca',
      permissions};
  }
  function permitted(route){
    return !!(route&&window.SHAccess?.context?.allowed
      &&window.SHAccess.canAny?.(route.permissions));
  }
  function shellUrl(route){
    const url=new URL(shellPath,location.origin);
    url.searchParams.set('target',route.href);
    if(NAV_DEBUG)url.searchParams.set('navDebug','1');
    return url.pathname+url.search;
  }
  function setStatus(message){if(status)status.textContent=message}
  function showEmpty(message){
    if(!empty)return;
    empty.textContent=message;
    empty.hidden=false;
  }
  // This does not grant permissions or skip authentication. It only makes a
  // stalled protected-shell bootstrap recoverable instead of showing a blank
  // screen indefinitely. The classic Dashboard applies its own existing RBAC.
  function showStartupRecovery(){
    if(currentFrame||document.getElementById('sh-access-denied'))return;
    const checking=window.SHAccess?.context;
    const message=checking?.allowed===false
      ?'Не удалось подтвердить доступ к рабочему разделу.'
      :'Smart Horeca не завершил открытие рабочего кабинета. Авторизация или проверка доступа могла остановиться.';
    showEmpty(message);
    if(!empty||empty.querySelector('[data-sh-shell-retry]'))return;
    const actions=document.createElement('div');
    actions.style.cssText='display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin-top:18px';
    const retry=document.createElement('a');
    retry.href=location.pathname+location.search;
    retry.textContent='Повторить открытие';
    retry.dataset.shShellRetry='1';
    const classic=document.createElement('a');
    classic.href='/dashboard.html?classic=1';
    classic.textContent='Открыть обычный Dashboard';
    classic.dataset.shShellClassic='1';
    for(const link of [retry,classic]){
      link.style.cssText='display:inline-flex;align-items:center;justify-content:center;padding:10px 13px;border:1px solid #34604c;border-radius:10px;background:#142820;color:#b9f5d7;text-decoration:none;font-size:13px;cursor:pointer';
      actions.appendChild(link);
    }
    empty.appendChild(actions);
    setStatus('Не удалось завершить открытие');
  }
  function isNavigableLink(link,event){
    return link&&(!event||!(event.ctrlKey||event.shiftKey||event.altKey||event.metaKey))
      &&(!link.target||link.target==='_self');
  }
  function sidebarNav(){
    return document.querySelector('.sidebar .unified-main-nav');
  }
  const SIDEBAR_COLLAPSE_KEY='shPersistentSidebarCollapsedV1';
  let expandedSidebarScroll=0;
  function isSidebarCollapsed(){
    return document.body.classList.contains('sh-sidebar-collapsed');
  }
  function setSidebarCollapsed(collapsed,{save=true}={}){
    const sidebar=document.querySelector('.sidebar');
    // The edge handle lives on <body> so the sidebar's overflow:hidden
    // cannot clip it while the navigation scrolls.
    const button=document.querySelector('body > .sh-sidebar-collapse-btn');
    if(!sidebar||!button)return;
    const wasCollapsed=isSidebarCollapsed();
    if(collapsed&&!wasCollapsed){
      expandedSidebarScroll=sidebar.scrollTop;
    }
    document.body.classList.toggle('sh-sidebar-collapsed',collapsed);
    if(collapsed)sidebar.scrollTop=0;
    else if(wasCollapsed)sidebar.scrollTop=expandedSidebarScroll;
    const text=collapsed?'Развернуть меню':'Свернуть меню';
    button.setAttribute('aria-label',text);
    button.setAttribute('title',text);
    button.setAttribute('aria-expanded',String(!collapsed));
    // CSS rotates the chevron towards the open direction when collapsed.
    // Keep focus, tooltip and aria-expanded usable by keyboard/screen reader.
    if(save){
      try{sessionStorage.setItem(SIDEBAR_COLLAPSE_KEY,collapsed?'1':'0')}catch(_){}
    }
  }
  function installSidebarCollapse(sidebar){
    if(!sidebar||document.querySelector('body > .sh-sidebar-collapse-btn'))return;
    const button=document.createElement('button');
    button.type='button';
    button.className='sh-sidebar-collapse-btn';
    button.innerHTML='<svg class="sh-sidebar-edge-svg" viewBox="0 0 30 70" aria-hidden="true" focusable="false"><path class="sh-sidebar-edge-shape" d="M1 1H6Q11 1 15 8L26 23Q29 27 29 32V38Q29 43 26 47L15 62Q11 69 6 69H1Z"/><path class="sh-sidebar-edge-chevron" d="M19 28L12 35L19 42"/></svg>';
    // Place outside the clipped sidebar: the tab straddles its right border.
    document.body.appendChild(button);
    const navForControl=sidebarNav();
    if(navForControl){
      navForControl.id ||= 'sh-primary-sidebar-navigation';
      button.setAttribute('aria-controls',navForControl.id);
    }
    button.addEventListener('click',()=>setSidebarCollapsed(!isSidebarCollapsed()));
    // Native tooltips and accessible names make icon-only mode understandable.
    const nav=sidebarNav();
    for(const link of nav?.querySelectorAll('a[href]')||[]){
      if(link.dataset.shAccessChecked!=='1'||link.hidden)continue;
      const name=link.textContent.trim().replace(/\s+/g,' ');
      if(!name)continue;
      link.title=name;
      link.setAttribute('aria-label',name);
    }
    for(const toggle of nav?.querySelectorAll('.documents-nav-toggle')||[]){
      const name=toggle.querySelector('.documents-nav-toggle-left')?.textContent.trim().replace(/\s+/g,' ')||'Открыть раздел';
      toggle.title=name;
      toggle.setAttribute('aria-label',name);
    }
    let saved=false;
    try{saved=sessionStorage.getItem(SIDEBAR_COLLAPSE_KEY)==='1'}catch(_){}
    setSidebarCollapsed(saved,{save:false});
  }
  function setGroupExpansion(group,open){
    // Never change RBAC visibility. Only update the view state of a
    // permission-approved group; users may still toggle groups themselves.
    if(!group||group.hidden)return;
    group.classList.toggle('open',open);
    const toggle=group.querySelector('.documents-nav-toggle');
    const sub=group.querySelector('.documents-subnav');
    toggle?.classList.toggle('active',open);
    toggle?.setAttribute('aria-expanded',String(open));
    if(sub)sub.hidden=!open;
  }
  function showOnlyGroup(selected){
    const nav=sidebarNav();if(!nav)return;
    for(const group of nav.querySelectorAll('.documents-nav-group,.reports-nav-group')){
      setGroupExpansion(group,group===selected);
    }
  }
  function activateMenu(route){
    if(!route)return;
    const nav=sidebarNav();if(!nav)return;
    let selectedGroup=null;
    for(const link of nav.querySelectorAll('a[href]')){
      const normalized=resolvePilotRoute(link.getAttribute('href'));
      // Leave original access-controlled visibility unchanged.
      const active=!!normalized&&(normalized.href===route.href
        ||(route.href==='/qr-order-admin.html'&&normalized.href==='/qr-menu.html'));
      link.classList.toggle('active',active);
      if(active)selectedGroup=link.closest('.documents-nav-group,.reports-nav-group');
    }
    // A new page selects its own category. Dashboard/AI/Cash have no
    // category, so old procurement, warehouse and HR folders close.
    showOnlyGroup(selectedGroup);
    // No scrollTop assignment: a category change never jumps the sidebar.
  }
  function syncAddress(route,mode='replace'){
    if(!route)return;
    const next=shellUrl(route);
    if(location.pathname+location.search===next)return;
    const fn=mode==='push'?'pushState':'replaceState';
    history[fn]({shPersistentRoute:route.href},'',next);
  }
  function readRequestedRoute(){
    const raw=new URL(location.href).searchParams.get('target');
    return raw?resolvePilotRoute(raw):null;
  }
  function chooseLandingRoute(){
    const requested=readRequestedRoute();
    if(permitted(requested))return requested;
    const candidates=[
      '/dashboard.html',
      ...Object.keys(PROCUREMENT).map(view=>'/procurement.html?view='+view),
      ...['my','incoming','preparing','shipments','receiving','all','settings']
        .map(view=>'/internal-orders.html?view='+view)
    ];
    const builtIn=candidates.map(resolvePilotRoute).find(permitted);
    if(builtIn)return builtIn;
    const nav=sidebarNav();
    const available=nav?[...nav.querySelectorAll('a[href][data-unified-nav-item]')]:[];
    return available.map(link=>resolvePilotRoute(link.href)).find(permitted)||null;
  }
  function childLocation(frame){
    try{return new URL(frame.contentWindow.location.href)}catch(_){return null}
  }
  // Show the first-party module as soon as same-origin RBAC is verified.
  // Each business page already presents its own loading state and controls.
  // Waiting for long-running stock/reference API calls here made ordinary
  // navigation appear frozen for 60-90 seconds. This shell never authorizes
  // operations: data and edit controls remain guarded by each module.
  function revealFrame(frame,route,mode){
    if(pendingFrame!==frame)return;
    pendingFrame=null;
    pendingMode=null;
    host.classList.remove('sh-is-loading');
    markNavigation(frame,'verified');
    frame.classList.remove('sh-pending');
    if(currentFrame&&currentFrame!==frame)currentFrame.remove();
    currentFrame=frame;
    currentRoute=route;
    empty.hidden=true;
    activateMenu(route);
    syncAddress(route,mode);
    setStatus('Открыто: '+route.label);
  }
  function frameFailure(frame,message){
    if(frame!==pendingFrame)return;
    frame.remove();
    pendingFrame=null;
    pendingMode=null;
    host.classList.remove('sh-is-loading');
    if(currentRoute)activateMenu(currentRoute);
    setStatus('Ошибка открытия');
    if(!currentFrame)showEmpty(message);
    else setStatus(message);
  }
  window.addEventListener('message',event=>{
    if(!NAV_DEBUG||event.origin!==location.origin||event.data?.type!=='sh:embedded-server-timing')return;
    const frame=pendingFrame||currentFrame;
    if(!frame||event.source!==frame.contentWindow)return;
    const entry=routeTimings.get(frame);
    if(!entry)return;
    const value=event.data;
    if(Number.isFinite(value.supabaseMs)&&value.supabaseMs>=0&&value.supabaseMs<=20000)entry.serverAuthMs=Math.round(value.supabaseMs);
    if(Number.isFinite(value.d1Ms)&&value.d1Ms>=0&&value.d1Ms<=20000)entry.serverDbMs=Math.round(value.d1Ms);
    markNavigation(frame,'server-breakdown');
  });
  window.addEventListener('message',event=>{
    if(!NAV_DEBUG||event.origin!==location.origin||event.data?.type!=='sh:embedded-nav-stage')return;
    const frame=pendingFrame||currentFrame;
    if(!frame||event.source!==frame.contentWindow)return;
    if(!['frame-boot','auth-ready','access-request','access-response','access-body','access-ready'].includes(event.data.stage))return;
    markNavigation(frame,event.data.stage);
  });
  function onAccessReadyMessage(event){
    if(event.origin!==location.origin||event.data?.type!=='sh:embedded-access-ready')return;
    const frame=pendingFrame;
    if(!frame||event.source!==frame.contentWindow)return;
    const url=childLocation(frame);
    const route=url?resolvePilotRoute(url.href):null;
    if(!route||!permitted(route))return;
    if(frame.contentWindow.SHAccess?.context?.allowed!==true)return;
    if(frame.contentDocument?.getElementById('sh-access-denied'))return;
    // Same-origin first-party page and its own RBAC are confirmed. Present
    // content as soon as ready, without waiting for charts/fonts to finish.
    revealFrame(frame,route,pendingMode||'push');
  }
  window.addEventListener('message',onAccessReadyMessage);
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.data?.type!=='sh:embedded-module-ready')return;
    const frame=pendingFrame;
    if(!frame||event.source!==frame.contentWindow)return;
    // Never trust the message alone: RBAC, URL and same-origin document are
    // still verified by the existing access-ready handler.
    onAccessReadyMessage({
      origin:event.origin,source:event.source,
      data:{type:'sh:embedded-access-ready'}
    });
  });
  function onFrameLoad(frame,intendedRoute,mode){
    const url=childLocation(frame);
    if(!url){
      frameFailure(frame,'Не удалось проверить адрес встроенной страницы.');
      return;
    }
    if(url.origin!==location.origin){
      frameFailure(frame,'Встраивание внешних страниц отключено.');
      return;
    }
    if(canonicalPagePath(url.pathname)==='/login.html'){
      // An expired session should never show a nested login in the iframe.
      location.assign('/login.html');
      return;
    }
    const route=resolvePilotRoute(url.href);
    if(!route){
      // Links to modules outside the pilot continue to work as normal pages.
      if(frame===currentFrame)location.assign(url.pathname+url.search+url.hash);
      else frameFailure(frame,'Страница не входит в пилот постоянного меню.');
      return;
    }
    if(!permitted(route)){
      frameFailure(frame,'Недостаточно прав для открытия раздела.');
      return;
    }
    const win=frame.contentWindow;
    const childContext=win.SHAccess?.context;
    if(childContext?.allowed===true){
      revealFrame(frame,route,mode);
      return;
    }
    if(childContext?.allowed===false){
      frameFailure(frame,'Сервер отклонил доступ к выбранной странице: '+(childContext.reason||'ACCESS_DENIED'));
      return;
    }
    let settled=false;
    const complete=()=>{
      if(settled||frame!==pendingFrame)return;
      const context=win.SHAccess?.context;
      if(!context)return;
      settled=true;
      cleanup();
      if(context.allowed)revealFrame(frame,route,mode);
      else frameFailure(frame,'Доступ к разделу не подтверждён: '+(context.reason||'ACCESS_DENIED'));
    };
    const onAccessEvent=()=>setTimeout(complete,0);
    const timeout=setTimeout(()=>{
      if(settled||frame!==pendingFrame)return;
      settled=true;cleanup();
      frameFailure(frame,'Проверка доступа к разделу не завершилась. Откройте его отдельно или повторите переход.');
    },12000);
    const cleanup=()=>{
      clearTimeout(timeout);
      win.removeEventListener('sh:access-visibility-ready',onAccessEvent);
      win.document.removeEventListener('sh-access-ready',onAccessEvent);
    };
    win.addEventListener('sh:access-visibility-ready',onAccessEvent);
    win.document.addEventListener('sh-access-ready',onAccessEvent);
    complete();
  }
  function openRoute(route,{historyMode='push'}={}){
    if(!permitted(route)){
      setStatus('Нет доступа к разделу');
      return;
    }
    if(currentFrame&&currentRoute?.href===route.href&&!pendingFrame){
      activateMenu(route);
      return;
    }
    // Switching tabs inside the same mounted module is not navigation to
    // another HTML document. Keep the iframe, fetched references, and user's
    // in-progress state. Each module validates whether an unsaved form is open.
    if(currentFrame&&!pendingFrame&&currentRoute
      &&currentFrame.contentWindow?.SHAccess?.context?.allowed===true){
      const nowPath=canonicalPagePath(new URL(currentRoute.href,location.origin).pathname);
      const nextPath=canonicalPagePath(new URL(route.href,location.origin).pathname);
      const win=currentFrame.contentWindow;
      const handler=nowPath===nextPath
        ?(nextPath==='/procurement.html'?win.SHProcurementNavigation
          :nextPath==='/internal-orders.html'?win.SHInternalOrdersNavigation:null)
        :null;
      if(handler&&typeof handler.go==='function'){
        const view=new URL(route.href,location.origin).searchParams.get('view');
        if(handler.go(view)===true){
          currentRoute=route;
          activateMenu(route);
          syncAddress(route,historyMode);
          setStatus('Открыто: '+route.label);
        }
        return;
      }
    }
    // Re-clicking a pending route must not discard its already-in-progress
    // document, Supabase session check and API requests.
    if(pendingFrame?.getAttribute('src')===route.href){
      activateMenu(route);
      return;
    }
    const id=++serial;
    if(pendingFrame){pendingFrame.remove();pendingFrame=null}
    // Select the destination immediately, rather than leaving old folders
    // expanded for the entire first-load delay.
    activateMenu(route);
    const frame=document.createElement('iframe');
    if(NAV_DEBUG)routeTimings.set(frame,{page:new URL(route.href,location.origin).pathname,start:performance.now()});
    frame.className='sh-workspace-frame sh-pending';
    frame.dataset.shPersistentWorkspace='1';
    if(NAV_DEBUG)frame.dataset.shNavDebug='1';
    frame.title='Smart Horeca — '+route.label;
    frame.referrerPolicy='same-origin';
    // No sandbox: these first-party modules require their existing auth and
    // document scripts. This is NOT an external/content-untrusted iframe.
    frame.src=route.href;
    frame.addEventListener('load',()=>{
      if(id!==serial)return;
      markNavigation(frame,'loaded');
      if(frame===pendingFrame)onFrameLoad(frame,route,historyMode);
      else if(frame===currentFrame)observeEmbeddedNavigation(frame);
    });
    pendingFrame=frame;
    pendingMode=historyMode;
    host.classList.add('sh-is-loading');
    host.appendChild(frame);
    setStatus('Открываем: '+route.label);
  }
  function observeEmbeddedNavigation(frame){
    const url=childLocation(frame);
    const route=url?resolvePilotRoute(url.href):null;
    if(!route){
      if(url?.origin===location.origin)location.assign(url.pathname+url.search+url.hash);
      return;
    }
    if(!permitted(route))return;
    const ctx=frame.contentWindow.SHAccess?.context;
    if(ctx?.allowed===true&&route.href!==currentRoute?.href){
      currentRoute=route;
      activateMenu(route);
      syncAddress(route,'push');
      setStatus('Открыто: '+route.label);
    }
  }
  function syncEmbeddedRoute(frame){
    // The child only signals that its location might have changed. Never use
    // route data from the message; re-read the authorized same-origin iframe.
    if(!frame||frame!==currentFrame||pendingFrame)return;
    const url=childLocation(frame);
    const route=url?resolvePilotRoute(url.href):null;
    if(!route||!permitted(route)||frame.contentWindow.SHAccess?.context?.allowed!==true)return;
    if(frame.contentDocument?.getElementById('sh-access-denied'))return;
    if(route.href===currentRoute?.href)return;
    currentRoute=route;
    activateMenu(route);
    syncAddress(route,'replace');
    setStatus('Открыто: '+route.label);
  }
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.data?.type!=='sh:embedded-route-changed')return;
    if(!currentFrame||event.source!==currentFrame.contentWindow)return;
    syncEmbeddedRoute(currentFrame);
  });
  function observeChildHistory(){
    // Event-driven for updated internal orders and procurement; a low-rate
    // fallback keeps old modules' history.replaceState links compatible.
    // No API request, page reload or global history monkey patch.
    if(routeWatch)clearInterval(routeWatch);
    routeWatch=setInterval(()=>{
      if(document.hidden)return;
      syncEmbeddedRoute(currentFrame);
    },5000);
  }
  // Warm the next document's PUBLIC, static HTML on deliberate pointer
  // intent. The browser handles this at low priority; prefetch neither
  // executes its scripts nor calls its authenticated APIs. Restricted and
  // cache-control:no-store modules are intentionally excluded.
  const STATIC_PREFETCH_PAGES=new Set([
    '/dashboard.html','/procurement.html','/internal-orders.html',
    '/cash-shifts.html','/ai-assistant.html','/reports.html',
    '/nomenclature.html','/stock-balances.html','/stock-movements.html'
  ]);
  const prefetchedPages=new Set();
  let hoverPrefetchTimer=0;
  function eligibleStaticPrefetch(rawLink){
    const link=rawLink?.closest?.('a[href]');
    if(!link||link.dataset.shAccessChecked!=='1'||link.hidden||link.closest('[hidden]'))return null;
    const route=resolvePilotRoute(link.href);
    if(!permitted(route))return null;
    const url=new URL(route.href,location.origin);
    const path=canonicalPagePath(url.pathname);
    if(!STATIC_PREFETCH_PAGES.has(path))return null;
    if(path===canonicalPagePath(new URL(currentRoute?.href||'/persistent-workspace.html',location.origin).pathname))return null;
    return path;
  }
  function prefetchStaticPage(path){
    if(!path||prefetchedPages.has(path)||prefetchedPages.size>=6)return;
    // Respect limited or metered connections; navigation still works normally.
    if(navigator.connection?.saveData)return;
    prefetchedPages.add(path);
    const link=document.createElement('link');
    link.rel='prefetch';
    link.as='document';
    link.href=path;
    link.dataset.shNavPrefetch='static-only';
    document.head.appendChild(link);
  }
  function scheduleSidebarPrefetch(event){
    clearTimeout(hoverPrefetchTimer);
    const path=eligibleStaticPrefetch(event.target);
    if(path)hoverPrefetchTimer=setTimeout(()=>prefetchStaticPage(path),100);
  }
  function installSidebarPrefetch(sidebar){
    if(!sidebar||sidebar.dataset.shPrefetchReady==='1')return;
    sidebar.dataset.shPrefetchReady='1';
    sidebar.addEventListener('pointerover',scheduleSidebarPrefetch,{passive:true});
    sidebar.addEventListener('pointerout',()=>clearTimeout(hoverPrefetchTimer),{passive:true});
    sidebar.addEventListener('focusin',scheduleSidebarPrefetch);
    sidebar.addEventListener('focusout',()=>clearTimeout(hoverPrefetchTimer));
  }
  function onSidebarClick(event){
    const groupToggle=event.target.closest('.documents-nav-toggle');
    if(groupToggle){
      if(isSidebarCollapsed()){
        // Expand the rail and reset this group to closed before its ORIGINAL
        // handler runs. It will open the group and persist state normally.
        // Do not cancel the click or alter any menu/business handlers.
        const group=groupToggle.closest('.documents-nav-group,.reports-nav-group');
        setSidebarCollapsed(false);
        if(group)setGroupExpansion(group,false);
      }
      // Run after app-shell.js updates the clicked button. Only one folder
      // remains open, but clicking a folder does not navigate or fetch data.
      queueMicrotask(()=>{
        const group=groupToggle.closest('.documents-nav-group,.reports-nav-group');
        if(group?.classList.contains('open'))showOnlyGroup(group);
      });
      return;
    }
    const link=event.target.closest('a[href]');
    if(!isNavigableLink(link,event))return;
    const route=resolvePilotRoute(link.href);
    if(!route)return;
    event.preventDefault();
    openRoute(route);
  }
  function ensureMenu(){
    const nav=sidebarNav();
    if(!nav)return false;
    installSidebarCollapse(nav.closest('.sidebar'));
    installSidebarPrefetch(nav.closest('.sidebar'));
    // Apply the saved language before the access-approved sidebar is shown.
    window.SH_I18N?.applyNow?.();
    document.body.classList.add('sh-workspace-ready');
    nav.closest('.sidebar').addEventListener('click',onSidebarClick,true);
    if(navObserver){navObserver.disconnect();navObserver=null}
    const landing=chooseLandingRoute();
    if(landing)openRoute(landing,{historyMode:'replace'});
    else{
      setStatus('Нет доступных пилотных разделов');
      showEmpty('У пользователя нет доступа к Dashboard, закупкам или внутренним заказам.');
    }
    observeChildHistory();
    return true;
  }
  function start(){
    if(started||!window.SHAccess?.context?.allowed)return;
    // The access event may fire before the sidebar is mounted. Do not mark
    // startup finished until the authorized menu has really been installed.
    try{
      if(ensureMenu()){
        started=true;
        return;
      }
    }catch(_){
      showStartupRecovery();
      return;
    }
    if(!navObserver){
      navObserver=new MutationObserver(()=>start());
      navObserver.observe(document.body,{subtree:true,childList:true});
    }
  }
  window.addEventListener('sh:access-visibility-ready',start);
  document.addEventListener('sh-access-ready',()=>setTimeout(start,0));
  // Auth and sidebar scripts are independently loaded. Re-check the verified
  // access context after window load even if the original ready event was lost.
  window.addEventListener('load',start);
  window.addEventListener('popstate',()=>{
    const route=chooseLandingRoute();
    if(route)openRoute(route,{historyMode:'none'});
  });
  // No automatic redirect from production Dashboard: only this opt-in URL
  // activates a persistent workspace. Browser Back is handled on the parent.
  if(window.SHAccess?.context?.allowed)start();
  // A slow/suspended auth SDK or an iframe that never fires "load" previously
  // left the protected shell at "Открываем доступный раздел..." forever.
  // The watchdog only adds recovery controls; it never exposes protected data.
  setTimeout(()=>{
    // One final authorization-aware attempt before showing recovery.
    if(!started&&window.SHAccess?.context?.allowed)start();
    if(currentFrame||document.getElementById('sh-access-denied'))return;
    if(pendingFrame){
      // A frame still pending here has not completed its protected access
      // handshake. Data API latency is handled inside an already opened
      // module, not by a hidden iframe or a second 75-second watchdog.
      frameFailure(pendingFrame,'Не удалось подтвердить доступ к разделу. Повторите переход.');
    }
    showStartupRecovery();
  },18000);
})();