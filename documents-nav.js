(function(){
  const items=[
    ['nakladnye.html','Накладные','▤'],
    ['rashodnye-nakladnye.html','Расходная накладная','▧'],
    ['akty-spisaniya.html','Акты списания','▥'],
    ['vnutrennie-peremescheniya.html','⇄ Внутренние перемещения','⇄']
  ];

  function installStyle(){
    if(document.getElementById('documents-nav-style'))return;
    const style=document.createElement('style');style.id='documents-nav-style';
    style.textContent=`
      .documents-nav-group{margin-top:10px;padding-top:8px;border-top:1px solid rgba(255,255,255,.045)}
      .documents-nav-toggle{appearance:none;-webkit-appearance:none;width:100%;height:40px;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 12px;border:1px solid transparent;border-radius:10px;background:#0f171f;color:#aeb9c5;font-family:inherit;font-size:12px;font-weight:750;line-height:1;text-align:left;cursor:pointer;box-sizing:border-box;transition:.16s}
      .documents-nav-toggle:hover{background:#121d26;border-color:#202a35;color:#f4f7fa}
      .documents-nav-toggle[aria-expanded="true"]{background:#14231e;border-color:#244637;color:#f4f7fa}
      .documents-nav-toggle-left{display:flex;align-items:center;gap:9px;min-width:0}.documents-nav-folder{width:18px;text-align:center;color:#42d392;font-size:13px}.documents-nav-chevron{width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;border-radius:5px;color:#8994a3;font-size:13px;line-height:1;transition:.18s}.documents-nav-toggle:hover .documents-nav-chevron{background:#1b2833}.documents-nav-group.open .documents-nav-chevron{transform:rotate(180deg);color:#42d392}
      .documents-subnav{margin:5px 0 8px;padding:4px 0 4px 8px;border-left:1px solid #26313d}.documents-subnav[hidden]{display:none!important}.documents-subnav a{font-size:12px!important}.documents-subnav .side-icon{width:22px!important;text-align:center!important}
    `;document.head.appendChild(style);
  }

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
    installStyle();
    const sidebar=document.querySelector('.sidebar');if(!sidebar)return false;
    const nav=sidebar.querySelector('.unified-main-nav,.side-nav');if(!nav)return false;
    organize(nav);

    let group=sidebar.querySelector('.documents-nav-group');
    if(!group){
      group=document.createElement('div');group.className='documents-nav-group';
      const toggle=document.createElement('button');toggle.type='button';toggle.className='documents-nav-toggle';toggle.setAttribute('aria-expanded','false');
      toggle.innerHTML='<span class="documents-nav-toggle-left"><span class="documents-nav-folder">▣</span><span>Документы</span></span><span class="documents-nav-chevron">⌄</span>';
      const links=document.createElement('nav');links.className='side-nav nav documents-subnav';links.hidden=true;
      items.forEach(([href,text,icon])=>{const a=document.createElement('a');a.href=href;a.innerHTML=`<span class="side-icon">${icon}</span><span>${text}</span>`;links.appendChild(a);});
      toggle.addEventListener('click',()=>{const open=toggle.getAttribute('aria-expanded')!=='true';toggle.setAttribute('aria-expanded',String(open));group.classList.toggle('open',open);links.hidden=!open;});
      group.append(toggle,links);
      const spacer=sidebar.querySelector('.sidebar-spacer');if(spacer)sidebar.insertBefore(group,spacer);else sidebar.appendChild(group);
    }
    sidebar.dataset.documentsNav='1';return true;
  }

  function boot(){
    if(add()){
      const sidebar=document.querySelector('.sidebar');
      if(sidebar&&!sidebar.dataset.documentsObserver){
        const observer=new MutationObserver(()=>{const nav=sidebar.querySelector('.unified-main-nav,.side-nav');if(nav)organize(nav);});
        observer.observe(sidebar,{childList:true,subtree:true});sidebar.dataset.documentsObserver='1';
      }
      return;
    }
    let n=0;const t=setInterval(()=>{if(add()||++n>100)clearInterval(t);},100);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
