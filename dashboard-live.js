(function(){
  'use strict';

  const $ = id => document.getElementById(id);
  const money = n => Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2}) + ' ₼';
  const num = v => { const n=Number(v); return Number.isFinite(n)?n:0; };
  const text = v => String(v ?? '').trim();
  const colors = {green:'#42d392',blue:'#5b8cff',orange:'#ffb454',red:'#ff6678',purple:'#9b7cff',muted:'#8994a3',grid:'#202a35'};
  let periodDays = 7;
  let loading = false;

  function isoDate(d){
    const x=new Date(d); const p=n=>String(n).padStart(2,'0');
    return `${x.getFullYear()}-${p(x.getMonth()+1)}-${p(x.getDate())}`;
  }
  function addDays(s,n){ const d=new Date(s+'T00:00:00'); d.setDate(d.getDate()+n); return isoDate(d); }
  function fmtDay(s){ const p=String(s).slice(0,10).split('-'); return p.length===3?`${p[2]}.${p[1]}`:String(s); }
  function period(){
    const to=isoDate(new Date());
    const from=addDays(to,-(periodDays-1));
    const prevTo=addDays(from,-1);
    const prevFrom=addDays(prevTo,-(periodDays-1));
    return {from,to,prevFrom,prevTo};
  }
  function setStatus(message){
    const p=document.querySelector('.pagehead p');
    if(p) p.textContent=message;
  }
  function conn(){
    try{return JSON.parse(localStorage.getItem('iikoConnection')||'null')}catch{return null}
  }
  function binding(){
    try{
      const x=window.SH_IikoUnified?.identity || window.SH_IikoContext?.getCached?.()?.identity || {};
      return Array.isArray(x.departmentIds)?[...new Set(x.departmentIds.map(String).filter(Boolean))]:[];
    }catch{return []}
  }
  async function post(body){
    const c=conn();
    if(!c?.ip||!c?.port||!c?.login||!c?.password) throw new Error('Сначала подключитесь к iiko Server через «Настройки».');
    const departments=binding();
    if(!departments.length) throw new Error('В D1 не найден Department ID. Подключите iiko Server заново через «Настройки».');
    const filters={
      'Department.Id':{filterType:'IncludeValues',values:departments},
      'OrderDeleted':{filterType:'IncludeValues',values:['NOT_DELETED']},
      'DeletedWithWriteoff':{filterType:'ExcludeValues',values:['DELETED_WITHOUT_WRITEOFF']}
    };
    if(body.from&&body.to) body.filters={...(body.filters||{}),...filters};
    else body.filters={...(body.filters||{}),...filters};
    const r=await fetch('/api/iiko/olap',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({...body,ip:c.ip,port:c.port,login:c.login,password:c.password})});
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.success===false) throw new Error(d.message||`OLAP HTTP ${r.status}`);
    return d?.report?.data || d?.data || [];
  }
  async function query(rows,measures,p){
    return post({action:'query',reportType:'SALES',buildSummary:false,groupByRowFields:rows,groupByColFields:[],aggregateFields:measures,from:p.from,to:p.to});
  }
  function field(row,names){
    for(const n of names) if(row&&row[n]!==undefined) return row[n];
    return '';
  }
  function setKpi(index,value,sub){
    const cards=document.querySelectorAll('.kpis .card'); const card=cards[index]; if(!card)return;
    const v=card.querySelector('.kvalue'), s=card.querySelector('.ksub'); if(v)v.textContent=value; if(s)s.innerHTML=sub||'';
  }
  function change(current,previous){
    if(!previous || !Number.isFinite(previous) || previous===0) return '<span class="ksub">Нет данных за прошлый период</span>';
    const x=(current-previous)/Math.abs(previous)*100;
    const arrow=x>=0?'▲':'▼';
    return `<span class="${x>=0?'up':''}" style="color:${x>=0?'var(--green)':'var(--red)'}">${arrow} ${Math.abs(x).toFixed(1)}%</span> vs прошлый период`;
  }
  function chart(id,opt){
    const el=$(id); if(!el||!window.echarts)return;
    const old=echarts.getInstanceByDom(el); if(old)old.dispose();
    const c=echarts.init(el); c.setOption(opt,true); setTimeout(()=>c.resize(),20);
  }
  function axis(data){return{type:'category',data,axisLabel:{color:colors.muted},axisLine:{lineStyle:{color:colors.grid}},axisTick:{show:false}}}
  function line(name,data,color){return{name,type:'line',smooth:true,data,symbol:'circle',symbolSize:6,lineStyle:{width:3,color},itemStyle:{color},areaStyle:{opacity:.07}}}

  function renderDaily(data){
    const map=new Map(); data.forEach(r=>{const day=text(field(r,['OpenDate.Typed','OpenDate','AccountingDay'])); if(!day)return; const x=map.get(day)||{revenue:0,checks:0}; x.revenue+=num(field(r,['DishSumInt','Revenue','AmountWithDiscount'])); x.checks+=num(field(r,['UniqOrderId','Bills','Orders'])); map.set(day,x);});
    const days=[]; for(let i=0;i<periodDays;i++) days.push(addDays(period().from,i));
    const labels=days.map(fmtDay), rev=days.map(d=>map.get(d)?.revenue||0), checks=days.map(d=>map.get(d)?.checks||0);
    const curRev=rev.reduce((a,b)=>a+b,0), curChecks=checks.reduce((a,b)=>a+b,0);
    window.__dashDaily={curRev,curChecks};
    chart('dashRevenue',{tooltip:{trigger:'axis'},legend:{data:['Выручка','Чеки'],textStyle:{color:colors.muted}},grid:{left:50,right:15,top:40,bottom:28},xAxis:axis(labels),yAxis:{type:'value',axisLabel:{color:colors.muted},splitLine:{lineStyle:{color:colors.grid}}},series:[line('Выручка',rev,colors.green),line('Чеки',checks,colors.blue)]});
    const head=document.querySelector('#dashRevenue')?.closest('.card')?.querySelector('.ctitle span'); if(head)head.textContent=periodDays===1?'Сегодня':`Последние ${periodDays} дней`;
  }
  function renderCategory(data){
    const map=new Map(); data.forEach(r=>{const name=text(field(r,['DishGroup','DishCategory','DishGroup.Name']))||'Без категории'; map.set(name,(map.get(name)||0)+num(field(r,['DishSumInt','Revenue','AmountWithDiscount'])))});
    const arr=[...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,value],i)=>({name,value,itemStyle:{color:[colors.green,colors.blue,colors.orange,colors.red,colors.purple,'#7ac7ff','#8be3c1','#c3a6ff'][i%8]}}));
    chart('dashCat',{tooltip:{trigger:'item',formatter:p=>`${p.name}<br>${money(p.value)} (${p.percent}%)`},legend:{bottom:0,textStyle:{color:colors.muted}},series:[{type:'pie',radius:['52%','75%'],label:{show:false},data:arr}]});
  }
  function renderHour(data){
    const map=new Map(); data.forEach(r=>{const h=text(field(r,['HourOpen','OpeningHour','OpenHour'])).padStart(2,'0'); if(/^\d{1,2}$/.test(h))map.set(h,(map.get(h)||0)+num(field(r,['DishSumInt','Revenue','AmountWithDiscount'])))});
    const hours=[...map.keys()].sort((a,b)=>Number(a)-Number(b));
    chart('dashHour',{tooltip:{trigger:'axis',formatter:p=>`${p[0]?.axisValue}:00<br>${money(p[0]?.value||0)}`},grid:{left:42,right:10,top:15,bottom:28},xAxis:axis(hours),yAxis:{type:'value',axisLabel:{color:colors.muted},splitLine:{lineStyle:{color:colors.grid}}},series:[{type:'bar',data:hours.map(h=>map.get(h)||0),barMaxWidth:18,itemStyle:{color:colors.green,borderRadius:[5,5,0,0]}}]});
  }
  function renderPay(data){
    const map=new Map(); data.forEach(r=>{const name=text(field(r,['PayTypes','PaymentType','PayType']))||'Другое'; map.set(name,(map.get(name)||0)+num(field(r,['DishSumInt','Revenue','AmountWithDiscount'])))});
    const arr=[...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,7).map(([name,value])=>({name,value}));
    const card=document.querySelector('#dashPay')?.closest('.card')?.querySelector('.ctitle span'); if(card)card.textContent=`${window.__dashDaily?.curChecks||0} чеков`;
    chart('dashPay',{tooltip:{trigger:'item',formatter:p=>`${p.name}<br>${money(p.value)} (${p.percent}%)`},legend:{bottom:0,textStyle:{color:colors.muted}},series:[{type:'pie',radius:['45%','72%'],label:{color:'#cdd5df'},data:arr}]});
  }
  function renderDishes(data){
    const map=new Map(); data.forEach(r=>{const name=text(field(r,['DishName','Dish']))||'Без названия'; const g=text(field(r,['DishGroup','DishCategory']))||'—'; const x=map.get(name)||{name,group:g,qty:0,revenue:0}; x.qty+=num(field(r,['DishAmountInt','DishAmount','Quantity','NumberOfDishes'])); x.revenue+=num(field(r,['DishSumInt','Revenue','AmountWithDiscount'])); map.set(name,x);});
    const list=[...map.values()].sort((a,b)=>b.revenue-a.revenue).slice(0,10); const total=list.reduce((s,x)=>s+x.revenue,0);
    const body=document.querySelector('.tablewrap tbody'); if(!body)return;
    body.innerHTML=list.length?list.map((x,i)=>`<tr><td><div class="prod"><span class="pimg">🍽</span>${x.name.replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]))}</div></td><td>${x.group}</td><td>${x.qty.toLocaleString('ru-RU')}</td><td>${money(x.revenue)}</td><td>${total?((x.revenue/total)*100).toFixed(1):'0.0'}%</td><td><span class="badge">№${i+1}</span></td></tr>`).join(''):'<tr><td colspan="6">Нет данных за выбранный период.</td></tr>';
  }
  function renderInsights(daily){
    const byHour=new Map(); daily.forEach(r=>{const h=text(field(r,['HourOpen','OpeningHour','OpenHour'])); if(h)byHour.set(h,(byHour.get(h)||0)+num(field(r,['DishSumInt','Revenue','AmountWithDiscount'])))});
    const top=[...byHour.entries()].sort((a,b)=>b[1]-a[1]).slice(0,2).map(x=>String(x[0]).padStart(2,'0'));
    const total=[...byHour.values()].reduce((a,b)=>a+b,0); const peak=[...byHour.values()].sort((a,b)=>b-a)[0]||0;
    const avg=window.__dashDaily?.curChecks?window.__dashDaily.curRev/window.__dashDaily.curChecks:0;
    const box=document.querySelector('.grid3 .card:last-child'); if(!box)return;
    const ins=box.querySelectorAll('.insight');
    if(ins[0]){ins[0].querySelector('p').textContent=top.length?`${top.join('–')} дают максимальную выручку.`:'Недостаточно данных для анализа.';ins[0].querySelector('i').style.width=(total?Math.round(peak/total*100):0)+'%';}
    if(ins[1]){ins[1].querySelector('p').textContent=`Средний чек: ${money(avg)}.`;ins[1].querySelector('i').style.width=(avg?Math.min(100,Math.round(avg/50*100)):0)+'%';}
    if(ins[2]){const cats=[...new Map(daily.map(r=>[text(field(r,['DishGroup','DishCategory'])),num(field(r,['DishSumInt','Revenue','AmountWithDiscount'])])).entries()].filter(x=>x[0]));const lead=cats.sort((a,b)=>b[1]-a[1])[0];ins[2].querySelector('p').textContent=lead?`Лидер по выручке — ${lead[0]}.`:'Недостаточно данных для анализа.';ins[2].querySelector('i').style.width=(window.__dashDaily?.curRev?Math.round(lead?.[1]/window.__dashDaily.curRev*100):0)+'%';}
  }
  async function load(){
    if(loading)return; loading=true;
    try{
      setStatus('Получаем реальные данные из iiko OLAP…');
      await window.SH_IikoContext?.get?.();
      const p=period();
      const all=await query(['OpenDate.Typed'],['DishSumInt','UniqOrderId'],{from:p.prevFrom,to:p.to});
      const current={from:p.from,to:p.to};
      const [cat,hour,pay,dishes]=await Promise.all([
        query(['DishGroup'],['DishSumInt'],current),
        query(['HourOpen'],['DishSumInt'],current),
        query(['PayTypes'],['DishSumInt'],current),
        query(['DishName','DishGroup'],['DishAmountInt','DishSumInt'],current)
      ]);
      const curRows=all.filter(r=>String(field(r,['OpenDate.Typed','OpenDate'])).slice(0,10)>=p.from&&String(field(r,['OpenDate.Typed','OpenDate'])).slice(0,10)<=p.to);
      const prevRows=all.filter(r=>String(field(r,['OpenDate.Typed','OpenDate'])).slice(0,10)>=p.prevFrom&&String(field(r,['OpenDate.Typed','OpenDate'])).slice(0,10)<=p.prevTo);
      const sum=r=>r.reduce((a,x)=>a+num(field(x,['DishSumInt','Revenue','AmountWithDiscount'])),0);
      const checks=r=>r.reduce((a,x)=>a+num(field(x,['UniqOrderId','Bills','Orders'])),0);
      const rev=sum(curRows), prevRev=sum(prevRows), bills=checks(curRows), prevBills=checks(prevRows);
      setKpi(0,money(rev),change(rev,prevRev));
      setKpi(1,bills.toLocaleString('ru-RU'),change(bills,prevBills));
      const avg=bills?rev/bills:0, prevAvg=prevBills?prevRev/prevBills:0; setKpi(2,money(avg),change(avg,prevAvg));
      const gross=document.querySelectorAll('.kpis .card')[3]; if(gross){gross.querySelector('.kvalue').textContent='—';gross.querySelector('.ksub').textContent='Расчёт по финансовым данным';}
      renderDaily(curRows); renderCategory(cat); renderHour(hour); renderPay(pay); renderDishes(dishes); renderInsights(hour);
      setStatus(`Реальные данные iiko · ${fmtDay(p.from)} — ${fmtDay(p.to)}`);
    }catch(e){
      console.error('[dashboard-live]',e); setStatus(`iiko: ${e.message||'не удалось загрузить данные'}`);
    }finally{loading=false;}
  }
  function bindPeriods(){
    const buttons=document.querySelectorAll('.period button'); if(!buttons.length)return;
    buttons.forEach((b,i)=>b.addEventListener('click',()=>{periodDays=i===0?1:i===1?7:30;buttons.forEach(x=>x.classList.remove('active'));b.classList.add('active');load();}));
  }
  function boot(){
    bindPeriods();
    setTimeout(load,120);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
