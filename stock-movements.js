(()=>{'use strict';
const $=id=>document.getElementById(id);
let rows=[],shownRows=[],quick='all',sources={};

function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function ymd(d=new Date()){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function money(v){return Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₼'}
function amount(v){return Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:3})}
function cost(v){return v===null||v===undefined?'—':Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:4})+' ₼'}
function fmtDate(v){if(!v)return'—';const d=new Date(v);if(!Number.isNaN(d.getTime()))return d.toLocaleString('ru-RU',{dateStyle:'short',timeStyle:String(v).includes('T')?'short':undefined});return String(v).slice(0,10)}
function groupOf(r){return String(r.categoryName||r.groupName||'Без группы').trim()}
async function binding(){if(window.SH_IikoContext?.getBinding)return await window.SH_IikoContext.getBinding();return null}
function setStatus(v){$('mov-status').textContent=v}
function setMessage(v,error=false){const e=$('mov-message');e.textContent=v;e.classList.toggle('error',!!error);e.style.display=v?'block':'none'}

function defaultPeriod(){
  const to=new Date(),from=new Date();
  from.setDate(from.getDate()-30);
  $('mov-from').value=ymd(from);$('mov-to').value=ymd(to);
}
function populate(select,items,label){
  const old=select.value;
  select.innerHTML='<option value="">'+esc(label)+'</option>'+items.map(x=>'<option value="'+esc(x.value)+'">'+esc(x.label)+'</option>').join('');
  if([...select.options].some(x=>x.value===old))select.value=old;
}
function movementSign(r,storeId){
  const a=Math.abs(Number(r.amount||0));
  if(r.type==='transfer'){
    if(!storeId)return null;
    if(String(r.fromStoreId||'')===storeId)return-a;
    if(String(r.toStoreId||'')===storeId)return a;
    return null;
  }
  if(r.signedAmount===null||r.signedAmount===undefined)return null;
  return Number(r.signedAmount);
}
function storeMatch(r,storeId){
  if(!storeId)return true;
  return [r.storeId,r.fromStoreId,r.toStoreId].map(String).includes(storeId);
}
function baseFiltered(){
  const store=$('mov-store').value,type=$('mov-type').value,category=$('mov-category').value,q=($('mov-search').value||'').trim().toLowerCase();
  return rows.filter(r=>{
    if(!storeMatch(r,store))return false;
    if(type&&r.type!==type)return false;
    if(category&&groupOf(r)!==category)return false;
    if(q){
      const hay=[r.productName,r.productNum,r.productCode,r.documentNumber,r.documentId,r.storeName,r.fromStoreName,r.toStoreName,r.comment,r.groupName,r.categoryName].join(' ').toLowerCase();
      if(!hay.includes(q))return false;
    }
    return true;
  });
}
function finalFiltered(){
  const base=baseFiltered();
  return quick==='all'?base:base.filter(r=>r.type===quick);
}
function typeBadge(r){return'<span class="type-badge '+esc(r.type)+'">'+esc(r.label||r.type)+'</span>'}
function place(v){return v&&String(v).trim()?String(v):'—'}
function qtyHtml(r){
  const store=$('mov-store').value,sgn=movementSign(r,store);
  if(r.type==='transfer'&&!store)return'<span class="qty neutral">↔ '+amount(r.amount)+'</span>';
  if(sgn===null)return'<span class="qty neutral">'+amount(r.amount)+'</span>';
  if(sgn>0)return'<span class="qty pos">+'+amount(sgn)+'</span>';
  if(sgn<0)return'<span class="qty neg">−'+amount(Math.abs(sgn))+'</span>';
  return'<span class="qty neutral">0</span>';
}
function updateSources(){
  const names={incoming:'Приход',outgoing:'Расход',writeoff:'Списания',transfer:'Перемещения',inventory:'Инвентаризация'};
  $('mov-sources').innerHTML=Object.entries(names).map(([k,label])=>{
    const s=sources?.[k];
    if(!s)return'<span class="source-chip warn">'+esc(label)+' · нет данных</span>';
    const cls=s.ok?'ok':'warn';
    return'<span class="source-chip '+cls+'">'+esc(label)+' · '+(s.ok?'OK':'недоступно')+' · '+Number(s.count||0)+' док.</span>';
  }).join('');
}
function updateKpis(base){
  const types=['incoming','outgoing','writeoff','transfer','inventory'];
  for(const t of types){
    const set=base.filter(r=>r.type===t),value=set.reduce((s,r)=>s+Number(r.value||0),0);
    const id=t==='incoming'?'in':t==='outgoing'?'out':t;
    $('kpi-'+id).textContent=money(value);
    $('kpi-'+id+'-count').textContent=set.length.toLocaleString('ru-RU')+' движений';
  }
}
function render(){
  const base=baseFiltered();
  const count=t=>base.filter(r=>r.type===t).length;
  $('count-all').textContent=base.length;
  for(const t of ['incoming','outgoing','writeoff','transfer','inventory'])$('count-'+t).textContent=count(t);
  updateKpis(base);

  const visible=finalFiltered();
  shownRows=visible.slice(0,2000);
  const tb=$('mov-table').querySelector('tbody');
  tb.innerHTML=shownRows.map((r,i)=>{
    const code=[r.productNum,r.productCode].filter(Boolean).join(' · ');
    return'<tr data-row="'+i+'">'+
      '<td>'+esc(fmtDate(r.date))+'</td>'+
      '<td class="product"><strong>'+esc(r.productName||r.productId)+'</strong><small>'+esc(code||r.productId||'')+'</small></td>'+
      '<td>'+typeBadge(r)+'</td>'+
      '<td>'+esc(place(r.fromStoreName||((r.type==='outgoing'||r.type==='writeoff')?r.storeName:'')))+'</td>'+
      '<td>'+esc(place(r.toStoreName||(r.type==='incoming'?r.storeName:'')))+'</td>'+
      '<td class="num">'+qtyHtml(r)+'</td>'+
      '<td>'+esc(r.unit||'—')+'</td>'+
      '<td class="num">'+cost(r.unitCost)+'</td>'+
      '<td class="num">'+(r.value===null||r.value===undefined?'—':money(r.value))+'</td>'+
      '<td class="doc-cell"><strong>'+esc(r.documentNumber||'—')+'</strong><small>'+esc(r.documentId||'')+'</small></td>'+
      '<td>'+esc(r.status||'—')+'</td></tr>';
  }).join('')||'<tr><td colspan="11" style="text-align:center;padding:34px;color:#8192a4">По выбранным фильтрам движений нет.</td></tr>';

  $('mov-result-meta').textContent=Math.min(visible.length,shownRows.length)+' из '+visible.length+' строк';
  $('mov-limit-note').textContent=visible.length>shownRows.length?'На экране показаны первые '+shownRows.length+' строк. CSV содержит все найденные движения.':'';
}
function modal(r){
  $('mov-modal-title').textContent=(r.label||'Операция')+' · '+(r.productName||r.productId);
  const selectedStore=$('mov-store').value,sgn=movementSign(r,selectedStore);
  const data=[
    ['Дата',fmtDate(r.date)],
    ['Документ',r.documentNumber||r.documentId||'—'],
    ['Статус',r.status||'—'],
    ['Товар',r.productName||r.productId],
    ['Количество',(sgn===null?amount(r.amount):(sgn>0?'+':'−')+amount(Math.abs(sgn)))+' '+(r.unit||'')],
    ['Себестоимость / ед.',cost(r.unitCost)],
    ['Сумма',r.value===null||r.value===undefined?'—':money(r.value)],
    ['Склад',r.storeName||'—'],
    ['Откуда',r.fromStoreName||'—'],
    ['Куда',r.toStoreName||'—'],
    ['Группа',r.categoryName||r.groupName||'—'],
    ['ID товара',r.productId||'—']
  ];
  if(r.type==='inventory'){
    data.push(['Учётное количество',r.accountingAmount===null||r.accountingAmount===undefined?'—':amount(r.accountingAmount)]);
    data.push(['Фактическое количество',r.actualAmount===null||r.actualAmount===undefined?'—':amount(r.actualAmount)]);
    data.push(['Корректировка',r.differenceAmount===null||r.differenceAmount===undefined?'—':amount(r.differenceAmount)]);
  }
  $('mov-modal-grid').innerHTML=data.map(x=>'<div class="modal-item"><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong></div>').join('');
  $('mov-modal-comment').textContent=r.comment?'Комментарий: '+r.comment:'';
  $('mov-modal').hidden=false;
}
function exportCsv(){
  const data=finalFiltered();if(!data.length)return;
  const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const head=['Дата','Товар','Артикул','Код','Операция','Откуда','Куда','Количество','Ед.','Себест./ед.','Сумма','Документ','Статус','Группа','Категория'];
  const store=$('mov-store').value;
  const body=data.map(r=>{
    const sgn=movementSign(r,store),qty=sgn===null?Number(r.amount||0):sgn;
    return[r.date,r.productName,r.productNum,r.productCode,r.label,r.fromStoreName,r.toStoreName,qty,r.unit,r.unitCost??'',r.value??'',r.documentNumber||r.documentId,r.status,r.groupName,r.categoryName].map(quote).join(';');
  });
  const blob=new Blob(['\uFEFF'+[head.map(quote).join(';'),...body].join('\r\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='stock-movements-'+$('mov-from').value+'-'+$('mov-to').value+'.csv';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},0);
}
async function load(){
  const btn=$('mov-refresh');btn.disabled=true;setStatus('Загрузка…');setMessage('Собираем складские документы iiko…');
  try{
    const b=await binding(),c=b?.connection;
    if(!c?.ip||!c?.port||!c?.login||!c?.password)throw Error('Не найдено подключение iiko. Откройте «Настройки» и подключите iiko Server.');
    const from=$('mov-from').value,to=$('mov-to').value;
    if(!from||!to||to<from)throw Error('Проверьте период.');
    const r=await fetch('/api/iiko/stock-movements',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({...c,from,to,departmentIds:Array.isArray(b?.departmentIds)?b.departmentIds:[]})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.success)throw Error(j.message||('HTTP '+r.status));
    rows=Array.isArray(j.movements)?j.movements:[];sources=j.sourceStatus||{};
    populate($('mov-store'),(j.stores||[]).map(x=>({value:String(x.id),label:x.name||x.id})),'Все склады');
    const cats=[...new Set(rows.map(groupOf).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    populate($('mov-category'),cats.map(x=>({value:x,label:x})),'Все группы');
    $('mov-period').textContent='Период: '+from+' — '+to;
    updateSources();setStatus('Готово · '+rows.length.toLocaleString('ru-RU')+' движений');setMessage('');
    render();
  }catch(e){
    rows=[];sources={};updateSources();render();setStatus('Ошибка');setMessage(e.message||String(e),true);
  }finally{btn.disabled=false}
}
function bind(){
  defaultPeriod();
  $('mov-refresh').onclick=load;$('mov-export').onclick=exportCsv;
  for(const id of ['mov-store','mov-type','mov-category'])$(id).onchange=render;
  $('mov-search').oninput=render;
  $('mov-quick').addEventListener('click',e=>{const b=e.target.closest('button[data-quick]');if(!b)return;quick=b.dataset.quick||'all';$('mov-quick').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));render()});
  $('mov-table').querySelector('tbody').addEventListener('click',e=>{const tr=e.target.closest('tr[data-row]');if(!tr)return;const r=shownRows[Number(tr.dataset.row)];if(r)modal(r)});
  $('mov-modal-close').onclick=()=>{$('mov-modal').hidden=true};$('mov-modal').addEventListener('click',e=>{if(e.target===$('mov-modal'))$('mov-modal').hidden=true});document.addEventListener('keydown',e=>{if(e.key==='Escape')$('mov-modal').hidden=true});
  load();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();