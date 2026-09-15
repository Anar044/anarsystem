(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>{if(typeof v==='number')return Number.isFinite(v)?v:0;const n=Number(String(v??'').replace(/\s/g,'').replace(',','.'));return Number.isFinite(n)?n:0};
  const money=v=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(num(v));
  const qty=v=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2}).format(num(v));
  const pct=v=>`${new Intl.NumberFormat('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1}).format(num(v))}%`;
  const today=()=>new Date().toISOString().slice(0,10);
  const daysAgo=days=>{const d=new Date();d.setDate(d.getDate()-days);return d.toISOString().slice(0,10)};
  const UPS_KEY='shWaiterUpsellProducts';
  let data=null,busy=false;

  function setStatus(text,kind=''){const el=$('wpStatus');if(!el)return;el.textContent=text;el.className=`wp-status ${kind}`.trim()}
  async function getState(){if(window.SH_IikoContext?.get)return await window.SH_IikoContext.get();return null}
  async function getConnection(){return(await getState())?.connection||null}
  async function getDepartmentIds(){
    if(window.SH_IikoContext?.getBinding){const binding=await window.SH_IikoContext.getBinding();if(Array.isArray(binding?.departmentIds)&&binding.departmentIds.length)return[...new Set(binding.departmentIds.map(String).map(x=>x.trim()).filter(Boolean))]}
    const state=await getState();
    if(window.SH_IikoContext?.departmentIds){const ids=window.SH_IikoContext.departmentIds(state);if(Array.isArray(ids)&&ids.length)return ids}
    return[];
  }
  function upsellProducts(){return String($('wpUpsellProducts')?.value||'').split(/[;\n]+/).map(x=>x.trim()).filter(Boolean)}
  function filtered(){const q=String($('wpSearch')?.value||'').trim().toLowerCase();const rows=Array.isArray(data?.waiters)?data.waiters:[];return q?rows.filter(r=>String(r.waiter||'').toLowerCase().includes(q)):rows}
  function comment(row,avgCheck,avgDepth){
    const hiCheck=row.averageCheck>=avgCheck,hiDepth=row.checkDepth>=avgDepth;
    if(hiCheck&&hiDepth)return'Сильный результат: высокий средний чек и хорошая глубина чека.';
    if(!hiCheck&&hiDepth)return'Много позиций в заказе, но средний чек ниже среднего — проверьте ценовой микс и Upsell более дорогих позиций.';
    if(hiCheck&&!hiDepth)return'Средний чек высокий, но глубина ниже средней — есть потенциал увеличивать количество позиций в заказе.';
    return'Средний чек и глубина ниже команды — зона для обучения рекомендациям и допродажам.';
  }
  function renderSummary(){
    const host=$('wpSummary');if(!host)return;const s=data?.summary||{};const tips=data?.tips||{};
    const tipValue=tips.available?money(s.totalTips):'Нет данных';
    host.innerHTML=`
      <article class="wp-summary-card"><span>Выручка</span><strong>${money(s.revenue)}</strong><small>${qty(s.orders)} заказов</small></article>
      <article class="wp-summary-card"><span>Средний чек</span><strong>${money(s.averageCheck)}</strong><small>Выручка ÷ заказы</small></article>
      <article class="wp-summary-card"><span>Глубина чека</span><strong>${qty(s.checkDepth)}</strong><small>Позиций на один заказ</small></article>
      <article class="wp-summary-card"><span>Официанты</span><strong>${qty(s.waiters)}</strong><small>Средняя выручка ${money(s.averageRevenuePerWaiter)}</small></article>
      <article class="wp-summary-card"><span>Чаевые</span><strong>${tipValue}</strong><small>${tips.available?'Получены из OLAP':'Сервер не отдал поле чаевых'}</small></article>`;
  }
  function bars(id,key,formatter){
    const host=$(id);if(!host)return;const rows=filtered().slice(0,12);const max=Math.max(1,...rows.map(r=>num(r[key])));
    host.innerHTML=rows.map(r=>`<div class="wp-bar-row"><div class="wp-bar-name">${esc(r.waiter)}</div><div class="wp-bar-track"><div class="wp-bar-fill" style="width:${Math.max(1,num(r[key])/max*100)}%"></div></div><div class="wp-bar-value">${formatter(r[key])}</div></div>`).join('')||'<div class="wp-muted">Нет данных</div>';
  }
  function renderTable(){
    const table=$('wpTable');if(!table)return;const rows=filtered();const s=data?.summary||{};const avgCheck=num(s.averageCheck),avgDepth=num(s.checkDepth);const tipsAvailable=Boolean(data?.tips?.available);
    table.querySelector('tbody').innerHTML=rows.map((r,index)=>{
      const rankClass=r.rank===1?'top1':r.rank===2?'top2':r.rank===3?'top3':'';
      const checkClass=r.averageCheck>=avgCheck?'wp-good':'wp-warn';
      const depthClass=r.checkDepth>=avgDepth?'wp-good':'wp-warn';
      return`<tr>
        <td><span class="wp-rank ${rankClass}">${r.rank}</span></td>
        <td class="text-left"><b>${esc(r.waiter)}</b></td>
        <td>${money(r.revenue)}</td><td>${pct(r.revenueShare)}</td><td>${qty(r.orders)}</td>
        <td class="${checkClass}">${money(r.averageCheck)}</td><td>${qty(r.quantity)}</td><td class="${depthClass}">${qty(r.checkDepth)}</td>
        <td>${money(r.profit)}</td><td>${pct(r.marginPct)}</td><td>${qty(r.upsellQuantity)}</td><td>${qty(r.upsellPerOrder)}</td>
        <td>${tipsAvailable?money(r.tips):'—'}</td><td class="text-left wp-comment">${esc(comment(r,avgCheck,avgDepth))}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="14" style="text-align:center;padding:35px;color:#7d8b9c">Нет данных</td></tr>';
    table.querySelector('tfoot').innerHTML=`<tr><th colspan="2" class="text-left">ИТОГО / СРЕДНЕЕ</th><th>${money(s.revenue)}</th><th>100%</th><th>${qty(s.orders)}</th><th>${money(s.averageCheck)}</th><th>${qty(s.quantity)}</th><th>${qty(s.checkDepth)}</th><th>${money(s.profit)}</th><th>${pct(s.revenue?s.profit/s.revenue*100:0)}</th><th>—</th><th>—</th><th>${tipsAvailable?money(s.totalTips):'—'}</th><th></th></tr>`;
    if($('wpRowCount'))$('wpRowCount').textContent=`${rows.length} официантов`;
  }
  function renderInfo(){
    const info=$('wpInfo');if(!info)return;const upsell=data?.upsell||{};const tips=data?.tips||{};const parts=[];
    if(upsell.mode==='configured')parts.push(`Upsell считается только по выбранным позициям: ${upsell.configuredProducts.join(', ')}.`);
    else if(upsell.profitAvailable)parts.push(`Upsell сейчас считается автоматически по высокомаржинальным позициям: прибыль на единицу ≥ ${money(upsell.autoMarginThreshold)}.`);
    else parts.push('Прибыль по блюдам недоступна — автоматический Upsell не рассчитывается. Можно указать конкретные блюда в фильтре.');
    if(!tips.available)parts.push(tips.message||'Чаевые недоступны.');
    info.textContent=parts.join(' ');info.hidden=!parts.length;
  }
  function render(){if(!data)return;renderSummary();bars('wpRevenueBars','revenue',money);bars('wpCheckBars','averageCheck',money);renderTable();renderInfo()}
  async function load(){
    if(busy)return;const error=$('wpError');
    try{
      const connection=await getConnection(),departmentIds=await getDepartmentIds();
      if(!connection)throw new Error('Не найдено подключение к SH Server. Проверьте «Настройки».');
      if(!departmentIds.length)throw new Error('Не найден выбранный ресторан / Department ID.');
      const from=$('wpFrom').value,to=$('wpTo').value;if(!from||!to)throw new Error('Укажите период.');if(from>to)throw new Error('Дата начала не может быть позже даты окончания.');
      busy=true;$('wpRun').disabled=true;error.hidden=true;setStatus('Получаем данные…','loading');
      const response=await fetch('/api/iiko/waiter-performance',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({...connection,from,to,departmentIds,upsellProducts:upsellProducts()})});
      const text=await response.text();let result;try{result=text?JSON.parse(text):{}}catch(_){throw new Error(`Сервер вернул не JSON: HTTP ${response.status}`)}
      if(!response.ok||result.success===false)throw new Error(result.message||`HTTP ${response.status}`);
      data=result;localStorage.setItem(UPS_KEY,$('wpUpsellProducts').value||'');render();setStatus(`Готово · ${result.waiters?.length||0} официантов`,'ok');
    }catch(e){data=null;error.hidden=false;error.textContent=e?.message||String(e);setStatus('Ошибка','error')}finally{busy=false;$('wpRun').disabled=false}
  }
  function exportCsv(){
    if(!data?.waiters?.length)return;const tips=Boolean(data?.tips?.available);const rows=[['Место','Официант','Выручка','Доля %','Заказы','Средний чек','Позиций','Глубина чека','Прибыль','Маржинальность %','Upsell шт.','Upsell/заказ','Чаевые']];
    for(const r of data.waiters)rows.push([r.rank,r.waiter,r.revenue,r.revenueShare,r.orders,r.averageCheck,r.quantity,r.checkDepth,r.profit,r.marginPct,r.upsellQuantity,r.upsellPerOrder,tips?r.tips:'']);
    const csv=rows.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\n');const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`waiter_performance_${$('wpFrom').value}_${$('wpTo').value}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function init(){
    $('wpFrom').value=daysAgo(30);$('wpTo').value=today();$('wpUpsellProducts').value=localStorage.getItem(UPS_KEY)||'';
    $('wpRun').onclick=load;$('wpExport').onclick=exportCsv;$('wpSearch').oninput=render;$('wpUpsellProducts').addEventListener('change',()=>localStorage.setItem(UPS_KEY,$('wpUpsellProducts').value||''));
    window.addEventListener('sh:iiko-selection-changed',load);load();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
