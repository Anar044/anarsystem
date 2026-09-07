(function(){
  const items=[
    ['nakladnye.html','Накладные','▤'],
    ['rashodnye-nakladnye.html','Расходная накладная','▧'],
    ['akty-spisaniya.html','Акты списания','▥'],
    ['vnutrennie-peremescheniya.html','Внутренние перемещения','⇄']
  ];

  function normalizeLabel(a){
    return String(a?.querySelector('span:last-child')?.textContent||a?.textContent||'').replace(/\s+/g,' ').trim();
  }

  function organizeMainNav(nav){
    if(!nav || nav.dataset.documentsOrganized==='1') return;

    const links=[...nav.children].filter(el=>el.tagName==='A');
    if(!links.length) return;

    // Накладные теперь находится только внутри раздела «Документы».
    links.forEach(a=>{
      if(normalizeLabel(a)==='Накладные') a.remove();
    });

    const remaining=[...nav.children].filter(el=>el.tagName==='A');
    const dashboard=remaining.find(a=>normalizeLabel(a)==='Dashboard');
    const others=remaining.filter(a=>a!==dashboard);

    const collator=new Intl.Collator('ru',{sensitivity:'base',numeric:true});
    others.sort((a,b)=>collator.compare(normalizeLabel(a),normalizeLabel(b)));

    [...nav.children].filter(el=>el.tagName==='A').forEach(a=>a.remove());
    if(dashboard) nav.appendChild(dashboard);
    others.forEach(a=>nav.appendChild(a));
    nav.dataset.documentsOrganized='1';
  }

  function add(){
    const sidebar=document.querySelector('.sidebar');
    if(!sidebar)return false;

    const nav=sidebar.querySelector('.unified-main-nav,.side-nav');
    if(!nav)return false;

    organizeMainNav(nav);

    if(sidebar.dataset.documentsNav==='1')return true;
    if(sidebar.querySelector('.documents-nav-group')){sidebar.dataset.documentsNav='1';return true;}

    const group=document.createElement('div');
    group.className='documents-nav-group';

    const toggle=document.createElement('button');
    toggle.type='button';
    toggle.className='documents-nav-toggle';
    toggle.setAttribute('aria-expanded','false');
    toggle.innerHTML='<span class="documents-nav-toggle-left"><span class="documents-nav-folder">▣</span><span>Документы</span></span><span class="documents-nav-chevron">⌄</span>';

    const links=document.createElement('nav');
    links.className='side-nav nav documents-subnav';
    links.hidden=true;

    const path=location.pathname.toLowerCase();
    let currentDocument=false;

    items.forEach(([href,label,icon])=>{
      const a=document.createElement('a');
      a.href=href;
      if(path.endsWith('/'+href)||path.endsWith(href)){
        a.className='active';
        currentDocument=true;
      }
      a.innerHTML=`<span class="side-icon">${icon}</span><span>${label}</span>`;
      links.appendChild(a);
    });

    function setOpen(open){
      toggle.setAttribute('aria-expanded',String(open));
      group.classList.toggle('open',open);
      links.hidden=!open;
    }

    toggle.addEventListener('click',()=>{
      setOpen(toggle.getAttribute('aria-expanded')!=='true');
    });

    group.append(toggle,links);

    const spacer=sidebar.querySelector('.sidebar-spacer');
    if(spacer)sidebar.insertBefore(group,spacer);else sidebar.appendChild(group);

    if(currentDocument)setOpen(true);

    sidebar.dataset.documentsNav='1';
    return true;
  }

  function boot(){
    if(add())return;
    let n=0;
    const t=setInterval(()=>{if(add()||++n>50)clearInterval(t);},100);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
