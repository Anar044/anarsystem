(function(){
  'use strict';

  function enhance(){
    const root=document.getElementById('olap-result');
    if(!root)return;
    const table=root.querySelector('table.report-table');
    if(!table||!table.tBodies.length)return;
    const tbody=table.tBodies[0];
    if(tbody.dataset.presentationVersion==='4')return;

    const rows=[...tbody.rows];
    const groups=rows.filter(r=>r.classList.contains('olap-group-row'));
    const grand=rows.find(r=>r.classList.contains('olap-grand-total'));
    if(!groups.length)return;

    groups.forEach(group=>{
      const level=Number(group.dataset.olapLevel||0);
      group.classList.add('olap-tree-row','olap-level-'+level);
      const boundary=findBoundary(group,level,rows,grand);
      const range=between(group,boundary,rows);
      const subtotal=findOwnSubtotal(group,range);
      if(subtotal){
        copyMeasureValues(group,subtotal);
        subtotal.hidden=true;
        subtotal.classList.add('olap-rendered-into-tree');
      }
      const toggle=group.querySelector('.olap-group-toggle');
      if(toggle){
        toggle.hidden=!range.some(r=>r.classList.contains('olap-group-row')||r.classList.contains('olap-data-row'));
        toggle.tabIndex=0;
        toggle.setAttribute('aria-expanded','true');
        toggle.textContent='▼';
        toggle.title='Свернуть';
      }
    });

    rows.filter(r=>r.classList.contains('olap-group-total')).forEach(r=>{
      r.hidden=true;
      r.classList.add('olap-rendered-into-tree');
    });
    if(grand){grand.hidden=false;grand.classList.add('olap-tree-grand-total');}
    bindToggles(root);
    tbody.dataset.presentationVersion='4';
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

  function between(start,end,rows){
    const a=rows.indexOf(start),b=end?rows.indexOf(end):rows.length;
    return rows.slice(a+1,b<0?rows.length:b);
  }

  function findOwnSubtotal(group,range){
    const label=clean(group.querySelector('.olap-group-label')?.textContent||'');
    const wanted=(label+' всего').toLowerCase();
    return range.find(r=>r.classList.contains('olap-group-total')&&clean(r.cells[0]?.textContent||'').toLowerCase()===wanted)
      ||range.filter(r=>r.classList.contains('olap-group-total')).at(-1)||null;
  }

  function copyMeasureValues(group,subtotal){
    const target=[...group.cells];
    const source=[...subtotal.cells];
    if(!target.length||source.length<2)return;
    const values=source.slice(1).filter(c=>c.textContent.trim()!=='');
    if(!values.length)return;
    const count=Math.min(values.length,target.length);
    const start=target.length-count;
    values.slice(-count).forEach((cell,i)=>{
      const value=cell.textContent.trim();
      if(!value)return;
      target[start+i].textContent=value;
      target[start+i].classList.add('olap-inline-value');
    });
  }

  function bindToggles(root){
    if(root.dataset.presentationToggleBound==='4')return;
    root.dataset.presentationToggleBound='4';
    root.addEventListener('click',function(event){
      const button=event.target.closest('.olap-group-toggle');
      if(!button)return;
      const group=button.closest('tr.olap-group-row');
      if(!group)return;
      const level=Number(group.dataset.olapLevel||0);
      const collapse=button.getAttribute('aria-expanded')!=='false';
      let row=group.nextElementSibling;
      while(row){
        const isGroup=row.classList.contains('olap-group-row');
        if(isGroup&&Number(row.dataset.olapLevel||0)<=level)break;
        if(row.classList.contains('olap-group-total')||row.classList.contains('olap-rendered-into-tree'))row.hidden=true;
        else row.hidden=collapse;
        row=row.nextElementSibling;
      }
      button.setAttribute('aria-expanded',collapse?'false':'true');
      button.textContent=collapse?'▶':'▼';
      button.title=collapse?'Развернуть':'Свернуть';
      group.classList.toggle('is-collapsed',collapse);
    });
  }

  function clean(value){return String(value||'').replace(/[▼▶]/g,'').replace(/\s+/g,' ').trim();}

  function start(){
    const root=document.getElementById('olap-result');
    if(!root)return;
    enhance();
    new MutationObserver(enhance).observe(root,{childList:true,subtree:true});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
