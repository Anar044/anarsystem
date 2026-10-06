(()=>{'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>`${(Number(v)||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} ₼`;
const hours=v=>{if(v===null||v===undefined)return'—';const m=Math.max(0,Number(v)||0),h=Math.floor(m/60),r=Math.round(m%60);return r?`${h} ч ${String(r).padStart(2,'0')} мин`:`${h} ч`};
const r=v=>Math.round((Number(v)||0)*100)/100,pct=v=>(Number(v)||0)/100;
let mode='OVERALL',state={payroll:null,adjustments:null,tax:null,models:[]},busy=false;

function monthNow(){const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0');return y===2026?`${y}-${m}`:'2026-10'}
async function token(){const c=await window.SHAuth?.createClient?.();if(!c)throw new Error('Supabase Auth не готов');const{data,error}=await c.auth.getSession();const t=data?.session?.access_token;if(error||!t)throw new Error('Сессия пользователя не найдена');return t}
async function fetchJson(url,t){const res=await (window.SH_IikoContext?.fetchWithTimeout||fetch)(url,{headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}},90000),j=await res.json().catch(()=>({success:false,message:'Некорректный ответ API'}));if(!res.ok||!j.success)throw new Error(j.message||`HTTP ${res.status}`);return j}
async function api(){const t=await token(),month=$('hrpMonth').value||monthNow();const[p,a,tax]=await Promise.all([fetchJson(`/api/hr/payroll?month=${encodeURIComponent(month)}`,t),fetchJson(`/api/hr/payroll-adjustments?month=${encodeURIComponent(month)}`,t),fetchJson(`/api/hr/payroll-tax-settings?month=${encodeURIComponent(month)}`,t)]);return{payroll:p,adjustments:a,tax}}
function setStatus(text,kind=''){const e=$('hrpStatus');e.textContent=text;e.className=`hr-status ${kind}`.trim()}
function showError(text=''){const e=$('hrpError');e.hidden=!text;e.textContent=text}

function tier(g,t1,t2,a,b,c){if(g<=t1)return g*pct(a);if(g<=t2)return t1*pct(a)+(g-t1)*pct(b);return t1*pct(a)+(t2-t1)*pct(b)+(g-t2)*pct(c)}
function calcGross(gross,s){
  const g=Math.max(0,Number(gross)||0),taxable=g<=s.incomeTaxThreshold1?Math.max(0,g-s.personalAllowance):g;
  let income=0;
  if(taxable<=s.incomeTaxThreshold1)income=taxable*pct(s.incomeTaxLowPercent);
  else if(taxable<=s.incomeTaxThreshold2)income=s.incomeTaxThreshold1*pct(s.incomeTaxLowPercent)+(taxable-s.incomeTaxThreshold1)*pct(s.incomeTaxMidPercent);
  else income=s.incomeTaxThreshold1*pct(s.incomeTaxLowPercent)+(s.incomeTaxThreshold2-s.incomeTaxThreshold1)*pct(s.incomeTaxMidPercent)+(taxable-s.incomeTaxThreshold2)*pct(s.incomeTaxHighPercent);
  const employee={
    incomeTax:r(income),
    socialInsurance:r(tier(g,s.socialThreshold1,s.socialThreshold2,s.employeeSocialLowPercent,s.employeeSocialMidPercent,s.employeeSocialHighPercent)),
    unemploymentInsurance:r(g*pct(s.employeeUnemploymentPercent)),
    medicalInsurance:r(Math.min(g,s.medicalThreshold)*pct(s.employeeMedicalLowPercent)+Math.max(0,g-s.medicalThreshold)*pct(s.employeeMedicalHighPercent))
  };
  employee.total=r(employee.incomeTax+employee.socialInsurance+employee.unemploymentInsurance+employee.medicalInsurance);
  const employer={
    socialInsurance:r(tier(g,s.socialThreshold1,s.socialThreshold2,s.employerSocialLowPercent,s.employerSocialMidPercent,s.employerSocialHighPercent)),
    unemploymentInsurance:r(g*pct(s.employerUnemploymentPercent)),
    medicalInsurance:r(Math.min(g,s.medicalThreshold)*pct(s.employerMedicalLowPercent)+Math.max(0,g-s.medicalThreshold)*pct(s.employerMedicalHighPercent))
  };
  employer.total=r(employer.socialInsurance+employer.unemploymentInsurance+employer.medicalInsurance);
  return{gross:r(g),taxableIncome:r(taxable),employee,employer,net:r(g-employee.total),totalEmployerCost:r(g+employer.total)}
}
function model(row,adj,tax){
  const term=row.term||null,s=tax.settings||{},tot=adj?.totals||{},meal=adj?.meal||{};
  const officialGross=Number(term?.officialGross||0),additionalGross=Number(term?.additionalAmount||0);
  const treatment=String(term?.additionalTaxTreatment||'TAXABLE').toUpperCase(),additionalTaxable=treatment==='TAXABLE';
  const taxableRewards=Number(tot.taxableRewards||0),exemptRewards=Number(tot.exemptRewards||0),rewards=Number(tot.rewards||0);
  const advances=Number(tot.advances||0),deductions=Number(tot.deductions||0),drafts=Number(tot.drafts||0);
  const official=calcGross(officialGross,s);
  const additionalTaxBase=officialGross+(additionalTaxable?additionalGross:0);
  const additionalCombined=calcGross(additionalTaxBase,s);
  const combinedTaxGross=additionalTaxBase+taxableRewards;
  const combined=calcGross(combinedTaxGross,s);
  const additionalEmployeeTax=r(Math.max(0,additionalCombined.employee.total-official.employee.total));
  const additionalNet=r(additionalGross-(additionalTaxable?Math.min(additionalGross,additionalEmployeeTax):0));
  const beforeDeductions=r(combined.net+(additionalTaxable?0:additionalGross)+exemptRewards);
  const finalPayable=r(Math.max(0,beforeDeductions-advances-deductions));
  const employerCost=r(combined.totalEmployerCost+(additionalTaxable?0:additionalGross)+exemptRewards);
  const factualBaseGross=r(officialGross+additionalGross);
  const fullAccrualGross=r(factualBaseGross+rewards);
  const cap=r(beforeDeductions*.20),overCap=deductions>cap+.009;
  const overtimeMinutes=Number(row.overtimeApprovedMinutes||0);
  const reasons=[...(row.flags||[])];
  if(drafts>0)reasons.push(`Черновики корректировок: ${drafts}`);
  if(Number(meal.pendingDeduction||0)>0)reasons.push(`Питание к подтверждению: ${money(meal.pendingDeduction)}`);
  if(overCap)reasons.push(`Удержания выше контрольных 20%: ${money(cap)}`);
  if(overtimeMinutes>0)reasons.push(`Подтверждены доп. часы: ${hours(overtimeMinutes)} — сумма ещё не рассчитана`);
  let status=row.status||'READY';
  if(!term)status='NO_TERMS';
  else if(status==='REVIEW'||drafts>0||Number(meal.pendingDeduction||0)>0||overCap||overtimeMinutes>0)status='REVIEW';
  else status='READY';
  return{row,adj:adj||{},term,officialGross,additionalGross,additionalNet,rewards,taxableRewards,exemptRewards,advances,deductions,drafts,official,combined,beforeDeductions,finalPayable,employerCost,factualBaseGross,fullAccrualGross,cap,overCap,overtimeMinutes,meal,status,reasons};
}
function buildModels(p,a,tax){const map=new Map((a.employees||[]).map(x=>[String(x.id),x]));return(p.rows||[]).map(row=>model(row,map.get(String(row.employeeId)),tax||{}))}

function sourceBadge(m){if(m.row.sourceType==='EMPLOYEE')return'<span class="hrp-source employee">Индивидуально</span>';if(m.row.sourceType==='ROLE')return'<span class="hrp-source role">По должности</span>';return'<span class="hrp-status missing">Нет условий</span>'}
function statusBadge(m){if(m.status==='NO_TERMS')return'<span class="hrp-status missing">Нет условий</span>';if(m.status==='REVIEW')return'<span class="hrp-status review">Проверить</span>';return'<span class="hrp-status ready">Готово</span>'}
function employeeCell(m){return`<div class="hr-name">${esc(m.row.employeeName||'—')}</div><div class="hr-sub">${esc(m.row.roleName||'Без должности')} · ${esc(m.row.employeeCode||'')}</div>`}
function reasonCell(m){return esc(m.reasons.join(' · ')||'—')}

function selectedModels(){
  const q=String($('hrpSearch')?.value||'').trim().toLowerCase(),role=$('hrpRole')?.value||'',st=$('hrpState')?.value||'';
  return state.models.filter(m=>{
    if(q&&!String(`${m.row.employeeName} ${m.row.employeeCode}`).toLowerCase().includes(q))return false;
    if(role&&String(m.row.roleCode||'')!==role)return false;
    if(st&&m.status!==st)return false;
    return true;
  });
}
function renderFilters(){
  const el=$('hrpRole'),current=el.value;
  const roles=[...new Map(state.models.filter(m=>m.row.roleCode).map(m=>[String(m.row.roleCode),m.row.roleName||m.row.roleCode])).entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1]),'ru'));
  el.innerHTML='<option value="">Все должности</option>'+roles.map(([v,n])=>`<option value="${esc(v)}">${esc(n)}</option>`).join('');
  if(roles.some(([v])=>v===current))el.value=current;
}
function renderSummary(){
  const list=selectedModels(),sum=fn=>r(list.reduce((a,m)=>a+Number(fn(m)||0),0));
  const factualFund=sum(m=>m.factualBaseGross),officialGross=sum(m=>m.officialGross),payable=sum(m=>m.finalPayable),cost=sum(m=>m.employerCost);
  $('hrpSummary').innerHTML=[
    ['Сотрудников',list.length,`С условиями: ${list.filter(m=>m.term).length}`],
    ['Фактический фонд',money(factualFund),'Официальная + дополнительная часть'],
    ['Официальный Gross',money(officialGross),'Белая часть начислений'],
    ['К выплате',money(payable),'После авансов и удержаний'],
    ['Стоимость ресторану',money(cost),'Начисления + взносы работодателя']
  ].map(x=>`<article class="hr-summary-card"><span>${esc(x[0])}</span><strong>${esc(x[1])}</strong><small>${esc(x[2])}</small></article>`).join('');
}
function renderContext(){
  const p=state.payroll,t=state.tax;
  $('hrpPeriod').textContent=`${p.period?.from||''} — ${p.period?.to||''}`;
  $('hrpTaxProfile').textContent=`${t.mode==='MANUAL'?'Ручной':'Системный'}${t.active?.effectiveFrom?' · с '+t.active.effectiveFrom:''}`;
  $('hrpAttendance').textContent=p.attendance?.mode==='FACE_ID'?`Face ID · устройств: ${Number(p.attendance.activeDevices||0)}`:'Face ID пока не подключён';
  $('hrpAttendance').className=p.attendance?.mode==='FACE_ID'?'connected':'not-connected';
  $('hrpOvertime').textContent=hours(p.summary?.overtimeApprovedMinutes||0);
}
function head(cols){return`<tr>${cols.map(c=>`<th class="${c.left?'text-left':''} ${c.cls||''}">${esc(c.label)}</th>`).join('')}</tr>`}
function overallRows(list){
  $('hrpTableTitle').textContent='Общий расчёт';
  $('hrpTableSub').textContent='Фактический оклад, официальная часть, корректировки и итоговая выплата';
  $('hrpTable').className='hrp-table mode-overall';
  $('hrpHead').innerHTML=head([
    {label:'Сотрудник',left:true},{label:'Источник'},{label:'Статус'},{label:'Фактический оклад'},{label:'Официальный Gross'},{label:'Доп. часть'},
    {label:'Вознаграждения'},{label:'Аванс'},{label:'Удержания'},{label:'Доп. часы HR'},{label:'К выплате',cls:'accent-head'},{label:'Стоимость ресторану'},{label:'Проверить',left:true}
  ]);
  return list.map(m=>`<tr>
    <td class="text-left">${employeeCell(m)}</td><td>${sourceBadge(m)}</td><td>${statusBadge(m)}</td>
    <td class="hrp-money">${m.term?money(m.factualBaseGross):'—'}</td><td>${m.term?money(m.officialGross):'—'}</td><td>${m.term?money(m.additionalGross):'—'}</td>
    <td class="hrp-plus">${money(m.rewards)}</td><td class="hrp-minus">${money(m.advances)}</td><td class="hrp-minus">${money(m.deductions)}</td>
    <td class="${m.overtimeMinutes?'hrp-overtime':''}">${hours(m.overtimeMinutes)}</td><td class="hrp-final">${m.term?money(m.finalPayable):'—'}</td>
    <td class="hrp-money">${m.term?money(m.employerCost):'—'}</td><td class="text-left hrp-flags">${reasonCell(m)}</td>
  </tr>`).join('');
}
function factualRows(list){
  $('hrpTableTitle').textContent='Фактическая часть';
  $('hrpTableSub').textContent='Полная договорённая зарплата и реальные суммы к выплате';
  $('hrpTable').className='hrp-table mode-factual';
  $('hrpHead').innerHTML=head([
    {label:'Сотрудник',left:true},{label:'Фактический оклад'},{label:'Официальный Net'},{label:'Доп. часть Gross'},{label:'Доп. часть Net'},
    {label:'Вознаграждения'},{label:'Начислено до удержаний'},{label:'Аванс'},{label:'Удержания'},{label:'Питание / долг'},{label:'Доп. часы HR'},{label:'К выплате',cls:'accent-head'},{label:'Статус'}
  ]);
  return list.map(m=>{
    const meal=m.meal||{},mealText=meal.source?`<b>${money(meal.monthNetIncrease)}</b><div class="hr-sub">лимит ${money(meal.limit)} · сверх ${money(meal.overLimit)}</div>`:'—';
    return`<tr>
      <td class="text-left">${employeeCell(m)}</td><td class="hrp-money">${m.term?money(m.factualBaseGross):'—'}</td>
      <td>${m.term?money(m.official.net):'—'}</td><td>${m.term?money(m.additionalGross):'—'}</td><td>${m.term?money(m.additionalNet):'—'}</td>
      <td class="hrp-plus">${money(m.rewards)}</td><td class="hrp-money">${m.term?money(m.beforeDeductions):'—'}</td>
      <td class="hrp-minus">${money(m.advances)}</td><td class="hrp-minus">${money(m.deductions)}</td><td>${mealText}</td>
      <td class="${m.overtimeMinutes?'hrp-overtime':''}">${hours(m.overtimeMinutes)}</td><td class="hrp-final">${m.term?money(m.finalPayable):'—'}</td><td>${statusBadge(m)}</td>
    </tr>`;
  }).join('');
}
function officialRows(list){
  $('hrpTableTitle').textContent='Официальная часть';
  $('hrpTableSub').textContent='Белая зарплата, налоги сотрудника и взносы работодателя';
  $('hrpTable').className='hrp-table mode-official';
  $('hrpHead').innerHTML=head([
    {label:'Сотрудник',left:true},{label:'Gross'},{label:'Налоговая база'},{label:'Подоходный',cls:'tax-head'},{label:'Соц. сотр.',cls:'tax-head'},
    {label:'Безраб. сотр.',cls:'tax-head'},{label:'Мед. сотр.',cls:'tax-head'},{label:'Удержания сотрудника'},{label:'Официальный Net',cls:'accent-head'},
    {label:'Соц. работ.',cls:'employer-head'},{label:'Безраб. работ.',cls:'employer-head'},{label:'Мед. работ.',cls:'employer-head'},
    {label:'Взносы работодателя'},{label:'Официальная стоимость'}
  ]);
  return list.map(m=>{const o=m.official;return`<tr>
    <td class="text-left">${employeeCell(m)}</td><td class="hrp-money">${m.term?money(o.gross):'—'}</td><td>${m.term?money(o.taxableIncome):'—'}</td>
    <td class="hrp-tax">${m.term?money(o.employee.incomeTax):'—'}</td><td class="hrp-tax">${m.term?money(o.employee.socialInsurance):'—'}</td>
    <td class="hrp-tax">${m.term?money(o.employee.unemploymentInsurance):'—'}</td><td class="hrp-tax">${m.term?money(o.employee.medicalInsurance):'—'}</td>
    <td class="hrp-minus">${m.term?money(o.employee.total):'—'}</td><td class="hrp-final">${m.term?money(o.net):'—'}</td>
    <td class="hrp-employer">${m.term?money(o.employer.socialInsurance):'—'}</td><td class="hrp-employer">${m.term?money(o.employer.unemploymentInsurance):'—'}</td>
    <td class="hrp-employer">${m.term?money(o.employer.medicalInsurance):'—'}</td><td class="hrp-employer">${m.term?money(o.employer.total):'—'}</td>
    <td class="hrp-money">${m.term?money(o.totalEmployerCost):'—'}</td>
  </tr>`}).join('');
}
function renderTable(){
  const list=selectedModels();$('hrpCount').textContent=`${list.length} сотрудников`;
  let body='';if(mode==='FACTUAL')body=factualRows(list);else if(mode==='OFFICIAL')body=officialRows(list);else body=overallRows(list);
  $('hrpRows').innerHTML=body||`<tr><td colspan="20" class="hr-empty">Сотрудники не найдены.</td></tr>`;
}
function renderTabs(){
  document.querySelectorAll('.hrp-tab').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
}
function render(){renderFilters();renderSummary();renderContext();renderTabs();renderTable()}
function onFilter(){renderSummary();renderTable()}
async function load(){
  if(busy)return;
  try{
    busy=true;$('hrpRefresh').disabled=true;showError();setStatus('Загрузка…','loading');
    const d=await api();state={...d,models:buildModels(d.payroll,d.adjustments,d.tax)};render();setStatus('Готово','ok');
  }catch(e){console.error(e);showError(e?.message||String(e));setStatus('Ошибка','error')}
  finally{busy=false;$('hrpRefresh').disabled=false}
}
function bind(){
  $('hrpRefresh').onclick=load;$('hrpMonth').onchange=load;
  $('hrpSearch').oninput=onFilter;$('hrpRole').onchange=onFilter;$('hrpState').onchange=onFilter;
  document.querySelectorAll('.hrp-tab').forEach(b=>b.onclick=()=>{mode=b.dataset.mode||'OVERALL';renderTabs();renderTable()});
}
function init(){$('hrpMonth').value=monthNow();bind();load()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();