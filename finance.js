(function(){
'use strict';
const SHIFT='/api/iiko/cash-shifts',DETAIL='/api/iiko/cash-shift-detail',ACCOUNTS='/api/iiko/accounts',KEY='iikoConnection';
const $=id=>document.getElementById(id);
let accounts=new Map(),accountItems=[],rows=[],shifts=[];
const TYPES={CASH:'Денежные средства',ACCOUNTS_RECEIVABLE:'Дебиторская задолженность',DEBTS_OF_EMPLOYEES:'Долги сотрудников',CURRENT_ASSET:'Текущие активы',OTHER_CURRENT_ASSET:'Основные средства',INVENTORY_ASSETS:'Складские запасы',EMPLOYEES_LIABILITY:'Расчёты с сотрудниками',ACCOUNTS_PAYABLE:'Расчёты с поставщиками',CLIENTS_LIABILITY:'Расчёты с гостями',OTHER_CURRENT_LIABILITY:'Прочие текущие обязательства',LONG_TERM_LIABILITY:'Долгосрочные обязательства',EQUITY:'Капитал',COST_OF_GOODS_SOLD:'Прямые издержки',INCOME:'Доходы',EXPENSES:'Расходы',OTHER_INCOME:'Прочие доходы',OTHER_EXPENSES:'Прочие расходы'};
const money=n=>Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2});
const esc=v=>String(v??'').replace(/[&<>'\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const conn=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'null')}catch{return null}};
const iso=d=>d.toISOString().slice(0,10);
const fmtDate=v=>{if(!v)return'—';const p=String(v).slice(0,10).split('-');return p.length===3?`${p[2]}.${p[1]}`:String(v)};
const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0};
const typeName=t=>TYPES[String(t||'').toUpperCase()]||t||'—';
function status(t,k=''){const e=$('fin-status');e.textContent=t;e.className='fin-status '+k}

function ensureFinanceStyles(){
  if(document.querySelector('link[data-finance-style]'))return;
  const link=document.createElement('link');link.rel='stylesheet';link.href='finance.css?v=8';link.dataset.financeStyle='1';document.head.appendChild(link);
}

async function post(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json().catch(()=>({success:false,message:`HTTP ${r.status}`}));if(!r.ok||!d.success)throw new Error(d.message||`HTTP ${r.status}`);return d}
function addMovement(date,accountId,group,sum,comment,shift){const s=Math.abs(num(sum));if(!s)return;const g=String(group||'').toUpperCase();const out=g==='PAYOUT'||g==='PAYOUTS';rows.push({date,accountId,group:g,income:out?0:s,expense:out?s:0,comment,shift})}
function movementRowsForAccount(id){const key=String(id);return rows.filter(r=>String(r.accountId??'')===key)}

function renderAccounts(){
  const q=($('fin-account-search')?.value||'').trim().toLowerCase(),t=$('fin-account-type')?.value||'';
  const list=accountItems.filter(a=>(!t||a.type===t)&&(!q||[a.name,a.code,a.id,a.type].join(' ').toLowerCase().includes(q)));
  $('fin-account-total').textContent=accountItems.length;
  $('fin-account-types').textContent=new Set(accountItems.map(x=>x.type).filter(Boolean)).size;
  $('fin-account-system').textContent=accountItems.filter(x=>x.system).length;
  $('fin-account-custom').textContent=accountItems.filter(x=>!x.system).length;
  $('fin-accounts-body').innerHTML=list.length?list.map(a=>{
    const mr=movementRowsForAccount(a.id),inc=mr.reduce((s,r)=>s+r.income,0),out=mr.reduce((s,r)=>s+r.expense,0);
    return `<tr class="fin-account-row" data-account-id="${esc(a.id)}" tabindex="0" title="Открыть детали счёта"><td><b>${esc(a.name)}</b>${a.system?'<span class="fin-system">SYSTEM</span>':''}</td><td>${esc(a.code||'—')}</td><td><span class="fin-type">${esc(typeName(a.type))}</span><small class="fin-type-code">${esc(a.type||'')}</small></td><td>${a.deleted?'<span class="fin-deleted">Удалён</span>':'<span class="fin-active">Активен</span>'}</td><td><b class="fin-movement-count">${mr.length}</b><small class="fin-movement-total">${inc||out?`${money(inc-out)}`:'Нет движений'}</small></td></tr>`;
  }).join(''):'<tr><td colspan="5" class="fin-empty">Счета не найдены</td></tr>';
  document.querySelectorAll('.fin-account-row').forEach(row=>{
    row.addEventListener('click',()=>openAccount(row.dataset.accountId));
    row.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openAccount(row.dataset.accountId)}});
  });
}

