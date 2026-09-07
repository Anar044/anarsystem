(function(){
  const items=[
    ['nakladnye.html','Накладные','▤'],
    ['rashodnye-nakladnye.html','Расходная накладная','▧'],
    ['akty-spisaniya.html','Акты списания','▥'],
    ['vnutrennie-peremescheniya.html','Внутренние перемещения','⇄']
  ];

  function installStyle(){
    if(document.getElementById('documents-nav-style')) return;
    const style=document.createElement('style');
    style.id='documents-nav-style';
    style.textContent=`
      .documents-nav-group{margin:0;padding:0;border:0}
      .documents-nav-toggle{appearance:none;-webkit-appearance:none;width:100%;height:40px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 12px;border:1px solid transparent;border-radius:10px;background:transparent;color:#aeb9c5;font-family:inherit;font-size:12px;font-weight:750;line-height:1;text-align:left;cursor:pointer;box-sizing:border-box;transition:.16s}
      .documents-nav-toggle:hover{background:#121d26;border-color:#202a35;color:#f4f7fa}
      .documents-nav-toggle[aria-expanded="true"]{background:#14231e;border-color:#244637;color:#f4f7fa}
      .documents-nav-toggle-left{display:flex;align-items:center;gap:9px;min-width:0}
      .documents-nav-folder{width:18px;text-align:center;color:#42d392;font-size:13px}
      .documents-nav-chevron{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:5px;color:#8994a3;font-size:13px;line-height:1;transition:.18s}
      .documents-nav-toggle:hover .documents-nav-chevron{background:#1b2833}
      .documents-nav-group.open .documents-nav-chevron{transform:rotate(180deg);color:#42d392}
      .documents-subnav{margin:3px 0 3px;padding:2px 0 2px 8px;border-left:1px solid #26313d}
      .documents-subnav[hidden]{display:none!important}
      .documents-subnav a{font-size:12px!important}
      .documents-subnav .side-icon{width:22px!important;text-align:center!important}
    `;
    document.head.appendChild(style);
  }

  function label(a){
    return String(a?.querySelector('span:last-child')?.textContent||a?.textContent||'')
      .replace(/\s+/g,' ').trim();
  }

  function organize(nav){
    if(!nav) return;

    const links=[...nav.children].filter(el=>el.tagName==='A');
    if(!links.length) return;

    const withoutOldNakladnye=links.filter(a=>label(a)!=='Накладные');
    const dashboard=withoutOldNakladnye.find(a=>label(a)==='Dashboard');
    const settings=withoutOldNakladnye.find(a=>label(a)==='Настройки');
    const middle=withoutOldNakladnye.filter(a=>a!==dashboard&&a!==settings);

    const desired=[
      ...(dashboard?[dashboard]:[]),
      ...middle,
      ...(settings?[settings]:[])
    ];

    const current=[...nav.children].filter(el=>el.tagName==='A');
    const same=current.length===desired.length && current.every((el,i)=>el===desired[i]);

    if(same) return;

    current.forEach(a=>a.remove());
    desired.forEach(a=>nav.appendChild(a));
  }

  function add(){
    installStyle();

    const sidebar=document.querySelector('.sidebar');
    if(!sidebar) return false;

    const nav=sidebar.querySelector('.unified-main-nav,.side-nav');
    if(!nav) return false;

    organize(nav);

    let group=sidebar.querySelector('.documents-nav-group');
    if(!group){
      group=document.createElement('div');
      group.className='documents-nav-group';

      const toggle=document.createElement('button');
      toggle.type='button';
      toggle.className='documents-nav-toggle';
      toggle.setAttribute('aria-expanded','false');
      toggle.innerHTML='<span class="documents-nav-toggle-left"><span class="documents-nav-folder">▣</span><span>Документы</span></span><span class="documents-nav-chevron">⌄</span>';

      const links=document.createElement('nav');
      links.className='side-nav nav documents-subnav';
      links.hidden=true;

      items.forEach(([href,text,icon])=>{
        const a=document.createElement('a');
        a.href=href;
        a.innerHTML=`<span class="side-icon">${icon}</span><span>${text}</span>`;
        links.appendChild(a);
      });

      toggle.addEventListener('click',()=>{
        const open=toggle.getAttribute('aria-expanded')!=='true';
        toggle.setAttribute('aria-expanded',String(open));
        group.classList.toggle('open',open);
        links.hidden=!open;
      });

      group.append(toggle,links);

      const settingsLink=[...nav.children].find(a=>a.tagName==='A'&&label(a)==='Настройки');
      if(settingsLink) nav.insertBefore(group,settingsLink);
      else nav.appendChild(group);
    }

    sidebar.dataset.documentsNav='1';
    return true;
  }

  function boot(){
    let attempts=0;
    const maxAttempts=100;

    function tryAdd(){
      if(add()) return;
      attempts++;
      if(attempts>=maxAttempts) return;
      setTimeout(tryAdd,100);
    }

    tryAdd();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',boot,{once:true});
  }else{
    boot();
  }
})();
