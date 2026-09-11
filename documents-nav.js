(function(){
  'use strict';

  const menu=[
    ['Dashboard','/index.html','⌂','index.html'],
    ['Финансы','/finance.html','₽','finance.html'],
    ['OLAP Отчёты','/reports.html','▥','reports.html'],
    ['ABC / XYZ анализ','/abc-xyz.html','◫','abc-xyz.html'],
    ['Прибыли и убытки','/pnl.html','▤','pnl.html'],
    ['Баланс по поставщикам','/supplier-balances.html','◈','supplier-balances.html'],
    ['Кассы','/cash','▣','cash.html'],
    ['Кассовые смены','/cash-shifts.html','▤','cash-shifts.html'],
    ['QR Menu','/qr-menu.html','▦','qr-menu.html']
  ];

  const documents=[
    ['Приходные накладные','/nakladnye.html','▤','nakladnye.html'],
    ['Расходные накладные','/rashodnye-nakladnye.html','▧','rashodnye-nakladnye.html'],
    ['Акты списания','/akty-spisaniya.html','▥','akty-spisaniya.html'],
    ['Внутренние перемещения','/vnutrennie-peremescheniya.html','⇄','vnutrennie-peremescheniya.html']
  ];

  const settings=['Настройки','/settings.html','⚙','settings.html'];

  function currentPage(){
    const p=location.pathname.toLowerCase().replace(/\/$/,'');
    const map=[
      ['/nakladnye','nakladnye.html'],
      ['/rashodnye-nakladnye','rashodnye-nakladnye.html'],
      ['/akty-spisaniya','akty-spisaniya.html'],
      ['/vnutrennie-peremescheniya','vnutrennie-peremescheniya.html'],
      ['/abc-xyz','abc-xyz.html'],
      ['/pnl','pnl.html'],
      ['/supplier-balances','supplier-balances.html'],
      ['/cash','cash.html'],
      ['/cash-shifts','cash-shifts.html'],
      ['/finance','finance.html'],
      ['/reports','reports.html'],
      ['/qr-menu','qr-menu.html'],
      ['/settings','settings.html'],
      ['/events','events.html'],
      ['/plugin-events','plugin-events.html']
    ];
    for(const [path,key] of map) if(p===path || p.endsWith(path+'.html')) return key;
    return 'index.html';
  }

  function style(){
    if(document.getElementById('documents-nav-style')) return;
    const s=document.createElement('style');
    s.id='documents-nav-style';
    s.textContent=`
      .documents-nav-group{margin:0;padding:0;border:0}
      .documents-nav-toggle{appearance:none;-webkit-appearance:none;width:100%;height:40px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 12px;border:1px solid transparent;border-radius:10px;background:transparent;color:#aeb9c5;font-family:inherit;font-size:12px;font-weight:750;line-height:1;text-align:left;cursor:pointer;box-sizing:border-box;transition:.16s}
      .documents-nav-toggle:hover{background:#121d26;border-color:#202a35;color:#f4f7fa}
      .documents-nav-toggle.active,.documents-nav-toggle[aria-expanded="true"]{background:#14231e;border-color:#244637;color:#f4f7fa}
      .documents-nav-toggle-left{display:flex;align-items:center;gap:9px;min-width:0}
      .documents-nav-folder{width:18px;text-align:center;color:#42d392;font-size:13px}
      .documents-nav-chevron{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:5px;color:#8994a3;font-size:13px;line-height:1;transition:.18s}
      .documents-nav-group.open .documents-nav-chevron{transform:rotate(180deg);color:#42d392}
      .documents-subnav{margin:3px 0 3px;padding:2px 0 2px 8px;border-left:1px solid #26313d}
      .documents-subnav[hidden]{display:none!important}
      .documents-subnav a{font-size:12px!important}
      .documents-subnav .side-icon{width:22px!important;text-align:center!important}
    `;
    document.head.appendChild(s);
  }

  function makeLink(item,page){
    const [text,href,icon,key]=item;
    const a=document.createElement('a');
    a.href=href;
    a.dataset.unifiedNavItem=key;
    a.innerHTML=`<span class="side-icon">${icon}</span><span>${text}</span>`;
    if(key===page) a.classList.add('active');
    return a;
  }

  function build(nav){
    const page=currentPage();
    nav.innerHTML='';
    menu.forEach(item=>nav.appendChild(makeLink(item,page)));

    const group=document.createElement('div');
    group.className='documents-nav-group';
    group.dataset.unifiedNavDocuments='1';

    const toggle=document.createElement('button');
    toggle.type='button';
    toggle.className='documents-nav-toggle';
    toggle.innerHTML='<span class="documents-nav-toggle-left"><span class="documents-nav-folder">▣</span><span>Документы</span></span><span class="documents-nav-chevron">⌄</span>';

    const sub=document.createElement('nav');
    sub.className='side-nav nav documents-subnav';
    sub.hidden=true;

    let activeDoc=false;
    documents.forEach(item=>{
      const a=makeLink(item,page);
      if(item[3]===page) activeDoc=true;
      sub.appendChild(a);
    });

    if(activeDoc){
      sub.hidden=false;
      group.classList.add('open');
      toggle.classList.add('active');
      toggle.setAttribute('aria-expanded','true');
    }else{
      toggle.setAttribute('aria-expanded','false');
    }

    toggle.addEventListener('click',()=>{
      const open=toggle.getAttribute('aria-expanded')!=='true';
      toggle.setAttribute('aria-expanded',String(open));
      group.classList.toggle('open',open);
      sub.hidden=!open;
    });

    group.append(toggle,sub);
    nav.appendChild(group);
    nav.appendChild(makeLink(settings,page));
    nav.dataset.documentsMenuVersion='20260911-2';
  }

  function ensure(nav){
    if(!nav) return false;
    style();
    build(nav);
    return true;
  }

  function boot(){
    const sidebar=document.querySelector('.sidebar');
    const nav=sidebar?.querySelector('.unified-main-nav,.side-nav');
    if(!nav) return false;
    ensure(nav);

    if(!nav.dataset.documentsNavObserver){
      let scheduled=false;
      const observer=new MutationObserver(()=>{
        if(scheduled) return;
        scheduled=true;
        queueMicrotask(()=>{
          scheduled=false;
          if(document.body.contains(nav)){
            const expected=menu.length+2;
            const directChildren=Array.from(nav.children);
            const hasDocuments=!!nav.querySelector(':scope > .documents-nav-group');
            const hasWrongCount=directChildren.length!==expected;
            const duplicateKeys=new Set();
            let duplicates=false;
            nav.querySelectorAll(':scope > a[data-unified-nav-item]').forEach(a=>{
              const key=a.dataset.unifiedNavItem;
              if(duplicateKeys.has(key)) duplicates=true;
              duplicateKeys.add(key);
            });
            if(hasWrongCount||!hasDocuments||duplicates) ensure(nav);
          }
        });
      });
      observer.observe(nav,{childList:true,subtree:true});
      nav.dataset.documentsNavObserver='1';
    }
    return true;
  }

  function start(){
    let attempts=0;
    const timer=setInterval(()=>{
      attempts++;
      if(boot()||attempts>=60) clearInterval(timer);
    },50);
    boot();
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
