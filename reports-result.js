(function(){
  'use strict';

  function escapeHtml(v){
    return String(v ?? '').replace(/[&<>"']/g,function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  function enhance(){
    const root=document.getElementById('olap-result');
    if(!root)return;
    bindToggles(root);
    root.querySelectorAll('tbody').forEach(transformTable);
  }

  function bindToggles(root){
    if(root.dataset.groupToggleBound==='1')return;
    root.dataset.groupToggleBound='1';
    root.addEventListener('click',function(event){
      const button=event.target.closest('.olap-group-toggle');
      if(!button || !root.contains(button))return;
      const row=button.closest('tr.olap-group-row');
      if(!row)return;
      const level=Number(row.dataset.olapLevel||0);
      const collapsing=button.getAttribute('aria-expanded')!=='false';
      let next=row.nextElementSibling;
      while(next){
        const isGroup=next.classList.contains('olap-group-row');
        const nextLevel=isGroup?Number(next.dataset.olapLevel||0):Infinity;
        if(isGroup && nextLevel<=level)break;
        next.hidden=collapsing;
        next=next.nextElementSibling;
      }
      button.setAttribute('aria-expanded',collapsing?'false':'true');
      button.textContent=collapsing?'▶':'▼';
      button.title=collapsing?'Развернуть':'Свернуть';
      row.classList.toggle('is-collapsed',collapsing);
    });
  }

  function transformTable(tbody){
    if(tbody.dataset.treeEnhanced==='1')return;

    const rows=[...tbody.children].filter(row=>row.tagName==='TR');
    const groups=rows.filter(row=>row.classList.contains('olap-group-row'));
    if(!groups.length)return;

    groups.forEach(function(group){
      const level=Number(group.dataset.olapLevel||0);
      group.classList.add('olap-tree-row','olap-level-'+level);

      const boundary=findBoundary(group,level,rows);
      const range=between(group,boundary,rows);
      const detail=range.filter(row=>row.classList.contains('olap-data-row'));
      const subtotalRows=range.filter(row=>row.classList.contains('olap-group-total'));
      const subtotal=subtotalRows.length?subtotalRows[subtotalRows.length-1]:null;
      const source=subtotal || detail[detail.length-1] || null;

      if(source)copyMeasureValues(group,source);

      detail.forEach(function(row){
        row.hidden=true;
        row.classList.add('olap-rendered-into-tree');
      });
      subtotalRows.forEach(function(row){
        row.hidden=true;
        row.classList.add('olap-rendered-into-tree');
      });

      const toggle=group.querySelector('.olap-group-toggle');
      if(toggle){
        const hasChildren=range.some(row=>row.classList.contains('olap-group-row')) || detail.length>0;
        toggle.hidden=!hasChildren;
        toggle.tabIndex=0;
        toggle.setAttribute('aria-expanded','true');
        toggle.textContent='▼';
        toggle.title='Свернуть';
      }
    });

    rows.filter(function(row){
      if(row.classList.contains('olap-group-total'))return true;
      const text=row.textContent.trim().toLowerCase();
      return text.endsWith(' всего');
    }).forEach(function(row){
      row.hidden=true;
      row.classList.add('olap-rendered-into-tree');
    });

    const grand=rows.find(row=>row.classList.contains('olap-grand-total'));
    if(grand){
      grand.hidden=false;
      grand.classList.add('olap-tree-grand-total');
    }

    tbody.dataset.treeEnhanced='1';
  }

  function findBoundary(group,level,rows){
    let next=group.nextElementSibling;
    while(next){
      if(next.classList.contains('olap-group-row') && Number(next.dataset.olapLevel||0)<=level)return next;
      if(next.classList.contains('olap-grand-total'))return next;
      next=next.nextElementSibling;
    }
    return null;
  }

  function between(start,end,rows){
    const a=rows.indexOf(start);
    const b=end?rows.indexOf(end):rows.length;
    return a<0?[]:rows.slice(a+1,b<0?rows.length:b);
  }

  function copyMeasureValues(target,source){
    const targetCells=[...target.children];
    const sourceCells=[...source.children];
    if(!targetCells.length || !sourceCells.length)return;

    const values=sourceCells.filter(function(cell){
      if(cell.classList.contains('olap-total-label'))return false;
      return cell.textContent.trim()!=='';
    });
    if(!values.length)return;

    const count=Math.min(values.length,targetCells.length);
    const targetStart=targetCells.length-count;
    const sourceStart=values.length-count;

    for(let i=0;i<count;i++){
      const text=values[sourceStart+i].textContent.trim();
      if(!text)continue;
      const targetCell=targetCells[targetStart+i];
      targetCell.innerHTML='<strong>'+escapeHtml(text)+'</strong>';
      targetCell.classList.add('olap-inline-value');
    }
  }

  function start(){
    const root=document.getElementById('olap-result');
    if(!root)return;
    enhance();
    new MutationObserver(enhance).observe(root,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
