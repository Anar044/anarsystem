(()=>{'use strict';
const $=id=>document.getElementById(id);
let rows=[],renderedRows=[],statusFilter='all',zeroTruncated=false;

function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function isGuidLike(v){return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v??'').trim())}
function shortRef(v,prefix='ID'){const s=String(v??'').trim();return s?(prefix+' · …'+s.slice(-6)):prefix}
function storeLabel(r){const n=String(r?.storeName||'').trim();return n&&!isGuidLike(n)?n:shortRef(r?.storeId,'Склад iiko')}
function unitLabel(r){const n=String(r?.unit||'').trim();return n&&!isGuidLike(n)?n:'—'}
function ymd(d=new Date()){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function snapshotTime(date){const n=new Date();return date===ymd(n)?String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0')+':'+String(n.getSeconds()).padStart(2,'0'):'23:59:59'}
function money(v){return Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₼'}
function cost(v){return v===null||v===undefined?'—':Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:4})+' ₼'}
function amount(v){return Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:3})}
function catOf(r){return String(r.categoryName||r.groupName||'Без категории').trim()}
async function binding(){if(window.SH_IikoContext?.getBinding)return await window.SH_IikoContext.getBinding();return null}

function setMessage(text,isError=false){const el=$('stock-message');el.textContent=text;el.classList.toggle('error',!!isError);el.style.display=text?'block':'none'}
function setStatus(text){$('stock-status').textContent=text}

function populateSelect(select,items,placeholder){
  const current=select.value;
  select.innerHTML='<option value="">'+esc(placeholder)+'</option>'+items.map(x=>'<option value="'+esc(x.value)+'">'+esc(x.label)+'</option>').join('');
  if([...select.options].some(x=>x.value===current))select.value=current;
}

function baseFiltered(){
  const store=$('stock-store').value;
  const category=$('stock-category').value;
  const q=($('stock-search').value||'').trim().toLowerCase();
  return rows.filter(r=>{
    if(store&&String(r.storeId)!==store)return false;
    if(category&&catOf(r)!==category)return false;
    if(q){
      const hay=[r.productName,r.productNum,r.productCode,r.groupName,r.categoryName,r.storeName,r.unit].join(' ').toLowerCase();
      if(!hay.includes(q))return false;
    }
    return true;
  });
}

function matchesStatus(r){
  const a=Number(r.amount||0);
  if(statusFilter==='positive')return a>0;
  if(statusFilter==='zero')return Math.abs(a)<=1e-12;
  if(statusFilter==='negative')return a<0;
  if(statusFilter==='belowMin')return !!r.belowMin;
  return true;
}

function badge(r){
  const a=Number(r.amount||0);
  if(a<0)return'<span class="status-badge negative">Минус</span>';
  if(r.belowMin)return'<span class="status-badge low">Ниже min</span>';
  if(Math.abs(a)<=1e-12)return'<span class="status-badge zero">Нет остатка</span>';
  return'<span class="status-badge">В наличии</span>';
}

function updateKpis(base){
  $('kpi-value').textContent=money(base.reduce((s,r)=>s+Number(r.sum||0),0));
  $('kpi-positions').textContent=base.length.toLocaleString('ru-RU');
  $('kpi-negative').textContent=base.filter(r=>Number(r.amount||0)<0).length.toLocaleString('ru-RU');
  const low=base.filter(r=>r.belowMin).length;
  $('kpi-low').textContent=low.toLocaleString('ru-RU');
  $('kpi-low-note').textContent=low?'по min из iiko':'min не задан / нет отклонений';
}

function render(){
  const base=baseFiltered();
  const counts={
    all:base.length,
    positive:base.filter(r=>Number(r.amount||0)>0).length,
    zero:base.filter(r=>Math.abs(Number(r.amount||0))<=1e-12).length,
    negative:base.filter(r=>Number(r.amount||0)<0).length,
    low:base.filter(r=>r.belowMin).length
  };
  $('count-all').textContent=counts.all;
  $('count-positive').textContent=counts.positive;
  $('count-zero').textContent=counts.zero;
  $('count-negative').textContent=counts.negative;
  $('count-low').textContent=counts.low;
  updateKpis(base);

  const visible=base.filter(matchesStatus);
  renderedRows=visible.slice(0,1500);
  const tb=$('stock-table').querySelector('tbody');
  tb.innerHTML=renderedRows.map((r,i)=>{
    const code=[r.productNum,r.productCode].filter(Boolean).join(' · ');
    return'<tr data-row="'+i+'">'+
      '<td class="product-cell"><strong>'+esc(r.productName||r.productId)+'</strong><small>'+esc(code||r.productId)+'</small></td>'+
      '<td>'+esc(r.categoryName||r.groupName||'—')+'</td>'+
      '<td>'+esc(storeLabel(r))+'</td>'+
      '<td>'+esc(unitLabel(r))+'</td>'+
      '<td class="num">'+amount(r.amount)+'</td>'+
      '<td class="num">'+cost(r.unitCost)+'</td>'+
      '<td class="num">'+money(r.sum)+'</td>'+
      '<td class="num">'+(r.minAmount===null||r.minAmount===undefined?'—':amount(r.minAmount))+'</td>'+
      '<td class="num">'+(r.maxAmount===null||r.maxAmount===undefined?'—':amount(r.maxAmount))+'</td>'+
      '<td>'+badge(r)+'</td></tr>';
  }).join('')||'<tr><td colspan="10" style="text-align:center;padding:34px;color:#8192a4">По выбранным фильтрам данных нет.</td></tr>';

  const shown=Math.min(visible.length,renderedRows.length);
  $('stock-result-meta').textContent=shown+' из '+visible.length+' позиций';
  const notes=[];
  if(visible.length>renderedRows.length)notes.push('На экране показаны первые '+renderedRows.length+' строк. Экспорт CSV содержит все '+visible.length+'.');
  if(zeroTruncated)notes.push('Нулевые позиции частично ограничены защитным лимитом.');
  $('stock-limit-note').textContent=notes.join(' ');
}

