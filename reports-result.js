(function(){
  'use strict';

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  function cells(row){return row?[...row.children]:[];}
  function text(row,index){return (cells(row)[index]?.textContent||'').trim();}

  function copyMeasures(target,source){
    const tc=cells(target),sc=cells(source); if(tc.length<2||sc.length<2)return;
    const count=Math.min(2,tc.length,sc.length);
    for(let i=0;i<count;i++){
      const value=(sc[sc.length-count+i]?.textContent||'').trim();
      if(!value)continue;
      const cell=tc[tc.length-count+i];
      cell.innerHTML='<strong>'+esc(value)+'</strong>';
      cell.classList.add('olap-inline-value');
    }
  }

  function boundary(rows,index,level){
    for(let i=index+1;i<rows.length;i++){
      const r=rows[i];
      if(r.classList.contains('olap-grand-total'))return i;
      if(r.classList.contains('olap-group-row')&&Number(r.dataset.olapLevel||0)<=level)return i;
    }
    return rows.length;
  }

  function buildSummary(root,rows){
    let box=root.querySelector('.olap-ui-summary');
    if(!box){
      box=document.createElement('div');
      box.className='olap-ui-summary';
      const resultCard=root.closest('.olap-result-card');
      if(resultCard)resultCard.insertBefore(box,root);
      else root.prepend(box);
    }

    const grand=rows.find(r=>r.classList.contains('olap-grand-total'));
    const dataRows=rows.filter(r=>r.classList.contains('olap-data-row'));
    const groups=rows.filter(r=>r.classList.contains('olap-group-row'));
    const cashCount=groups.filter(r=>Number(r.dataset.olapLevel||0)===1).length;
    const total=text(grand,cells(grand).length-2)||'—';
    const discount=text(grand,cells(grand).length-1)||'—';

    box.innerHTML=`
      <div class="olap-summary-card olap-summary-main"><div class="olap-summary-icon">▤</div><div><span>Сумма со скидкой</span><strong>${esc(total)} <small>AZN</small></strong></div></div>
      <div class="olap-summary-card olap-summary-discount"><div class="olap-summary-icon">%</div><div><span>Сумма скидки</span><strong>${esc(discount)} <small>AZN</small></strong></div></div>
      <div class="olap-summary-card olap-summary-count"><div class="olap-summary-icon">●</div><div><span>Количество строк</span><strong>${dataRows.length}</strong></div></div>
      <div class="olap-summary-card olap-summary-cash"><div class="olap-summary-icon">▣</div><div><span>Количество касс</span><strong>${cashCount||'—'}</strong></div></div>`;
  }

  function decorate(root){
    const table=root.querySelector('.report-table');
    if(!table)return;
    const tbody=table.querySelector('tbody'); if(!tbody)return;
    const rows=[...tbody.children].filter(r=>r.tagName==='TR');
    const groups=rows.filter(r=>r.classList.contains('olap-group-row'));
    if(!groups.length)return;

    groups.forEach(group=>{
      const level=Number(group.dataset.olapLevel||0);
      group.classList.add('olap-tree-row','olap-level-'+level);
      const i=rows.indexOf(group), end=boundary(rows,i,level);
      const range=rows.slice(i+1,end);
      const totals=range.filter(r=>r.classList.contains('olap-group-total'));
      if(totals.length)copyMeasures(group,totals[totals.length-1]);
      const toggle=group.querySelector('.olap-group-toggle');
      if(toggle){
        toggle.dataset.designReady='1';
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

    const headerCells=cells(table.querySelector('thead tr'));
    root.classList.add('olap-modern-result');
    const oldTitle=root.querySelector('.olap-modern-title');
    if(!oldTitle){
      const head=document.createElement('div');
      head.className='olap-modern-title';
      const names=headerCells.map(c=>(c.textContent||'').trim()).filter(Boolean);
      head.innerHTML=`<div><div class="olap-modern-title-main">Результат отчёта</div><div class="olap-modern-subtitle">${esc(names.slice(0,3).join('  →  ')||'Иерархический отчёт')}</div></div><div class="olap-result-actions"><span>${dataRowsCount(rows)} строк</span><button type="button" class="olap-expand-all">↘ Развернуть</button><button type="button" class="olap-collapse-all">↗ Свернуть</button></div>`;
      root.insertBefore(head,root.firstChild);
      head.querySelector('.olap-expand-all').onclick=()=>setAll(root,false);
      head.querySelector('.olap-collapse-all').onclick=()=>setAll(root,true);
    }

    buildSummary(root,rows);
    tbody.dataset.olapDesignEnhanced='1';
    bindToggles(root);
  }

  function dataRowsCount(rows){return rows.filter(r=>r.classList.contains('olap-data-row')).length;}

  function setAll(root,collapse){
    root.querySelectorAll('.olap-group-toggle').forEach(b=>{
      const row=b.closest('tr.olap-group-row'); if(!row)return;
      b.setAttribute('aria-expanded',collapse?'false':'true');
      b.textContent=collapse?'▶':'▼';
      b.title=collapse?'Развернуть':'Свернуть';
      row.classList.toggle('is-collapsed',collapse);
      let n=row.nextElementSibling,level=Number(row.dataset.olapLevel||0);
      while(n){
        const g=n.classList.contains('olap-group-row'),l=g?Number(n.dataset.olapLevel||0):Infinity;
        if(g&&l<=level)break;
        if(!n.classList.contains('olap-design-hidden'))n.hidden=collapse;
        n=n.nextElementSibling;
      }
    });
  }

  function bindToggles(root){
    root.querySelectorAll('.olap-group-toggle').forEach(button=>{
      if(button.dataset.designToggleBound==='1')return;
      button.dataset.designToggleBound='1';
      button.addEventListener('click',function(e){
        e.preventDefault();e.stopPropagation();
        const row=button.closest('tr.olap-group-row');if(!row)return;
        const level=Number(row.dataset.olapLevel||0),collapse=button.getAttribute('aria-expanded')!=='false';
        let n=row.nextElementSibling;
        while(n){
          const g=n.classList.contains('olap-group-row'),l=g?Number(n.dataset.olapLevel||0):Infinity;
          if(g&&l<=level)break;
          if(!n.classList.contains('olap-design-hidden'))n.hidden=collapse;
          n=n.nextElementSibling;
        }
        button.setAttribute('aria-expanded',collapse?'false':'true');
        button.textContent=collapse?'▶':'▼';
        button.title=collapse?'Развернуть':'Свернуть';
        row.classList.toggle('is-collapsed',collapse);
      });
    });
  }

  function enhance(){
    const root=document.getElementById('olap-result');if(!root)return;
    root.querySelectorAll('tbody').forEach(tb=>decorate(root));
  }

  function start(){
    enhance();
    const observer=new MutationObserver(enhance);
    observer.observe(document.body,{childList:true,subtree:true});
    let tries=0;
    const timer=setInterval(()=>{enhance();if(++tries>=40)clearInterval(timer)},250);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
})();
