(()=>{
const $=id=>document.getElementById(id),key='iikoConnection';
let last=null,tree=[];
function conn(){try{return JSON.parse(localStorage.getItem(key)||'null')}catch{return null}}
function pad(n){return String(n).padStart(2,'0')}
function iso(d){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function initDates(){const n=new Date(),f=new Date(n.getFullYear(),n.getMonth(),1);$('from').value=iso(f);$('to').value=iso(n)}
function setPeriod(v){const n=new Date(),t=new Date(n);if(v==='month'){t.setDate(1);$('from').value=iso(t);$('to').value=iso(n)}else if(v==='prev'){const f=new Date(n.getFullYear(),n.getMonth()-1,1),e=new Date(n.getFullYear(),n.getMonth(),0);$('from').value=iso(f);$('to').value=iso(e)}else if(v==='7'||v==='30'){t.setDate(t.getDate()-Number(v)+1);$('from').value=iso(t);$('to').value=iso(n)}}
function money(v){return Number(v||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})}
function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function render(rows,rev){
 const tb=$('pnl-table').querySelector('tbody');tb.innerHTML='';
 const totalRev=Number(rev||0);
 rows.forEach(r=>{
  const tr=document.createElement('tr');
  tr.className=(r.kind||'')+' '+(Number(r.value)<0?'negative':'')+(r.revenueCategory?' revenue-category':'');
  const pct=totalRev?Number(r.value)/totalRev*100:0;
  const categoryPct=r.revenueCategory&&Number.isFinite(Number(r.share))?Number(r.share):pct;
  tr.innerHTML=`<td>${r.level?'<span class="toggle">'+(r.open?'⌄':'›')+'</span>':''}${esc(r.name)}</td><td>${money(r.value)}</td><td class="pct-col">${$('pct').checked?(categoryPct.toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})+' %'):'—'}</td>`;
  if(r.level)tr.querySelector('.toggle').onclick=()=>{r.open=!r.open;render(rows,rev)};
  tb.appendChild(tr)
 })
}
function renderCategorySummary(categories,rev){
 const host=$('revenue-category-summary');
 if(!host)return;
 const items=(categories||[]).slice().sort((a,b)=>Number(b.share)-Number(a.share));
 if(!items.length){host.innerHTML='';return}
 host.innerHTML=`<div class="revenue-category-head"><div><strong>Структура выручки по категориям</strong><span>Только категории блюд · без детализации по блюдам</span></div><b>${money(rev)}</b></div><div class="revenue-category-list">${items.map(x=>`<div class="revenue-category-row"><div class="revenue-category-name"><span>${esc(x.name)}</span><div class="revenue-category-bar"><i style="width:${Math.max(0,Math.min(100,Number(x.share)||0))}%"></i></div></div><strong>${money(x.value)}</strong><b>${Number(x.share||0).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})}%</b></div>`).join('')}</div><div class="revenue-category-total"><span>Итого</span><strong>${money(rev)}</strong><b>100,0%</b></div>`;
}
async function load(){
 const c=conn();
 if(!c){$('pnl-status').textContent='Нет подключения iiko';$('message').textContent='Не найдены сохранённые данные подключения iiko.';return}
 const from=$('from').value,to=$('to').value;if(!from||!to)return;
 $('load').disabled=true;$('pnl-status').textContent='Загрузка…';$('message').style.display='block';$('message').textContent='Получаем P&L и структуру выручки по категориям из iiko OLAP…';
 try{
  const r=await fetch('/api/iiko/pnl',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...c,from,to,byDate:$('byDate').checked,byConcept:$('byConcept').checked,allocate:$('allocate').checked})});
  const j=await r.json();if(!r.ok||!j.success)throw new Error(j.message||'Ошибка P&L');
  last=j;$('source-note').textContent=j.sourceNote||'iiko Server / OLAP';$('pnl-status').textContent=`Данные: ${from} — ${to}`;
  tree=j.rows||[];render(tree,j.revenue||0);renderCategorySummary(j.revenueCategories||[],j.revenue||0);
  $('message').style.display='none';$('excel').disabled=false;
  const all=[...(j.salesFields||[]).map(x=>({s:'SALES',x})),...(j.transactionFields||[]).map(x=>({s:'TRANSACTIONS',x}))];
  $('field-list').innerHTML=all.map(o=>`<div class="field-chip"><b>${esc(o.s)}</b> · ${esc(o.x.name)} — ${esc(o.x.title)}</div>`).join('')||'<span>Поля не получены</span>';
 }catch(e){$('pnl-status').textContent='Ошибка';$('message').style.display='block';$('message').textContent=e.message;$('excel').disabled=true}
 finally{$('load').disabled=false}
}
function bind(){
 if(!$('load'))return;
 $('period').onchange=e=>setPeriod(e.target.value);$('load').onclick=load;
 $('expand').onclick=()=>{tree.forEach(x=>{if(x.level)x.open=true});render(tree,last?.revenue||0)};
 $('collapse').onclick=()=>{tree.forEach(x=>{if(x.level)x.open=false});render(tree,last?.revenue||0)};
 $('pct').onchange=()=>render(tree,last?.revenue||0);
 $('excel').onclick=()=>{if(!last)return;const lines=[['Статья','Сумма','% к выручке'],...last.rows.map(r=>[r.name,r.value,last.revenue?Number(r.value)/last.revenue*100:0])];const csv='\ufeff'+lines.map(a=>a.map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(';')).join('\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=`pnl-${$('from').value}-${$('to').value}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500)};
 initDates()
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind()
})();