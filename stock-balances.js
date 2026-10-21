(()=>{'use strict';
const $=id=>document.getElementById(id);
let rows=[],renderedRows=[],statusFilter='all',zeroTruncated=false;
let traceLots=[],traceLocations=[],traceState='unavailable',traceMessage='';

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
function refKey(v){return String(v??'').trim().replace(/[{}]/g,'').toLowerCase()}
function lotsForRow(r){
  if(traceState!=='current')return[];
  return traceLots.filter(l=>refKey(l.productId)===refKey(r.productId)&&
    refKey(l.warehouseId)===refKey(r.storeId)&&Number(l.remaining)>0.00001);
}
function locationRows(r){
  return lotsForRow(r).flatMap(l=>(l.balances||[]).filter(b=>Number(b.quantity)>0.00001)
    .map(b=>({lot:l,locationId:b.locationId,name:b.locationName,quantity:Number(b.quantity)})));
}
function locationBrief(r){
  if(traceState==='historical')return'Места хранения доступны только для текущей даты';
  if(traceState!=='current')return'Нет данных о местах хранения';
  const places=locationRows(r);
  if(!places.length)return'Без распределения';
  const grouped=new Map();
  for(const x of places)grouped.set(x.name,(grouped.get(x.name)||0)+x.quantity);
  return [...grouped.entries()].map(([name,qty])=>name+' · '+amount(qty)).join(' | ');
}
async function refreshTrace(date){
  traceLots=[];traceLocations=[];traceState='unavailable';traceMessage='';
  if(date!==ymd()){traceState='historical';traceMessage='Полки отображаются только для текущих остатков; исторические места хранения пока не восстановлены.';return}
  try{
    const client=await window.SHAuth?.createClient?.();
    const session=(await client?.auth?.getSession?.())?.data?.session;
    if(!session?.access_token)throw Error('Нет активной сессии');
    const fn=window.SH_IikoContext?.fetchWithTimeout||fetch;
    const response=await fn('/api/procurement-trace',{
      method:'GET',headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'
    },45000);
    const data=await response.json().catch(()=>({}));
    if(!response.ok||data.success===false)throw Error(data.message||'HTTP '+response.status);
    traceLots=data.lots||[];traceLocations=data.locations||[];traceState='current';
    traceMessage='Полки и партии — локальный учёт Smart Horeca на текущий момент; iiko показывает общий остаток.';
  }catch(error){
    traceMessage='Не удалось получить полки из Smart Horeca: '+(error.message||String(error));
  }
}

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
  const location=$('stock-location')?.value||'';
  const q=($('stock-search').value||'').trim().toLowerCase();
  return rows.filter(r=>{
    if(store&&String(r.storeId)!==store)return false;
    if(category&&catOf(r)!==category)return false;
    if(location&&!locationRows(r).some(x=>x.locationId===location))return false;
    if(q){
      const hay=[r.productName,r.productNum,r.productCode,r.groupName,r.categoryName,r.storeName,r.unit,locationBrief(r),...lotsForRow(r).map(l=>l.supplierName+' '+l.lotCode)].join(' ').toLowerCase();
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
      '<td class="product-code-cell">'+esc(code||'—')+'</td><td class="product-cell"><strong>'+esc(r.productName||r.productId)+'</strong></td>'+ 
      '<td>'+esc(r.categoryName||r.groupName||'—')+'</td>'+
      '<td>'+esc(storeLabel(r))+'</td>'+
      '<td class="stock-storage-cell">'+esc(locationBrief(r))+'</td>'+
      '<td>'+esc(unitLabel(r))+'</td>'+
      '<td class="num">'+amount(r.amount)+'</td>'+
      '<td class="num">'+cost(r.unitCost)+'</td>'+
      '<td class="num">'+money(r.sum)+'</td>'+
      '<td class="num">'+(r.minAmount===null||r.minAmount===undefined?'—':amount(r.minAmount))+'</td>'+
      '<td class="num">'+(r.maxAmount===null||r.maxAmount===undefined?'—':amount(r.maxAmount))+'</td>'+
      '<td>'+badge(r)+'</td></tr>';
  }).join('')||'<tr><td colspan="12" class="sh-i18n-empty-state" style="text-align:center;padding:34px;color:#8192a4">По выбранным фильтрам данных нет.</td></tr>';

  const shown=Math.min(visible.length,renderedRows.length);
  $('stock-result-meta').textContent=shown+' из '+visible.length+' позиций';
  const notes=[];
  if(traceMessage)notes.push(traceMessage);
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
  const breakdown=$('stock-location-breakdown'),shelves=locationRows(r);
  if(traceState!=='current')breakdown.textContent=traceMessage||'Нет информации по партиям.';
  else if(!shelves.length)breakdown.textContent='Для этой позиции нет зарегистрированных партий с указанием полки. Общий остаток iiko остаётся доступным.';
  else{
    const records=shelves.map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.lot.lotCode)+'</td>'+
      '<td>'+esc(x.lot.supplierName||'—')+'</td><td>'+amount(x.quantity)+' '+esc(x.lot.unit||'')+'</td>'+
      '<td>'+esc(x.lot.expiresOn||'—')+'</td></tr>').join('');
    const tracked=shelves.reduce((sum,x)=>sum+x.quantity,0);
    breakdown.innerHTML='<strong>Расположение зарегистрированных партий</strong>'+
      '<div class="table-wrap"><table><thead><tr><th>Место</th><th>Партия</th><th>Поставщик</th><th>Кол-во</th><th>Срок</th></tr></thead><tbody>'+
      records+'</tbody></table></div><p>Учтено по партиям: '+amount(tracked)+' '+esc(unitLabel(r))+'. Остаток по iiko: '+
      amount(r.amount)+' '+esc(unitLabel(r))+'. Разница требует сверки, не прибавляется к остатку.</p>';
  }
  $('stock-modal').hidden=false;
}

function exportCsv(){
  const visible=baseFiltered().filter(matchesStatus);
  if(!visible.length)return;
  const head=['Товар','Артикул','Код','Категория','Группа','Склад','Полка / холодильник','Ед.','Количество','Себест./ед.','Стоимость','Min','Max','Статус'];
  const quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const body=visible.map(r=>[
    r.productName,r.productNum,r.productCode,r.categoryName,r.groupName,storeLabel(r),locationBrief(r),unitLabel(r),
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
    const isChain=String(b?.identity?.mode||b?.connection?.connectionType||'RMS').toUpperCase()==='CHAIN';
    // In CHAIN a full zero-position expansion can multiply the shared catalog
    // by every warehouse and exceed the Pages Function response budget.
    // Real balance rows (including real zero rows returned by SH) stay intact.
    const r=await (window.SH_IikoContext?.fetchWithTimeout||fetch)('/api/iiko/stock-balances',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({...c,date,time:snapshotTime(date),departmentIds,includeZero:!isChain})},45000);
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.success)throw Error(j.message||('HTTP '+r.status));
    rows=Array.isArray(j.rows)?j.rows:[];
    zeroTruncated=!!j.meta?.zeroExpansionTruncated;
    await refreshTrace(date);
    populateSelect($('stock-location'),traceLocations.filter(x=>x.active).map(x=>({value:x.id,label:x.name+' · '+(x.warehouseName||x.warehouseId)})),'Все места хранения');

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
  $('stock-location').onchange=render;
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