function renderProfitLoss(income,expense,sales){
  const result=income-expense;
  const margin=income?result/income*100:0;
  $('fin-profit').textContent=(result<0?'− ':'')+money(Math.abs(result));
  $('fin-profit').className=result<0?'negative':'';
  $('fin-profit-caption').textContent=result<0?'Убыток: приход − расход':'Прибыль: приход − расход';
  $('fin-pnl-income').textContent=money(income);
  $('fin-pnl-expense').textContent=money(expense);
  $('fin-pnl-sales').textContent=money(sales);
  $('fin-pnl-costs').textContent=money(expense);
  $('fin-margin').textContent=`${margin.toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})}%`;
  const max=Math.max(1,income,expense);
  $('fin-pnl-income-bar').style.width=`${income/max*100}%`;
  $('fin-pnl-expense-bar').style.width=`${expense/max*100}%`;
  const from=$('fin-from').value,to=$('fin-to').value;
  $('fin-pnl-period').textContent=from&&to?`${fmtDate(from)} — ${fmtDate(to)}`:'—';
}

function render(){
  const income=shifts.reduce((s,x)=>{const sh=x.shift||{};return s+num(sh.salesCash)+num(sh.salesCredit)+num(sh.salesCard)+num(sh.payIn)},0);
  const sales=shifts.reduce((s,x)=>{const sh=x.shift||{};return s+num(sh.salesCash)+num(sh.salesCredit)+num(sh.salesCard)},0);
  const expense=shifts.reduce((s,x)=>{const sh=x.shift||{};return s+num(sh.payOut)+Math.abs(num(sh.payIncome))},0);
  $('fin-income').textContent=money(income);
  $('fin-expense').textContent=money(expense);
  $('fin-turnover').textContent=money(income+expense);
  const closed=shifts.filter(x=>x.success&&x.shift);
  const cash=closed.length?closed.reduce((s,x)=>s+num(x.shift.cashRemain),0):0;
  $('fin-cash').textContent=money(cash);
  $('fin-count').textContent=`${rows.length} операций`;
  renderProfitLoss(income,expense,sales);

  const byAccount=new Map();
  for(const r of rows){
    const id=String(r.accountId??'');
    const name=accounts.get(id)||r.accountId||'Счёт не указан';
    const x=byAccount.get(id||'__none')||{id:r.accountId||null,name,in:0,out:0,count:0};
    x.in+=r.income;x.out+=r.expense;x.count++;byAccount.set(id||'__none',x);
  }
  $('fin-account-list').innerHTML=byAccount.size?[...byAccount.values()].sort((a,b)=>(b.in+b.out)-(a.in+a.out)).slice(0,12).map(x=>{
    const clickable=x.id!=null;
    return `<div class="fin-account ${clickable?'is-clickable':''}" ${clickable?`data-account-id="${esc(x.id)}" tabindex="0"`:''}><div><div class="fin-account-name">${esc(x.name)}</div><div class="fin-account-meta">Приход ${money(x.in)} · Расход ${money(x.out)} · ${x.count} оп.</div></div><div class="fin-account-sum ${x.out>x.in?'expense':''}">${money(x.in-x.out)}</div>${clickable?'<span class="fin-account-arrow">→</span>':''}</div>`;
  }).join(''):'<div class="fin-empty">Нет проводок за период</div>';
  document.querySelectorAll('.fin-account.is-clickable').forEach(el=>{el.addEventListener('click',()=>openAccount(el.dataset.accountId));el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openAccount(el.dataset.accountId)}})});

  const byDay=new Map();
  for(const r of rows){const d=String(r.date||'').slice(0,10);const x=byDay.get(d)||{in:0,out:0};x.in+=r.income;x.out+=r.expense;byDay.set(d,x)}
  const days=[...byDay.entries()].sort((a,b)=>a[0].localeCompare(b[0]));
  const max=Math.max(1,...days.map(x=>Math.max(x[1].in,x[1].out)));
  $('fin-chart').innerHTML=days.length?days.slice(-14).map(([d,x])=>{const hi=Math.max(2,x.in/max*100),ho=Math.max(2,x.out/max*100);return`<div class="fin-bar-col"><div class="fin-bars"><div class="fin-bar in" title="Приход ${money(x.in)}" style="height:${hi}%"></div><div class="fin-bar out" title="Расход ${money(x.out)}" style="height:${ho}%"></div></div><div class="fin-day">${fmtDate(d)}</div></div>`}).join(''):'<div class="fin-empty">Нет движений за выбранный период</div>';

  const sorted=[...rows].sort((a,b)=>String(b.date).localeCompare(String(a.date)));
  $('fin-body').innerHTML=sorted.length?sorted.map(r=>{const name=accounts.get(String(r.accountId))||r.accountId||'Счёт не указан';const op=r.group==='PAYIN'?'Внесение':r.group==='PAYOUT'?'Изъятие':r.group==='CREDIT'?'Кредит':'Безналичная оплата';return`<tr><td>${fmtDate(r.date)}</td><td>${r.accountId?`<button class="fin-table-account" data-account-id="${esc(r.accountId)}">${esc(name)}</button>`:`<b>${esc(name)}</b>`}<div class="muted">${esc(r.accountId||'')}</div></td><td><span class="fin-op ${r.expense?'out':'in'}">${op}</span></td><td class="plus">${r.income?'+ '+money(r.income):'—'}</td><td class="minus">${r.expense?'− '+money(r.expense):'—'}</td><td class="muted">${esc(r.comment||'—')}</td></tr>`}).join(''):'<tr><td colspan="6" class="fin-empty">Проводки не найдены</td></tr>';
  document.querySelectorAll('.fin-table-account').forEach(b=>b.addEventListener('click',()=>openAccount(b.dataset.accountId)));
}

