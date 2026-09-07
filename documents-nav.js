(function(){
  const items=[
    ['nakladnye.html','Накладные','▤'],
    ['rashodnye-nakladnye.html','Расходная накладная','▧'],
    ['akty-spisaniya.html','Акты списания','▥'],
    ['vnutrennie-peremescheniya.html','Внутренние перемещения','⇄']
  ];

  function label(a){return String(a?.querySelector('span:last-child')?.textContent||a?.textContent||'').replace(/\s+/g,' ').trim();}

  function organize(nav){
    if(!nav)return;
    const links=[...nav.children].filter(el=>el.tagName==='A');
    if(!links.length)return;

    links.forEach(a=>{if(label(a)==='Накладные')a.remove();});
    const current=[...nav.children].filter(el=>el.tagName==='A');
    const dashboard=current.find(a=>label(a)==='Dashboard');
    const others=current.filter(a=>a!==dashboard);
    const collator=new Intl.Collator('ru',{sensitivity:'base',numeric:true});
    others.sort((a,b)=>collator.compare(label(a),label(b)));

    [...nav.children].filter(el=>el.tagName==='A').forEach(a=>a.remove());
    if(dashboard)nav.appendChild(dashboard);
    others.forEach(a=>nav.appendChild(a));
  }

  function add(){
    const sidebar=document.querySelector('.sidebar');
    if(!sidebar)return false;
    const nav=sidebar.querySelector('.unified-main-nav,.side-nav');
    if(!nav)return false;

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
      const spacer=sidebar.querySelector('.sidebar-spacer');
      if(spacer)sidebar.insertBefore(group,spacer);else sidebar.appendChild(group);
    }

    sidebar.dataset.documentsNav='1';
    return true;
  }

  function boot(){
    if(add()){
      const sidebar=document.querySelector('.sidebar');
      if(sidebar&&!sidebar.dataset.documentsObserver){
        const observer=new MutationObserver(()=>{
          const nav=sidebar.querySelector('.unified-main-nav,.side-nav');
          if(nav)organize(nav);
        });
        observer.observe(sidebar,{childList:true,subtree:true});
        sidebar.dataset.documentsObserver='1';
      }
      return;
    }
    let n=0;const t=setInterval(()=>{if(add()||++n>100)clearInterval(t);},100);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
