(function(){
'use strict';

const ACCOUNTS='/api/iiko/accounts';
const POSTINGS='/api/iiko/account-postings';
const $=id=>document.getElementById(id);
let accountItems=[];
let currentBinding=null;
let currentAccount=null;
const expanded=new Set();

const TYPES={
  CASH:'Денежные средства',
  ACCOUNTS_RECEIVABLE:'Дебиторская задолженность',
  DEBTS_OF_EMPLOYEES:'Долги сотрудников',
  CURRENT_ASSET:'Текущие активы',
  OTHER_CURRENT_ASSET:'Основные средства',
  INVENTORY_ASSETS:'Складские запасы',
  EMPLOYEES_LIABILITY:'Расчёты с сотрудниками',
  ACCOUNTS_PAYABLE:'Расчёты с поставщиками',
  CLIENTS_LIABILITY:'Расчёты с гостями',
  OTHER_CURRENT_LIABILITY:'Прочие текущие обязательства',
  LONG_TERM_LIABILITY:'Долгосрочные обязательства',
  EQUITY:'Капитал',
  COST_OF_GOODS_SOLD:'Себестоимость / прямые издержки',
  INCOME:'Доходы',
  EXPENSES:'Расходы',
  OTHER_INCOME:'Прочие доходы',
  OTHER_EXPENSES:'Прочие расходы'
};

const GROUPS={
  assets:{title:'Активы',types:['CASH','ACCOUNTS_RECEIVABLE','DEBTS_OF_EMPLOYEES','CURRENT_ASSET','OTHER_CURRENT_ASSET','INVENTORY_ASSETS']},
  liabilities:{title:'Обязательства',types:['EMPLOYEES_LIABILITY','ACCOUNTS_PAYABLE','CLIENTS_LIABILITY','OTHER_CURRENT_LIABILITY','LONG_TERM_LIABILITY']},
  income:{title:'Доходы',types:['INCOME','OTHER_INCOME']},
  expenses:{title:'Расходы',types:['COST_OF_GOODS_SOLD','EXPENSES','OTHER_EXPENSES']},
  equity:{title:'Капитал',types:['EQUITY']}
};

const money=n=>Number(n||0).toLocaleString('ru-RU',{minimumFractionDigits:0,maximumFractionDigits:2});
const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const clean=v=>String(v??'').trim();
const fmtDate=v=>{
  if(!v)return'—';
  const p=String(v).slice(0,10).split('-');
  return p.length===3?p[2]+'.'+p[1]+'.'+p[0]:String(v);
};
const typeName=t=>TYPES[String(t||'').toUpperCase()]||t||'—';

async function getIikoBinding(){
  if(window.SH_IikoContext?.getBinding)return await window.SH_IikoContext.getBinding();
  const state=window.SH_IikoContext?.get?await window.SH_IikoContext.get():null;
  const identity=state?.identity||{},connection=state?.connection||{};
  const ids=[
    ...(Array.isArray(identity.departmentIds)?identity.departmentIds:[]),
    ...(Array.isArray(connection.departmentIds)?connection.departmentIds:[])
  ];
  if(!ids.length&&identity.organizationId)ids.push(identity.organizationId);
  if(!ids.length&&connection.organizationId)ids.push(connection.organizationId);
  return{connection,departmentIds:[...new Set(ids.map(String).map(x=>x.trim()).filter(Boolean))]};
}

function status(text,kind=''){
  const el=$('fin-status');
  if(!el)return;
  el.textContent=text;
  el.className='fin-status '+kind;
}
function modalStatus(text,kind=''){
  const el=$('fin-modal-status');
  if(!el)return;
  el.textContent=text;
  el.className='fin-modal-status '+kind;
}
async function getAuthToken(){
  const client=await window.SHAuth?.createClient?.();if(!client)return'';
  const{data}=await client.auth.getSession();return data?.session?.access_token||'';
}
async function post(url,body,timeout=90000){
  const token=await getAuthToken();
  const r=await (window.SH_IikoContext?.fetchWithTimeout||fetch)(url,{
    method:'POST',
    headers:{'Content-Type':'application/json','Accept':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
    body:JSON.stringify(body)
  },timeout);
  const raw=await r.text();
  let data={};
  try{data=raw?JSON.parse(raw):{}}
  catch(_){throw new Error('HTTP '+r.status+': '+raw.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,220))}
  if(!r.ok||!data.success)throw new Error(data.message||('HTTP '+r.status));
  return data;
}

function accountById(id){return accountItems.find(a=>String(a.id)===String(id))||null}
function balanceFor(a){return Number(a?.balance||0)}
function parentId(a){return clean(a?.accountParentId||a?.parentId)}
function groupAccounts(key){
  const types=new Set(GROUPS[key].types);
  return accountItems.filter(a=>types.has(String(a.type||'').toUpperCase()));
}
function accountSort(a,b){
  return String(a.code||'').localeCompare(String(b.code||''),'ru',{numeric:true,sensitivity:'base'})
    ||String(a.name||'').localeCompare(String(b.name||''),'ru');
}
function groupBalance(key){
  const list=groupAccounts(key);
  const ids=new Set(list.map(a=>String(a.id)));
  const parents=new Set(list.map(parentId).filter(id=>ids.has(id)));
  const leaves=list.filter(a=>!parents.has(String(a.id)));
  const source=leaves.length?leaves:list;
  return source.reduce((sum,a)=>sum+balanceFor(a),0);
}
function renderSummary(){
  const map={assets:'sum-assets',liabilities:'sum-liabilities',income:'sum-income',expenses:'sum-expenses',equity:'sum-equity'};
  Object.entries(map).forEach(([key,id])=>{const el=$(id);if(el)el.textContent=money(groupBalance(key))+' ₼'});
}

function groupTree(key){
  const list=groupAccounts(key).slice().sort(accountSort);
  const ids=new Set(list.map(a=>String(a.id)));
  const children=new Map();
  const roots=[];
  list.forEach(a=>{
    const pid=parentId(a);
    if(pid&&ids.has(pid)){
      if(!children.has(pid))children.set(pid,[]);
      children.get(pid).push(a);
    }else roots.push(a);
  });
  for(const arr of children.values())arr.sort(accountSort);
  roots.sort(accountSort);
  return{list,roots,children};
}
function searchVisibleSet(tree,query){
  if(!query)return null;
  const q=query.toLowerCase();
  const visible=new Set();
  tree.list.forEach(a=>{
    const text=[a.code,a.name,a.type,typeName(a.type)].join(' ').toLowerCase();
    if(!text.includes(q))return;
    let cur=a;
    while(cur){
      visible.add(String(cur.id));
      const pid=parentId(cur);
      cur=pid?accountById(pid):null;
    }
  });
  return visible;
}
function renderTreeNode(a,children,depth,searchVisible){
  const id=String(a.id);
  const kids=children.get(id)||[];
  if(searchVisible&&!searchVisible.has(id))return'';
  const open=searchVisible?true:expanded.has(id);
  const hasKids=kids.length>0;
  const childHtml=hasKids&&open?kids.map(x=>renderTreeNode(x,children,depth+1,searchVisible)).join(''):'';
  return '<div class="fin-tree-node" data-node-id="'+esc(id)+'">'+
    '<div class="fin-tree-row" style="--tree-depth:'+depth+'">'+
      '<button class="fin-tree-toggle '+(hasKids?'':'empty')+'" type="button" data-toggle-id="'+esc(id)+'">'+(hasKids?(open?'⌄':'›'):'·')+'</button>'+
      '<button class="fin-tree-account" type="button" data-open-id="'+esc(id)+'">'+
        '<span class="fin-tree-code">'+esc(clean(a.code)||'—')+'</span>'+
        '<span class="fin-tree-name"><b>'+esc(a.name||id)+'</b><small>'+(hasKids?(kids.length+' дочерних счетов'):(a.system?'Системный счёт':'Счёт'))+'</small></span>'+
        '<span class="fin-tree-type">'+esc(typeName(a.type))+'</span>'+
        '<span class="fin-tree-balance">'+money(balanceFor(a))+' ₼</span>'+
      '</button>'+
    '</div>'+
    (childHtml?'<div class="fin-tree-children">'+childHtml+'</div>':'')+
  '</div>';
}
function renderGroups(){
  const host=$('fin-groups');if(!host)return;
  const query=($('fin-account-search')?.value||'').trim().toLowerCase();
  host.innerHTML=Object.entries(GROUPS).map(([key,g])=>{
    const tree=groupTree(key);
    const visible=searchVisibleSet(tree,query);
    const body=tree.roots.map(a=>renderTreeNode(a,tree.children,0,visible)).join('');
    const count=query?(visible?tree.list.filter(a=>visible.has(String(a.id))).length:0):tree.list.length;
    return '<section class="fin-tree-group fin-tree-group-'+key+'">'+
      '<button class="fin-tree-group-head" type="button" data-group-toggle="'+key+'">'+
        '<span class="fin-tree-group-chevron">⌄</span>'+
        '<span class="fin-tree-group-title"><b>'+esc(g.title)+'</b><small>'+count+' счетов</small></span>'+
        '<strong>'+money(groupBalance(key))+' ₼</strong>'+
      '</button>'+
      '<div class="fin-tree-group-body">'+(body||'<div class="fin-empty">Счета не найдены</div>')+'</div>'+
    '</section>';
  }).join('');

  host.querySelectorAll('[data-toggle-id]').forEach(btn=>btn.addEventListener('click',e=>{
    e.stopPropagation();
    const id=btn.dataset.toggleId;
    const hasKids=accountItems.some(x=>parentId(x)===id);
    if(!hasKids)return;
    if(expanded.has(id))expanded.delete(id);else expanded.add(id);
    renderGroups();
  }));
  host.querySelectorAll('[data-open-id]').forEach(btn=>btn.addEventListener('click',()=>openAccount(btn.dataset.openId)));
  host.querySelectorAll('[data-group-toggle]').forEach(btn=>btn.addEventListener('click',()=>{
    const group=btn.closest('.fin-tree-group');
    const body=group?.querySelector('.fin-tree-group-body');
    if(!body)return;
    body.hidden=!body.hidden;
    const chevron=btn.querySelector('.fin-tree-group-chevron');
    if(chevron)chevron.textContent=body.hidden?'›':'⌄';
  }));
}
function expandAll(){
  accountItems.forEach(a=>{if(accountItems.some(x=>parentId(x)===String(a.id)))expanded.add(String(a.id))});
  renderGroups();
}
function collapseAll(){expanded.clear();renderGroups()}

function renderPostings(postings){
  const body=$('fin-modal-body');if(!body)return;
  if(!postings.length){
    body.innerHTML='<tr><td colspan="10" class="fin-empty">За выбранный период проводок по этому счёту нет.</td></tr>';
    return;
  }
  body.innerHTML=postings.map(p=>'<tr>'+
    '<td>'+fmtDate(p.date)+'</td>'+
    '<td>'+esc(p.number||'—')+'</td>'+
    '<td><span class="fin-posting-type">'+esc(p.type||'—')+'</span></td>'+
    '<td>'+esc(p.correspondentAccount||'—')+'</td>'+
    '<td>'+esc(p.correspondentCounteragent||'—')+'</td>'+
    '<td class="muted">'+esc(p.comment||p.concept||'—')+'</td>'+
    '<td class="plus">'+(p.debit?money(p.debit)+' ₼':'—')+'</td>'+
    '<td class="minus">'+(p.credit?money(p.credit)+' ₼':'—')+'</td>'+
    '<td>'+(p.balance===null||p.balance===undefined?'—':money(p.balance)+' ₼')+'</td>'+
    '<td>'+esc(p.department||'—')+'</td>'+
  '</tr>').join('');
}

async function loadCurrentAccountPostings(){
  const a=currentAccount;
  if(!a)return;

  const from=$('fin-modal-from')?.value||'';
  const to=$('fin-modal-to')?.value||'';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to){
    modalStatus('Укажите корректный период проводок.','error');
    return;
  }
  if(periodDays(from,to)>92){
    modalStatus('Период проводок ограничен 92 днями за один запрос.','error');
    return;
  }

  const loadBtn=$('fin-modal-load');
  if(loadBtn)loadBtn.disabled=true;
  $('fin-modal-period').textContent=fmtDate(from)+' — '+fmtDate(to);
  $('fin-modal-debit').textContent='—';
  $('fin-modal-credit').textContent='—';
  $('fin-modal-result').textContent='—';
  $('fin-modal-count').textContent='—';
  $('fin-modal-body').innerHTML='<tr><td colspan="10" class="fin-empty">Загружаем проводки SH Server…</td></tr>';
  modalStatus('Получаем OLAP отчёт по проводкам…');

  try{
    const b=currentBinding||await getIikoBinding();
    currentBinding=b;
    const c=b?.connection;
    const departmentIds=Array.isArray(b?.departmentIds)?b.departmentIds.map(String).filter(Boolean):[];
    const allowedDepartmentIds=Array.isArray(b?.allDepartmentIds)?b.allDepartmentIds.map(String).filter(Boolean):departmentIds;
    const selectedSet=new Set(departmentIds);
    const selectedDepartmentNames=(Array.isArray(b?.restaurants)?b.restaurants:[])
      .filter(x=>selectedSet.has(String(x?.id||'')))
      .map(x=>String(x?.name||'').trim())
      .filter(Boolean);
    const chainScope={
      mode:String(b?.identity?.mode||c?.connectionType||'RMS').toUpperCase(),
      allowedDepartmentIds,
      selectedDepartmentIds:departmentIds,
      selectedDepartmentNames
    };
    const data=await post(POSTINGS,{
      ip:c.ip,port:c.port,login:c.login,password:c.password,
      from,to,accountId:a.id,accountCode:a.code,accountName:a.name,departmentIds,chainScope
    },60000);
    const totals=data.totals||{};
    $('fin-modal-debit').textContent=money(totals.debit||0)+' ₼';
    $('fin-modal-credit').textContent=money(totals.credit||0)+' ₼';
    const change=Number(totals.change||0);
    $('fin-modal-result').textContent=(change<0?'− ':'')+money(Math.abs(change))+' ₼';
    $('fin-modal-count').textContent=String(data.count||0);
    renderPostings(data.postings||[]);
    modalStatus('Проводки загружены из SH OLAP · '+(data.count||0)+' строк.','ok');
  }catch(error){
    modalStatus(error.message||'Не удалось загрузить проводки','error');
    $('fin-modal-body').innerHTML='<tr><td colspan="10" class="fin-empty fin-error-cell">'+esc(error.message||'Ошибка загрузки проводок')+'</td></tr>';
  }finally{
    if(loadBtn)loadBtn.disabled=false;
  }
}

async function openAccount(id){
  const a=accountById(id);if(!a)return;
  currentAccount=a;
  const modal=$('fin-account-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
  document.body.classList.add('fin-modal-open');

  $('fin-modal-title').textContent=[a.code,a.name].filter(Boolean).join(' · ')||'Счёт';
  $('fin-modal-meta').textContent=[typeName(a.type),a.system?'Системный':'Пользовательский'].filter(Boolean).join(' · ');
  $('fin-modal-balance').textContent=money(balanceFor(a))+' ₼';

  // New account starts with the page period, then the drawer can be changed independently.
  const pageFrom=$('fin-from').value;
  const pageTo=$('fin-to').value;
  $('fin-modal-from').value=pageFrom;
  $('fin-modal-to').value=pageTo;

  await loadCurrentAccountPostings();
}
function closeAccount(){
  const modal=$('fin-account-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
  document.body.classList.remove('fin-modal-open');
  currentAccount=null;
}
function nowIikoTimestamp(){
  const d=new Date(),p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds());
}
function periodDays(from,to){
  const a=new Date(from+'T00:00:00Z'),b=new Date(to+'T00:00:00Z');
  return Math.floor((b-a)/86400000)+1;
}

async function load(){
  const binding=await getIikoBinding();
  currentBinding=binding;
  const c=binding?.connection;
  const departmentIds=Array.isArray(binding?.departmentIds)?binding.departmentIds.map(String).filter(Boolean):[];
  if(!c?.ip||!c?.port||!c?.login||!c?.password){status('Нет сохранённого подключения к SH Server.','error');return}
  const from=$('fin-from').value,to=$('fin-to').value;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to){status('Укажите корректный период.','error');return}
  if(periodDays(from,to)>92){status('Для проводок выберите период не более 92 дней.','error');return}

  const btn=$('fin-load');btn.disabled=true;
  try{
    status('Получаем план счетов и балансы SH Server…');
    const data=await post(ACCOUNTS,{
      ip:c.ip,port:c.port,login:c.login,password:c.password,
      includeDeleted:false,timestamp:nowIikoTimestamp(),departmentIds
    });
    accountItems=(data.accounts||[]).map(a=>({...a,id:String(a.id),accountParentId:a.accountParentId?String(a.accountParentId):null}));
    expanded.clear();
    accountItems.forEach(a=>{
      if(!parentId(a)&&accountItems.some(x=>parentId(x)===String(a.id)))expanded.add(String(a.id));
    });
    renderSummary();
    renderGroups();
    status('Готово: '+accountItems.length+' счетов. Нажмите на счёт, чтобы открыть дебет, кредит и проводки за период.','ok');
  }catch(error){
    status(error.message||'Ошибка загрузки плана счетов','error');
  }finally{
    btn.disabled=false;
  }
}

function init(){
  const now=new Date(),to=now.toISOString().slice(0,10),d=new Date(now);
  d.setDate(d.getDate()-6);
  $('fin-from').value=d.toISOString().slice(0,10);
  $('fin-to').value=to;
  $('fin-load').addEventListener('click',load);
  $('fin-account-search').addEventListener('input',renderGroups);
  $('fin-modal-load')?.addEventListener('click',loadCurrentAccountPostings);
  document.querySelectorAll('[data-fin-period]').forEach(btn=>btn.addEventListener('click',()=>{
    if(!currentAccount)return;
    const mode=btn.dataset.finPeriod;
    const today=new Date();
    const toDate=new Date(today.getFullYear(),today.getMonth(),today.getDate());
    let fromDate=new Date(toDate);

    if(mode==='today'){
      fromDate=new Date(toDate);
    }else if(mode==='month'){
      fromDate=new Date(toDate.getFullYear(),toDate.getMonth(),1);
    }else{
      const days=Math.max(1,Number(mode)||7);
      fromDate.setDate(fromDate.getDate()-(days-1));
    }

    const ymd=d=>d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
    $('fin-modal-from').value=ymd(fromDate);
    $('fin-modal-to').value=ymd(toDate);
    loadCurrentAccountPostings();
  }));
  $('fin-expand-all')?.addEventListener('click',expandAll);
  $('fin-collapse-all')?.addEventListener('click',collapseAll);
  document.querySelectorAll('[data-fin-close]').forEach(x=>x.addEventListener('click',closeAccount));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeAccount()});
  renderSummary();
  renderGroups();
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();