function openAccount(id){
  const a=accountItems.find(x=>String(x.id)===String(id));
  if(!a)return;
  const mr=movementRowsForAccount(id).sort((x,y)=>String(y.date).localeCompare(String(x.date)));
  const income=mr.reduce((s,r)=>s+r.income,0),expense=mr.reduce((s,r)=>s+r.expense,0),result=income-expense;
  $('fin-modal-title').textContent=a.name||'Счёт';
  $('fin-modal-meta').textContent=[a.code?`Код: ${a.code}`:null,typeName(a.type),a.system?'Системный':'Пользовательский'].filter(Boolean).join(' · ');
  $('fin-modal-income').textContent=money(income);
  $('fin-modal-expense').textContent=money(expense);
  $('fin-modal-result').textContent=(result<0?'− ':'')+money(Math.abs(result));
  $('fin-modal-result').className=result<0?'negative':'';
  $('fin-modal-count').textContent=mr.length;
  const from=$('fin-from').value,to=$('fin-to').value;
  $('fin-modal-period').textContent=from&&to?`${fmtDate(from)} — ${fmtDate(to)}`:'—';
  $('fin-modal-body').innerHTML=mr.length?mr.map(r=>{const op=r.group==='PAYIN'?'Внесение':r.group==='PAYOUT'?'Изъятие':r.group==='CREDIT'?'Кредит':'Безналичная оплата';return`<tr><td>${fmtDate(r.date)}</td><td><span class="fin-op ${r.expense?'out':'in'}">${op}</span></td><td class="plus">${r.income?'+ '+money(r.income):'—'}</td><td class="minus">${r.expense?'− '+money(r.expense):'—'}</td><td class="muted">${esc(r.comment||'—')}</td></tr>`}).join(''):'<tr><td colspan="5" class="fin-empty">За выбранный период движений по этому счёту нет.</td></tr>';
  const modal=$('fin-account-modal');modal.classList.add('open');modal.setAttribute('aria-hidden','false');document.body.classList.add('fin-modal-open');
}
function closeAccount(){const modal=$('fin-account-modal');modal.classList.remove('open');modal.setAttribute('aria-hidden','true');document.body.classList.remove('fin-modal-open')}

