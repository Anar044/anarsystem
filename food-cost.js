(()=>{'use strict';
const $=id=>document.getElementById(id);
let rows=[],shown=[],sources={},quick='all',summary={};

function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function ymd(d=new Date()){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')}
function money(v){return Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₼'}
function amount(v){return Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:3})}
function pct(v){return v===null||v===undefined?'—':Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+'%'}
function catOf(r){return String(r.categoryName||r.groupName||'Без категории').trim()}
function setStatus(v){$('fc-status').textContent=v}
function setMessage(v,error=false){const e=$('fc-message');e.textContent=v;e.classList.toggle('error',!!error);e.style.display=v?'block':'none'}
async function binding(){if(window.SH_IikoContext?.getBinding)return await window.SH_IikoContext.getBinding();return null}
function defaultPeriod(){const to=new Date(),from=new Date();from.setDate(from.getDate()-30);$('fc-from').value=ymd(from);$('fc-to').value=ymd(to)}
function populate(select,items,label){const old=select.value;select.innerHTML='<option value="">'+esc(label)+'</option>'+items.map(x=>'<option value="'+esc(x.value)+'">'+esc(x.label)+'</option>').join('');if([...select.options].some(x=>x.value===old))select.value=old}
function isProblem(r){return Math.abs(Number(r.varianceValue||0))>=0.01||Math.abs(Number(r.varianceQty||0))>=0.001}
function baseFiltered(){
  const category=$('fc-category').value,q=($('fc-search').value||'').trim().toLowerCase();
  return rows.filter(r=>{
    if(category&&catOf(r)!==category)return false;
    if(q){const hay=[r.productName,r.productNum,r.productCode,r.groupName,r.categoryName,r.unit].join(' ').toLowerCase();if(!hay.includes(q))return false}
    return true;
  });
}
function filtered(){
  const base=baseFiltered();
  if(quick==='problem')return base.filter(isProblem);
  if(quick==='positive')return base.filter(r=>Number(r.varianceValue||0)>0.01);
  if(quick==='negative')return base.filter(r=>Number(r.varianceValue||0)<-0.01);
  return base;
}
function statusBadge(r){
  const v=Number(r.varianceValue||0);
  if(v>0.01)return'<span class="badge bad">Перерасход</span>';
  if(v<-0.01)return'<span class="badge good">Экономия</span>';
  return'<span class="badge neutral">Норма</span>';
}
function vclass(v){return Number(v||0)>0?'v-pos':Number(v||0)<0?'v-neg':''}
function updateSummary(){
  $('kpi-revenue').textContent=money(summary.revenue);
  $('kpi-theory').textContent=money(summary.theoreticalCost);
  $('kpi-theory-pct').textContent=pct(summary.theoreticalFoodCostPct);
  $('kpi-actual').textContent=money(summary.actualCost);
  $('kpi-actual-pct').textContent=pct(summary.actualFoodCostPct);
  $('kpi-variance').textContent=(Number(summary.varianceValue||0)>0?'+':'')+money(summary.varianceValue);
  $('kpi-variance-pct').textContent=pct(summary.variancePct);
  $('ex-open').textContent=money(summary.openingValue);
  $('ex-in').textContent=money(summary.incomingValue);
  $('ex-close').textContent=money(summary.closingValue);
  $('ex-writeoff').textContent=money(summary.documentedWriteoffValue);
  $('ex-unexplained').textContent=(Number(summary.unexplainedVariance||0)>0?'+':'')+money(summary.unexplainedVariance);
  $('ex-coverage').textContent=pct(summary.recipeCoveragePct);
}
function updateSources(){
  const names={sales:'SALES OLAP',recipes:'Техкарты',openingBalance:'Остаток начало',closingBalance:'Остаток конец',incoming:'Приходы',outgoing:'Расходы',transfers:'Перемещения',writeoffs:'Списания'};
  $('fc-sources').innerHTML=Object.entries(names).map(([k,label])=>{
    const s=sources?.[k],ok=s?.ok!==false,extra=s?.rows??s?.count??s?.documents;
    return'<span class="source-chip '+(ok?'ok':'warn')+'">'+esc(label)+' · '+(ok?'OK':'недоступно')+(extra!==undefined?' · '+esc(extra):'')+'</span>';
  }).join('');
}
function render(){
  const base=baseFiltered(),problem=base.filter(isProblem).length,pos=base.filter(r=>Number(r.varianceValue||0)>0.01).length,neg=base.filter(r=>Number(r.varianceValue||0)<-0.01).length;
  $('count-all').textContent=base.length;$('count-problem').textContent=problem;$('count-positive').textContent=pos;$('count-negative').textContent=neg;
  const data=filtered();shown=data.slice(0,2000);
  $('fc-table').querySelector('tbody').innerHTML=shown.map((r,i)=>{
    const code=[r.productNum,r.productCode].filter(Boolean).join(' · ');
    return'<tr data-row="'+i+'">'+
      '<td class="product"><strong>'+esc(r.productName||r.productId)+'</strong><small>'+esc(code||r.productId||'')+'</small></td>'+
      '<td>'+esc(r.categoryName||r.groupName||'—')+'</td><td>'+esc(r.unit||'—')+'</td>'+
      '<td class="num">'+amount(r.theoreticalQty)+'</td><td class="num">'+amount(r.actualQty)+'</td>'+
      '<td class="num '+vclass(r.varianceQty)+'">'+(Number(r.varianceQty||0)>0?'+':'')+amount(r.varianceQty)+'</td>'+
      '<td class="num">'+money(r.unitCost)+'</td><td class="num">'+money(r.theoreticalValue)+'</td><td class="num">'+money(r.actualValue)+'</td>'+
      '<td class="num '+vclass(r.varianceValue)+'">'+(Number(r.varianceValue||0)>0?'+':'')+money(r.varianceValue)+'</td>'+
      '<td class="num '+vclass(r.variancePct)+'">'+pct(r.variancePct)+'</td><td>'+statusBadge(r)+'</td></tr>';
  }).join('')||'<tr><td colspan="12" style="text-align:center;padding:34px;color:#8192a4">По фильтрам данных нет.</td></tr>';
  $('fc-result-meta').textContent=Math.min(data.length,shown.length)+' из '+data.length+' ингредиентов';
  $('fc-limit-note').textContent=data.length>shown.length?'Показаны первые '+shown.length+' строк. CSV содержит все найденные ингредиенты.':'';
}
function openModal(r){
  $('fc-modal-title').textContent=r.productName||r.productId;
  const items=[
    ['Остаток на начало',amount(r.openingQty)+' '+(r.unit||'')],
    ['Приход',amount(r.incomingQty)+' '+(r.unit||'')],
    ['Внешний расход',amount(r.outgoingQty)+' '+(r.unit||'')],
    ['Перемещение',amount(r.transferQty)+' '+(r.unit||'')],
    ['Остаток на конец',amount(r.closingQty)+' '+(r.unit||'')],
    ['Теория',amount(r.theoreticalQty)+' '+(r.unit||'')],
    ['Факт',amount(r.actualQty)+' '+(r.unit||'')],
    ['Отклонение',amount(r.varianceQty)+' '+(r.unit||'')],
    ['Себестоимость / ед.',money(r.unitCost)],
    ['Отклонение в деньгах',(Number(r.varianceValue||0)>0?'+':'')+money(r.varianceValue)]
  ];
  $('fc-modal-grid').innerHTML=items.map(x=>'<div class="modal-item"><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong></div>').join('');
  $('fc-modal-formula').textContent='Actual = '+amount(r.openingQty)+' + '+amount(r.incomingQty)+' − '+amount(r.outgoingQty)+' '+(Number(r.transferQty||0)>=0?'+ ':'− ')+amount(Math.abs(Number(r.transferQty||0)))+' − '+amount(r.closingQty)+' = '+amount(r.actualQty)+' '+(r.unit||'');
  $('fc-modal').hidden=false;
}
function exportCsv(){
  const data=filtered();if(!data.length)return;
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"',head=['Ингредиент','Артикул','Код','Категория','Группа','Ед.','Остаток начало','Приход','Внешний расход','Перемещение','Остаток конец','Теория','Факт','Отклонение','Себест./ед.','Теория ₼','Факт ₼','Отклонение ₼','Отклонение %'];
  const body=data.map(r=>[r.productName,r.productNum,r.productCode,r.categoryName,r.groupName,r.unit,r.openingQty,r.incomingQty,r.outgoingQty,r.transferQty,r.closingQty,r.theoreticalQty,r.actualQty,r.varianceQty,r.unitCost,r.theoreticalValue,r.actualValue,r.varianceValue,r.variancePct??''].map(q).join(';'));
  const blob=new Blob(['\uFEFF'+[head.map(q).join(';'),...body].join('\r\n')],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='food-cost-'+$('fc-from').value+'-'+$('fc-to').value+'.csv';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},0);
}
async function load(){
  const btn=$('fc-refresh');btn.disabled=true;setStatus('Расчёт…');setMessage('Получаем продажи, техкарты, остатки и складские документы…');
  try{
    const b=await binding(),c=b?.connection;if(!c?.ip||!c?.port||!c?.login||!c?.password)throw Error('Нет подключения iiko Server.');
    const from=$('fc-from').value,to=$('fc-to').value;if(!from||!to||to<from)throw Error('Проверьте период.');
    const r=await fetch('/api/iiko/food-cost',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({...c,from,to,storeId:$('fc-store').value,departmentIds:Array.isArray(b?.departmentIds)?b.departmentIds:[]})});
    const j=await r.json().catch(()=>({}));if(!r.ok||!j.success)throw Error(j.message||('HTTP '+r.status));
    rows=Array.isArray(j.rows)?j.rows:[];summary=j.summary||{};sources=j.sources||{};
    populate($('fc-store'),(j.stores||[]).map(x=>({value:String(x.id),label:x.name||x.id})),'Все склады');
    const cats=[...new Set(rows.map(catOf).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));populate($('fc-category'),cats.map(x=>({value:x,label:x})),'Все категории');
    $('fc-period').textContent='Период: '+from+' — '+to+' · источник теории: '+(j.meta?.theoreticalCostSource==='SALES_OLAP_COST'?'SALES OLAP себестоимость':'оценка по техкартам');
    updateSummary();updateSources();render();setMessage('');setStatus('Готово · '+rows.length+' ингредиентов');
  }catch(e){rows=[];summary={};sources={};updateSummary();updateSources();render();setStatus('Ошибка');setMessage(e.message||String(e),true)}
  finally{btn.disabled=false}
}
function bind(){
  defaultPeriod();$('fc-refresh').onclick=load;$('fc-export').onclick=exportCsv;$('fc-store').onchange=load;$('fc-category').onchange=render;$('fc-search').oninput=render;
  $('fc-quick').addEventListener('click',e=>{const b=e.target.closest('button[data-q]');if(!b)return;quick=b.dataset.q||'all';$('fc-quick').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));render()});
  $('fc-table').querySelector('tbody').addEventListener('click',e=>{const tr=e.target.closest('tr[data-row]');if(!tr)return;const r=shown[Number(tr.dataset.row)];if(r)openModal(r)});
  $('fc-modal-close').onclick=()=>{$('fc-modal').hidden=true};$('fc-modal').addEventListener('click',e=>{if(e.target===$('fc-modal'))$('fc-modal').hidden=true});document.addEventListener('keydown',e=>{if(e.key==='Escape')$('fc-modal').hidden=true});
  load();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();