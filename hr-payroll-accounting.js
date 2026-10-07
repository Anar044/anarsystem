(()=>{'use strict';
const $=id=>document.getElementById(id),state={accounts:[],bankAccounts:[],config:null,scope:null,binding:null,access:null};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const TYPES={CASH:'Денежные средства',ACCOUNTS_RECEIVABLE:'Дебиторская задолженность',DEBTS_OF_EMPLOYEES:'Долги сотрудников',CURRENT_ASSET:'Текущие активы',OTHER_CURRENT_ASSET:'Основные средства',INVENTORY_ASSETS:'Складские запасы',EMPLOYEES_LIABILITY:'Расчёты с сотрудниками',ACCOUNTS_PAYABLE:'Расчёты с поставщиками',CLIENTS_LIABILITY:'Расчёты с гостями',OTHER_CURRENT_LIABILITY:'Прочие текущие обязательства',LONG_TERM_LIABILITY:'Долгосрочные обязательства',EQUITY:'Капитал',COST_OF_GOODS_SOLD:'Себестоимость / прямые издержки',INCOME:'Доходы',EXPENSES:'Расходы',OTHER_INCOME:'Прочие доходы',OTHER_EXPENSES:'Прочие расходы'};
function typeName(t){return TYPES[String(t||'').toUpperCase()]||String(t||'—')}
function setStatus(text,kind=''){const e=$('hrpaStatus');e.textContent=text;e.className=`hrpa-status ${kind}`.trim()}
function showError(text=''){const e=$('hrpaError');e.hidden=!text;e.textContent=text}
async function token(){const c=await window.SHAuth?.createClient?.();if(!c)throw new Error('Supabase Auth не готов');const{data,error}=await c.auth.getSession();const t=data?.session?.access_token;if(error||!t)throw new Error('Сессия пользователя не найдена');return t}
async function api(url,options={}){const t=await token(),r=await (window.SH_IikoContext?.fetchWithTimeout||fetch)(url,{...options,headers:{Authorization:`Bearer ${t}`,'Content-Type':'application/json',Accept:'application/json',...(options.headers||{})}},90000),j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);return j}
async function binding(){if(!window.SH_IikoContext?.getBinding)throw new Error('Единый SH context не готов');const b=await window.SH_IikoContext.getBinding(true);if(!b?.connection)throw new Error('Подключение SH Server не настроено');return b}
function account(id){return state.accounts.find(x=>String(x.id)===String(id))||null}
function isExpense(a){const t=String(a?.type||'').toUpperCase();return t.includes('EXPENSE')||t==='COST_OF_GOODS_SOLD'}
function isLiability(a){return /LIABILITY|PAYABLE/i.test(String(a?.type||''))}
function isCash(a){return String(a?.type||'').toUpperCase()==='CASH'||/касс|банк|bank|cash|денеж/i.test(String(a?.name||''))}
function score(a,kind){
  let n=0;if(kind==='expense'&&isExpense(a))n+=50;if(kind==='liability'&&isLiability(a))n+=50;if((kind==='cash'||kind==='bank')&&isCash(a))n+=40;
  const name=String(a?.name||'').toLowerCase();
  if(kind==='liability'&&/сотруд|персон|зарп|employee|payroll/.test(name))n+=30;
  if(kind==='expense'&&/зарп|оплат.*труд|персон|salary|payroll|wage/.test(name))n+=30;
  if(kind==='cash'&&/касс|cash/.test(name))n+=30;
  if(kind==='bank'&&/банк|bank|расчетн|расчётн/.test(name))n+=30;
  return n;
}
function optionLabel(a){return [a.code?String(a.code):'',a.name||a.id].filter(Boolean).join(' · ')+' — '+typeName(a.type)}
function fillSelect(id,kind,selected='',optional=false){
  const el=$(id),list=state.accounts.slice().sort((a,b)=>score(b,kind)-score(a,kind)||String(a.code||'').localeCompare(String(b.code||''),'ru',{numeric:true})||String(a.name||'').localeCompare(String(b.name||''),'ru'));
  el.innerHTML=(optional?'<option value="">— Не использовать —</option>':'<option value="">— Выберите счёт —</option>')+list.map(a=>`<option value="${esc(a.id)}">${esc(optionLabel(a))}</option>`).join('');
  if(selected&&account(selected))el.value=String(selected);
  el.onchange=()=>{renderMeta(id);renderPreview()};
}
function renderMeta(id){
  const a=account($(id)?.value),meta=$(id+'Meta');if(!meta)return;
  meta.textContent=a?`ID: ${a.id} · Тип: ${typeName(a.type)} · Баланс SH + Smart Horeca: ${Number(a.balance||0).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})} ₼`:'Счёт не выбран';
}
function cfgId(path){const [group]=path.split('.'),v=state.config?.[group];return v?.id||''}
function renderScope(){
  const scope=state.scope||{},selected=scope.selectedDepartmentCodes||[],cfg=state.config||null;
  const current=scope.scopeKey==='*'?'Общий профиль для всех ресторанов':`Ресторан / department code: ${scope.scopeKey}`;
  const fallback=cfg&&cfg.effectiveScopeKey!==scope.scopeKey?` Сейчас используется fallback: ${cfg.effectiveScopeKey}.`:'';
  $('hrpaScope').innerHTML=`<strong>Область настройки:</strong> ${esc(current)}.${esc(fallback)} ${selected.length?`Выбрано: ${esc(selected.join(', '))}.`:''}`;
}
function defaultBank(){return state.bankAccounts.find(x=>x.isDefault)||state.bankAccounts[0]||null}
function bankAccount(id){return state.bankAccounts.find(x=>String(x.id)===String(id))||null}
function renderBanks(){
  const box=$('hrpaBankList'),count=$('hrpaBankCount');if(!box)return;
  count.textContent=`${state.bankAccounts.length} банковских счетов`;
  box.innerHTML=state.bankAccounts.length?state.bankAccounts.map(b=>`<div class="hrpa-bank-item" data-bank-id="${esc(b.id)}"><div class="hrpa-bank-main"><strong>${esc([account(b.id)?.code,b.name||account(b.id)?.name||b.id].filter(Boolean).join(' · '))}</strong><small>${esc(typeName(b.type||account(b.id)?.type))} · ID: ${esc(b.id)}</small></div><label class="hrpa-bank-default"><input type="radio" name="hrpaDefaultBank" value="${esc(b.id)}" ${b.isDefault?'checked':''}> По умолчанию</label><button type="button" class="hrpa-bank-remove" data-bank-remove="${esc(b.id)}" title="Удалить банк">×</button></div>`).join(''):'<div class="hrpa-bank-empty">Банковские счета пока не добавлены. Выплаты через банк будут недоступны, пока не добавите хотя бы один счёт.</div>';
  box.querySelectorAll('input[name="hrpaDefaultBank"]').forEach(r=>r.onchange=()=>{state.bankAccounts=state.bankAccounts.map(x=>({...x,isDefault:String(x.id)===String(r.value)}));renderBanks();renderPreview()});
  box.querySelectorAll('[data-bank-remove]').forEach(b=>b.onclick=()=>{const id=b.dataset.bankRemove;state.bankAccounts=state.bankAccounts.filter(x=>String(x.id)!==String(id));if(state.bankAccounts.length&&!state.bankAccounts.some(x=>x.isDefault))state.bankAccounts[0].isDefault=true;renderBanks();renderPreview()});
}
function addBank(){
  const a=account($('hrpaBankCandidate')?.value);if(!a)return;
  if(state.bankAccounts.some(x=>String(x.id)===String(a.id)))return;
  state.bankAccounts.push({id:String(a.id),name:a.name||'',type:a.type||'',isDefault:state.bankAccounts.length===0});
  $('hrpaBankCandidate').value='';renderBanks();renderPreview();
}
function renderPreview(){
  const exp=account($('hrpaSalaryExpense').value),pay=account($('hrpaEmployeePayable').value),cash=account($('hrpaCash').value),bank=defaultBank();
  const name=a=>a?esc([a.code||account(a.id)?.code,a.name||account(a.id)?.name].filter(Boolean).join(' · ')):'<em>не выбран</em>';
  $('hrpaPreview').innerHTML=[
    ['Начисление доп. часов',name(exp),'Дт','→ Кт '+name(pay)],
    ['Выплата наличными',name(pay),'Дт','→ Кт '+name(cash)],
    ['Выплата через банк',name(pay),'Дт','→ Кт '+name(bank)+(bank?' (по умолчанию)':'')]
  ].map(x=>`<div class="hrpa-entry"><span>${x[0]}</span><strong>${x[1]}</strong><b>${x[2]}</b><strong>${x[3]}</strong></div>`).join('');
}
function render(){
  renderScope();const c=state.config||{};
  fillSelect('hrpaSalaryExpense','expense',c.salaryExpense?.id);
  fillSelect('hrpaEmployeePayable','liability',c.employeePayable?.id);
  fillSelect('hrpaCash','cash',c.cash?.id);
  fillSelect('hrpaBankCandidate','bank','',true);
  fillSelect('hrpaOther','cash',c.otherPayment?.id,true);
  fillSelect('hrpaEmployerExpense','expense',c.employerContribExpense?.id,true);
  fillSelect('hrpaTaxPayable','liability',c.taxPayable?.id,true);
  ['hrpaSalaryExpense','hrpaEmployeePayable','hrpaCash','hrpaOther'].forEach(renderMeta);
  renderBanks();renderPreview();
  $('hrpaSave').disabled=state.access?.canConfigurePayrollAccounting===false;
  if(state.access?.canConfigurePayrollAccounting===false)$('hrpaSave').title='Только владелец или Payroll может менять бухгалтерские счета';
}
function selectedDto(id){const a=account($(id).value);return a?{id:String(a.id),name:a.name||'',type:a.type||''}:{id:'',name:'',type:''}}
function collect(){
  const exp=selectedDto('hrpaSalaryExpense'),pay=selectedDto('hrpaEmployeePayable'),cash=selectedDto('hrpaCash'),other=selectedDto('hrpaOther'),empl=selectedDto('hrpaEmployerExpense'),tax=selectedDto('hrpaTaxPayable');
  if(!exp.id||!pay.id||!cash.id)throw new Error('Выберите обязательные счета: расходы на оплату труда, задолженность сотрудникам и кассу.');
  if(exp.id===pay.id)throw new Error('Расходный счёт и задолженность сотрудникам должны быть разными счетами.');
  return{
    salaryExpenseAccountId:exp.id,salaryExpenseAccountName:exp.name,salaryExpenseAccountType:exp.type,
    employeePayableAccountId:pay.id,employeePayableAccountName:pay.name,employeePayableAccountType:pay.type,
    cashAccountId:cash.id,cashAccountName:cash.name,cashAccountType:cash.type,
    otherPaymentAccountId:other.id,otherPaymentAccountName:other.name,otherPaymentAccountType:other.type,
    employerContribExpenseAccountId:empl.id,employerContribExpenseAccountName:empl.name,employerContribExpenseAccountType:empl.type,
    taxPayableAccountId:tax.id,taxPayableAccountName:tax.name,taxPayableAccountType:tax.type
  };
}
async function loadAccounts(){
  state.binding=await binding();const b=state.binding,c=b.connection,ids=(b.departmentIds||[]).map(String),all=(b.allDepartmentIds||ids).map(String),set=new Set(ids),rs=(b.restaurants||[]).filter(x=>set.has(String(x?.id||'')));
  const chainScope={mode:String(b?.identity?.mode||c?.connectionType||'RMS').toUpperCase(),allowedDepartmentIds:all,selectedDepartmentIds:ids,selectedDepartmentCodes:rs.map(x=>String(x?.code||'').trim()).filter(Boolean),selectedDepartmentNames:rs.map(x=>String(x?.name||'').trim()).filter(Boolean)};
  const data=await api('/api/iiko/accounts',{method:'POST',body:JSON.stringify({ip:c.ip,port:c.port,login:c.login,password:c.password,includeDeleted:false,timestamp:new Date().toISOString().slice(0,19),departmentIds:ids,chainScope})});
  state.accounts=(data.accounts||[]).filter(x=>!x.deleted);
}
async function load(){
  try{
    showError();setStatus('Загрузка…');
    const[cfg]=await Promise.all([api('/api/hr/payroll-accounting-settings'),loadAccounts()]);
    state.config=cfg.config;state.bankAccounts=Array.isArray(cfg.bankAccounts)?cfg.bankAccounts.map(x=>({...x,isDefault:Boolean(x.isDefault)})):[];state.scope=cfg.scope;state.access=cfg.access;render();setStatus('Готово','ok');
  }catch(e){console.error(e);showError(e.message||String(e));setStatus('Ошибка','error')}
}
async function save(){
  try{
    showError();setStatus('Сохранение…');$('hrpaSave').disabled=true;
    const out=await api('/api/hr/payroll-accounting-settings',{method:'POST',body:JSON.stringify({scopeKey:state.scope?.scopeKey||'*',config:collect(),bankAccounts:state.bankAccounts})});
    state.config=out.config;state.bankAccounts=Array.isArray(out.bankAccounts)?out.bankAccounts.map(x=>({...x,isDefault:Boolean(x.isDefault)})):state.bankAccounts;state.access=out.access;render();setStatus('Сохранено','ok');
  }catch(e){console.error(e);showError(e.message||String(e));setStatus('Ошибка','error')}
  finally{$('hrpaSave').disabled=state.access?.canConfigurePayrollAccounting===false}
}
function init(){$('hrpaSave').onclick=save;$('hrpaBankAdd').onclick=addBank;load()}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();