function dayList(from,to){const a=[];let d=new Date(`${from}T00:00:00Z`),end=new Date(`${to}T00:00:00Z`);while(d<=end){a.push(iso(d));d.setUTCDate(d.getUTCDate()+1)}return a}
async function load(){
  const c=conn();
  if(!c?.ip||!c?.port||!c?.login||!c?.password){status('Нет сохранённого подключения к SH Server.','error');return}
  const from=$('fin-from').value,to=$('fin-to').value;
  if(!from||!to){status('Укажите период.','error');return}
  if(from>to){status('Дата окончания не может быть раньше даты начала.','error');return}
  const dates=dayList(from,to);if(dates.length>62){status('Максимальный период — 62 дня.','error');return}
  const b=$('fin-load');b.disabled=true;rows=[];shifts=[];status(`Получаем данные за ${dates.length} ${dates.length===1?'день':'дн.'}…`);
  try{
    const a=await post(ACCOUNTS,{ip:c.ip,port:c.port,login:c.login,password:c.password,includeDeleted:false});
    accountItems=a.accounts||[];accounts=new Map(accountItems.map(x=>[String(x.id),x.name]));
    const types=[...new Set(accountItems.map(x=>x.type).filter(Boolean))].sort();
    $('fin-account-type').innerHTML='<option value="">Все типы</option>'+types.map(t=>`<option value="${esc(t)}">${esc(typeName(t))}</option>`).join('');
    renderAccounts();
    const found=[];let shiftErrors=0;
    for(let i=0;i<dates.length;i++){const day=dates[i];status(`Получаем смены: ${fmtDate(day)} (${i+1}/${dates.length})…`);try{const d=await post(SHIFT,{ip:c.ip,port:c.port,login:c.login,password:c.password,from:day,to:day});found.push(...(d.shifts||[]))}catch(e){shiftErrors++}}
    const unique=new Map();for(const s of found){const id=String(s._sessionId||s.id||JSON.stringify(s));if(!unique.has(id))unique.set(id,s)}
    const list=[...unique.values()],details=[];
    for(let i=0;i<list.length;i++){const s=list[i];status(`Получаем детали смен: ${i+1}/${list.length}…`);try{details.push(await post(DETAIL,{ip:c.ip,port:c.port,login:c.login,password:c.password,sessionId:s._sessionId||s.id}))}catch(e){details.push({success:false,error:e.message,shift:s})}}
    shifts=details;
    for(const item of shifts){if(!item.success)continue;const sh=item.shift||{};const baseDate=String(sh.openDate||item.operationDay||'').slice(0,10)||String(from);const sales=num(sh.salesCash)+num(sh.salesCredit)+num(sh.salesCard);if(sales)addMovement(baseDate,null,'CARD',sales,'Продажи за смену',sh);if(num(sh.payIn))addMovement(baseDate,null,'PAYIN',sh.payIn,'Внесения за смену',sh);if(num(sh.payOut))addMovement(baseDate,null,'PAYOUT',sh.payOut,'Изъятия за смену',sh);if(num(sh.payIncome))addMovement(baseDate,null,'PAYOUT',Math.abs(num(sh.payIncome)),'Изъятие при закрытии смены',sh);for(const p of(item.payments||[]))addMovement(p.date||p.creationDate||baseDate,p.accountId,p.group,p.sum,p.comment,sh)}
    render();
    const failed=shifts.filter(x=>!x.success).length;
    status(`Загружено ${list.length} смен, ${rows.length} движений.${failed?` Не удалось получить детали: ${failed}.`:''}${shiftErrors?` Ошибки дней: ${shiftErrors}.`:''}`,'ok');
  }catch(e){render();status(e.message||'Ошибка загрузки финансов','error')}finally{b.disabled=false}
}

function bind(){
  ensureFinanceStyles();
  const now=new Date(),prior=new Date(now);prior.setDate(now.getDate()-6);
  $('fin-from').value=iso(prior);$('fin-to').value=iso(now);
  $('fin-load').addEventListener('click',load);
  $('fin-account-search').addEventListener('input',renderAccounts);
  $('fin-account-type').addEventListener('change',renderAccounts);
  document.querySelectorAll('.fin-tabs a').forEach(a=>a.addEventListener('click',()=>{document.querySelectorAll('.fin-tabs a').forEach(x=>x.classList.remove('active'));a.classList.add('active')}));
  document.querySelectorAll('[data-fin-close]').forEach(el=>el.addEventListener('click',closeAccount));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAccount()});
  load();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();