function openModal(r){
  $('stock-modal-title').textContent=r.productName||r.productId;
  const items=[
    ['Склад',storeLabel(r)],
    ['Количество',amount(r.amount)+(unitLabel(r)==='—'?'':' '+unitLabel(r))],
    ['Себестоимость единицы',cost(r.unitCost)],
    ['Стоимость остатка',money(r.sum)],
    ['Группа',r.groupName||'—'],
    ['Категория',r.categoryName||'—'],
    ['Артикул',r.productNum||'—'],
    ['Код',r.productCode||'—'],
    ['Minimum',r.minAmount===null||r.minAmount===undefined?'—':amount(r.minAmount)],
    ['Maximum',r.maxAmount===null||r.maxAmount===undefined?'—':amount(r.maxAmount)]
  ];
  $('stock-modal-grid').innerHTML=items.map(x=>'<div class="modal-item"><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong></div>').join('');
  $('stock-modal').hidden=false;
}

function exportCsv(){
  const visible=baseFiltered().filter(matchesStatus);
  if(!visible.length)return;
  const head=['Товар','Артикул','Код','Категория','Группа','Склад','Ед.','Количество','Себест./ед.','Стоимость','Min','Max','Статус'];
  const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const body=visible.map(r=>[
    r.productName,r.productNum,r.productCode,r.categoryName,r.groupName,storeLabel(r),unitLabel(r),
    Number(r.amount||0),r.unitCost??'',Number(r.sum||0),r.minAmount??'',r.maxAmount??'',
    Number(r.amount||0)<0?'Отрицательный':r.belowMin?'Ниже min':Math.abs(Number(r.amount||0))<=1e-12?'Нулевой':'В наличии'
  ].map(quote).join(';'));
  const blob=new Blob(['\uFEFF'+[head.map(quote).join(';'),...body].join('\r\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='stock-balances-'+($('stock-date').value||ymd())+'.csv';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},0);
}

async function load(){
  const btn=$('stock-refresh');btn.disabled=true;setStatus('Загрузка…');setMessage('Получаем остатки и номенклатуру из iiko…');
  try{
    const b=await binding(),c=b?.connection,departmentIds=Array.isArray(b?.departmentIds)?b.departmentIds:[];
    if(!c?.ip||!c?.port||!c?.login||!c?.password)throw Error('Не найдено подключение iiko. Откройте «Настройки» и подключите iiko Server.');
    const date=$('stock-date').value||ymd();
    const r=await fetch('/api/iiko/stock-balances',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({...c,date,time:snapshotTime(date),departmentIds,includeZero:true})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.success)throw Error(j.message||('HTTP '+r.status));
    rows=Array.isArray(j.rows)?j.rows:[];
    zeroTruncated=!!j.meta?.zeroExpansionTruncated;

    populateSelect($('stock-store'),(j.warehouses||[]).map(x=>({value:String(x.id),label:(x.name&&!isGuidLike(x.name))?x.name:shortRef(x.id,'Склад iiko')})),'Все склады');
    const cats=[...new Set(rows.map(catOf).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    populateSelect($('stock-category'),cats.map(x=>({value:x,label:x})),'Все категории');

    $('stock-source').textContent='Источник: '+(j.source||'/resto/api/v2/reports/balance/stores')+' · '+j.timestamp;
    setStatus('Готово · '+Number(j.meta?.realBalanceRows||0).toLocaleString('ru-RU')+' реальных строк');
    setMessage('');
    render();
  }catch(e){
    rows=[];render();setStatus('Ошибка');setMessage(e.message||String(e),true);
  }finally{btn.disabled=false}
}

function bind(){
  $('stock-date').value=ymd();
  $('stock-refresh').onclick=load;
  $('stock-export').onclick=exportCsv;
  $('stock-store').onchange=render;
  $('stock-category').onchange=render;
  $('stock-search').oninput=render;
  $('stock-status-filters').addEventListener('click',e=>{
    const b=e.target.closest('button[data-status]');if(!b)return;
    statusFilter=b.dataset.status||'all';
    $('stock-status-filters').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));
    render();
  });
  $('stock-table').querySelector('tbody').addEventListener('click',e=>{
    const tr=e.target.closest('tr[data-row]');if(!tr)return;
    const r=renderedRows[Number(tr.dataset.row)];if(r)openModal(r);
  });
  $('stock-modal-close').onclick=()=>{$('stock-modal').hidden=true};
  $('stock-modal').addEventListener('click',e=>{if(e.target===$('stock-modal'))$('stock-modal').hidden=true});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')$('stock-modal').hidden=true});
  load();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();