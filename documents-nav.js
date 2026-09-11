(()=>{
  'use strict';
  const documents=[
    ['Приходные накладные','/nakladnye.html','▤','nakladnye.html'],
    ['Расходные накладные','/rashodnye-nakladnye.html','▧','rashodnye-nakladnye.html'],
    ['Акты списания','/akty-spisaniya.html','▥','akty-spisaniya.html'],
    ['Внутренние перемещения','/vnutrennie-peremescheniya.html','⇄','vnutrennie-peremescheniya.html']
  ];
  function currentPage(){
    const p=location.pathname.toLowerCase().replace(/\/$/,'');
    const map=[['/nakladnye','nakladnye.html'],['/rashodnye-nakladnye','rashodnye-nakladnye.html'],['/akty-spisaniya','akty-spisaniya.html'],['/vnutrennie-peremescheniya','vnutrennie-peremescheniya.html'],['/abc-xyz','abc-xyz.html'],['/pnl','pnl.html'],['/supplier-balances','supplier-balances.html'],['/cash','cash.html'],['/cash-shifts','cash-shifts.html'],['/finance','finance.html'],['/reports','reports.html'],['/qr-menu','qr-menu.html'],['/settings','settings.html']];
    for(const [path,key] of map) if(p===path||p.endsWith(path+'.html')) return key;
    return 'index.html';
  }
  function style(){
    if(document.getElementById('documents-nav-style'))return;
    const s=document.createElement('style');s.id='documents-nav-style';s.textContent=`
      .documents-nav-group{margin:0;padding:0;border:0}
      .documents-nav-toggle{appearance:none;-webkit-appearance:none;width:100%;height:40px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 12px;border:1px solid transparent;border-radius:10px;background:transparent;color:#aeb9c5;font-family:inherit;font-size:12px;font-weight:750;line-height:1;text-align:left;cursor:pointer;box-sizing:border-box;transition:.16s}
      .documents-nav-toggle:hover{background:#121d26;border-color:#202a35;color:#f4f7fa}
      .documents-nav-toggle.active,.documents-nav-toggle[aria-expanded="true"]{background:#14231e;border-color:#244637;color:#f4f7fa}
      .documents-nav-toggle-left{display:flex;align-items:center;gap:9px;min-width:0}
      .documents-nav-folder{width:18px;text-align:center;color:#42d392;font-size:13px}
      .documents-nav-chevron{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;color:#8994a3;font-size:13px;line-height:1;transition:.18s}
      .documents-nav-group.open .documents-nav-chevron{transform:rotate(180deg);color:#42d392}
      .documents-subnav{margin:3px 0 3px;padding:2px 0 2px 8px;border-left:1px solid #26313d}
      .documents-subnav[hidden]{display:none!important}
      .documents-subnav a{font-size:12px!important}
      .documents-subnav .side-icon{width:22px!important;text-align:center!important}
    `;document.head.appendChild(s);
  }
  function keyOf(a){return String(a?.dataset?.unifiedNavItem||a?.getAttribute('href')||'').toLowerCase().split('?')[0].replace(/^\//,'').replace(/\/$/,'')}
  function link(text,href,icon,key){const a=document.createElement('a');a.href=href;a.dataset.unifiedNavItem=key;a.innerHTML=`<span class="side-icon">${icon}</span><span>${text}</span>`;if(key===currentPage())a.classList.add('active');return a}
  function ensureCashShifts(nav){
    if([...nav.children].some(x=>x.matches?.('a[data-unified-nav-item="cash-shifts.html"]')||keyOf(x)==='cash-shifts.html'))return;
    const cash=[...nav.children].find(x=>keyOf(x)==='cash.html');
    const a=link('Кассовые смены','/cash-shifts.html','▤','cash-shifts.html');
    if(cash&&cash.nextSibling)nav.insertBefore(a,cash.nextSibling);else nav.appendChild(a);
  }
  function ensureDocuments(nav){
    let group=[...nav.children].find(x=>x.classList?.contains('documents-nav-group'));
    if(group)return group;
    group=document.createElement('div');group.className='documents-nav-group';group.dataset.unifiedNavDocuments='1';
    const toggle=document.createElement('button');toggle.type='button';toggle.className='documents-nav-toggle';toggle.innerHTML='<span class="documents-nav-toggle-left"><span class="documents-nav-folder">▣</span><span>Документы</span></span><span class="documents-nav-chevron">⌄</span>';
    const sub=document.createElement('nav');sub.className='side-nav nav documents-subnav';sub.hidden=true;
    const page=currentPage();let active=false;
    documents.forEach(([text,href,icon,key])=>{const a=link(text,href,icon,key);if(key===page)active=true;sub.appendChild(a)});
    toggle.setAttribute('aria-expanded',String(active));if(active){group.classList.add('open');toggle.classList.add('active');sub.hidden=false}
    toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));group.classList.toggle('open',open);sub.hidden=!open});
    group.append(toggle,sub);
    const settings=[...nav.children].find(x=>keyOf(x)==='settings.html');
    if(settings)nav.insertBefore(group,settings);else nav.appendChild(group);
    return group;
  }
  function removeDuplicateDirectLinks(nav){
    const seen=new Set();[...nav.children].forEach(el=>{if(el.tagName!=='A')return;const key=keyOf(el);if(!key)return;if(seen.has(key))el.remove();else seen.add(key)});
  }
  function boot(){
    const sidebar=document.querySelector('.sidebar');const nav=sidebar?.querySelector('.unified-main-nav,.side-nav');if(!nav)return false;
    style();
    removeDuplicateDirectLinks(nav);
    ensureCashShifts(nav);
    ensureDocuments(nav);
    nav.querySelectorAll(':scope > a').forEach(a=>a.classList.toggle('active',keyOf(a)===currentPage()));
    const sub=nav.querySelector('.documents-subnav');if(sub)sub.querySelectorAll('a').forEach(a=>a.classList.toggle('active',keyOf(a)===currentPage()));
    return true;
  }
  function start(){let attempts=0;const timer=setInterval(()=>{attempts++;if(boot()||attempts>=60)clearInterval(timer)},50);boot()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});else start();
})();
