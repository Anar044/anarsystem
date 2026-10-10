(function(){
'use strict';
if(window.__SH_MOBILE_RESPONSIVE__)return;window.__SH_MOBILE_RESPONSIVE__=true;
const style=document.createElement('style');style.id='sh-mobile-responsive';style.textContent=`@media(max-width:760px){html,body{width:100%;max-width:100%;overflow-x:hidden!important;-webkit-text-size-adjust:100%}body.sh-has-mobile-nav{padding-bottom:calc(88px + env(safe-area-inset-bottom, 0px))!important}.app-shell,.app{display:block!important;width:100%!important;min-width:0!important}.main{width:100%!important;min-width:0!important;margin:0!important}.topbar{height:64px!important;min-height:64px!important;padding:0 14px!important;position:sticky!important;top:0!important;z-index:90!important}.topbar .title,.topbar-title{font-size:15px!important;line-height:1.15!important}.topbar .crumb,.topbar-sub{font-size:10px!important;white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;max-width:230px!important}.topbar .avatar,.topbar .user-avatar{width:34px!important;height:34px!important;min-width:34px!important}.top-actions{gap:5px!important}.sidebar{display:none!important}
.sh-mobile-nav{position:fixed!important;left:9px!important;right:9px!important;bottom:calc(8px + env(safe-area-inset-bottom, 0px))!important;min-height:66px!important;display:grid!important;grid-template-columns:repeat(var(--sh-mobile-items,5),minmax(0,1fr))!important;gap:3px!important;padding:5px!important;background:rgba(15,21,29,.98)!important;border:1px solid #273340!important;border-radius:18px!important;box-shadow:0 14px 40px rgba(0,0,0,.42)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important;z-index:9999!important}
.sh-mobile-nav a,.sh-mobile-nav button{display:flex!important;min-width:0!important;min-height:54px!important;flex-direction:column!important;align-items:center!important;justify-content:center!important;gap:3px!important;padding:4px 3px!important;border:0!important;border-radius:12px!important;text-decoration:none!important;color:#a6b3c1!important;background:transparent!important;font-family:inherit!important;font-size:10px!important;font-weight:650!important;line-height:1.2!important;cursor:pointer!important}
.sh-mobile-nav a.active,.sh-mobile-nav button.active{background:#15251f!important;color:#42d392!important}
.sh-mobile-nav .mnav-icon{font-size:21px!important;line-height:23px!important}
.sh-mobile-nav .mnav-label{white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important;max-width:100%!important}
.sh-mobile-more-overlay{position:fixed!important;inset:0!important;background:rgba(3,8,14,.72)!important;z-index:10005!important;display:flex!important;align-items:flex-end!important;justify-content:center!important}
.sh-mobile-more-sheet{box-sizing:border-box!important;width:100%!important;max-height:min(78dvh,690px)!important;overflow-y:auto!important;background:#101922!important;border:1px solid #344251!important;border-radius:20px 20px 0 0!important;padding:16px 16px calc(25px + env(safe-area-inset-bottom, 0px))!important;color:#eaf1f7!important;box-shadow:0 -20px 70px #0008!important}
.sh-mobile-more-header{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px!important;margin:0 0 12px!important}
.sh-mobile-more-header strong{font-size:17px!important}
.sh-mobile-more-close{width:40px!important;height:40px!important;border:1px solid #344251!important;border-radius:12px!important;background:#1a2733!important;color:#eaf1f7!important;font-size:22px!important}
.sh-mobile-more-group{margin:14px 0!important}
.sh-mobile-more-group h3{margin:4px 3px 8px!important;color:#95a6b6!important;font-size:11px!important;text-transform:uppercase!important;letter-spacing:.07em!important}
.sh-mobile-more-group a{display:block!important;margin:3px 0!important;padding:13px!important;border-radius:10px!important;background:#172430!important;color:#eaf1f7!important;text-decoration:none!important;font-size:14px!important}
.sh-mobile-more-group a[aria-current="page"]{background:#173526!important;color:#64e2ab!important}
.content,.page,.app-content,.reports-page,.settings-page,.finance-page,.accounts-page{width:100%!important;max-width:none!important;margin:0!important;padding:18px 14px 30px!important;min-width:0!important}.finance-page{padding:18px 14px 34px!important}.finance-page .fin-table-wrap{width:100%!important;overflow-x:auto!important}.finance-page .fin-accounts-table{min-width:720px!important}.tablewrap{width:100%!important;overflow-x:auto!important}.tablewrap table{min-width:620px!important}.kpis{grid-template-columns:repeat(2,minmax(0,1fr))!important}.grid,.grid3{grid-template-columns:1fr!important}.card,.panel{min-width:0!important}.settings-grid,.olap-workspace,.olap-grid,.olap-zones,.request-grid,.shift-summary-grid{grid-template-columns:1fr!important}.fin-grid{grid-template-columns:1fr!important}.fin-kpis{grid-template-columns:1fr 1fr!important}.date-row{flex-wrap:wrap}.date-row input{flex:1;min-width:130px}.fin-btn{width:100%!important}.fin-chart{height:240px!important}.fin-bars{height:175px!important}.chart{max-width:100%!important}.reports-header{flex-direction:column!important}.olap-workspace,.olap-grid{display:flex!important;flex-direction:column!important}.accounts-page{padding:18px 14px 34px!important}.acc-tools{grid-template-columns:1fr!important}.acc-stats{grid-template-columns:1fr 1fr!important}.acc-table-wrap{overflow-x:auto!important}}
@media(max-width:420px){.content,.page,.app-content,.reports-page,.settings-page,.accounts-page,.finance-page{padding-left:12px!important;padding-right:12px!important}.kpis,.fin-kpis,.acc-stats{grid-template-columns:1fr!important}}
`;document.head.appendChild(style);

const MAX_QUICK=4;
const QUICK_PRIORITY=[
  item=>item.page==='index.html',
  item=>item.page==='reports.html'||item.section==='Отчёты',
  item=>item.page==='cash.html'||item.page==='cash-shifts.html',
  item=>item.section==='Сотрудники'||item.page.startsWith('hr-'),
  item=>item.section==='Закупки',
  item=>item.section==='Склад и справочники',
  item=>item.page==='finance.html',
  item=>item.page==='qr-menu.html'
];
function pageFor(href){
  const url=new URL(href,location.origin);
  const path=url.pathname.toLowerCase().replace(/\/+$/,'');
  if(path==='/cash'||path==='/cash/index.html')return'cash.html';
  if(path==='/'||path==='/dashboard'||path==='/dashboard.html'||path==='/index.html')return'index.html';
  const page=path.split('/').pop()||'index.html';
  return page.includes('.')?page:page+'.html';
}
function collectAllowedLinks(){
  const sidebar=document.querySelector('.sidebar .unified-main-nav');
  if(!sidebar)return[];
  // Side navigation is the source of truth. Unchecked nodes are never trusted.
  window.SHAccess?.applyVisibility?.(sidebar);
  const seen=new Set(),items=[];
  sidebar.querySelectorAll('a[href]').forEach(link=>{
    if(link.dataset.shAccessChecked!=='1'||link.hidden)return;
    let url;
    try{url=new URL(link.getAttribute('href'),location.origin)}catch{return}
    if(url.origin!==location.origin)return;
    const href=url.pathname+url.search;
    // Connection management is always owned by Platform Admin, including old
    // sidebar links from a cached or dynamically injected page.
    if(pageFor(href)==='settings.html'||pageFor(href)==='debug.html')return;
    if(seen.has(href))return;
    seen.add(href);
    const group=link.closest('.documents-nav-group,.reports-nav-group');
    const section=group?.querySelector('.documents-nav-toggle-left span:last-child')?.textContent?.trim()||'Основное';
    const label=link.querySelector('span:last-child')?.textContent?.trim()||link.textContent?.trim()||'Раздел';
    items.push({href,page:pageFor(href),label,section});
  });
  return items;
}
function selectQuickLinks(items){
  const selected=[],seen=new Set();
  for(const pred of QUICK_PRIORITY){
    const item=items.find(x=>!seen.has(x.href)&&pred(x));
    if(item){selected.push(item);seen.add(item.href)}
    if(selected.length>=MAX_QUICK)break;
  }
  for(const item of items){
    if(selected.length>=MAX_QUICK)break;
    if(!seen.has(item.href)){selected.push(item);seen.add(item.href)}
  }
  return{quick:selected,other:items.filter(item=>!seen.has(item.href))};
}
function isCurrent(item){
  const here=pageFor(location.pathname),match=here===item.page;
  if(!match)return false;
  if(item.page==='procurement.html'){
    const expected=new URL(item.href,location.origin).searchParams.get('view')||'catalog';
    const current=new URLSearchParams(location.search).get('view')||'catalog';
    return expected===current;
  }
  return true;
}
function shortLabel(item){
  if(item.page==='index.html')return'Dashboard';
  if(item.page==='reports.html')return'OLAP';
  if(item.page==='cash.html')return'Кассы';
  if(item.section==='Сотрудники'||item.page.startsWith('hr-'))return'Сотрудники';
  if(item.section==='Закупки')return'Закупки';
  if(item.section==='Склад и справочники')return'Склад';
  if(item.page==='finance.html')return'Финансы';
  return item.label;
}
function iconFor(item){
  if(item.page==='index.html')return'⌂';
  if(item.section==='Отчёты'||item.page==='reports.html')return'▥';
  if(item.page==='cash.html'||item.page==='cash-shifts.html')return'▣';
  if(item.section==='Сотрудники'||item.page.startsWith('hr-'))return'♟';
  if(item.section==='Закупки')return'◫';
  if(item.section==='Склад и справочники')return'▤';
  if(item.page==='finance.html')return'₼';
  if(item.page==='qr-menu.html')return'▦';
  return'◈';
}
let signature='',observer=null,queued=false,returnFocus=null;
function closeMore(){
  const overlay=document.querySelector('.sh-mobile-more-overlay');
  overlay?.remove();
  document.querySelector('.sh-mobile-nav .sh-mobile-more-btn')?.setAttribute('aria-expanded','false');
  if(returnFocus?.isConnected)returnFocus.focus();
  returnFocus=null;
}
function openMore(items,button){
  closeMore();
  returnFocus=button;
  button.setAttribute('aria-expanded','true');
  const overlay=document.createElement('div');
  overlay.className='sh-mobile-more-overlay';
  const dialog=document.createElement('section');
  dialog.className='sh-mobile-more-sheet';
  dialog.setAttribute('role','dialog');
  dialog.setAttribute('aria-modal','true');
  dialog.setAttribute('aria-label','Остальные разделы');
  const header=document.createElement('header');
  header.className='sh-mobile-more-header';
  const title=document.createElement('strong');title.textContent='Разделы Smart Horeca';
  const close=document.createElement('button');close.className='sh-mobile-more-close';
  close.type='button';close.textContent='×';close.setAttribute('aria-label','Закрыть');
  close.onclick=closeMore;
  header.append(title,close);dialog.appendChild(header);
  const groups=new Map();
  for(const item of items){
    if(!groups.has(item.section))groups.set(item.section,[]);
    groups.get(item.section).push(item);
  }
  for(const [section,links] of groups){
    const group=document.createElement('div');group.className='sh-mobile-more-group';
    const label=document.createElement('h3');label.textContent=section;group.appendChild(label);
    for(const item of links){
      const a=document.createElement('a');a.href=item.href;a.textContent=item.label;
      if(isCurrent(item))a.setAttribute('aria-current','page');
      group.appendChild(a);
    }
    dialog.appendChild(group);
  }
  overlay.appendChild(dialog);
  overlay.addEventListener('click',e=>{if(e.target===overlay)closeMore()});
  document.body.appendChild(overlay);
  close.focus();
}
function hideMobileNav(){
  document.querySelector('.sh-mobile-nav')?.remove();
  document.body.classList.remove('sh-has-mobile-nav');
  closeMore();signature='';
}
function refresh(){
  if(window.innerWidth>760||!document.body?.dataset.protected||document.getElementById('sh-access-denied')||
     !window.SHAccess?.context?.allowed){hideMobileNav();return}
  const items=collectAllowedLinks();
  if(!items.length){hideMobileNav();return}
  const {quick,other}=selectQuickLinks(items);
  const nextSignature=items.map(x=>x.href+'|'+x.label).join(';')+'@'+location.pathname+location.search;
  if(signature===nextSignature&&document.querySelector('.sh-mobile-nav'))return;
  document.querySelector('.sh-mobile-nav')?.remove();closeMore();
  const nav=document.createElement('nav');nav.className='sh-mobile-nav';
  nav.setAttribute('aria-label','Мобильная навигация Smart Horeca');
  nav.style.setProperty('--sh-mobile-items',String(quick.length+(other.length?1:0)));
  const otherActive=other.some(isCurrent);
  for(const item of quick){
    const a=document.createElement('a');a.href=item.href;
    if(isCurrent(item)){a.classList.add('active');a.setAttribute('aria-current','page')}
    const icon=document.createElement('span');icon.className='mnav-icon';icon.textContent=iconFor(item);
    const name=document.createElement('span');name.className='mnav-label';name.textContent=shortLabel(item);
    a.append(icon,name);nav.appendChild(a);
  }
  if(other.length){
    const button=document.createElement('button');button.type='button';
    button.className='sh-mobile-more-btn'+(otherActive?' active':'');
    button.setAttribute('aria-label','Остальные доступные разделы');
    button.setAttribute('aria-expanded','false');
    const icon=document.createElement('span');icon.className='mnav-icon';icon.textContent='☷';
    const name=document.createElement('span');name.className='mnav-label';name.textContent='Ещё';
    button.append(icon,name);button.onclick=()=>openMore(other,button);nav.appendChild(button);
  }
  document.body.appendChild(nav);
  document.body.classList.add('sh-has-mobile-nav');
  signature=nextSignature;
}
function scheduleRefresh(){
  if(queued)return;queued=true;
  queueMicrotask(()=>{queued=false;refresh()});
}
function watchSidebar(){
  if(observer)return;
  const side=document.querySelector('.sidebar');
  if(!side)return;
  observer=new MutationObserver(()=>scheduleRefresh());
  observer.observe(side,{subtree:true,childList:true});
}
function init(){
  watchSidebar();scheduleRefresh();
}
document.addEventListener('sh-access-ready',scheduleRefresh);
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMore()});
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
else init();
window.addEventListener('resize',scheduleRefresh,{passive:true});
window.SH_MobileNav={refresh:scheduleRefresh};
})();
