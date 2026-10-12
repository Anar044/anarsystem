(()=>{
  'use strict';
  if(!document.body?.classList.contains('sh-workspace-page'))return;

  // Opt-in pilot: all pages are existing first-party, independently protected HTML.
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

  function resolvePilotRoute(raw){
    let url;
    try{url=new URL(raw,location.origin)}catch(_){return null}
    if(url.origin!==location.origin)return null;
    if(url.pathname==='/index.html'||url.pathname==='/dashboard.html'){
      return{href:'/dashboard.html',label:'Dashboard',permissions:['dashboard.view']};
    }
    if(url.pathname==='/procurement.html'){
      const view=url.searchParams.get('view')||'catalog';
      if(!Object.prototype.hasOwnProperty.call(PROCUREMENT,view))return null;
      return{href:'/procurement.html?view='+encodeURIComponent(view),
        label:'Внешние закупки',permissions:PROCUREMENT[view]};
    }
    if(url.pathname==='/internal-orders.html'){
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
    return null;
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
  function activateMenu(route){
    if(!route)return;
    const nav=sidebarNav();if(!nav)return;
    for(const link of nav.querySelectorAll('a[href]')){
      const normalized=resolvePilotRoute(link.getAttribute('href'));
      // Leave original access-controlled visibility unchanged.
      link.classList.toggle('active',!!normalized&&normalized.href===route.href);
    }
    // Deliberately keep expanded/collapsed groups and scroll unchanged.
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
      '/procurement.html?view=requests',
      '/procurement.html?view=catalog',
      '/internal-orders.html?view=my',
      '/internal-orders.html?view=incoming'
    ];
    return candidates.map(resolvePilotRoute).find(permitted)||null;
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
    if(url.pathname==='/login.html'){
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