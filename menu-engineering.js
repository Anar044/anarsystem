(()=>{
  'use strict';

  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const num=value=>{
    if(typeof value==='number')return Number.isFinite(value)?value:0;
    const parsed=Number(String(value??'').replace(/\s/g,'').replace(',','.'));
    return Number.isFinite(parsed)?parsed:0;
  };
  const money=value=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(num(value));
  const qty=value=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2}).format(num(value));
  const pct=value=>`${new Intl.NumberFormat('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1}).format(num(value))}%`;
  const today=()=>new Date().toISOString().slice(0,10);
  const daysAgo=days=>{const d=new Date();d.setDate(d.getDate()-days);return d.toISOString().slice(0,10)};

  const META={
    star:{name:'Звёзды',description:'Высокая маржа + высокие продажи',recommendation:'Сохранять качество и наличие, выделять в меню и поддерживать текущую ценовую позицию.'},
    workhorse:{name:'Рабочие лошадки',description:'Низкая маржа + высокие продажи',recommendation:'Высокий спрос, но слабая маржа: проверить цену, себестоимость, рецептуру и размер порции.'},
    puzzle:{name:'Загадки',description:'Высокая маржа + низкие продажи',recommendation:'Маржинальное блюдо продаётся редко: улучшить название, фото, расположение в меню и рекомендации персонала.'},
    dog:{name:'Собаки',description:'Низкая маржа + низкие продажи',recommendation:'Пересмотреть рецепт и цену. Если потенциала нет — рассмотреть вывод из меню или замену.'}
  };
  const CLASS_ORDER={star:0,workhorse:1,puzzle:2,dog:3};

  let sourceRows=[];
  let busy=false;
  let lastAnalysis=null;

  function setStatus(text,kind=''){
    const el=$('bcgStatus');
    if(!el)return;
    el.textContent=text;
    el.className=`bcg-status ${kind}`.trim();
  }

  async function getState(){
    if(window.SH_IikoContext?.get)return await window.SH_IikoContext.get();
    return null;
  }

  async function getConnection(){
    const state=await getState();
    return state?.connection||null;
  }

  async function getDepartmentIds(){
    if(window.SH_IikoContext?.getBinding){
      const binding=await window.SH_IikoContext.getBinding();
      if(Array.isArray(binding?.departmentIds)&&binding.departmentIds.length){
        return [...new Set(binding.departmentIds.map(String).map(v=>v.trim()).filter(Boolean))];
      }
    }
    const state=await getState();
    if(window.SH_IikoContext?.departmentIds){
      const ids=window.SH_IikoContext.departmentIds(state);
      if(Array.isArray(ids)&&ids.length)return ids;
    }
    const identity=state?.identity||{};
    const connection=state?.connection||{};
    const candidates=[
      ...(Array.isArray(identity.departmentIds)?identity.departmentIds:[]),
      ...(Array.isArray(connection.departmentIds)?connection.departmentIds:[]),
      ...(Array.isArray(identity.departments)?identity.departments.map(x=>x?.id):[]),
      ...(Array.isArray(identity.organizations)?identity.organizations.map(x=>x?.id):[]),
      identity.organizationId,
      connection.organizationId
    ];
    return [...new Set(candidates.map(String).map(v=>v.trim()).filter(v=>v&&v!=='undefined'&&v!=='null'))];
  }

  function fillSelect(id,key,emptyLabel){
    const el=$(id);
    if(!el)return;
    const current=el.value;
    const values=[...new Set(sourceRows.map(row=>String(row[key]||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
    el.innerHTML=`<option value="">${emptyLabel}</option>`+values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
    if(values.includes(current))el.value=current;
  }

  function populateFilters(){
    fillSelect('bcgGroup','group','Все группы');
    fillSelect('bcgCategory','category','Все категории');
  }

  function scopedRows(){
    const group=$('bcgGroup')?.value||'';
    const category=$('bcgCategory')?.value||'';
    return sourceRows.filter(row=>{
      if(group&&String(row.group||'')!==group)return false;
      if(category&&String(row.category||'')!==category)return false;
      return true;
    });
  }

  function classify(rows){
    const cleanRows=rows.map(row=>({
      ...row,
      revenue:num(row.revenue),
      quantity:Math.max(0,num(row.quantity)),
      profit:num(row.profit),
      cost:num(row.cost),
      margin:num(row.margin),
      avgPrice:num(row.avgPrice)
    }));
    const count=cleanRows.length;
    const totalQty=cleanRows.reduce((sum,row)=>sum+row.quantity,0);
    const totalRevenue=cleanRows.reduce((sum,row)=>sum+row.revenue,0);
    const totalProfit=cleanRows.reduce((sum,row)=>sum+row.profit,0);
    const totalCost=cleanRows.reduce((sum,row)=>sum+row.cost,0);
    const averageQty=count?totalQty/count:0;
    const popularityFactor=Math.max(10,Math.min(150,num($('bcgPopularityFactor')?.value)||70));
    const popularityThreshold=averageQty*(popularityFactor/100);
    const marginThreshold=totalQty?totalProfit/totalQty:0;

    const classified=cleanRows.map(row=>{
      const unitProfit=row.quantity?row.profit/row.quantity:0;
      const highPopularity=row.quantity>=popularityThreshold;
      const highMargin=unitProfit>=marginThreshold;
      let bcgClass='dog';
      if(highPopularity&&highMargin)bcgClass='star';
      else if(highPopularity&&!highMargin)bcgClass='workhorse';
      else if(!highPopularity&&highMargin)bcgClass='puzzle';
      const popularityIndex=popularityThreshold?row.quantity/popularityThreshold*100:0;
      return {...row,unitProfit,popularityIndex,bcgClass};
    });

    return {rows:classified,count,totalQty,totalRevenue,totalProfit,totalCost,averageQty,popularityFactor,popularityThreshold,marginThreshold};
  }

  function displayRows(analysis){
    const query=($('bcgSearch')?.value||'').trim().toLowerCase();
    if(!query)return analysis.rows;
    return analysis.rows.filter(row=>`${row.name||''} ${row.group||''} ${row.category||''} ${META[row.bcgClass]?.name||''}`.toLowerCase().includes(query));
  }

  function renderSummary(analysis){
    const host=$('bcgSummary');
    if(!host)return;
    const buckets={star:[],workhorse:[],puzzle:[],dog:[]};
    for(const row of analysis.rows)(buckets[row.bcgClass]||buckets.dog).push(row);
    host.innerHTML=Object.keys(buckets).map(key=>{
      const rows=buckets[key];
      const revenue=rows.reduce((sum,row)=>sum+row.revenue,0);
      const profit=rows.reduce((sum,row)=>sum+row.profit,0);
      const meta=META[key];
      return `<article class="bcg-summary-card ${key}">
        <div class="bcg-summary-top"><div><div class="bcg-summary-name">${meta.name}</div><div class="bcg-summary-desc">${meta.description}</div></div><div class="bcg-summary-count">${rows.length}</div></div>
        <div class="bcg-summary-metrics"><div><span>Выручка</span><strong>${money(revenue)}</strong></div><div><span>Прибыль</span><strong>${money(profit)}</strong></div></div>
      </article>`;
    }).join('');
  }

  function renderMethod(analysis){
    $('bcgPopularityThreshold').textContent=`${qty(analysis.popularityThreshold)} продаж`;
    $('bcgMarginThreshold').textContent=`${money(analysis.marginThreshold)} / блюдо`;
    $('bcgAverageQty').textContent=qty(analysis.averageQty);
    $('bcgAnalyzedCount').textContent=String(analysis.count);
  }

  function renderMatrix(analysis,visible){
    const host=$('bcgMatrix');
    if(!host)return;
    if(!analysis.rows.length){host.innerHTML='<div class="bcg-empty">Нет данных для построения матрицы</div>';return}

    const unitProfits=analysis.rows.map(row=>row.unitProfit);
    const maxQty=Math.max(1,analysis.popularityThreshold*1.25,...analysis.rows.map(row=>row.quantity));
    let yMin=Math.min(0,analysis.marginThreshold,...unitProfits);
    let yMax=Math.max(0,analysis.marginThreshold,...unitProfits);
    let range=yMax-yMin;
    if(range<0.0001){yMin-=1;yMax+=1;range=2}
    const padding=Math.max(1,range*.08);
    yMin-=padding;
    yMax+=padding;
    range=yMax-yMin;

    const xThreshold=Math.max(1,Math.min(99,analysis.popularityThreshold/maxQty*100));
    const yThreshold=Math.max(1,Math.min(99,100-((analysis.marginThreshold-yMin)/range*100)));
    const maxRevenue=Math.max(1,...analysis.rows.map(row=>Math.max(0,row.revenue)));

    const quadrant=(key,left,top,width,height)=>`<div class="bcg-quadrant ${key}" style="left:${left}%;top:${top}%;width:${width}%;height:${height}%"><strong>${META[key].name}</strong></div>`;
    let html='';
    html+=quadrant('puzzle',0,0,xThreshold,yThreshold);
    html+=quadrant('star',xThreshold,0,100-xThreshold,yThreshold);
    html+=quadrant('dog',0,yThreshold,xThreshold,100-yThreshold);
    html+=quadrant('workhorse',xThreshold,yThreshold,100-xThreshold,100-yThreshold);
    html+=`<div class="bcg-threshold-line vertical" style="left:${xThreshold}%"></div>`;
    html+=`<div class="bcg-threshold-line horizontal" style="top:${yThreshold}%"></div>`;
    html+='<span class="bcg-axis-label x">Продажи →</span><span class="bcg-axis-label y">↑ Маржа на блюдо</span>';

    for(const row of visible){
      const x=Math.max(1.5,Math.min(98.5,row.quantity/maxQty*100));
      const y=Math.max(1.5,Math.min(98.5,100-((row.unitProfit-yMin)/range*100)));
      const bubble=10+16*Math.sqrt(Math.max(0,row.revenue)/maxRevenue);
      const meta=META[row.bcgClass];
      html+=`<div class="bcg-dot ${row.bcgClass}" style="left:${x}%;top:${y}%;width:${bubble}px;height:${bubble}px" title="${esc(row.name)} — ${meta.name}">
        <span class="bcg-dot-label">${esc(row.name)} · ${qty(row.quantity)} продаж · ${money(row.unitProfit)} маржа</span>
      </div>`;
    }
    host.innerHTML=html;
  }

  function renderTable(analysis,visible){
    const table=$('bcgTable');
    if(!table)return;
    const rows=[...visible].sort((a,b)=>CLASS_ORDER[a.bcgClass]-CLASS_ORDER[b.bcgClass]||b.revenue-a.revenue);
    table.querySelector('tbody').innerHTML=rows.map((row,index)=>{
      const meta=META[row.bcgClass];
      const profitClass=row.profit<0?'bcg-share-negative':'bcg-share-positive';
      return `<tr>
        <td>${index+1}</td>
        <td class="text-left"><b>${esc(row.name)}</b></td>
        <td>${esc(row.group||'Без группы')}</td>
        <td>${esc(row.category||'Без категории')}</td>
        <td class="bcg-num">${qty(row.quantity)}</td>
        <td class="bcg-num">${money(row.revenue)}</td>
        <td class="bcg-num">${money(row.cost)}</td>
        <td class="bcg-num ${profitClass}">${money(row.profit)}</td>
        <td class="bcg-num">${money(row.unitProfit)}</td>
        <td class="bcg-num">${pct(row.margin)}</td>
        <td><span class="bcg-class-badge ${row.bcgClass}">${meta.name}</span></td>
        <td class="text-left bcg-rec">${meta.recommendation}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="12" style="text-align:center;padding:35px;color:#7d8b9c">Нет данных</td></tr>';

    const totalMargin=analysis.totalRevenue?analysis.totalProfit/analysis.totalRevenue*100:0;
    const avgUnitProfit=analysis.totalQty?analysis.totalProfit/analysis.totalQty:0;
    table.querySelector('tfoot').innerHTML=`<tr>
      <th colspan="4" class="text-left">ИТОГО ПО ВЫБРАННОМУ МЕНЮ</th>
      <th>${qty(analysis.totalQty)}</th>
      <th>${money(analysis.totalRevenue)}</th>
      <th>${money(analysis.totalCost)}</th>
      <th>${money(analysis.totalProfit)}</th>
      <th>${money(avgUnitProfit)}</th>
      <th>${pct(totalMargin)}</th>
      <th>—</th><th></th>
    </tr>`;
  }

  function render(){
    const analysis=classify(scopedRows());
    lastAnalysis=analysis;
    const visible=displayRows(analysis);
    renderSummary(analysis);
    renderMethod(analysis);
    renderMatrix(analysis,visible);
    renderTable(analysis,visible);
    if($('bcgRowCount'))$('bcgRowCount').textContent=`${visible.length} из ${analysis.count} блюд`;
  }

  async function load(){
    if(busy)return;
    const errorBox=$('bcgError');
    try{
      const connection=await getConnection();
      const departmentIds=await getDepartmentIds();
      if(!connection){
        errorBox.hidden=false;
        errorBox.textContent='Не найдено подключение к SH Server. Откройте «Настройки» и проверьте подключение.';
        setStatus('Нет подключения','error');
        return;
      }
      if(!departmentIds.length){
        errorBox.hidden=false;
        errorBox.textContent='Не найден Department ID выбранного ресторана. Переподключитесь через «Настройки».';
        setStatus('Нет ресторана','error');
        return;
      }
      const from=$('bcgFrom').value;
      const to=$('bcgTo').value;
      if(!from||!to)throw new Error('Укажите период анализа.');
      if(from>to)throw new Error('Дата начала не может быть позже даты окончания.');

      busy=true;
      $('bcgRun').disabled=true;
      errorBox.hidden=true;
      setStatus('Получаем данные меню…','loading');

      const response=await fetch('/api/iiko/abc',{
        method:'POST',
        headers:{'Content-Type':'application/json','Accept':'application/json'},
        body:JSON.stringify({...connection,from,to,departmentIds,abcA:80,abcB:95})
      });
      const text=await response.text();
      let data;
      try{data=text?JSON.parse(text):{}}catch(_){throw new Error(`Сервер вернул некорректный ответ: HTTP ${response.status}`)}
      if(!response.ok||data.success===false)throw new Error(String(data.message||`Ошибка отчёта: HTTP ${response.status}`).replace(/iiko/gi,'SH'));

      sourceRows=Array.isArray(data.rows)?data.rows:[];
      populateFilters();
      render();
      setStatus(`Готово · ${sourceRows.length} блюд`,'ok');
      if(!sourceRows.length){
        errorBox.hidden=false;
        errorBox.textContent='За выбранный период нет продаж блюд для меню-инжиниринга.';
      }
    }catch(error){
      sourceRows=[];
      render();
      errorBox.hidden=false;
      errorBox.textContent=error?.message||String(error);
      setStatus('Ошибка','error');
    }finally{
      busy=false;
      $('bcgRun').disabled=false;
    }
  }

  function exportCsv(){
    if(!lastAnalysis?.rows?.length)return;
    const rows=[...lastAnalysis.rows].sort((a,b)=>CLASS_ORDER[a.bcgClass]-CLASS_ORDER[b.bcgClass]||b.revenue-a.revenue);
    const header=['Блюдо','Группа','Категория','Продажи','Выручка','Себестоимость','Прибыль','Маржа на блюдо','Маржинальность %','Индекс популярности %','Класс','Рекомендация'];
    const data=[header,...rows.map(row=>[
      row.name,row.group||'',row.category||'',row.quantity,row.revenue,row.cost,row.profit,row.unitProfit,row.margin,row.popularityIndex,META[row.bcgClass].name,META[row.bcgClass].recommendation
    ])];
    const csv=data.map(line=>line.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(';')).join('\n');
    const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;
    a.download=`Menu_Engineering_${$('bcgFrom').value}_${$('bcgTo').value}.csv`;
    a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function init(){
    $('bcgFrom').value=daysAgo(30);
    $('bcgTo').value=today();
    $('bcgRun').addEventListener('click',load);
    $('bcgExport').addEventListener('click',exportCsv);
    $('bcgGroup').addEventListener('change',render);
    $('bcgCategory').addEventListener('change',render);
    $('bcgPopularityFactor').addEventListener('input',render);
    $('bcgSearch').addEventListener('input',render);
    $('bcgClearSearch').addEventListener('click',()=>{$('bcgSearch').value='';render()});
    load();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
