(function(){
  'use strict';

  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=v=>{if(typeof v==='number'&&Number.isFinite(v))return v;let s=String(v??'').trim();if(!s)return 0;s=s.replace(/\s/g,'').replace(',', '.');const n=Number(s);return Number.isFinite(n)?n:0;};
  const today=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const dateShift=days=>{const d=new Date();d.setDate(d.getDate()-days);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;};
  const fmt=(v,d=2)=>new Intl.NumberFormat('ru-RU',{minimumFractionDigits:d,maximumFractionDigits:d}).format(Number(v)||0);
  const pct=v=>`${fmt(v,2)}%`;

  const REQUEST_TIMEOUT=45000;
  let connection=null;
  let allRows=[];
  let resultRows=[];
  let currentTab='abc';

  function setStatus(text,type=''){const e=$('status');if(!e)return;e.textContent=text;e.className=`status-pill ${type}`;}

  function getConnection(){
    try{const raw=localStorage.getItem('iikoConnection');if(raw){const x=JSON.parse(raw);if(x?.ip&&x?.port&&x?.login&&x?.password)return x;}}catch(_){ }
    return null;
  }

  function pick(row,names){
    if(!row||typeof row!=='object')return '';
    const entries=Object.entries(row);
    for(const name of names){
      if(row[name]!==undefined&&row[name]!==null)return row[name];
      const hit=entries.find(([k])=>k.toLowerCase()===String(name).toLowerCase());
      if(hit)return hit[1];
    }
    return '';
  }

  function mapArrayRows(data,columns){
    if(!Array.isArray(data))return [];
    if(!data.length||!Array.isArray(data[0]))return data;
    const cols=Array.isArray(columns)?columns.map(c=>typeof c==='string'?c:(c?.name||c?.field||c?.key||'')):[];
    return data.map(arr=>Object.fromEntries(arr.map((v,i)=>[cols[i]||`col${i}`,v])));
  }

  function extractRows(payload){
    const seen=new Set(),out=[];
    const add=(candidate,columns)=>{
      if(!Array.isArray(candidate)||!candidate.length)return;
      const mapped=mapArrayRows(candidate,columns);
      if(!mapped.length||typeof mapped[0]!=='object'||Array.isArray(mapped[0]))return;
      for(const row of mapped){const key=JSON.stringify(row);if(!seen.has(key)){seen.add(key);out.push(row);}}
    };
    const walk=(value,depth=0)=>{
      if(!value||depth>6)return;
      if(Array.isArray(value)){add(value);return;}
      if(typeof value!=='object')return;
      const columns=value.columns||value.columnNames||value.headers||[];
      for(const key of ['data','rows','items','result']){
        const child=value[key];
        if(Array.isArray(child))add(child,columns);
        else if(child&&typeof child==='object')walk(child,depth+1);
      }
      for(const child of Object.values(value))if(child&&typeof child==='object'&&!Array.isArray(child))walk(child,depth+1);
    };
    walk(payload);
    return out;
  }

  function dateOf(row){
    const v=pick(row,['OpenDate.Typed','OpenDate','OpenDate_Typed','Date','date']);
    if(!v)return '';
    const m=String(v).match(/\d{4}-\d{2}-\d{2}/);return m?m[0]:'';
  }

  function weekKey(date){
    const d=new Date(`${date}T00:00:00`);const day=(d.getDay()+6)%7;d.setDate(d.getDate()-day);return d.toISOString().slice(0,10);
  }
  function bucket(date,interval){if(!date)return '';if(interval==='month')return date.slice(0,7);if(interval==='week')return weekKey(date);return date;}

  function dishInfo(row){
    const name=String(pick(row,['DishName','Product.Name','name'])||'Без названия').trim();
    const code=String(pick(row,['DishCode','Product.Num','DishId','Product.Id'])||'').trim();
    const group=String(pick(row,['DishGroup','DishGroup.Name','Product.TopParent','Product.Hierarchy'])||'').trim()||'Без группы';
    const category=String(pick(row,['DishCategory','DishCategory.Name','Product.Category','DishCategory.Accounting'])||'').trim()||'(без категории)';
    const unit=String(pick(row,['DishMeasureUnit','Product.MeasureUnit','MeasureUnit'])||'').trim();
    const store=String(pick(row,['Store.Name','Store','StoreName'])||'').trim()||'Без склада';
    return {name,code,group,category,unit,store,key:`${code}¦${name}`};
  }

  function buildFilters(){
    const filters=[
      {field:'DishType',operator:'IncludeValues',values:['DISH']},
      {field:'DeletedWithWriteoff',operator:'ExcludeValues',values:['DELETED_WITHOUT_WRITEOFF']}
    ];
    const pairs=[['Store.Name','store'],['DishGroup','group'],['DishCategory','category']];
    for(const [field,id] of pairs){const v=$(id)?.value;if(v)filters.push({field,operator:'IncludeValues',values:[v]});}
    return filters;
  }

  function aggregateFields(){
    const fields=new Set(['DishSumInt','DishAmountInt']);
    if(document.querySelector('.indicator-box input[value="profit"]:checked'))fields.add('ProductCostBase.Profit');
    return [...fields];
  }

  async function postOlap(body){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),REQUEST_TIMEOUT);
    try{
      return await fetch('/api/iiko/olap',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body),signal:controller.signal});
    }catch(error){
      if(error?.name==='AbortError')throw new Error(`iiko не ответил за ${REQUEST_TIMEOUT/1000} секунд. Запрос OLAP слишком тяжёлый для выбранного периода.`);
      throw error;
    }finally{clearTimeout(timer);}
  }

  async function query(){
    connection=getConnection();
    if(!connection)throw new Error('Не найдено подключение к iiko Server. Сначала подключитесь через OLAP Отчёты.');
    const from=$('from').value,to=$('to').value;
    if(!from||!to)throw new Error('Укажите период анализа.');
    if(from>to)throw new Error('Дата начала не может быть позже даты окончания.');

    const body={
      action:'query',reportType:'SALES',ip:connection.ip,port:connection.port,login:connection.login,password:connection.password,
      from,to,buildSummary:false,
      // Минимальная группировка: дата + блюдо. Это резко уменьшает объём OLAP-ответа.
      groupByRowFields:['OpenDate.Typed','DishCode','DishName'],
      groupByColumnFields:[],
      aggregateFields:aggregateFields(),
      filters:buildFilters()
    };

    setStatus('Запрос данных iiko…','loading');
    const response=await postOlap(body);
    const text=await response.text();
    let data={};
    try{data=text?JSON.parse(text):{};}catch(_){throw new Error(text||`HTTP ${response.status}`);}
    if(!response.ok||data.success===false)throw new Error(data.message||`OLAP HTTP ${response.status}`);
    const rows=extractRows(data.report||data);
    if(!rows.length)throw new Error('iiko не вернул строки продаж за выбранный период. Проверьте даты и права пользователя.');
    return rows;
  }

  function aggregate(rows){
    const map=new Map();
    for(const row of rows){
      const info=dishInfo(row),key=info.key;
      if(!map.has(key))map.set(key,{...info,revenue:0,quantity:0,profit:0,periods:new Map()});
      const x=map.get(key);
      const revenue=num(pick(row,['DishSumInt','Sales']));
      const quantity=num(pick(row,['DishAmountInt','DishAmountInt.PerOrder']));
      const profit=num(pick(row,['ProductCostBase.Profit','Profit']));
      x.revenue+=revenue;x.quantity+=quantity;x.profit+=profit;
      const date=dateOf(row),b=bucket(date,$('interval').value);
      if(b){
        if(!x.periods.has(b))x.periods.set(b,{revenue:0,quantity:0,profit:0});
        const p=x.periods.get(b);p.revenue+=revenue;p.quantity+=quantity;p.profit+=profit;
      }
    }
    return [...map.values()];
  }

  function applyClientFilters(items){
    const store=$('store')?.value||'',group=$('group')?.value||'',category=$('category')?.value||'';
    return items.filter(x=>(!store||x.store===store)&&(!group||x.group===group)&&(!category||x.category===category));
  }

  function abcClass(cumulative,total,a,b){
    if(!Number.isFinite(cumulative)||cumulative<=0||total<=0)return 'C';
    const share=cumulative/total*100;
    if(share<=a)return 'A';
    if(share<=b)return 'B';
    return 'C';
  }

  function assignABC(items,metric){
    const a=num($('abcA').value),b=num($('abcB').value);
    const total=items.reduce((s,x)=>s+Math.max(0,num(x[metric])),0);
    let cumulative=0;
    const sorted=[...items].sort((x,y)=>num(y[metric])-num(x[metric]));
    for(const item of sorted){
      const value=Math.max(0,num(item[metric]));cumulative+=value;
      item[`abc_${metric}`]=abcClass(cumulative,total,a,b);item[`share_${metric}`]=total?value/total*100:0;
    }
    return total;
  }

  function cv(periods,metric){
    const values=[...periods.values()].map(p=>num(p[metric]));
    if(values.length<=1)return 0;
    const mean=values.reduce((s,x)=>s+x,0)/values.length;if(mean===0)return 0;
    const variance=values.reduce((s,x)=>s+Math.pow(x-mean,2),0)/(values.length-1);
    return Math.sqrt(variance)/Math.abs(mean)*100;
  }

  function xyzClass(value){const x=num($('xyzX').value),y=num($('xyzY').value);if(value<=x)return 'X';if(value<=y)return 'Y';return 'Z';}

  function calculate(rows){
    const items=applyClientFilters(aggregate(rows));if(!items.length)return [];
    for(const metric of ['revenue','quantity','profit'])assignABC(items,metric);
    const xyzMetric=$('xyzMetric').value;
    for(const item of items){item.cv=cv(item.periods,xyzMetric);item.xyz=xyzClass(item.cv);item.matrix=`${item.abc_revenue||'C'}${item.xyz}`;}
    return items.sort((a,b)=>b.revenue-a.revenue);
  }

  function optionValues(items,field){return [...new Set(items.map(x=>x[field]).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'ru'));}
  function fillSelect(id,values){const el=$(id),old=el.value;el.innerHTML='<option value="">Все</option>'+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if(values.includes(old))el.value=old;}
  function updateFilterOptions(raw){
    // Запрос теперь специально минимальный, поэтому iiko может не вернуть эти атрибуты.
    // Не затираем уже выбранные фильтры и не создаём ложные значения.
    const infos=raw.map(dishInfo);
    const stores=optionValues(infos,'store').filter(v=>v!=='Без склада');
    const groups=optionValues(infos,'group').filter(v=>v!=='Без группы');
    const categories=optionValues(infos,'category').filter(v=>v!=='(без категории)');
    if(stores.length)fillSelect('store',stores);
    if(groups.length)fillSelect('group',groups);
    if(categories.length)fillSelect('category',categories);
  }

  function selectedABC(){return [...document.querySelectorAll('.indicator-box input:checked')].map(x=>x.value);}
  function visibleRows(){
    const q=($('search').value||'').trim().toLowerCase();
    if(!q)return resultRows;
    return resultRows.filter(x=>[x.name,x.code,x.group,x.category,x.store,x.xyz,x.matrix].join(' ').toLowerCase().includes(q));
  }

  function renderDistribution(){
    const el=$('distribution');if(!el)return;
    if(currentTab==='xyz'){
      const counts={X:0,Y:0,Z:0};resultRows.forEach(x=>counts[x.xyz]=(counts[x.xyz]||0)+1);const total=resultRows.length||1;
      el.innerHTML=['X','Y','Z'].map(k=>`<div class="dist-row"><span class="dist-label">${k}</span><div class="dist-track"><div class="dist-fill ${k.toLowerCase()}" style="width:${counts[k]/total*100}%"></div></div><span class="dist-value">${pct(counts[k]/total*100)}</span></div>`).join('');return;
    }
    const metric=currentTab==='matrix'?'revenue':(selectedABC()[0]||'revenue');const counts={A:0,B:0,C:0};resultRows.forEach(x=>counts[x[`abc_${metric}`]]++);const total=resultRows.length||1;
    el.innerHTML=['A','B','C'].map(k=>`<div class="dist-row"><span class="dist-label">${k}</span><div class="dist-track"><div class="dist-fill ${k.toLowerCase()}" style="width:${counts[k]/total*100}%"></div></div><span class="dist-value">${pct(counts[k]/total*100)}</span></div>`).join('');
  }

  function renderTable(){
    const head=$('#resultTable thead'),body=$('#resultTable tbody'),foot=$('#resultTable tfoot'),rows=visibleRows();
    let cols=`<th>Группа</th><th>Категория</th><th>Артикул</th><th class="text-left">Наименование</th><th>Ед. изм.</th>`;
    const metrics=selectedABC();
    if(currentTab==='abc'||currentTab==='matrix')for(const m of metrics){const title=m==='revenue'?'Выручка':m==='quantity'?'Количество продаж':'Прибыль';cols+=`<th>${title}</th><th>ABC</th>`;}
    if(currentTab==='xyz'||currentTab==='matrix')cols+=`<th>Коэффициент вариации</th><th>XYZ</th>`;
    if(currentTab==='matrix')cols+='<th>Матрица</th>';
    head.innerHTML=`<tr>${cols}</tr>`;
    body.innerHTML=rows.map(x=>{
      let html=`<td class="group-cell">${esc(x.group)}</td><td class="category-cell">${esc(x.category)}</td><td>${esc(x.code)}</td><td class="text-left"><b>${esc(x.name)}</b></td><td>${esc(x.unit)}</td>`;
      if(currentTab==='abc'||currentTab==='matrix')for(const m of metrics)html+=`<td class="num">${fmt(x[m],m==='quantity'?3:2)}</td><td><span class="abc-badge ${(x[`abc_${m}`]||'C').toLowerCase()}">${x[`abc_${m}`]||'C'}</span></td>`;
      if(currentTab==='xyz'||currentTab==='matrix')html+=`<td class="num cv-cell">${pct(x.cv)}</td><td><span class="xyz-badge ${String(x.xyz).toLowerCase()}">${x.xyz}</span></td>`;
      if(currentTab==='matrix')html+=`<td><span class="matrix-badge ${String(x.matrix).toLowerCase()}">${esc(x.matrix)}</span></td>`;
      return `<tr>${html}</tr>`;
    }).join('');
    if(!rows.length)body.innerHTML='<tr><td colspan="20" style="text-align:center;padding:35px;color:#7d8b9c">Нет данных</td></tr>';
    const totals={revenue:rows.reduce((s,x)=>s+x.revenue,0),quantity:rows.reduce((s,x)=>s+x.quantity,0),profit:rows.reduce((s,x)=>s+x.profit,0)};
    let footHtml='<tr><th colspan="5" class="text-left">ИТОГО</th>';
    if(currentTab==='abc'||currentTab==='matrix')for(const m of metrics)footHtml+=`<th class="num">${fmt(totals[m],m==='quantity'?3:2)}</th><th>—</th>`;
    if(currentTab==='xyz'||currentTab==='matrix')footHtml+='<th></th><th>—</th>';
    if(currentTab==='matrix')footHtml+='<th>—</th>';
    foot.innerHTML=`${footHtml}</tr>`;
    $('rowCount').textContent=`${rows.length} ${rows.length===1?'позиция':'позиций'}`;
  }

  function render(){renderDistribution();renderTable();}

  async function run(){
    const button=$('run');button.disabled=true;$('error').hidden=true;setStatus('Подготовка запроса…','loading');
    try{
      const raw=await query();
      allRows=raw;
      updateFilterOptions(raw);
      resultRows=calculate(raw);
      render();
      setStatus(`Готово · ${resultRows.length} позиций`,'ok');
    }catch(error){
      resultRows=[];render();$('error').hidden=false;$('error').textContent=error?.message||String(error);setStatus('Ошибка','error');
    }finally{button.disabled=false;}
  }

  function exportCsv(){
    const rows=visibleRows();if(!rows.length)return;
    const metrics=selectedABC();const headers=['Группа','Категория','Артикул','Наименование','Ед. изм.'];
    if(currentTab==='abc'||currentTab==='matrix')for(const m of metrics)headers.push(m==='revenue'?'Выручка':m==='quantity'?'Количество продаж':'Прибыль','ABC');
    if(currentTab==='xyz'||currentTab==='matrix')headers.push('Коэффициент вариации','XYZ');
    if(currentTab==='matrix')headers.push('Матрица');
    const lines=[headers,...rows.map(x=>{const a=[x.group,x.category,x.code,x.name,x.unit];if(currentTab==='abc'||currentTab==='matrix')for(const m of metrics)a.push(x[m],x[`abc_${m}`]);if(currentTab==='xyz'||currentTab==='matrix')a.push(x.cv,x.xyz);if(currentTab==='matrix')a.push(x.matrix);return a;})];
    const csv='\uFEFF'+lines.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`abc-xyz-${$('from').value}-${$('to').value}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function init(){
    $('from').value=dateShift(31);$('to').value=today();
    document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));t.classList.add('active');currentTab=t.dataset.tab;render();});
    $('run').onclick=run;$('export').onclick=exportCsv;$('search').oninput=render;$('clearSearch').onclick=()=>{$('search').value='';render();};
    document.querySelectorAll('.indicator-box input,#xyzMetric,#abcA,#abcB,#xyzX,#xyzY').forEach(e=>e.addEventListener('change',()=>{if(allRows.length){resultRows=calculate(allRows);render();}}));
    ['store','group','category','interval'].forEach(id=>$(id).addEventListener('change',()=>{if(id==='interval')run();else if(allRows.length){resultRows=calculate(allRows);render();}}));
    if(!getConnection())setStatus('Нет подключения','error');else run();
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
