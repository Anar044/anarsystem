(function(){
  'use strict';

  const VERSION='7';

  function clean(value){
    return String(value||'').replace(/[▼▶▾▸]/g,'').replace(/\s+/g,' ').trim();
  }

  function rowsBetween(start,end,rows){
    const a=rows.indexOf(start);
    const b=end?rows.indexOf(end):rows.length;
    return rows.slice(a+1,b<0?rows.length:b);
  }

  function findBoundary(group,level,rows,grand){
    let row=group.nextElementSibling;
    while(row){
      if(row.classList.contains('olap-group-row')&&Number(row.dataset.olapLevel||0)<=level)return row;
      if(row===grand)return row;
      row=row.nextElementSibling;
    }
    return null;
  }

  function findOwnSubtotal(group,range){
    const label=clean(group.querySelector('.olap-group-label')?.textContent||'');
    const wanted=(label+' всего').toLowerCase();
    return range.find(row=>
      row.classList.contains('olap-group-total')&&
      clean(row.cells[0]?.textContent||'').toLowerCase()===wanted
    )||range.filter(row=>row.classList.contains('olap-group-total')).at(-1)||null;
  }

  function copyMeasureValues(group,subtotal){
    const target=[...group.cells];
    const source=[...subtotal.cells];
    if(!target.length||source.length<2)return;

    const values=source.slice(1).filter(cell=>cell.textContent.trim()!=='');
    if(!values.length)return;

    const count=Math.min(values.length,target.length);
    const start=target.length-count;
    values.slice(-count).forEach((cell,index)=>{
      const value=cell.textContent.trim();
      if(!value)return;
      const targetCell=target[start+index];
      if(targetCell.querySelector('.olap-group-toggle'))return;
      targetCell.textContent=value;
      targetCell.classList.add('olap-inline-value','olap-measure-cell');
    });
  }

  function ensureHeaderControls(root){
    const header=root.querySelector('.report-header');
    if(!header||header.querySelector('.olap-tree-actions'))return;

    const count=header.querySelector('span');
    const actions=document.createElement('div');
    actions.className='olap-tree-actions';
    actions.innerHTML=
      '<button type="button" data-olap-collapse-all title="Свернуть все группы">Свернуть все</button>'+
      '<button type="button" data-olap-expand-all title="Развернуть все группы">Развернуть все</button>';

    if(count){
      count.classList.add('olap-row-count');
      actions.appendChild(count);
    }
    header.appendChild(actions);
  }

  function assignTreeMetadata(tbody,rows,grand){
    const stack=[];
    let sequence=0;

    rows.forEach(row=>{
      if(row===grand){
        row.dataset.olapAncestors='';
        return;
      }

      if(row.classList.contains('olap-group-row')){
        const level=Math.max(0,Number(row.dataset.olapLevel||0));
        stack.length=level;
        const ancestors=stack.filter(Boolean);
        const id='olap-group-'+(++sequence);
        row.dataset.olapTreeId=id;
        row.dataset.olapAncestors=ancestors.join(',');
        stack[level]=id;
        stack.length=level+1;
        return;
      }

      row.dataset.olapAncestors=stack.filter(Boolean).join(',');
    });

    tbody.dataset.olapTreeSequence=String(sequence);
  }

  function collapsedSet(root){
    if(!(root.__olapCollapsedGroups instanceof Set))root.__olapCollapsedGroups=new Set();
    return root.__olapCollapsedGroups;
  }

  function rowHasCollapsedAncestor(row,collapsed){
    const ancestors=String(row.dataset.olapAncestors||'').split(',').filter(Boolean);
    return ancestors.some(id=>collapsed.has(id));
  }

  function applyTreeVisibility(root){
    const table=root.querySelector('table.report-table');
    if(!table||!table.tBodies.length)return;
    const tbody=table.tBodies[0];
    const collapsed=collapsedSet(root);

    [...tbody.rows].forEach(row=>{
      if(row.classList.contains('olap-group-total')||row.classList.contains('olap-rendered-into-tree')){
        row.hidden=true;
        row.classList.add('olap-tree-hidden');
        return;
      }
      if(row.classList.contains('olap-grand-total')){
        row.hidden=false;
        row.classList.remove('olap-tree-hidden');
        return;
      }

      const shouldHide=rowHasCollapsedAncestor(row,collapsed);
      row.hidden=shouldHide;
      row.classList.toggle('olap-tree-hidden',shouldHide);

      if(row.classList.contains('olap-group-row')){
        const id=row.dataset.olapTreeId;
        const button=row.querySelector('.olap-group-toggle');
        const isCollapsed=id&&collapsed.has(id);
        row.classList.toggle('is-collapsed',Boolean(isCollapsed));
        if(button&&!button.hidden){
          button.setAttribute('aria-expanded',isCollapsed?'false':'true');
          button.textContent=isCollapsed?'▸':'▾';
          button.title=isCollapsed?'Развернуть':'Свернуть';
        }
      }
    });
  }

  function enhance(){
    const root=document.getElementById('olap-result');
    if(!root)return;

    const table=root.querySelector('table.report-table');
    if(!table||!table.tBodies.length)return;

    const tbody=table.tBodies[0];
    if(tbody.dataset.presentationVersion===VERSION)return;

    const rows=[...tbody.rows];
    const groups=rows.filter(row=>row.classList.contains('olap-group-row'));
    const grand=rows.find(row=>row.classList.contains('olap-grand-total'));
    if(!groups.length)return;

    root.__olapCollapsedGroups=new Set();

    groups.forEach(group=>{
      const level=Math.max(0,Number(group.dataset.olapLevel||0));
      group.classList.add('olap-tree-row','olap-level-'+Math.min(level,4));

      const boundary=findBoundary(group,level,rows,grand);
      const range=rowsBetween(group,boundary,rows);
      const subtotal=findOwnSubtotal(group,range);

      if(subtotal){
        copyMeasureValues(group,subtotal);
        subtotal.hidden=true;
        subtotal.classList.add('olap-rendered-into-tree');
      }

      const toggle=group.querySelector('.olap-group-toggle');
      if(toggle){
        const hasChildren=range.some(row=>
          row.classList.contains('olap-group-row')||
          row.classList.contains('olap-data-row')
        );
        toggle.hidden=!hasChildren;
        toggle.tabIndex=0;
        toggle.setAttribute('aria-expanded','true');
        toggle.textContent='▾';
        toggle.title='Свернуть';
      }
    });

    rows.filter(row=>row.classList.contains('olap-group-total')).forEach(row=>{
      row.hidden=true;
      row.classList.add('olap-rendered-into-tree');
    });

    if(grand){
      grand.hidden=false;
      grand.classList.add('olap-tree-grand-total');
    }

    assignTreeMetadata(tbody,rows,grand);
    ensureHeaderControls(root);
    bindControls(root);
    bindGroupButtons(root);
    tbody.dataset.presentationVersion=VERSION;
    applyTreeVisibility(root);
  }

  function toggleGroup(root,group){
    const id=group?.dataset.olapTreeId;
    if(!group||!id)return;
    const collapsed=collapsedSet(root);
    if(collapsed.has(id))collapsed.delete(id);
    else collapsed.add(id);
    applyTreeVisibility(root);
  }

  function bindGroupButtons(root){
    root.querySelectorAll('.olap-group-toggle').forEach(button=>{
      if(button.dataset.olapDirectBound===VERSION)return;
      button.dataset.olapDirectBound=VERSION;
      button.addEventListener('click',event=>{
        event.preventDefault();
        event.stopPropagation();
        toggleGroup(root,button.closest('tr.olap-group-row'));
      });
    });
  }

  function bindControls(root){
    if(root.dataset.presentationToggleBound===VERSION)return;
    root.dataset.presentationToggleBound=VERSION;

    root.addEventListener('click',event=>{
      const toggle=event.target.closest('.olap-group-toggle');
      if(toggle){
        // Direct button handler above is the primary path.
        // Keep delegated handling only as a fallback for dynamically replaced buttons.
        if(toggle.dataset.olapDirectBound===VERSION)return;
        toggleGroup(root,toggle.closest('tr.olap-group-row'));
        return;
      }

      if(event.target.closest('[data-olap-collapse-all]')){
        const collapsed=collapsedSet(root);
        collapsed.clear();
        root.querySelectorAll('tr.olap-group-row[data-olap-level="0"]').forEach(row=>{
          if(row.dataset.olapTreeId)collapsed.add(row.dataset.olapTreeId);
        });
        applyTreeVisibility(root);
        return;
      }

      if(event.target.closest('[data-olap-expand-all]')){
        collapsedSet(root).clear();
        applyTreeVisibility(root);
      }
    });
  }

  let rootObserver=null;

  function attachToResultRoot(root){
    if(!root||root.dataset.olapPresentationObserved===VERSION)return;
    root.dataset.olapPresentationObserved=VERSION;
    enhance();
    new MutationObserver(enhance).observe(root,{childList:true,subtree:true});
  }

  function start(){
    const existing=document.getElementById('olap-result');
    if(existing){
      attachToResultRoot(existing);
      return;
    }

    if(rootObserver)return;
    rootObserver=new MutationObserver(()=>{
      const root=document.getElementById('olap-result');
      if(!root)return;
      rootObserver.disconnect();
      rootObserver=null;
      attachToResultRoot(root);
    });
    rootObserver.observe(document.documentElement,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();