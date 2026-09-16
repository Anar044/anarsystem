(()=>{
'use strict';
const $=id=>document.getElementById(id);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ensureCompensationStyle(){
  let link=document.querySelector('link[data-hcp-style="1"]');
  if(link)return;
  link=document.createElement('link');
  link.rel='stylesheet';
  link.href='/hr-compensation.css?v=20260916-5';
  link.dataset.hcpStyle='1';
  document.head.appendChild(link);
}
ensureCompensationStyle();
let state={employees:[],roles:[],counts:{},totals:{}},busy=false,forceNew=false;
const money=v=>`${(Number(v)||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} ₼`;
const round=v=>Math.round((Number(v)||0)*100)/100;
const n=v=>Math.max(0,Number(v)||0);
function today(){const d=new Date(),p=x=>String(x).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`}
function yearOf(v){const m=/^(\d{4})-/.exec(String(v||''));return m?Number(m[1]):new Date().getFullYear()}
async function token(){const c=await window.SHAuth?.createClient?.();if(!c)throw new Error('Supabase Auth не готов');const{data,error}=await c.auth.getSession();const t=data?.session?.access_token;if(error||!t)throw new Error('Сессия пользователя не найдена');return t}
async function api(body=null){
  const t=await token(),asOf=$('hcpAsOf').value||today(),opts={headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}};
  let url=`/api/hr/compensation?asOf=${encodeURIComponent(asOf)}`;
  if(body){opts.method='POST';opts.headers['Content-Type']='application/json';opts.body=JSON.stringify({...body,asOf});url='/api/hr/compensation'}
  const r=await fetch(url,opts),j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));
  if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);
  return j;
}
function status(t,k=''){const e=$('hcpStatus');if(!e)return;e.textContent=t;e.className=`hr-status ${k}`.trim()}
function error(t=''){const e=$('hcpError');if(!e)return;e.hidden=!t;e.textContent=t}
function incomeTax(g,date){g=n(g);const y=yearOf(date);let lr=.03,lb=75,mb=625;if(y===2027){lr=.05;lb=125;mb=675}else if(y>=2028){lr=.07;lb=175;mb=725}const x=g<=2500?Math.max(0,g-200):g;if(x<=2500)return round(x*lr);if(x<=8000)return round(lb+(x-2500)*.10);return round(mb+(x-8000)*.14)}
function empSocial(g){g=n(g);if(g<=200)return round(g*.03);if(g<=8000)return round(6+(g-200)*.10);return round(786+(g-8000)*.10)}
function erSocial(g){g=n(g);if(g<=200)return round(g*.22);if(g<=8000)return round(44+(g-200)*.15);return round(1214+(g-8000)*.11)}
const med=g=>round(Math.min(n(g),2500)*.02+Math.max(0,n(g)-2500)*.005),unemp=g=>round(n(g)*.005);
function statutory(g,date){g=round(n(g));const employee={incomeTax:incomeTax(g,date),socialInsurance:empSocial(g),unemploymentInsurance:unemp(g),medicalInsurance:med(g)};employee.total=round(Object.values(employee).reduce((a,b)=>a+b,0));const employer={socialInsurance:erSocial(g),unemploymentInsurance:unemp(g),medicalInsurance:med(g)};employer.total=round(Object.values(employer).reduce((a,b)=>a+b,0));return{gross:g,employee,employer,net:round(g-employee.total)}}
function formCalc(){const o=statutory($('hcpOfficialGross').value,$('hcpAsOf').value||today()),a=round(n($('hcpAdditional').value)),taxable=$('hcpTaxTreatment').value==='TAXABLE',c=statutory(o.gross+(taxable?a:0),$('hcpAsOf').value||today()),ded=round(c.employee.total-o.employee.total),er=round(c.employer.total-o.employer.total),net=taxable?round(a-ded):a;return{official:o,combined:c,additional:{gross:a,net,employeeDeductions:ded,employerContributions:er},totalEmployeeReceives:round(o.net+net),totalEmployerCost:round(o.gross+o.employer.total+a+er)}}
function preview(){
  const c=formCalc(),o=c.official,d=c.combined;
  [['pvOfficialGross',o.gross],['pvIncomeTax',o.employee.incomeTax],['pvEmployeeSocial',o.employee.socialInsurance],['pvEmployeeUnemployment',o.employee.unemploymentInsurance],['pvEmployeeMedical',o.employee.medicalInsurance],['pvOfficialNet',o.net],['pvAdditionalGross',c.additional.gross],['pvAdditionalDeductions',c.additional.employeeDeductions],['pvAdditionalEmployer',c.additional.employerContributions],['pvAdditionalNet',c.additional.net],['pvEmployeeTotal',c.totalEmployeeReceives],['pvEmployerSocial',d.employer.socialInsurance],['pvEmployerUnemployment',d.employer.unemploymentInsurance],['pvEmployerMedical',d.employer.medicalInsurance],['pvEmployerCost',c.totalEmployerCost]].forEach(([id,v])=>{if($(id))$(id).textContent=money(v)});
  const ex=$('hcpTaxTreatment').value==='EXEMPT_WITH_BASIS';$('hcpBasisWrap').hidden=!ex;$('hcpBasis').required=ex;$('pvTaxNote').textContent=ex?'Исключено из баз только по указанному законному основанию.':'Включено в налоговые и страховые базы.';$('hcpRuleBadge').textContent=`AZ · ${yearOf($('hcpAsOf').value||today())}`;
}
function summary(){const c=state.counts||{},t=state.totals||{};$('hcpSummary').innerHTML=`<article class="hr-summary-card"><span>Сотрудники</span><strong>${Number(c.employees||0)}</strong><small>С условиями: ${Number(c.configured||0)} · без: ${Number(c.withoutTerms||0)}</small></article><article class="hr-summary-card"><span>Должности настроены</span><strong>${Number(c.rolesConfigured||0)} / ${Number(c.roles||0)}</strong><small>Базовые условия</small></article><article class="hr-summary-card"><span>Индивидуальные исключения</span><strong>${Number(c.individualOverrides||0)}</strong><small>Приоритет над должностью</small></article><article class="hr-summary-card"><span>Стоимость для ресторана</span><strong class="hr-text-value">${money(t.employerCost||0)}</strong><small>По эффективным условиям</small></article>`}
function selectors(){
  const ec=$('hcpEmployee').value,rc=$('hcpRole').value;
  $('hcpEmployee').innerHTML=(state.employees||[]).map(e=>`<option value="${esc(e.id)}">${esc(e.name)}${e.roleName?' · '+esc(e.roleName):''}</option>`).join('')||'<option value="">Нет сотрудников</option>';
  $('hcpRole').innerHTML=(state.roles||[]).map(r=>`<option value="${esc(r.code)}">${esc(r.name)} · ${Number(r.employeeCount||0)} сотр.</option>`).join('')||'<option value="">Нет должностей</option>';
  if((state.employees||[]).some(e=>e.id===ec))$('hcpEmployee').value=ec;
  if((state.roles||[]).some(r=>r.code===rc))$('hcpRole').value=rc;
}
const taxBadge=t=>!t?'<span class="hr-badge pending">Не настроено</span>':t.additionalTaxTreatment==='EXEMPT_WITH_BASIS'?'<span class="hr-badge">Есть основание</span>':'<span class="hr-badge active">Облагается</span>';
function sourceBadge(e){if(e.sourceType==='EMPLOYEE')return'<span class="hcp-source individual">Индивидуально</span>';if(e.sourceType==='ROLE')return`<span class="hcp-source inherited">По должности</span><div class="hr-sub">${esc(e.roleName||e.roleCode||'')}</div>`;return'<span class="hr-badge pending">Не настроено</span>'}
function roleRows(){
  const l=state.roles||[];$('hcpRoleCount').textContent=`${l.length} должностей`;
  $('hcpRoleRows').innerHTML=l.map(r=>{if(!r.term||!r.calculation)return `<tr><td class="text-left"><div class="hr-name">${esc(r.name)}</div><div class="hr-sub">${esc(r.code)}</div></td><td>${r.employeeCount||0}</td><td colspan="5" class="text-left"><span class="hr-badge pending">Условия не настроены</span></td><td>—</td><td><button class="hr-link-button" data-rnew="${esc(r.code)}">Настроить</button></td></tr>`;const c=r.calculation,o=c.official;return `<tr><td class="text-left"><div class="hr-name">${esc(r.name)}</div><div class="hr-sub">${esc(r.code)}</div></td><td>${r.employeeCount||0}</td><td>${money(o.gross)}</td><td><b>${money(o.net)}</b></td><td>${money(r.term.additionalAmount)}</td><td><b>${money(c.totalEmployeeReceives)}</b></td><td><b>${money(c.totalEmployerCost)}</b></td><td>${taxBadge(r.term)}</td><td><div class="hcp-row-actions"><button class="hr-link-button" data-redit="${esc(r.code)}">Изменить</button><button class="hr-link-button danger" data-rdisable="${esc(r.code)}">Отключить</button></div></td></tr>`}).join('')||'<tr><td colspan="9" class="hr-empty">Должности не найдены.</td></tr>';
  $('hcpRoleRows').querySelectorAll('[data-rnew]').forEach(b=>b.onclick=()=>newRole(b.dataset.rnew));$('hcpRoleRows').querySelectorAll('[data-redit]').forEach(b=>b.onclick=()=>editRole(b.dataset.redit));$('hcpRoleRows').querySelectorAll('[data-rdisable]').forEach(b=>b.onclick=()=>disableRole(b.dataset.rdisable));
}
function employeeRows(){
  const l=state.employees||[];$('hcpRowCount').textContent=`${l.length} сотрудников`;
  $('hcpRows').innerHTML=l.map(e=>{if(!e.term||!e.calculation){const a=e.roleCode?`<button class="hr-link-button" data-rnew="${esc(e.roleCode)}">Для должности</button>`:`<button class="hr-link-button" data-ind="${esc(e.id)}">Индивидуально</button>`;return `<tr><td class="text-left"><div class="hr-name">${esc(e.name)}</div><div class="hr-sub">${esc(e.roleName||'Без должности')} · ${esc(e.code||'')}</div></td><td>${sourceBadge(e)}</td><td colspan="10" class="text-left"><span class="hr-badge pending">Условия не настроены</span></td><td>${a}</td></tr>`}const c=e.calculation,o=c.official,a=e.sourceType==='EMPLOYEE'?`<div class="hcp-row-actions"><button class="hr-link-button" data-eedit="${esc(e.id)}">Изменить</button><button class="hr-link-button" data-inherit="${esc(e.id)}">Вернуть к должности</button></div>`:`<button class="hr-link-button" data-ind="${esc(e.id)}">Индивидуально</button>`;return `<tr><td class="text-left"><div class="hr-name">${esc(e.name)}</div><div class="hr-sub">${esc(e.roleName||'Без должности')} · ${esc(e.code||'')}</div></td><td>${sourceBadge(e)}</td><td>${money(o.gross)}</td><td>${money(o.employee.incomeTax)}</td><td>${money(o.employee.socialInsurance)}</td><td>${money(o.employee.unemploymentInsurance)}</td><td>${money(o.employee.medicalInsurance)}</td><td><b>${money(o.net)}</b></td><td>${money(e.term.additionalAmount)}</td><td><b>${money(c.totalEmployeeReceives)}</b></td><td>${money(c.combined.employer.total)}</td><td><b>${money(c.totalEmployerCost)}</b></td><td>${a}</td></tr>`}).join('')||'<tr><td colspan="13" class="hr-empty">Сотрудники не найдены.</td></tr>';
  $('hcpRows').querySelectorAll('[data-ind]').forEach(b=>b.onclick=()=>newEmployee(b.dataset.ind));$('hcpRows').querySelectorAll('[data-eedit]').forEach(b=>b.onclick=()=>editEmployee(b.dataset.eedit));$('hcpRows').querySelectorAll('[data-inherit]').forEach(b=>b.onclick=()=>inherit(b.dataset.inherit));$('hcpRows').querySelectorAll('[data-rnew]').forEach(b=>b.onclick=()=>newRole(b.dataset.rnew));
}
function scope(){const r=$('hcpScope').value==='ROLE';$('hcpRoleWrap').hidden=!r;$('hcpEmployeeWrap').hidden=r;$('hcpRole').required=r;$('hcpEmployee').required=!r}
function render(){summary();selectors();roleRows();employeeRows();scope();preview()}
function clearFields(scopeType='ROLE'){
  $('hcpId').value='';$('hcpScope').value=scopeType;$('hcpFrom').value=$('hcpAsOf').value||today();$('hcpTo').value='';$('hcpOfficialGross').value=0;$('hcpAdditional').value=0;$('hcpMethod').value='CASH';$('hcpTaxTreatment').value='TAXABLE';$('hcpBasis').value='';$('hcpNote').value='';scope();preview();
}
function fill(t){forceNew=false;$('hcpId').value=t.id||'';$('hcpFrom').value=t.effectiveFrom||($('hcpAsOf').value||today());$('hcpTo').value=t.effectiveTo||'';$('hcpOfficialGross').value=t.officialGross??0;$('hcpAdditional').value=t.additionalAmount??0;$('hcpMethod').value=t.additionalPaymentMethod||'CASH';$('hcpTaxTreatment').value=t.additionalTaxTreatment||'TAXABLE';$('hcpBasis').value=t.additionalLegalBasis||'';$('hcpNote').value=t.note||'';preview()}
function newRole(code){forceNew=true;const selected=code||$('hcpRole').value;clearFields('ROLE');if(selected)$('hcpRole').value=selected;document.querySelector('.hcp-editor')?.scrollIntoView({behavior:'smooth',block:'start'})}
function editRole(code){const r=(state.roles||[]).find(x=>x.code===code);$('hcpScope').value='ROLE';scope();if(code)$('hcpRole').value=code;if(r?.term)fill(r.term);else newRole(code);document.querySelector('.hcp-editor')?.scrollIntoView({behavior:'smooth',block:'start'})}
function newEmployee(id){
  forceNew=true;const selected=id||$('hcpEmployee').value;clearFields('EMPLOYEE');if(selected)$('hcpEmployee').value=selected;
  const e=(state.employees||[]).find(x=>String(x.id)===String(selected));const base=e?.term;
  if(base){$('hcpOfficialGross').value=base.officialGross??0;$('hcpAdditional').value=base.additionalAmount??0;$('hcpMethod').value=base.additionalPaymentMethod||'CASH';$('hcpTaxTreatment').value=base.additionalTaxTreatment||'TAXABLE';$('hcpBasis').value=base.additionalLegalBasis||'';$('hcpNote').value='Индивидуальное исключение';preview()}
  document.querySelector('.hcp-editor')?.scrollIntoView({behavior:'smooth',block:'start'});
}
function editEmployee(id){
  const e=(state.employees||[]).find(x=>String(x.id)===String(id));$('hcpScope').value='EMPLOYEE';scope();if(id)$('hcpEmployee').value=id;
  if(e?.individualTerm)fill(e.individualTerm);else newEmployee(id);
  document.querySelector('.hcp-editor')?.scrollIntoView({behavior:'smooth',block:'start'});
}
function loadEmployeeContext(){
  if($('hcpScope').value!=='EMPLOYEE')return;
  const id=$('hcpEmployee').value,e=(state.employees||[]).find(x=>String(x.id)===String(id));
  if(e?.individualTerm){fill(e.individualTerm);return}
  forceNew=true;$('hcpId').value='';$('hcpFrom').value=$('hcpAsOf').value||today();$('hcpTo').value='';
  if(e?.term){$('hcpOfficialGross').value=e.term.officialGross??0;$('hcpAdditional').value=e.term.additionalAmount??0;$('hcpMethod').value=e.term.additionalPaymentMethod||'CASH';$('hcpTaxTreatment').value=e.term.additionalTaxTreatment||'TAXABLE';$('hcpBasis').value=e.term.additionalLegalBasis||'';$('hcpNote').value='Индивидуальное исключение'}else{$('hcpOfficialGross').value=0;$('hcpAdditional').value=0;$('hcpNote').value=''}preview();
}
function loadRoleContext(){
  if($('hcpScope').value!=='ROLE')return;
  const code=$('hcpRole').value,r=(state.roles||[]).find(x=>String(x.code)===String(code));
  if(r?.term)fill(r.term);else{forceNew=true;$('hcpId').value='';$('hcpFrom').value=$('hcpAsOf').value||today();$('hcpTo').value='';$('hcpOfficialGross').value=0;$('hcpAdditional').value=0;$('hcpNote').value='';preview()}
}
async function load(){if(busy)return;try{busy=true;$('hcpRefresh').disabled=true;error();status('Загрузка…','loading');state=await api();render();if($('hcpScope').value==='EMPLOYEE')loadEmployeeContext();else loadRoleContext();status('Готово','ok')}catch(e){error(e.message);status('Ошибка','error')}finally{busy=false;$('hcpRefresh').disabled=false}}
async function save(ev){
  ev.preventDefault();
  try{
    error();status('Сохраняем…','loading');if($('hcpTaxTreatment').value==='EXEMPT_WITH_BASIS'&&!$('hcpBasis').value.trim())throw new Error('Укажите законное основание');
    const s=$('hcpScope').value,employeeId=$('hcpEmployee').value,effectiveFrom=$('hcpFrom').value,effectiveTo=$('hcpTo').value,officialGross=Number($('hcpOfficialGross').value||0),additionalAmount=Number($('hcpAdditional').value||0);
    if(s==='EMPLOYEE'&&!employeeId)throw new Error('Выберите сотрудника');
    let id=$('hcpId').value;
    if(s==='EMPLOYEE'&&!forceNew&&!id){const current=(state.employees||[]).find(e=>String(e.id)===String(employeeId));id=current?.individualTerm?.id||''}
    const payload={action:'saveTerm',scopeType:s,id,roleCode:$('hcpRole').value,employeeId,effectiveFrom,effectiveTo,officialGross,additionalAmount,additionalPaymentMethod:$('hcpMethod').value,additionalTaxTreatment:$('hcpTaxTreatment').value,additionalLegalBasis:$('hcpBasis').value,note:$('hcpNote').value};
    state=await api(payload);
    if(s==='EMPLOYEE'){
      const currentAsOf=$('hcpAsOf').value||today();if(effectiveFrom>currentAsOf){$('hcpAsOf').value=effectiveFrom;state=await api()}
      let saved=(state.employees||[]).find(e=>String(e.id)===String(employeeId));if(!saved||saved.sourceType!=='EMPLOYEE'){await new Promise(r=>setTimeout(r,200));state=await api();saved=(state.employees||[]).find(e=>String(e.id)===String(employeeId))}
      if(!saved||saved.sourceType!=='EMPLOYEE')throw new Error('Индивидуальные условия сохранились, но не стали активными.');
      const active=saved.individualTerm;if(active&&effectiveFrom<=($('hcpAsOf').value||today())&&(!effectiveTo||effectiveTo>=($('hcpAsOf').value||today()))){if(Math.abs(Number(active.officialGross)-officialGross)>.009||Math.abs(Number(active.additionalAmount)-additionalAmount)>.009)throw new Error(`Активна другая индивидуальная запись от ${active.effectiveFrom}. Нажмите «Изменить» у сотрудника и сохраните её.`)}
      render();editEmployee(employeeId);status(`Индивидуальные условия применены · ${saved.name||''}`,'ok');return;
    }
    render();loadRoleContext();status('Условия должности сохранены','ok');
  }catch(e){error(e.message);status('Ошибка','error')}
}
async function inherit(id){const e=(state.employees||[]).find(x=>x.id===id);if(!e?.individualTerm)return;if(!confirm(`Убрать индивидуальные условия у «${e.name}» и вернуть условия должности?`))return;try{state=await api({action:'disableTerm',scopeType:'EMPLOYEE',id:e.individualTerm.id});render();$('hcpEmployee').value=id;loadEmployeeContext();status('Сотрудник снова наследует условия должности','ok')}catch(x){error(x.message);status('Ошибка','error')}}
async function disableRole(code){const r=(state.roles||[]).find(x=>x.code===code);if(!r?.term)return;if(!confirm(`Отключить условия должности «${r.name}»?`))return;try{state=await api({action:'disableTerm',scopeType:'ROLE',id:r.term.id});render();status('Условия должности отключены','ok')}catch(x){error(x.message);status('Ошибка','error')}}
function bind(){
  $('hcpRefresh').onclick=load;
  $('hcpReset').onclick=()=>{$('hcpScope').value==='EMPLOYEE'?newEmployee($('hcpEmployee').value):newRole($('hcpRole').value)};
  $('hcpAsOf').onchange=load;
  $('hcpScope').onchange=()=>{scope();$('hcpScope').value==='EMPLOYEE'?loadEmployeeContext():loadRoleContext()};
  $('hcpEmployee').onchange=loadEmployeeContext;
  $('hcpRole').onchange=loadRoleContext;
  $('hcpForm').onsubmit=save;
  ['hcpOfficialGross','hcpAdditional','hcpTaxTreatment','hcpBasis'].forEach(id=>{$(id).addEventListener('input',preview);$(id).addEventListener('change',preview)});
}
async function init(){ensureCompensationStyle();$('hcpAsOf').value=today();bind();clearFields('ROLE');await load()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();