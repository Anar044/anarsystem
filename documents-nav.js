(function(){
  const items=[
    ['nakladnye.html','Накладные','▤'],
    ['rashodnye-nakladnye.html','Расходная накладная','▧'],
    ['akty-spisaniya.html','Акты списания','▥'],
    ['vnutrennie-peremescheniya.html','Внутренние перемещения','⇄']
  ];

  function add(){
    const sidebar=document.querySelector('.sidebar');
    if(!sidebar||sidebar.dataset.documentsNav==='1')return false;
    const nav=sidebar.querySelector('.unified-main-nav,.side-nav');
    if(!nav)return false;
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

    // If the user is already inside one of the document pages, keep the section open.
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
