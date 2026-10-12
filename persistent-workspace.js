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
  let serial=0;
  let started=false;
  let navObserver=null;
  let routeWatch=null;

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
    return url.pathname+url.search;
  }
  function setStatus(message){if(status)status.textContent=message}
  function showEmpty(message){
    if(!empty)return;
    empty.textContent=message;
    empty.hidden=false;
  }
  function isNavigableLink(link,event){
    return link&&(!event||!(event.ctrlKey||event.shiftKey||event.altKey||event.metaKey))
      &&(!link.target||link.target==='_self');
  }
  function sidebarNav(){
    return document.querySelector('.sidebar .unified-main-nav');
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
      const active=!!normalized&&normalized.href===route.href;
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
  function revealFrame(frame,route,mode){
    if(pendingFrame!==frame)return;
    pendingFrame=null;
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
    setStatus('Ошибка открытия');
    if(!currentFrame)showEmpty(message);
    else setStatus(message);
  }
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
    const id=++serial;
    if(pendingFrame){pendingFrame.remove();pendingFrame=null}
    const frame=document.createElement('iframe');
    frame.className='sh-workspace-frame sh-pending';
    frame.dataset.shPersistentWorkspace='1';
    frame.title='Smart Horeca — '+route.label;
    frame.referrerPolicy='same-origin';
    // No sandbox: these first-party modules require their existing auth and
    // document scripts. This is NOT an external/content-untrusted iframe.
    frame.src=route.href;
    frame.addEventListener('load',()=>{
      if(id!==serial)return;
      if(frame===pendingFrame)onFrameLoad(frame,route,historyMode);
      else if(frame===currentFrame)observeEmbeddedNavigation(frame);
    });
    pendingFrame=frame;
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
  function observeChildHistory(){
    // Internal Orders updates its own URL via history.replaceState without
    // a frame load. Read the URL only (no polling of restaurant/API data).
    if(routeWatch)clearInterval(routeWatch);
    routeWatch=setInterval(()=>{
      if(!currentFrame||pendingFrame)return;
      const url=childLocation(currentFrame);
      const route=url?resolvePilotRoute(url.href):null;
      if(route&&permitted(route)&&currentFrame.contentWindow.SHAccess?.context?.allowed
        &&route.href!==currentRoute?.href){
        currentRoute=route;
        activateMenu(route);
        syncAddress(route,'replace');
        setStatus('Открыто: '+route.label);
      }
    },750);
  }
  function onSidebarClick(event){
    const groupToggle=event.target.closest('.documents-nav-toggle');
    if(groupToggle){
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
    started=true;
    if(ensureMenu())return;
    navObserver=new MutationObserver(()=>ensureMenu());
    navObserver.observe(document.body,{subtree:true,childList:true});
  }
  window.addEventListener('sh:access-visibility-ready',start);
  document.addEventListener('sh-access-ready',()=>setTimeout(start,0));
  window.addEventListener('popstate',()=>{
    const route=chooseLandingRoute();
    if(route)openRoute(route,{historyMode:'none'});
  });
  // No automatic redirect from production Dashboard: only this opt-in URL
  // activates a persistent workspace. Browser Back is handled on the parent.
  if(window.SHAccess?.context?.allowed)start();
})();