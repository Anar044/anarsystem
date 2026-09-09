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
        const expanded=button.getAttribute('aria-expanded')!=='false';
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

    /* Presentation only: for a simple one-level grouped report, put the
       aggregated value directly on the group row and hide duplicate detail
       and subtotal rows. Multi-level reports remain unchanged. */
    root.querySelectorAll('tbody').forEach(tbody=>{
      if(tbody.dataset.compactEnhanced==='1')return;
      const groups=[...tbody.querySelectorAll(':scope > tr.olap-group-row')];
      if(!groups.length)return;

      let simple=true;
      groups.forEach(group=>{
        if(Number(group.dataset.olapLevel||0)!==0)simple=false;
      });
      if(!simple)return;

      groups.forEach(group=>{
        let next=group.nextElementSibling;
        const detail=[];
        let subtotal=null;
        while(next && !next.classList.contains('olap-group-row') && !next.classList.contains('olap-grand-total')){
          if(next.classList.contains('olap-data-row'))detail.push(next);
          if(next.classList.contains('olap-group-total'))subtotal=next;
          next=next.nextElementSibling;
        }
        if(detail.length!==1)return;

        const source=subtotal||detail[0];
        const sourceCells=[...source.children];
        const targetCells=[...group.children];
        for(let i=1;i<targetCells.length;i++){
          const text=sourceCells[i]?.textContent?.trim()||'';
          if(text)targetCells[i].innerHTML='<strong>'+escapeHtml(text)+'</strong>';
        }
        detail[0].hidden=true;
        if(subtotal)subtotal.hidden=true;
        group.classList.add('olap-compact-group');
      });
      tbody.dataset.compactEnhanced='1';
    });
  }

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,function(char){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];
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
