(function(){
  'use strict';

  function enhance(){
    const root=document.getElementById('olap-result');
    if(!root)return;
    bindToggles(root);
    polishTree(root);
  }

  function bindToggles(root){
    if(root.dataset.groupToggleBound==='1')return;
    root.dataset.groupToggleBound='1';
    root.addEventListener('click',function(event){
      const button=event.target.closest('.olap-group-toggle');
      if(!button||!root.contains(button))return;
      const row=button.closest('tr.olap-group-row');
      if(!row)return;
      const level=Number(row.dataset.olapLevel||0);
      const expanded=button.getAttribute('aria-expanded')!=='false';
      let next=row.nextElementSibling;
      while(next){
        const isGroup=next.classList.contains('olap-group-row');
        const nextLevel=isGroup?Number(next.dataset.olapLevel||0):Infinity;
        if(isGroup&&nextLevel<=level)break;
        next.hidden=expanded;
        next=next.nextElementSibling;
      }
      button.setAttribute('aria-expanded',expanded?'false':'true');
      button.textContent=expanded?'▶':'▼';
      button.title=expanded?'Развернуть':'Свернуть';
      row.classList.toggle('is-collapsed',expanded);
    });
    root.addEventListener('keydown',function(event){
      if((event.key!=='Enter'&&event.key!==' ')||!event.target.classList.contains('olap-group-toggle'))return;
      event.preventDefault();
      event.target.click();
    });
  }

  function polishTree(root){
    root.querySelectorAll('.olap-group-toggle').forEach(function(button){
      button.tabIndex=0;
      if(!button.dataset.enhanced){
        button.dataset.enhanced='1';
        button.setAttribute('aria-expanded','true');
        button.textContent='▼';
        button.title='Свернуть';
      }
    });

    root.querySelectorAll('tbody').forEach(function(tbody){
      if(tbody.dataset.treeEnhanced==='1')return;
      const rows=[...tbody.children].filter(row=>row.tagName==='TR');
      const groups=rows.filter(row=>row.classList.contains('olap-group-row'));
      if(!groups.length)return;

      /* Presentation-only transformation. reports.js remains untouched. */
      groups.forEach(function(group){
        const level=Number(group.dataset.olapLevel||0);
        group.classList.add('olap-tree-row','olap-level-'+level);
        group.dataset.treeLevel=String(level);

        const cells=[...group.children];
        if(cells[level])cells[level].classList.add('olap-tree-label-cell');

        const nextBoundary=findNextBoundary(group,level);
        const range=rowsBetween(group,nextBoundary,rows);
        const detail=range.filter(row=>row.classList.contains('olap-data-row'));
        const subtotals=range.filter(row=>row.classList.contains('olap-group-total'));
        const ownSubtotal=subtotals.length?subtotals[subtotals.length-1]:null;
        const source=ownSubtotal||detail[detail.length-1]||null;
        if(source)copyValueCells(group,source,level);

        detail.forEach(function(row){
          row.hidden=true;
          row.classList.add('olap-rendered-into-tree');
        });
        subtotals.forEach(function(row){
          row.hidden=true;
          row.classList.add('olap-rendered-into-tree');
        });

        const toggle=group.querySelector('.olap-group-toggle');
        if(toggle){
          const hasChildren=range.some(row=>row.classList.contains('olap-group-row'))||detail.length>0;
          toggle.hidden=!hasChildren;
          if(!hasChildren)group.classList.add('olap-leaf');
        }
      });

      const grand=rows.find(row=>row.classList.contains('olap-grand-total'));
      if(grand){
        grand.hidden=false;
        grand.classList.add('olap-tree-grand-total');
      }
      tbody.dataset.treeEnhanced='1';
    });
  }

  function findNextBoundary(group,level){
    let next=group.nextElementSibling;
    while(next){
      if(next.classList.contains('olap-group-row')&&Number(next.dataset.olapLevel||0)<=level)return next;
      if(next.classList.contains('olap-grand-total'))return next;
      next=next.nextElementSibling;
    }
    return null;
  }

  function rowsBetween(start,end,allRows){
    const startIndex=allRows.indexOf(start);
    const endIndex=end?allRows.indexOf(end):allRows.length;
    if(startIndex<0)return [];
    return allRows.slice(startIndex+1,endIndex<0?allRows.length:endIndex);
  }

  function copyValueCells(target,source,level){
    const targetCells=[...target.children];
    const sourceCells=[...source.children];
    const rowFieldCount=Math.max(0,level+1);
    const targetValueCount=Math.max(0,targetCells.length-rowFieldCount);

    /* Subtotal rows use one colspan label cell, so their indexes differ from
       the normal table. Align the rightmost value cells instead of indexes. */
    if(targetValueCount>0){
      const sourceValues=sourceCells.slice(Math.max(0,sourceCells.length-targetValueCount));
      sourceValues.forEach(function(cell,offset){
        const targetIndex=rowFieldCount+offset;
        if(!targetCells[targetIndex])return;
        const text=cell.textContent.trim();
        if(!text)return;
        targetCells[targetIndex].innerHTML='<strong>'+escapeHtml(text)+'</strong>';
        targetCells[targetIndex].classList.add('olap-inline-value');
      });
    }
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
