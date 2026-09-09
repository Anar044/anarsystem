(function(){
  'use strict';
  function enhance(){
    const root=document.getElementById('olap-result');
    if(!root)return;
    if(!root.dataset.groupToggleBound){
      root.dataset.groupToggleBound='1';
      root.addEventListener('click',function(event){
        const button=event.target.closest('.olap-group-toggle');
        if(!button||!root.contains(button))return;
        const row=button.closest('tr.olap-group-row');
        if(!row)return;
        const level=Number(row.dataset.olapLevel||0);
        let next=row.nextElementSibling;
        let expanded=button.getAttribute('aria-expanded')!=='false';
        while(next){
          const nextGroup=next.classList.contains('olap-group-row');
          const nextLevel=nextGroup?Number(next.dataset.olapLevel||0):Infinity;
          if(nextGroup&&nextLevel<=level)break;
          next.hidden=expanded;
          next=next.nextElementSibling;
        }
        button.setAttribute('aria-expanded',expanded?'false':'true');
        button.textContent=expanded?'▶':'▼';
        button.title=expanded?'Развернуть':'Свернуть';
      });
      root.addEventListener('keydown',function(event){
        if((event.key!=='Enter'&&event.key!==' ')||!event.target.classList.contains('olap-group-toggle'))return;
        event.preventDefault();
        event.target.click();
      });
    }
    root.querySelectorAll('.olap-group-toggle').forEach(button=>{
      button.tabIndex=0;
      if(!button.dataset.enhanced){
        button.dataset.enhanced='1';
        button.setAttribute('aria-expanded','true');
        button.textContent='▼';
        button.title='Свернуть';
      }
    });
  }
  function start(){
    const root=document.getElementById('olap-result');
    if(!root)return;
    enhance();
    new MutationObserver(enhance).observe(root,{childList:true,subtree:true});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
