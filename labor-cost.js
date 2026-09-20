(()=>{'use strict';
const $=id=>document.getElementById(id);
let state={payroll:null,timesheet:null,sales:null,binding:null,token:'',month:'',daily:[],employees:[],roles:[]};

const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const money=v=>(Number(v)||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₼';
const hoursFromMinutes=v=>((Number(v)||0)/60).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})+' ч';
const pct=v=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':Number(v).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+'%';
const perHour=v=>v===null||v===undefined||!Number.isFinite(Number(v))?'—':money(v)+'/ч';
const pad=n=>String(n).padStart(2,'0');

function monthNow(){
  const d=new Date(),y=d.getFullYear(),m=pad(d.getMonth()+1);
  return y===2026?y+'-'+m:'2026-09';
}
function monthBounds(month){
  const [y,m]=String(month).split('-').map(Number),last=new Date(y,m,0).getDate();
  return{from:month+'-01',to:month+'-'+pad(last)};
}
function fmtDate(v){
  if(!v)return'—';
  const s=String(v).slice(0,10),m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m?m[3]+'.'+m[2]+'.'+m[1]:String(v);
}
function setStatus(text){$('lc-status').textContent=text}
async function token(){
  const c=await window.SHAuth?.createClient?.();
  if(!c)throw new Error('Supabase Auth не готов');
  const{data,error}=await c.auth.getSession();
  const t=data?.session?.access_token;
  if(error||!t)throw new Error('Сессия пользователя не найдена');
  return t;
}
async function getJson(url,t){
  const r=await fetch(url,{headers:{Authorization:'Bearer '+t,Accept:'application/json'},cache:'no-store'});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.success===false)throw new Error(j.message||('HTTP '+r.status));
  return j;
}
async function postJson(url,body){
  const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify(body),cache:'no-store'});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.success===false)throw new Error(j.message||('HTTP '+r.status));
  return j;
}
function reportRows(report){
  if(Array.isArray(report))return report;
  if(Array.isArray(report?.data))return report.data;
  if(Array.isArray(report?.rows))return report.rows;
  if(Array.isArray(report?.result))return report.result;
  return[];
}
function field(row,names){
  for(const n of names)if(row&&row[n]!==undefined)return row[n];
  if(!row||typeof row!=='object')return undefined;
  const wanted=names.map(x=>String(x).toLowerCase().replace(/[\s._()-]+/g,''));
  for(const [k,v] of Object.entries(row)){
    const nk=String(k).toLowerCase().replace(/[\s._()-]+/g,'');
    if(wanted.includes(nk))return v;
  }
}
function parseSales(report){
  return reportRows(report).map(r=>({
    date:String(field(r,['OpenDate.Typed','OpenDate','Date'])||'').slice(0,10),
    revenue:Number(field(r,['DishSumInt','DishDiscountSumInt','Sales','Revenue'])||0),
    orders:Number(field(r,['UniqOrderId','Orders','OrderCount'])||0)
  })).filter(x=>x.date);
}
function selectedRole(){return $('lc-role').value||''}
function selectedPayrollRows(){
  const role=selectedRole(),rows=state.payroll?.rows||[];
  return role?rows.filter(x=>String(x.roleCode||x.roleName||'')===role):rows;
}
function payrollCost(row){return Number(row?.calculation?.totalEmployerCost||0)}
function employeeRateMap(rows){
  const map=new Map();
  for(const r of rows){
    const mins=Number(r.actualMinutes||0),cost=payrollCost(r);
    map.set(String(r.employeeId),{minutes:mins,cost,rate:mins>0?cost/mins:0,row:r});
  }
  return map;
}
function buildDaily(rows){
  const rateMap=employeeRateMap(rows),salesMap=new Map(parseSales(state.sales?.report).map(x=>[x.date,x]));
  const byDay=new Map();
  const ensure=date=>{
    if(!byDay.has(date))byDay.set(date,{date,revenue:0,orders:0,workedMinutes:0,employees:new Set(),laborCost:0});
    return byDay.get(date);
  };
  for(const x of salesMap.values()){const d=ensure(x.date);d.revenue+=x.revenue;d.orders+=x.orders}
  for(const d of state.timesheet?.days||[]){
    const info=rateMap.get(String(d.employeeId));
    if(!info)continue;
    const row=ensure(d.workDate),mins=Number(d.workedMinutes||0);
    row.workedMinutes+=mins;
    if(mins>0)row.employees.add(String(d.employeeId));
    row.laborCost+=mins*info.rate;
  }
  return[...byDay.values()].sort((a,b)=>a.date.localeCompare(b.date)).map(x=>({
    ...x,employeeCount:x.employees.size,
    laborCostPct:x.revenue>0?x.laborCost/x.revenue*100:null,
    splh:x.workedMinutes>0?x.revenue/(x.workedMinutes/60):null
  }));
}
function employeeRows(rows,totalCost){
  return rows.map(r=>{
    const cost=payrollCost(r),mins=Number(r.actualMinutes||0),planned=Number(r.plannedMinutes||0);
    return{...r,cost,costPerHour:mins>0?cost/(mins/60):null,share:totalCost>0?cost/totalCost*100:null};
  });
}
function renderRoles(){
  const el=$('lc-role'),old=el.value;
  const roles=[...new Map((state.payroll?.rows||[]).filter(x=>x.roleCode||x.roleName).map(x=>[String(x.roleCode||x.roleName),String(x.roleName||x.roleCode)])).entries()]
    .map(([value,label])=>({value,label})).sort((a,b)=>a.label.localeCompare(b.label,'ru'));
  el.innerHTML='<option value="">Все должности</option>'+roles.map(x=>'<option value="'+esc(x.value)+'">'+esc(x.label)+'</option>').join('');
  if(roles.some(x=>x.value===old))el.value=old;
}
function renderSummary(){
  const rows=selectedPayrollRows();
  const totalCost=rows.reduce((s,x)=>s+payrollCost(x),0),totalMinutes=rows.reduce((s,x)=>s+Number(x.actualMinutes||0),0);
  const revenue=parseSales(state.sales?.report).reduce((s,x)=>s+x.revenue,0);
  const laborPct=revenue>0?totalCost/revenue*100:null,splh=totalMinutes>0?revenue/(totalMinutes/60):null,hourCost=totalMinutes>0?totalCost/(totalMinutes/60):null;
  $('kpi-sales').textContent=money(revenue);
  $('kpi-labor').textContent=money(totalCost);
  $('kpi-percent').textContent=pct(laborPct);
  $('kpi-hours').textContent=hoursFromMinutes(totalMinutes);
  $('kpi-splh').textContent=splh===null?'—':money(splh);
  $('kpi-hour-cost').textContent=perHour(hourCost);

  state.daily=buildDaily(rows);
  state.employees=employeeRows(rows,totalCost);
  renderWarnings(totalCost,totalMinutes);
  renderDays();
  renderEmployees();
}
function renderWarnings(totalCost,totalMinutes){
  const items=[];
  const p=state.payroll?.summary||{},t=state.timesheet?.summary||{};
  if(Number(p.withoutTerms||0)>0)items.push('<b>'+Number(p.withoutTerms)+' сотрудников</b> без условий оплаты — ФОТ может быть занижен.');
  if(Number(t.issues||0)>0)items.push('<b>'+Number(t.issues)+' ошибок табеля</b> требуют проверки.');
  const rows=selectedPayrollRows(),unallocated=rows.filter(x=>Number(x.actualMinutes||0)<=0&&payrollCost(x)>0).reduce((s,x)=>s+payrollCost(x),0);
  if(unallocated>0.01)items.push('<b>'+money(unallocated)+'</b> ФОТ не распределён по дням из-за отсутствия фактических часов.');
  if(selectedRole())items.push('ФОТ и человеко-часы отфильтрованы по должности, а выручка остаётся общей выручкой ресторана.');
  if(totalMinutes<=0&&totalCost>0)items.push('Есть ФОТ, но нет фактических человеко-часов — SPLH пока не рассчитывается.');
  const e=$('lc-warning');e.hidden=!items.length;e.innerHTML=items.join(' ');
}
function renderDays(){
  const tb=$('lc-day-table').querySelector('tbody');
  tb.innerHTML=state.daily.length?state.daily.map(x=>'<tr>'+
    '<td>'+esc(fmtDate(x.date))+'</td>'+
    '<td class="num">'+money(x.revenue)+'</td>'+
    '<td class="num">'+Number(x.orders||0).toLocaleString('ru-RU')+'</td>'+
    '<td class="num">'+hoursFromMinutes(x.workedMinutes)+'</td>'+
    '<td class="num">'+x.employeeCount+'</td>'+
    '<td class="num">'+money(x.laborCost)+'</td>'+
    '<td class="num">'+pct(x.laborCostPct)+'</td>'+
    '<td class="num">'+(x.splh===null?'—':money(x.splh))+'</td></tr>').join(''):
    '<tr><td colspan="8" style="text-align:center;padding:30px;color:#8192a4">За месяц данных нет.</td></tr>';
  $('lc-day-meta').textContent=state.daily.length+' дней';
}
function statusBadge(r){
  const s=String(r.status||'');
  if(s==='READY')return'<span class="status-badge ready">Готово</span>';
  if(s==='NO_TERMS')return'<span class="status-badge missing">Нет условий</span>';
  return'<span class="status-badge review">Проверить</span>';
}
function renderEmployees(){
  const q=($('lc-search').value||'').trim().toLowerCase();
  const rows=state.employees.filter(r=>!q||[r.employeeName,r.employeeCode,r.roleName,r.roleCode].join(' ').toLowerCase().includes(q));
  const tb=$('lc-employee-table').querySelector('tbody');
  tb.innerHTML=rows.length?rows.map(r=>{
    const delta=Number(r.varianceMinutes||0),cls=delta>0?'delta-pos':delta<0?'delta-neg':'';
    return'<tr><td class="employee-name"><strong>'+esc(r.employeeName||'—')+'</strong><small>'+esc(r.employeeCode?'№ '+r.employeeCode:'')+'</small></td>'+
      '<td>'+esc(r.roleName||r.roleCode||'—')+'</td>'+
      '<td class="num">'+hoursFromMinutes(r.actualMinutes)+'</td>'+
      '<td class="num">'+hoursFromMinutes(r.plannedMinutes)+'</td>'+
      '<td class="num '+cls+'">'+(delta>0?'+':'')+hoursFromMinutes(delta)+'</td>'+
      '<td class="num">'+money(r.cost)+'</td>'+
      '<td class="num">'+perHour(r.costPerHour)+'</td>'+
      '<td class="num">'+pct(r.share)+'</td>'+
      '<td>'+statusBadge(r)+'</td></tr>';
  }).join(''):'<tr><td colspan="9" style="text-align:center;padding:30px;color:#8192a4">Сотрудники не найдены.</td></tr>';
  $('lc-employee-meta').textContent=rows.length+' сотрудников';
}
function exportCsv(){
  if(!state.payroll)return;
  const q=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const lines=[];
  lines.push(['Labor Cost & SPLH',state.month].map(q).join(';'));
  lines.push('');
  lines.push(['Сотрудник','Код','Должность','Факт минут','План минут','ФОТ работодателя','Стоимость часа','Доля ФОТ %','Статус'].map(q).join(';'));
  for(const r of state.employees)lines.push([r.employeeName,r.employeeCode,r.roleName||r.roleCode,r.actualMinutes,r.plannedMinutes,r.cost,r.costPerHour??'',r.share??'',r.status].map(q).join(';'));
  lines.push('');
  lines.push(['Дата','Выручка','Заказы','Человеко-часы','Сотрудников','ФОТ оценка','Labor Cost %','SPLH'].map(q).join(';'));
  for(const d of state.daily)lines.push([d.date,d.revenue,d.orders,d.workedMinutes/60,d.employeeCount,d.laborCost,d.laborCostPct??'',d.splh??''].map(q).join(';'));
  const blob=new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='labor-cost-'+state.month+'.csv';document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},0);
}
async function load(){
  const btn=$('lc-refresh');btn.disabled=true;setStatus('Загрузка…');
  try{
    const month=$('lc-month').value||monthNow(),bounds=monthBounds(month),t=await token(),binding=await window.SH_IikoContext?.getBinding?.();
    const c=binding?.connection;
    if(!c?.ip||!c?.port||!c?.login||!c?.password)throw new Error('Нет подключения iiko Server.');
    const [payroll,timesheet,sales]=await Promise.all([
      getJson('/api/hr/payroll?month='+encodeURIComponent(month),t),
      getJson('/api/hr/timesheet?from='+encodeURIComponent(bounds.from)+'&to='+encodeURIComponent(bounds.to),t),
      postJson('/api/iiko/sales',{...c,from:bounds.from,to:bounds.to,departmentIds:Array.isArray(binding?.departmentIds)?binding.departmentIds:[]})
    ]);
    state={...state,payroll,timesheet,sales,binding,token:t,month};
    renderRoles();
    $('lc-period').textContent='Период: '+bounds.from+' — '+bounds.to;
    renderSummary();
    setStatus('Готово · '+(payroll.summary?.employees||0)+' сотрудников');
  }catch(e){
    state={...state,payroll:null,timesheet:null,sales:null,daily:[],employees:[]};
    setStatus('Ошибка');
    const w=$('lc-warning');w.hidden=false;w.innerHTML='<b>Ошибка:</b> '+esc(e.message||String(e));
    renderDays();renderEmployees();
  }finally{btn.disabled=false}
}
function bind(){
  $('lc-month').value=monthNow();
  $('lc-refresh').onclick=load;$('lc-export').onclick=exportCsv;
  $('lc-month').onchange=load;
  $('lc-role').onchange=renderSummary;
  $('lc-search').oninput=renderEmployees;
  load();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();