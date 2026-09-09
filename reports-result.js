(function(){
  'use strict';

  function copyMeasures(target, source){
    if(!target || !source) return;
    const targetCells=[...target.children];
    const sourceCells=[...source.children];
    if(targetCells.length<2 || sourceCells.length<2) return;
    const count=Math.min(2,targetCells.length,sourceCells.length);
    for(let i=0;i<count;i++){
      const text=(sourceCells[sourceCells.length-count+i]?.textContent||'').trim();
      if(!text) continue;
      const cell=targetCells[targetCells.length-count+i];
      cell.innerHTML='<strong>'+escapeHtml(text)+'</strong>';
      cell.classList.add('olap-inline-value');
    }
  }

  function escapeHtml(value){
    return String(value??'').replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function getRows(tbody){
    return [...tbody.children].filter(row=>row.tagName==='TR');
  }

  function findBoundary(rows,startIndex,level){
    for(let i=startIndex+1;i<rows.length;i++){
      const row=rows[i];
      if(row.classList.contains('olap-grand-total')) return i;
      if(row.classList.contains('olap-group-row')){
        const rowLevel=Number(row.dataset.olapLevel||0);
        if(rowLevel<=level) return i;
      }
    }
    return rows.length;
  }

  function decorateTable(tbody){
    const rows=getRows(tbody);
    if(!rows.length) return;

    const groups=rows.filter(row=>row.classList.contains('olap-group-row'));
    if(!groups.length) return;

    groups.forEach(group=>{
      const level=Number(group.dataset.olapLevel||0);
      group.classList.add('olap-tree-row','olap-level-'+level);

      const index=rows.indexOf(group);
      const boundary=findBoundary(rows,index,level);
      const range=rows.slice(index+1,boundary);
      const totals=range.filter(row=>row.classList.contains('olap-group-total'));
      const ownTotal=totals.length?totals[totals.length-1]:null;

      if(ownTotal) copyMeasures(group,ownTotal);

      const toggle=group.querySelector('.olap-group-toggle');
      if(toggle){
        toggle.tabIndex=0;
        toggle.setAttribute('aria-expanded',toggle.getAttribute('aria-expanded')==='false'?'false':'true');
        toggle.textContent=toggle.getAttribute('aria-expanded')==='false'?'▶':'▼';
        toggle.title=toggle.getAttribute('aria-expanded')==='false'?'Развернуть':'Свернуть';
      }
    });

    rows.forEach(row=>{
      if(row.classList.contains('olap-data-row')){
        row.classList.add('olap-waiter-row');
        row.hidden=false;
      }
      if(row.classList.contains('olap-group-total')){
        row.classList.add('olap-design-hidden');
        row.hidden=true;
      }
      if(row.classList.contains('olap-grand-total')){
        row.classList.add('olap-tree-grand-total');
        row.hidden=false;
      }
    });

    tbody.dataset.olapDesignEnhanced='1';
  }

  function bindToggles(root){
    root.querySelectorAll('.olap-group-toggle').forEach(function(button){
      if(button.dataset.designToggleBound==='1') return;
      button.dataset.designToggleBound='1';
      button.addEventListener('click',function(event){
        event.preventDefault();
        event.stopPropagation();
        const row=button.closest('tr.olap-group-row');
        if(!row) return;
        const level=Number(row.dataset.olapLevel||0);
        const collapsed=button.getAttribute('aria-expanded')!=='false';
        let next=row.nextElementSibling;
        while(next){
          const isGroup=next.classList.contains('olap-group-row');
          const nextLevel=isGroup?Number(next.dataset.olapLevel||0):Infinity;
          if(isGroup && nextLevel<=level) break;
          if(!next.classList.contains('olap-design-hidden')) next.hidden=collapsed;
          next=next.nextElementSibling;
        }
        button.setAttribute('aria-expanded',collapsed?'false':'true');
        button.textContent=collapsed?'▶':'▼';
        button.title=collapsed?'Развернуть':'Свернуть';
        row.classList.toggle('is-collapsed',collapsed);
      });
    });
  }

  function enhance(){
    const root=document.getElementById('olap-result');
    if(!root) return;
    root.querySelectorAll('tbody').forEach(decorateTable);
    bindToggles(root);
  }

  function scheduleEnhance(){
    if(scheduleEnhance.pending) return;
    scheduleEnhance.pending=true;
    requestAnimationFrame(function(){
      scheduleEnhance.pending=false;
      enhance();
    });
  }

  function start(){
    scheduleEnhance();

    const observer=new MutationObserver(function(){
      scheduleEnhance();
    });
    observer.observe(document.body,{childList:true,subtree:true});

    let attempts=0;
    const timer=setInterval(function(){
      scheduleEnhance();
      attempts++;
      if(attempts>=30) clearInterval(timer);
    },250);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start);
  else start();
})();
