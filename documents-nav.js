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
    const group=document.createElement('div');group.className='documents-nav-group';
    const title=document.createElement('div');title.className='nav-title';title.textContent='ДОКУМЕНТЫ';
    const links=document.createElement('nav');links.className='side-nav nav documents-subnav';
    const path=location.pathname.toLowerCase();
    items.forEach(([href,label,icon])=>{const a=document.createElement('a');a.href=href;if(path.endsWith('/'+href)||path.endsWith(href))a.className='active';a.innerHTML=`<span class="side-icon">${icon}</span><span>${label}</span>`;links.appendChild(a);});
    group.append(title,links);
    const spacer=sidebar.querySelector('.sidebar-spacer');
    if(spacer)sidebar.insertBefore(group,spacer);else sidebar.appendChild(group);
    sidebar.dataset.documentsNav='1';
    return true;
  }
  function boot(){if(add())return;let n=0;const t=setInterval(()=>{if(add()||++n>50)clearInterval(t);},100);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();