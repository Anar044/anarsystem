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

    /* Compact simple OLAP results visually: when a group contains only one
       detail row, show the value directly on the group row and remove the
       duplicate detail/subtotal lines. This changes presentation only. */
    root.querySelectorAll('tbody').forEach(tbody=>{
      if(tbody.dataset.compactEnhanced==='1')return;
      const groups=[...tbody.querySelectorAll(':scope > tr.olap-group-row')];
      groups.forEach(group=>{
        if(Number(group.dataset.olapLevel||0)!==0)return;
        let next=group.nextElementSibling;
        const between=[];
        while(next && !next.classList.contains('olap-group-row') && !next.classList.contains('olap-grand-total')){
          between.push(next);
          next=next.nextElementSibling;
        }
        const detail=between.filter(row=>row.classList.contains('olap-data-row'));
        const subtotal=between.find(row=>row.classList.contains('olap-group-total'));
        if(detail.length!==1||!subtotal)return;
        const detailCells=[...detail[0].children];
        const groupCells=[...group.children];
        detailCells.forEach((cell,index)=>{
          if(index===0)return;
          if(!groupCells[index])return;
          const text=cell.textContent.trim();
          if(text)groupCells[index].innerHTML='<strong>'+escapeHtml(text)+'</strong>';
        });
        detail[0].hidden=true;
        subtotal.hidden=true;
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
