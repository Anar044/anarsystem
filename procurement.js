(()=>{
'use strict';

const $=id=>document.getElementById(id);
const state={
  token:'',binding:null,data:null,refs:{suppliers:[],warehouses:[],products:[]},
  stockRows:[],purchaseRows:[],needs:[],historyDocs:[],supplierBalances:new Map(),latestByProduct:new Map(),priceBySupplierProduct:new Map(),
  productById:new Map(),productLabelToId:new Map(),selectedNeeds:new Set(),
  normDrafts:new Map(),dirtyNorms:new Set(),busy:false,tab:'needs',view:'catalog',cacheWarnings:[]
};

const key=v=>String(v??'').trim().replace(/^\{+|\}+$/g,'').toLowerCase();
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=(v,f=0)=>{const n=Number(v);return Number.isFinite(n)?n:f};
const qty=v=>num(v).toLocaleString('ru-RU',{maximumFractionDigits:3});
const money=v=>num(v).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' ₼';
const today=()=>new Date().toISOString().slice(0,10);
const addDays=(date,days)=>{const d=new Date(date+'T12:00:00');d.setDate(d.getDate()+Number(days||0));return d.toISOString().slice(0,10)};
const daysAgo=n=>{const d=new Date();d.setDate(d.getDate()-n);return d.toISOString().slice(0,10)};
const statusLabel=s=>({DRAFT:'Черновик',PENDING_APPROVAL:'На согласовании',APPROVED:'Согласовано',PARTIALLY_ORDERED:'Частично заказано',ORDERED:'Заказано',PARTIALLY_FULFILLED:'Частично выполнено',SENT:'Отправлен',CONFIRMED:'Подтверждён',PARTIALLY_RECEIVED:'Частично принят',COMPLETED:'Выполнен',CLOSED:'Закрыт вручную',CANCELLED:'Отменён'}[s]||s||'—');
const statusTone=s=>['CANCELLED','CLOSED'].includes(s)?(s==='CANCELLED'?'danger':'neutral'):['COMPLETED','APPROVED','ORDERED'].includes(s)?'success':['PENDING_APPROVAL','SENT','CONFIRMED','PARTIALLY_RECEIVED','PARTIALLY_ORDERED','PARTIALLY_FULFILLED'].includes(s)?'warn':'neutral';
const matchLabel=s=>({OPEN:'Ожидает приёмки',PARTIAL:'Частичная приёмка',MATCHED:'PO = приёмка = накладная',PRICE_MISMATCH:'Расхождение цены',QUANTITY_MISMATCH:'Расхождение количества'}[s]||s||'—');
const approvalName=s=>({MANAGER:'Менеджер',DIRECTOR:'Директор',OWNER:'Владелец'}[s]||s||'—');

const PROCUREMENT_VIEWS=new Set(['catalog','requests','approvals','sourcing','suppliers','orders','receiving','analytics','norms','settings']);
function currentProcurementView(){
  const raw=new URLSearchParams(location.search).get('view')||'catalog';
  return PROCUREMENT_VIEWS.has(raw)?raw:'catalog';
}
function viewPanel(view){
  if(view==='catalog')return'needs';
  if(view==='norms')return'norms';
  if(['requests','approvals','sourcing'].includes(view))return'requisitions';
  if(view==='suppliers')return'suppliers';
  if(['orders','receiving'].includes(view))return'orders';
  return view;
}
function procurementCacheKey(kind){
  const b=state.binding||{},conn=b.connection||{},scope=(b.departmentIds||[]).map(String).sort().join(',');
  return 'shProcurementCache:'+kind+':'+String(conn.ip||'')+':'+String(conn.port||'')+':'+scope;
}
function saveLocalCache(kind,value){
  try{localStorage.setItem(procurementCacheKey(kind),JSON.stringify({savedAt:new Date().toISOString(),value}))}catch(e){console.warn('Procurement cache save failed',kind,e)}
}
function readLocalCache(kind){
  try{
    const raw=localStorage.getItem(procurementCacheKey(kind));if(!raw)return null;
    const parsed=JSON.parse(raw);return parsed&&parsed.value?parsed:null;
  }catch(e){return null}
}
function cacheAgeLabel(savedAt){
  if(!savedAt)return '';
  const ms=Date.now()-new Date(savedAt).getTime(),m=Math.max(0,Math.round(ms/60000));
  if(m<60)return m+' мин. назад';
  const h=Math.round(m/60);if(h<48)return h+' ч. назад';
  return Math.round(h/24)+' дн. назад';
}
function ensureProcurementSidebarOpen(){
  const group=document.querySelector('.procurement-nav-group');if(!group)return;
  const sub=group.querySelector('.documents-subnav'),toggle=group.querySelector('.documents-nav-toggle');
  group.classList.add('open');if(sub)sub.hidden=false;if(toggle){toggle.classList.add('active');toggle.setAttribute('aria-expanded','true')}
  const view=state.view||currentProcurementView();
  group.querySelectorAll('[data-procurement-view]').forEach(a=>a.classList.toggle('active',a.dataset.procurementView===view));
}
function viewMeta(view){
  return({
    catalog:{title:'Заказать товары',subtitle:'Каталог, остатки и автоматическая потребность'},
    requests:{title:'Заявки на закупку',subtitle:'Создание PR и контроль статуса своих заявок'},
    approvals:{title:'Согласование заявок',subtitle:'Заявки, ожидающие решения'},
    sourcing:{title:'RFQ и сравнение цен',subtitle:'Запросы цен, предложения поставщиков и создание PO'},
    suppliers:{title:'Поставщики',subtitle:'Реквизиты, контакты, условия оплаты, поставки и договоры'},
    orders:{title:'Заказы поставщикам',subtitle:'Отправка PO и контроль подтверждения'},
    receiving:{title:'Приёмка поставок',subtitle:'Фактическое количество, накладные и расхождения'},
    analytics:{title:'Аналитика закупок',subtitle:'Исполнение, суммы и поставщики'},
    norms:{title:'Нормы запаса',subtitle:'Min и целевой остаток по товару и складу'},
    settings:{title:'Настройки закупок',subtitle:'Лимиты согласования и правила процесса'}
  })[view]||{title:'Закупки',subtitle:''};
}
function applyProcurementView(){
  state.view=currentProcurementView();
  const panel=viewPanel(state.view);state.tab=panel;
  const meta=viewMeta(state.view);
  const hero=document.querySelector('.proc-hero h1');if(hero)hero.textContent=meta.title;
  const heroP=document.querySelector('.proc-hero p');if(heroP)heroP.textContent=meta.subtitle;
  const flow=document.querySelector('.proc-flow'),kpis=document.querySelector('.proc-kpis'),tabs=document.querySelector('.proc-tabs');
  if(tabs)tabs.style.display='none';
  const newPr=$('proc-new-pr');if(newPr)newPr.style.display=['catalog','requests'].includes(state.view)?'':'none';
  const compact=state.view!=='catalog';
  if(flow)flow.style.display=compact?'none':'';
  if(kpis)kpis.style.display=compact?'none':'';
  document.querySelectorAll('[data-panel]').forEach(p=>p.hidden=p.dataset.panel!==panel);
  if(state.view==='requests'||state.view==='approvals'||state.view==='sourcing')renderRequisitions();
  if(state.view==='orders'||state.view==='receiving')renderOrders();
  if(state.view==='suppliers')renderSuppliers();
  ensureProcurementSidebarOpen();
  setTimeout(ensureProcurementSidebarOpen,100);
}
function goProcurementView(view){location.href='/procurement.html?view='+encodeURIComponent(view)}

function setStatus(text,kind=''){
  const el=$('proc-status');if(!el)return;
  el.textContent=text||'';el.className='proc-status'+(text?' show':'')+(kind?' '+kind:'');
}
function setBusy(v){state.busy=!!v;document.querySelectorAll('.proc-btn').forEach(b=>{if(b.dataset.noBusy!=='1')b.disabled=!!v})}
function closeModal(){$('proc-modal').hidden=true;$('proc-modal-body').innerHTML=''}
function openModal(title,eyebrow,html){
  $('proc-modal-title').textContent=title;$('proc-modal-eyebrow').textContent=eyebrow||'ЗАКУПКИ';
  $('proc-modal-body').innerHTML=html;$('proc-modal').hidden=false;
}
function toast(message,kind='ok'){setStatus(message,kind);if(kind==='ok')setTimeout(()=>{if($('proc-status')?.textContent===message)setStatus('')},3500)}

async function authToken(){
  const client=await window.SHAuth?.createClient?.();if(!client)throw Error('Supabase Auth не готов');
  const {data,error}=await client.auth.getSession();const token=data?.session?.access_token;
  if(error||!token)throw Error('Сессия пользователя не найдена');return token;
}
async function authFetch(url,options={}){
  const headers=new Headers(options.headers||{});headers.set('Authorization','Bearer '+state.token);
  if(options.body&&!headers.has('Content-Type'))headers.set('Content-Type','application/json');
  return (window.SH_IikoContext?.fetchWithTimeout||fetch)(url,{...options,headers},options.timeoutMs||45000);
}
async function procPost(action,payload={}){
  const r=await authFetch('/api/procurement',{method:'POST',body:JSON.stringify({action,...payload}),cache:'no-store'});
  const j=await r.json().catch(()=>({}));if(!r.ok||j.success===false)throw Error(j.message||('HTTP '+r.status));return j;
}
function normId(storeId,productId){return key(storeId)+'|'+key(productId)}
function seedNormDrafts(){
  state.normDrafts=new Map();
  for(const x of state.data?.stockNorms||[]){
    state.normDrafts.set(normId(x.storeId,x.productId),{
      storeId:key(x.storeId),storeName:x.storeName||'',productId:key(x.productId),productName:x.productName||'',unit:x.unit||'',
      minStock:x.minStock,targetStock:x.targetStock,leadDays:num(x.leadDays),enabled:x.enabled!==false,persisted:true
    });
  }
  state.dirtyNorms=new Set();
}
async function loadProcurement(){
  const view=state.view||currentProcurementView();
  const r=await authFetch('/api/procurement?view='+encodeURIComponent(view),{method:'GET',cache:'no-store'});const j=await r.json().catch(()=>({}));
  if(!r.ok||j.success===false)throw Error(j.message||('HTTP '+r.status));state.data=j;seedNormDrafts();return j;
}
function chainScope(){
  const b=state.binding||{},selected=Array.isArray(b.departmentIds)?b.departmentIds.map(String):[],allowed=Array.isArray(b.allDepartmentIds)?b.allDepartmentIds.map(String):selected;
  const mode=String(b.identity?.mode||b.connection?.connectionType||'RMS').toUpperCase();
  const selectedNames=(b.restaurants||[]).filter(x=>selected.includes(String(x.id))).map(x=>x.name);
  return{mode,selectedDepartmentIds:selected,allowedDepartmentIds:allowed,selectedDepartmentNames:selectedNames};
}
function connectionBody(extra={}){
  const b=state.binding||{},c=b.connection||{};
  return{...c,departmentIds:b.departmentIds||[],chainScope:chainScope(),...extra};
}
async function loadReferences(){
  try{
    const r=await (window.SH_IikoContext?.fetchWithTimeout||fetch)('/api/iiko/invoice-reference-data',{
      method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({connection:state.binding.connection,departmentIds:state.binding.departmentIds||[],chainScope:chainScope()}),cache:'no-store'
    },65000);
    const j=await r.json().catch(()=>({}));if(!r.ok||j.success===false)throw Error('Справочники: '+(j.message||('HTTP '+r.status)));
    state.refs={suppliers:j.suppliers||[],warehouses:j.warehouses||[],products:j.products||[]};
    saveLocalCache('refs',state.refs);
  }catch(e){
    const cached=readLocalCache('refs');
    if(!cached)throw e;
    state.refs=cached.value||{suppliers:[],warehouses:[],products:[]};
    state.cacheWarnings.push('Справочники недоступны — используем кэш '+cacheAgeLabel(cached.savedAt));
    console.warn('Procurement references cache fallback',e);
  }
  state.productById=new Map((state.refs.products||[]).map(x=>[key(x.id),x]));
  state.productLabelToId=new Map();
  for(const p of state.refs.products||[])state.productLabelToId.set(productLabel(p.id,p.name),key(p.id));
  return state.refs;
}
async function loadStocks(){
  try{
    const r=await (window.SH_IikoContext?.fetchWithTimeout||fetch)('/api/iiko/stock-balances',{
      method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify(connectionBody({date:today(),time:'23:59:59',includeZero:true})),cache:'no-store'
    },60000);
    const j=await r.json().catch(()=>({}));if(!r.ok||j.success===false)throw Error('Остатки: '+(j.message||('HTTP '+r.status)));
    state.stockRows=Array.isArray(j.rows)?j.rows:[];
    saveLocalCache('stocks',state.stockRows);
    return j;
  }catch(e){
    const cached=readLocalCache('stocks');
    if(!cached)throw e;
    state.stockRows=Array.isArray(cached.value)?cached.value:[];
    state.cacheWarnings.push('Остатки недоступны — используем кэш '+cacheAgeLabel(cached.savedAt));
    console.warn('Procurement stocks cache fallback',e);
    return{success:true,rows:state.stockRows,cached:true};
  }
}
async function loadSupplierBalances(){
  try{
    const r=await (window.SH_IikoContext?.fetchWithTimeout||fetch)('/api/iiko/supplier-balances',{
      method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify(connectionBody({timestamp:today()+'T23:59:59'})),cache:'no-store'
    },65000);
    const j=await r.json().catch(()=>({}));if(!r.ok||j.success===false)throw Error(j.message||('Баланс поставщиков HTTP '+r.status));
    state.supplierBalances=new Map((j.rows||[]).map(x=>[key(x.id),{debt:num(x.debt),advance:num(x.advance),total:num(x.total),name:x.name||''}]));
  }catch(e){console.warn('Supplier balances unavailable',e);state.supplierBalances=new Map()}
}
async function loadHistory(){
  try{
    const r=await (window.SH_IikoContext?.fetchWithTimeout||fetch)('/api/iiko/incoming-invoices',{
      method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify(connectionBody({from:daysAgo(90),to:today()})),cache:'no-store'
    },75000);
    const j=await r.json().catch(()=>({}));if(!r.ok||j.success===false)throw Error(j.message||('Накладные HTTP '+r.status));
    state.historyDocs=Array.isArray(j.documents)?j.documents:[];buildPriceHistory();
  }catch(e){console.warn('Procurement price history unavailable',e);state.historyDocs=[];buildPriceHistory()}
}
function buildPriceHistory(){
  state.latestByProduct=new Map();state.priceBySupplierProduct=new Map();
  const docs=[...state.historyDocs].sort((a,b)=>String(b.dateIncoming||b.incomingDate||'').localeCompare(String(a.dateIncoming||a.incomingDate||'')));
  for(const d of docs){
    const supplierId=key(d.supplierId),supplierName=d.supplierName||supplierId;
    for(const item of d.items||[]){
      const pid=key(item.productId),price=num(item.price);
      if(!pid||!(price>=0))continue;
      const row={price,supplierId,supplierName,date:d.dateIncoming||d.incomingDate||'',documentNumber:d.documentNumber||''};
      if(!state.latestByProduct.has(pid))state.latestByProduct.set(pid,row);
      const k=supplierId+'|'+pid;if(supplierId&&!state.priceBySupplierProduct.has(k))state.priceBySupplierProduct.set(k,row);
    }
  }
}

function procurementLineFromInvoiceItem(x){
  const packageCount=num(x.amount,0);
  const actualAmount=num(x.actualAmount??x.amount,0);
  let packageSize=num(x.actualUnitWeight,0);
  if(!(packageSize>0))packageSize=packageCount>0?actualAmount/packageCount:1;
  if(!(packageSize>0))packageSize=1;
  const count=packageCount>0?packageCount:(actualAmount>0?actualAmount/packageSize:0);
  const pack=packagingByContainer(x.productId,x.containerId);return{productId:key(x.productId),productName:x.productName||productName(x.productId),unit:x.amountUnit||unitFor(x.productId),quantity:actualAmount||packageSize*count,packageSize,packageCount:count,containerId:key(x.containerId),packageName:pack?.name||pack?.num||'',vatPercent:num(x.vatPercent,0),unitPrice:num(x.price)};
}
function receiptSignature(lines){
  return (lines||[]).map(x=>[key(x.productId),Number(x.quantity??x.actualAmount??x.amount??0).toFixed(3),Number(x.packageSize??x.actualUnitWeight??1).toFixed(3),Number(x.packageCount??x.amount??0).toFixed(3),Number(x.vatPercent??0).toFixed(2),Number(x.unitPrice??x.price??0).toFixed(4)].join(':')).sort().join('|');
}
async function reconcileLinkedReceipts(){
  const receipts=state.data?.receipts||[];if(!receipts.length||!state.historyDocs.length)return false;
  const byNumber=new Map(state.historyDocs.map(d=>[String(d.documentNumber||'').trim().toLowerCase(),d]).filter(x=>x[0]));
  let changed=false;
  for(const receipt of receipts){
    const doc=byNumber.get(String(receipt.iikoDocumentNumber||'').trim().toLowerCase());if(!doc)continue;
    const lines=(doc.items||[]).map(procurementLineFromInvoiceItem).filter(x=>x.productId&&x.quantity>0);
    const sameLines=receiptSignature(lines)===receiptSignature(receipt.lines||[]);
    const sameStatus=String(receipt.iikoStatus||'').toUpperCase()===String(doc.status||'').toUpperCase();
    if(sameLines&&sameStatus)continue;
    try{
      await procPost('sync-receipt',{iikoDocumentNumber:receipt.iikoDocumentNumber,iikoStatus:doc.status||receipt.iikoStatus,documentDate:String(doc.dateIncoming||doc.incomingDate||receipt.documentDate||today()).slice(0,10),comment:doc.comment||receipt.comment||'',lines});
      changed=true;
    }catch(e){console.warn('Receipt reconciliation failed',receipt.iikoDocumentNumber,e)}
  }
  if(changed)await loadProcurement();
  return changed;
}
function unitFor(pid){const r=state.stockRows.find(x=>key(x.productId)===key(pid)&&x.unit);return r?.unit||''}
function productName(pid){return state.productById.get(key(pid))?.name||state.stockRows.find(x=>key(x.productId)===key(pid))?.productName||pid}
function productLabel(pid,name){const id=key(pid);return String(name||productName(id)||id)+(id?' · …'+id.slice(-6):'')}
function productRef(pid){return state.productById.get(key(pid))||null}
function productPackagings(pid){
  const p=productRef(pid),list=Array.isArray(p?.packagings)?p.packagings:[];
  return list.filter(x=>num(x.count)>0);
}
function packagingByContainer(pid,containerId){
  const cid=key(containerId);if(!cid)return null;
  return productPackagings(pid).find(x=>key(x.id)===cid)||null;
}
function packagingChoiceHtml(pid,{containerId='',packageSize=1}={}){
  const packs=productPackagings(pid),cid=key(containerId),size=num(packageSize,1),unit=unitFor(pid)||'';
  if(!packs.length){
    return '<option value="__base__" selected>Основная единица · 1'+(unit?' '+esc(unit):'')+'</option>';
  }
  let matched=false;
  const options=packs.map((p,i)=>{
    const isSelected=(cid&&key(p.id)===cid)||(!cid&&!matched&&Math.abs(num(p.count)-size)<0.0005);
    if(isSelected)matched=true;
    const rawName=String(p.name||p.num||'').trim();
    const label=rawName||(qty(p.count)+(unit?' '+unit:''));
    return '<option value="'+esc(p.id||('__iiko_'+i))+'" '+(isSelected?'selected':'')+'>'+esc(label)+'</option>';
  }).join('');
  if(matched)return options;
  if(packs.length===1)return options.replace('<option ','<option selected ');
  return '<option value="" selected disabled>Выберите фасовку</option>'+options;
}
function syncPackagingRow(row){
  const pid=key(row.dataset.productId),choice=row.querySelector('[data-f="packageChoice"]'),size=row.querySelector('[data-f="packageSize"]'),cid=row.querySelector('[data-f="containerId"]'),pname=row.querySelector('[data-f="packageName"]');
  if(!choice||!size||!cid||!pname)return;
  const oldSize=num(size.value,1),oldCid=key(cid.value);
  choice.innerHTML=packagingChoiceHtml(pid,{containerId:oldCid,packageSize:oldSize});
  applyPackagingChoice(row);
}
function applyPackagingChoice(row){
  const pid=key(row.dataset.productId),choice=row.querySelector('[data-f="packageChoice"]'),size=row.querySelector('[data-f="packageSize"]'),cid=row.querySelector('[data-f="containerId"]'),pname=row.querySelector('[data-f="packageName"]');
  if(!choice||!size||!cid||!pname)return;
  size.readOnly=true;size.classList.add('proc-package-locked');
  if(choice.value==='__base__'){
    size.value='1';cid.value='';pname.value='';return;
  }
  if(!choice.value){
    size.value='0';cid.value='';pname.value='';return;
  }
  const pack=packagingByContainer(pid,choice.value)||productPackagings(pid).find(x=>String(x.id||'')===choice.value);
  if(pack){
    size.value=num(pack.count,1);cid.value=pack.id||'';pname.value=pack.name||pack.num||'';
  }else{
    size.value='0';cid.value='';pname.value='';
  }
}
function historyPrice(pid,supplierId=''){
  if(supplierId){const x=state.priceBySupplierProduct.get(key(supplierId)+'|'+key(pid));if(x)return x}
  return state.latestByProduct.get(key(pid))||null;
}
function computeNeeds(){
  const rows=[];
  for(const r of state.stockRows){
    const id=normId(r.storeId,r.productId),local=state.normDrafts.get(id),amount=num(r.amount),hasLocal=!!(local&&local.persisted);
    const localDisabled=hasLocal&&local.enabled===false;
    const min=hasLocal
      ? (local.minStock===null||local.minStock===undefined?null:num(local.minStock))
      : (r.minAmount===null||r.minAmount===undefined?null:num(r.minAmount));
    const max=hasLocal
      ? (local.targetStock===null||local.targetStock===undefined?null:num(local.targetStock))
      : (r.maxAmount===null||r.maxAmount===undefined?null:num(r.maxAmount));
    const target=min!==null?(max!==null&&max>=min?max:min):null;
    const recommended=(!localDisabled&&min!==null&&amount<min)?Math.max(0,target-amount):0;
    const h=historyPrice(r.productId),price=h?num(h.price):Math.max(0,num(r.unitCost));
    rows.push({
      id,productId:key(r.productId),productName:r.productName||productName(r.productId),productNum:r.productNum||'',
      groupName:r.categoryName||r.groupName||'',unit:r.unit||'',storeId:key(r.storeId),storeName:r.storeName||r.storeId,
      currentStock:amount,minStock:min,maxStock:max,recommendedQty:recommended,lastPrice:price,lastSupplier:h?.supplierName||'',
      estimated:recommended*price,normSource:hasLocal?'SMART_HORECA':(min!==null||max!==null?'SERVER':'NONE'),
      autoRecommended:recommended>0,manualQty:recommended>0?recommended:1
    });
  }
  state.purchaseRows=rows.sort((a,b)=>(b.autoRecommended-a.autoRecommended)||a.storeName.localeCompare(b.storeName,'ru')||a.productName.localeCompare(b.productName,'ru'));
  state.needs=state.purchaseRows.filter(x=>x.autoRecommended);
  const live=new Set(state.purchaseRows.map(x=>x.id));state.selectedNeeds=new Set([...state.selectedNeeds].filter(x=>live.has(x)));
}
function scopeLabel(){
  const s=chainScope(),names=s.selectedDepartmentNames||[];
  $('proc-scope-label').textContent=s.mode==='CHAIN'?(names.length?names.join(', '):'CHAIN'):'Текущий ресторан';
}
function renderAll(){computeNeeds();scopeLabel();renderKpis();renderNeeds();renderNorms();renderRequisitions();renderOrders();renderSuppliers();renderAnalytics();renderSettings()}
function renderKpis(){
  const d=state.data||{},a=d.analytics||{};
  $('proc-kpi-needs').textContent=state.needs.length.toLocaleString('ru-RU');
  $('proc-kpi-needs-sum').textContent=money(state.needs.reduce((s,x)=>s+x.estimated,0))+' оценочно';
  $('proc-kpi-approvals').textContent=num(a.pendingApprovals).toLocaleString('ru-RU');
  $('proc-kpi-orders').textContent=num(a.activeOrders).toLocaleString('ru-RU');
  $('proc-kpi-orders-sum').textContent=money((d.orders||[]).filter(x=>!['COMPLETED','CANCELLED'].includes(x.effectiveStatus)).reduce((s,x)=>s+num(x.totalAmount),0));
  const completed=(d.orders||[]).filter(x=>x.effectiveStatus==='COMPLETED');
  $('proc-kpi-completed').textContent=completed.length.toLocaleString('ru-RU');
  $('proc-kpi-match').textContent=completed.filter(x=>x.matchStatus==='MATCHED').length+' совпали без расхождений';
  $('proc-tab-needs-count').textContent=state.needs.length;$('proc-tab-norms-count').textContent=(d.stockNorms||[]).length;$('proc-tab-pr-count').textContent=(d.requisitions||[]).length;$('proc-tab-po-count').textContent=(d.orders||[]).length;
}
function purchaseMatrixRows(){
  const products=new Map();
  for(const row of state.purchaseRows){
    let p=products.get(row.productId);
    if(!p){
      p={
        productId:row.productId,productName:row.productName,productNum:row.productNum,groupName:row.groupName,unit:row.unit,
        byStore:new Map(),totalStock:0,lastPrice:row.lastPrice,lastSupplier:row.lastSupplier
      };
      products.set(row.productId,p);
    }
    p.byStore.set(row.storeId,row);
    p.totalStock+=num(row.currentStock);
    if(!p.lastPrice&&row.lastPrice){p.lastPrice=row.lastPrice;p.lastSupplier=row.lastSupplier}
  }
  return [...products.values()].sort((a,b)=>a.productName.localeCompare(b.productName,'ru'));
}
function renderNeeds(){
  const store=$('proc-needs-store'),current=store.value;
  const stores=[...new Map(state.purchaseRows.map(x=>[x.storeId,{id:x.storeId,name:x.storeName}])).values()].sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  store.innerHTML='<option value="">Выберите склад</option>'+stores.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');
  const targetStoreId=stores.some(x=>x.id===current)?current:(stores[0]?.id||'');
  if(targetStoreId)store.value=targetStoreId;

  const qv=($('proc-needs-search').value||'').trim().toLowerCase(),filter=$('proc-needs-filter')?.value||'all';
  const matrix=purchaseMatrixRows();
  const visible=matrix.filter(p=>{
    const target=p.byStore.get(targetStoreId);
    if(qv&&![p.productName,p.productNum,p.groupName].join(' ').toLowerCase().includes(qv))return false;
    if(!target)return filter==='all';
    if(filter==='recommended'&&!target.autoRecommended)return false;
    if(filter==='negative'&&!(target.currentStock<0))return false;
    if(filter==='zero'&&Math.abs(target.currentStock)>1e-12)return false;
    if(filter==='no_norm'&&(target.minStock!==null||target.maxStock!==null))return false;
    return true;
  });
  const targetName=stores.find(x=>x.id===targetStoreId)?.name||'склад';
  const recommendedVisible=visible.filter(p=>p.byStore.get(targetStoreId)?.autoRecommended);
  $('proc-needs-meta').textContent=visible.length+' товаров · '+recommendedVisible.length+' требуют закупки на «'+targetName+'»';

  const table=$('proc-needs-table');
  const head=table.querySelector('thead');
  head.innerHTML='<tr><th></th><th>Товар</th>'+
    stores.map(s=>'<th class="proc-store-col '+(s.id===targetStoreId?'target':'')+'">'+esc(s.name)+(s.id===targetStoreId?'<small>склад заказа</small>':'')+'</th>').join('')+
    '<th>Всего</th><th>Min / Max<br><small>'+esc(targetName)+'</small></th><th>Рекомендация</th><th>Последняя цена</th><th></th></tr>';

  const tb=table.querySelector('tbody');
  tb.innerHTML=visible.map(p=>{
    const target=p.byStore.get(targetStoreId);
    const selectedId=target?.id||'';
    const cells=stores.map(s=>{
      const x=p.byStore.get(s.id);
      if(!x)return '<td class="proc-stock-cell empty">—</td>';
      const cls=x.currentStock<0?'proc-negative':Math.abs(x.currentStock)<=1e-12?'proc-low':'proc-good';
      return '<td class="proc-stock-cell '+(s.id===targetStoreId?'target ':'')+cls+'"><strong>'+qty(x.currentStock)+'</strong><small>'+esc(x.unit||p.unit)+(x.autoRecommended?' · ↓ '+qty(x.recommendedQty):'')+'</small></td>';
    }).join('');
    const minmax=target
      ? (target.minStock===null?'—':qty(target.minStock))+' / '+(target.maxStock===null?'—':qty(target.maxStock))+
        (target.normSource!=='NONE'?'<small>'+(target.normSource==='SMART_HORECA'?'Smart Horeca':'Server')+'</small>':'')
      : '—';
    const recommendation=target?.autoRecommended
      ? '<strong>'+qty(target.recommendedQty)+' '+esc(target.unit)+'</strong><small>авторекомендация</small>'
      : '<span class="proc-status-badge neutral">Ручной заказ</span>';
    const price=target?.lastPrice||p.lastPrice;
    const supplier=target?.lastSupplier||p.lastSupplier;
    return '<tr>'+
      '<td><input class="proc-need-check" type="checkbox" data-need="'+esc(selectedId)+'" '+(selectedId&&state.selectedNeeds.has(selectedId)?'checked':'')+' '+(!selectedId?'disabled':'')+'></td>'+
      '<td><strong>'+esc(p.productName)+'</strong><small>'+esc([p.productNum,p.groupName].filter(Boolean).join(' · ')||p.productId)+'</small></td>'+
      cells+
      '<td class="'+(p.totalStock<0?'proc-negative':Math.abs(p.totalStock)<=1e-12?'proc-low':'proc-good')+'"><strong>'+qty(p.totalStock)+'</strong><small>'+esc(p.unit)+'</small></td>'+
      '<td>'+minmax+'</td>'+
      '<td>'+recommendation+'</td>'+
      '<td>'+(price?money(price):'—')+(supplier?'<small>'+esc(supplier)+'</small>':'')+'</td>'+
      '<td>'+(selectedId?'<button class="proc-btn small '+(target?.autoRecommended?'primary':'ghost')+'" data-create-need="'+esc(selectedId)+'">'+(target?.autoRecommended?'Создать PR':'В PR')+'</button>':'—')+'</td></tr>';
  }).join('')||'<tr><td colspan="'+(stores.length+7)+'" class="proc-empty">Товары по выбранному фильтру не найдены.</td></tr>';
  $('proc-create-selected').disabled=state.selectedNeeds.size===0;
}
function normRows(){
  const map=new Map();
  for(const r of state.stockRows){
    const id=normId(r.storeId,r.productId);
    map.set(id,{
      id,storeId:key(r.storeId),storeName:r.storeName||r.storeId,productId:key(r.productId),productName:r.productName||productName(r.productId),
      productNum:r.productNum||'',groupName:r.categoryName||r.groupName||'',unit:r.unit||'',currentStock:num(r.amount),
      serverMin:r.minAmount===null||r.minAmount===undefined?null:num(r.minAmount),serverMax:r.maxAmount===null||r.maxAmount===undefined?null:num(r.maxAmount)
    });
  }
  for(const x of state.data?.stockNorms||[]){
    const id=normId(x.storeId,x.productId);
    if(!map.has(id))map.set(id,{id,storeId:key(x.storeId),storeName:x.storeName||x.storeId,productId:key(x.productId),productName:x.productName||productName(x.productId),productNum:'',groupName:'',unit:x.unit||'',currentStock:0,serverMin:null,serverMax:null});
  }
  return [...map.values()].sort((a,b)=>a.storeName.localeCompare(b.storeName,'ru')||a.productName.localeCompare(b.productName,'ru'));
}
function effectiveNormDraft(row){
  const draft=state.normDrafts.get(row.id);
  if(draft)return draft;
  return{
    storeId:row.storeId,storeName:row.storeName,productId:row.productId,productName:row.productName,unit:row.unit,
    minStock:row.serverMin,targetStock:row.serverMax,leadDays:num(state.data?.settings?.defaultLeadDays,2),enabled:true,persisted:false
  };
}
function renderNorms(){
  const table=$('proc-norms-table');if(!table)return;
  const rows=normRows(),store=$('proc-norms-store'),current=store.value;
  const stores=[...new Map(rows.map(x=>[x.storeId,{id:x.storeId,name:x.storeName}])).values()].sort((a,b)=>a.name.localeCompare(b.name,'ru'));
  store.innerHTML='<option value="">Все склады</option>'+stores.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('');if(stores.some(x=>x.id===current))store.value=current;
  const qv=($('proc-norms-search').value||'').trim().toLowerCase(),sid=store.value,filter=$('proc-norms-filter').value;
  const visible=rows.filter(row=>{
    const d=effectiveNormDraft(row),configured=!!d.persisted;
    if(sid&&row.storeId!==sid)return false;
    if(qv&&![row.productName,row.productNum,row.groupName,row.storeName].join(' ').toLowerCase().includes(qv))return false;
    if(filter==='configured'&&!configured)return false;if(filter==='unconfigured'&&configured)return false;
    if(filter==='negative'&&!(row.currentStock<0))return false;if(filter==='zero'&&Math.abs(row.currentStock)>1e-12)return false;
    return true;
  });
  $('proc-norms-meta').textContent=visible.length+' из '+rows.length+' · настроено '+(state.data?.stockNorms||[]).length;
  const tb=table.querySelector('tbody');
  tb.innerHTML=visible.map(row=>{
    const d=effectiveNormDraft(row),configured=!!d.persisted,min=d.minStock,target=d.targetStock,source=configured?'Smart Horeca':(row.serverMin!==null||row.serverMax!==null?'Server':'Не задано');
    return '<tr data-norm-row="'+esc(row.id)+'" data-store-id="'+esc(row.storeId)+'" data-store-name="'+esc(row.storeName)+'" data-product-id="'+esc(row.productId)+'" data-product-name="'+esc(row.productName)+'" data-unit="'+esc(row.unit)+'">'+
      '<td><strong>'+esc(row.productName)+'</strong><small>'+esc([row.productNum,row.groupName].filter(Boolean).join(' · ')||row.productId)+'</small></td>'+
      '<td>'+esc(row.storeName)+'</td><td class="'+(row.currentStock<0?'proc-negative':Math.abs(row.currentStock)<=1e-12?'proc-low':'')+'">'+qty(row.currentStock)+' '+esc(row.unit)+'</td>'+
      '<td><input class="proc-norm-input" data-norm-field="minStock" type="number" min="0" step="0.001" value="'+(min===null||min===undefined?'':esc(min))+'" placeholder="—"></td>'+
      '<td><input class="proc-norm-input" data-norm-field="targetStock" type="number" min="0" step="0.001" value="'+(target===null||target===undefined?'':esc(target))+'" placeholder="—"></td>'+
      '<td><input class="proc-norm-input lead" data-norm-field="leadDays" type="number" min="0" step="1" value="'+num(d.leadDays)+'"></td>'+
      '<td><label class="proc-switch"><input data-norm-field="enabled" type="checkbox" '+(d.enabled!==false?'checked':'')+'><span></span></label></td>'+
      '<td><span class="proc-status-badge '+(configured?'success':source==='Server'?'warn':'neutral')+'">'+esc(source)+'</span>'+(state.dirtyNorms.has(row.id)?'<small class="proc-dirty">изменено</small>':'')+'</td></tr>';
  }).join('')||'<tr><td colspan="8" class="proc-empty">По выбранным фильтрам позиций нет.</td></tr>';
}
function updateNormDraftFromRow(row){
  const id=row.dataset.normRow,base=effectiveNormDraft(normRows().find(x=>x.id===id)||{id,storeId:row.dataset.storeId,storeName:row.dataset.storeName,productId:row.dataset.productId,productName:row.dataset.productName,unit:row.dataset.unit,serverMin:null,serverMax:null});
  const read=name=>row.querySelector('[data-norm-field="'+name+'"]');
  const minEl=read('minStock'),targetEl=read('targetStock'),leadEl=read('leadDays'),enabledEl=read('enabled');
  state.normDrafts.set(id,{...base,storeId:row.dataset.storeId,storeName:row.dataset.storeName,productId:row.dataset.productId,productName:row.dataset.productName,unit:row.dataset.unit,minStock:minEl.value===''?null:num(minEl.value),targetStock:targetEl.value===''?null:num(targetEl.value),leadDays:Math.max(0,Math.round(num(leadEl.value))),enabled:enabledEl.checked,persisted:true});
  state.dirtyNorms.add(id);
}
async function saveNorms(){
  const ids=[...state.dirtyNorms];if(!ids.length){toast('Изменений норм запаса нет.');return}
  const norms=ids.map(id=>state.normDrafts.get(id)).filter(Boolean);
  for(const x of norms)if(x.minStock!==null&&x.targetStock!==null&&x.targetStock<x.minStock){toast((x.productName||x.productId)+': целевой остаток должен быть не меньше Min.','error');return}
  try{setBusy(true);await procPost('save-stock-norms',{norms});await loadProcurement();computeNeeds();renderKpis();renderNeeds();renderNorms();toast('Нормы запаса сохранены. Потребность пересчитана.')}catch(e){toast(e.message||String(e),'error')}finally{setBusy(false)}
}

function requesterActions(r){
  const a=[],effective=r.effectiveStatus||r.status;
  if(r.status==='DRAFT'){
    a.push('<button class="proc-btn small ghost" data-pr-edit="'+r.id+'">Изменить</button>');
    a.push('<button class="proc-btn small primary" data-pr-submit="'+r.id+'">На согласование</button>');
    a.push('<button class="proc-btn small danger" data-pr-cancel="'+r.id+'">Отменить</button>');
  }else if(['APPROVED','PARTIALLY_ORDERED','ORDERED','PARTIALLY_FULFILLED'].includes(effective)){
    a.push('<button class="proc-btn small ghost" data-pr-close="'+r.id+'">Закрыть вручную</button>');
  }
  return a.join('');
}
function prLinesHtml(r,showPrices=true){
  return '<div class="proc-line-list">'+(r.lines||[]).map(l=>'<div class="proc-line"><span>'+esc(l.productName||l.productId)+'</span><strong>'+qty(l.quantity)+' '+esc(l.unit)+'</strong><span>фас. '+qty(l.packageSize||1)+' × '+qty(l.packageCount||l.quantity)+' · НДС '+num(l.vatPercent)+'%'+(showPrices?(l.expectedPrice?' · '+money(l.expectedPrice)+'/уп.':' · цена уточняется'):'')+'</span></div>').join('')+'</div>';
}
function prProgressHtml(r){
  const effective=r.effectiveStatus||r.status;
  if(!['PARTIALLY_ORDERED','ORDERED','PARTIALLY_FULFILLED','COMPLETED'].includes(effective))return '';
  return '<div class="proc-progress"><div class="proc-progress-track"><i style="width:'+Math.min(100,num(r.completionPercent))+'%"></i></div><div class="proc-progress-meta"><span>'+((r.linkedOrders||[]).length)+' PO связано</span><span>'+num(r.completionPercent).toFixed(1)+'% выполнено</span></div></div>';
}
function requestCard(r){
  const effective=r.effectiveStatus||r.status,done=['COMPLETED','CLOSED','CANCELLED'].includes(effective);
  return '<article class="proc-doc-card '+(done?'proc-done-card':'')+'"><div class="proc-doc-top"><div class="proc-doc-title"><strong>'+esc(r.number)+'</strong><span>'+esc(r.warehouseName||'Склад')+' · '+new Date(r.createdAt).toLocaleDateString('ru-RU')+' · '+esc(r.createdBy||'')+'</span></div><span class="proc-status-badge '+statusTone(effective)+'">'+esc(statusLabel(effective))+'</span></div>'+
    prProgressHtml(r)+prLinesHtml(r,true)+(r.comment?'<p class="proc-doc-comment">'+esc(r.comment)+'</p>':'')+
    '<div class="proc-doc-footer"><strong>'+(r.totalEstimate?money(r.totalEstimate):'Сумма уточняется')+'</strong><div class="proc-actions">'+requesterActions(r)+'</div></div></article>';
}
function approvalCard(r){
  return '<article class="proc-doc-card"><div class="proc-doc-top"><div class="proc-doc-title"><strong>'+esc(r.number)+'</strong><span>'+esc(r.warehouseName||'Склад')+' · '+new Date(r.createdAt).toLocaleDateString('ru-RU')+' · '+esc(r.createdBy||'')+'</span></div><span class="proc-status-badge warn">Нужно: '+esc(approvalName(r.requiredApprovalLevel))+'</span></div>'+
    prLinesHtml(r,true)+(r.comment?'<p class="proc-doc-comment">'+esc(r.comment)+'</p>':'')+
    '<div class="proc-doc-footer"><strong>'+(r.totalEstimate?money(r.totalEstimate):'Сумма уточняется')+'</strong><div class="proc-actions"><button class="proc-btn small primary" data-pr-approve="'+r.id+'">Согласовать</button><button class="proc-btn small danger" data-pr-cancel="'+r.id+'">Отклонить</button></div></div></article>';
}
function quoteLineByProduct(quote,productId){
  return (quote?.lines||[]).find(x=>key(x.productId)===key(productId))||null;
}
function quoteComparisonHtml(r){
  const quotes=r.quotes||[],lines=r.lines||[];
  if(!quotes.length)return '<div class="proc-history-note">Предложений пока нет. Добавьте поставщика и укажите цены по каждой позиции.</div>';

  const bestPriceByProduct=new Map();
  for(const line of lines){
    const prices=quotes.map(qt=>num(quoteLineByProduct(qt,line.productId)?.unitPrice,0)).filter(x=>x>0);
    if(prices.length)bestPriceByProduct.set(key(line.productId),Math.min(...prices));
  }

  const head='<thead><tr><th class="quote-product-col">Товар / количество</th>'+
    quotes.map(qt=>'<th class="quote-supplier-col"><strong>'+esc(qt.supplierName||qt.supplierId)+'</strong><small>'+money(qt.totalAmount)+' всего</small><small>'+(qt.deliveryDays?esc(qt.deliveryDays+' дн.'):'срок —')+(qt.paymentTerms?' · '+esc(qt.paymentTerms):'')+'</small></th>').join('')+
    '</tr></thead>';

  const bodyRows=lines.map(line=>{
    const best=bestPriceByProduct.get(key(line.productId));
    return '<tr><td class="quote-product-cell"><strong>'+esc(line.productName||line.productId)+'</strong><small>'+qty(line.packageCount||line.quantity)+' уп. × '+qty(line.packageSize||1)+' '+esc(line.unit||'')+' = '+qty(line.quantity)+' '+esc(line.unit||'')+' · НДС '+num(line.vatPercent)+'%</small></td>'+
      quotes.map(qt=>{
        const ql=quoteLineByProduct(qt,line.productId);
        if(!ql)return '<td class="quote-price-cell missing"><span>Не предложил</span></td>';
        const price=num(ql.unitPrice),packCount=num(ql.packageCount, num(ql.quantity||line.quantity)/num(ql.packageSize||line.packageSize||1)),lineTotal=num(ql.total||packCount*price),isBest=best>0&&Math.abs(price-best)<0.0001;
        return '<td class="quote-price-cell '+(isBest?'best':'')+'"><strong>'+money(price)+' <em>/ упак.</em></strong><span>'+qty(packCount)+' уп. × '+money(price)+' = '+money(lineTotal)+' · НДС '+num(ql.vatPercent??line.vatPercent)+'%</span>'+(isBest?'<b>Лучшая цена</b>':'')+'</td>';
      }).join('')+'</tr>';
  }).join('');

  const totals='<tr class="quote-total-row"><td><strong>Итого предложение</strong></td>'+
    quotes.map(qt=>'<td><strong>'+money(qt.totalAmount)+'</strong>'+(r.status==='APPROVED'?'<button class="proc-btn small primary quote-po-btn" data-po-create="'+r.id+'" data-quote="'+qt.id+'">Создать PO</button>':'')+'</td>').join('')+'</tr>';

  return '<div class="proc-quote-compare-wrap"><table class="proc-quote-compare">'+head+'<tbody>'+bodyRows+totals+'</tbody></table></div>'+
    '<div class="proc-quote-legend"><span><i class="best-dot"></i> зелёным отмечена минимальная цена по конкретному товару</span><span>Итог поставщика считается по всем его строкам</span></div>';
}
function rfqStatusLabel(s){
  return({DRAFT:'Черновик',SENT:'Отправлен',CLOSED:'Закрыт'}[String(s||'').toUpperCase()]||s||'—');
}
function rfqStatusTone(s){
  return String(s||'').toUpperCase()==='SENT'?'warn':String(s||'').toUpperCase()==='CLOSED'?'success':'neutral';
}
function rfqListHtml(r){
  const rfqs=r.rfqs||[];
  if(!rfqs.length)return '<div class="proc-rfq-empty">RFQ ещё не создан. Можно выбрать поставщиков и сформировать запрос цен.</div>';
  return rfqs.map(x=>{
    const deadline=x.deadline?new Date(x.deadline+'T00:00:00').toLocaleDateString('ru-RU'):'не указан';
    const supplierRows=(x.supplierIds||[]).map((sid,i)=>{
      const quote=(r.quotes||[]).find(q=>key(q.rfqId)===key(x.id)&&key(q.supplierId)===key(sid));
      const name=(x.supplierNames||[])[i]||sid;
      return '<div class="proc-rfq-supplier-row"><div><strong>'+esc(name)+'</strong><small>'+(quote?'Ответ получен · '+money(quote.totalAmount):'Ожидаем предложение')+'</small></div>'+(x.status!=='CLOSED'?'<button class="proc-btn small '+(quote?'ghost':'secondary')+'" data-rfq-link="'+x.id+'" data-supplier="'+esc(sid)+'">Ссылка</button>':'')+'</div>';
    }).join('');
    return '<div class="proc-rfq-row"><div class="proc-rfq-main"><div><strong>'+esc(x.number)+'</strong><span class="proc-status-badge '+rfqStatusTone(x.status)+'">'+esc(rfqStatusLabel(x.status))+'</span></div><small>Ответов: '+num(x.responseCount)+' из '+(x.supplierIds||[]).length+' · срок: '+esc(deadline)+'</small></div><div class="proc-actions"><button class="proc-btn small ghost" data-rfq-copy="'+x.id+'">Копировать RFQ</button>'+(x.status==='DRAFT'?'<button class="proc-btn small primary" data-rfq-send="'+x.id+'">Отметить отправленным</button>':'')+(x.status!=='CLOSED'?'<button class="proc-btn small danger" data-rfq-close="'+x.id+'">Закрыть</button>':'')+'</div><div class="proc-rfq-supplier-links">'+supplierRows+'</div></div>';
  }).join('');
}
function sourcingCard(r){
  const effective=r.effectiveStatus||r.status;
  const activeRfq=(r.rfqs||[]).find(x=>x.status!=='CLOSED')||null;
  return '<article class="proc-doc-card sourcing-card"><div class="proc-doc-top"><div class="proc-doc-title"><strong>'+esc(r.number)+'</strong><span>'+esc(r.warehouseName||'Склад')+' · '+new Date(r.createdAt).toLocaleDateString('ru-RU')+'</span></div><span class="proc-status-badge '+statusTone(effective)+'">'+esc(statusLabel(effective))+'</span></div>'+
    '<div class="proc-sourcing-request"><div class="proc-quotes-head"><strong>Что нужно купить</strong><span class="proc-history-note">'+(r.lines||[]).length+' позиций</span></div>'+prLinesHtml(r,false)+'</div>'+
    '<div class="proc-rfq-block"><div class="proc-quotes-head"><strong>RFQ · запрос цен</strong><button class="proc-btn small secondary" data-rfq-create="'+r.id+'">+ Создать RFQ</button></div>'+rfqListHtml(r)+'</div>'+
    '<div class="proc-quotes"><div class="proc-quotes-head"><strong>Сравнение предложений · '+(r.quotes||[]).length+'</strong><button class="proc-btn small ghost" data-pr-quote="'+r.id+'" '+(activeRfq?'data-rfq="'+activeRfq.id+'"':'')+'>+ Внести предложение</button></div>'+quoteComparisonHtml(r)+'</div>'+
    '<div class="proc-doc-footer"><strong>Оценка PR: '+(r.totalEstimate?money(r.totalEstimate):'—')+'</strong><span class="proc-history-note">'+((r.linkedOrders||[]).length?'Создано PO: '+r.linkedOrders.length:'PO ещё не создан')+'</span></div></article>';
}
function renderRequisitions(){
  const box=$('proc-pr-list'),all=state.data?.requisitions||[],view=state.view||currentProcurementView();
  const head=document.querySelector('[data-panel="requisitions"] .proc-panel-head');
  if(view==='approvals'){
    if(head)head.querySelector('h2').textContent='Согласование заявок';
    if(head)head.querySelector('p').textContent='Здесь нет предложений поставщиков — только потребность, сумма и решение.';
    const rows=all.filter(r=>r.status==='PENDING_APPROVAL');
    box.innerHTML=rows.map(approvalCard).join('')||'<div class="proc-empty">Нет заявок, ожидающих согласования.</div>';
    return;
  }
  if(view==='sourcing'){
    if(head)head.querySelector('h2').textContent='Работа с поставщиками';
    if(head)head.querySelector('p').textContent='Согласованные PR, предложения поставщиков и создание PO.';
    const rows=all.filter(r=>['APPROVED','PARTIALLY_ORDERED','ORDERED','PARTIALLY_FULFILLED'].includes(r.effectiveStatus||r.status));
    box.innerHTML=rows.map(sourcingCard).join('')||'<div class="proc-empty">Нет согласованных заявок для работы закупщика.</div>';
    return;
  }
  if(head)head.querySelector('h2').textContent='Заявки на закупку (PR)';
  if(head)head.querySelector('p').textContent='Пользователь видит свою потребность и статус процесса без коммерческих предложений поставщиков.';
  const active=all.filter(r=>!['COMPLETED','CLOSED','CANCELLED'].includes(r.effectiveStatus||r.status));
  const done=all.filter(r=>['COMPLETED','CLOSED','CANCELLED'].includes(r.effectiveStatus||r.status));
  box.innerHTML=
    '<div class="proc-list-section"><div class="proc-list-section-title"><strong>Активные</strong><span>'+active.length+'</span></div>'+ (active.map(requestCard).join('')||'<div class="proc-empty">Активных заявок нет.</div>')+'</div>'+
    '<details class="proc-history-block" '+(!active.length&&done.length?'open':'')+'><summary>Завершённые и закрытые · '+done.length+'</summary><div class="proc-card-list inner">'+(done.map(requestCard).join('')||'<div class="proc-empty">Истории пока нет.</div>')+'</div></details>';
}
function buyerOrderActions(o){
  const a=[];if(['CANCELLED','COMPLETED'].includes(o.effectiveStatus))return '';
  if(o.status==='APPROVED')a.push('<button class="proc-btn small primary" data-po-send="'+o.id+'">Отправлен поставщику</button>');
  if(['APPROVED','SENT'].includes(o.status))a.push('<button class="proc-btn small primary" data-po-confirm="'+o.id+'">Поставщик подтвердил</button>');
  a.push('<button class="proc-btn small ghost" data-po-copy="'+o.id+'">Копировать PO</button>');
  a.push('<button class="proc-btn small danger" data-po-cancel="'+o.id+'">Отменить</button>');
  return a.join('');
}
function receivingActions(o){
  if(['CANCELLED','COMPLETED'].includes(o.effectiveStatus))return '';
  return '<button class="proc-btn small primary" data-po-receive="'+o.id+'">Принять поставку</button><button class="proc-btn small ghost" data-po-link="'+o.id+'">Привязать накладную</button>';
}
function orderCard(o,{receiving=false}={}){
  const lines=(o.lines||[]).map(l=>'<div class="proc-line"><span>'+esc(l.productName||l.productId)+'</span><strong>'+qty(l.orderedQty)+' '+esc(l.unit)+(receiving?'':' × '+money(l.unitPrice))+'</strong><span>принято '+qty(l.receivedQty)+' · осталось '+qty(l.remainingQty)+'</span></div>').join('');
  return '<article class="proc-doc-card '+(o.effectiveStatus==='COMPLETED'?'proc-done-card':'')+'"><div class="proc-doc-top"><div class="proc-doc-title"><strong>'+esc(o.number)+'</strong><span>'+esc(o.supplierName||o.supplierId)+' · '+esc(o.warehouseName||'Склад')+' · '+new Date(o.createdAt).toLocaleDateString('ru-RU')+'</span></div><span class="proc-status-badge '+statusTone(o.effectiveStatus)+'">'+esc(statusLabel(o.effectiveStatus))+'</span></div>'+
    '<div class="proc-progress"><div class="proc-progress-track"><i style="width:'+Math.min(100,num(o.completionPercent))+'%"></i></div><div class="proc-progress-meta"><span>Принято '+qty(o.receivedQty)+' из '+qty(o.orderedQty)+'</span><span>'+num(o.completionPercent).toFixed(1)+'%</span></div></div>'+
    '<div class="proc-line-list">'+lines+'</div>'+
    '<div class="proc-card-row" style="margin-top:10px"><span class="proc-match '+String(o.matchStatus||'OPEN').toLowerCase()+'">'+esc(matchLabel(o.matchStatus))+'</span><span class="proc-history-note">'+((o.receipts||[]).length?'Накладные: '+(o.receipts||[]).map(r=>esc(r.iikoDocumentNumber||'без №')).join(', '):'Приёмок пока нет')+'</span></div>'+
    '<div class="proc-doc-footer">'+(receiving?'<strong>'+qty(o.remainingQty||Math.max(0,o.orderedQty-o.receivedQty))+' к приёмке</strong>':'<strong>'+money(o.totalAmount)+'</strong>')+'<div class="proc-actions">'+(receiving?receivingActions(o):buyerOrderActions(o))+(o.effectiveStatus==='COMPLETED'?'<a class="proc-btn small ghost" href="/nakladnye.html">Открыть накладные ↗</a>':'')+'</div></div></article>';
}
function renderOrders(){
  const box=$('proc-po-list'),all=state.data?.orders||[],view=state.view||currentProcurementView();
  const head=document.querySelector('[data-panel="orders"] .proc-panel-head');
  if(view==='receiving'){
    if(head)head.querySelector('h2').textContent='Приёмка поставок';
    if(head)head.querySelector('p').textContent='Склад видит количество, поставщика и факт приёмки без коммерческих предложений.';
    const active=all.filter(o=>!['COMPLETED','CANCELLED'].includes(o.effectiveStatus));
    const done=all.filter(o=>o.effectiveStatus==='COMPLETED').slice(0,30);
    box.innerHTML=active.map(o=>orderCard(o,{receiving:true})).join('')||'<div class="proc-empty">Нет поставок, ожидающих приёмки.</div>';
    if(done.length)box.insertAdjacentHTML('beforeend','<details class="proc-history-block"><summary>Недавно принятые · '+done.length+'</summary><div class="proc-card-list inner">'+done.map(o=>orderCard(o,{receiving:true})).join('')+'</div></details>');
    return;
  }
  if(head)head.querySelector('h2').textContent='Заказы поставщикам (PO)';
  if(head)head.querySelector('p').textContent='Отправка заказа, подтверждение поставщика и контроль исполнения.';
  const active=all.filter(o=>!['COMPLETED','CANCELLED'].includes(o.effectiveStatus));
  const done=all.filter(o=>['COMPLETED','CANCELLED'].includes(o.effectiveStatus));
  box.innerHTML=active.map(o=>orderCard(o)).join('')||'<div class="proc-empty">Активных PO нет.</div>';
  if(done.length)box.insertAdjacentHTML('beforeend','<details class="proc-history-block"><summary>Завершённые PO · '+done.length+'</summary><div class="proc-card-list inner">'+done.map(o=>orderCard(o)).join('')+'</div></details>');
}
const WEEKDAY_LABELS={1:'Пн',2:'Вт',3:'Ср',4:'Чт',5:'Пт',6:'Сб',7:'Вс'};
function supplierProfileFor(id){return (state.data?.supplierProfiles||[]).find(x=>key(x.supplierId)===key(id))||null}
function supplierContractsFor(id){return (state.data?.supplierContracts||[]).filter(x=>key(x.supplierId)===key(id))}
function supplierContractTone(c){
  if(String(c.status).toUpperCase()==='CANCELLED')return'danger';
  if(String(c.status).toUpperCase()==='DRAFT')return'neutral';
  if(c.endDate&&c.endDate<today())return'danger';
  if(c.endDate&&c.endDate<=addDays(today(),30))return'warn';
  return'success';
}
function supplierContractLabel(c){
  if(String(c.status).toUpperCase()==='CANCELLED')return'Отменён';
  if(String(c.status).toUpperCase()==='DRAFT')return'Черновик';
  if(c.endDate&&c.endDate<today())return'Истёк';
  if(c.endDate&&c.endDate<=addDays(today(),30))return'Истекает';
  return'Активен';
}
function renderSuppliers(){
  const table=$('proc-supplier-master-table');if(!table)return;
  const qv=String($('proc-suppliers-search')?.value||'').trim().toLowerCase(),profiles=state.data?.supplierProfiles||[];
  const rows=(state.refs.suppliers||[]).map(s=>({supplier:s,profile:supplierProfileFor(s.id),contracts:supplierContractsFor(s.id)})).filter(x=>{
    if(!qv)return true;const p=x.profile||{},hay=[x.supplier.name,p.taxId,p.contactPerson,p.phone,p.email,p.paymentTerms,(p.categories||[]).join(' ')].join(' ').toLowerCase();return hay.includes(qv);
  }).sort((a,b)=>String(a.supplier.name||'').localeCompare(String(b.supplier.name||''),'ru'));
  const tb=table.querySelector('tbody');
  tb.innerHTML=rows.map(x=>{
    const s=x.supplier,p=x.profile||{},days=(p.deliveryDays||[]).map(d=>WEEKDAY_LABELS[d]||d).join(', ')||'—',balance=state.supplierBalances.get(key(s.id))||{},active=x.contracts.filter(c=>supplierContractTone(c)==='success').length,expiring=x.contracts.filter(c=>supplierContractTone(c)==='warn').length;
    return '<tr><td><strong>'+esc(s.name||s.id)+'</strong><small>'+esc(s.code||s.num||'')+'</small></td><td>'+esc(p.taxId||'—')+'</td><td>'+(p.contactPerson?'<strong>'+esc(p.contactPerson)+'</strong><small>'+esc([p.phone,p.email].filter(Boolean).join(' · '))+'</small>':'—')+'</td><td>'+esc(p.paymentTerms||'—')+(num(p.paymentDays)>0?'<small>'+num(p.paymentDays)+' дн.</small>':'')+'</td><td>'+esc(days)+'</td><td>'+money(p.minOrderAmount||0)+'</td><td><strong>'+x.contracts.length+'</strong><small>'+active+' акт.'+(expiring?' · '+expiring+' истекает':'')+'</small></td><td>'+money(balance.debt||0)+'<small>аванс '+money(balance.advance||0)+'</small></td><td><button class="proc-btn small secondary" data-supplier-edit="'+esc(key(s.id))+'">Карточка</button></td></tr>';
  }).join('')||'<tr><td colspan="9" class="proc-empty">Поставщики не найдены.</td></tr>';
  if($('proc-suppliers-meta'))$('proc-suppliers-meta').textContent=rows.length+' поставщиков · '+profiles.length+' карточек заполнено';
}
function supplierDaysChecks(selected=[]){
  const set=new Set((selected||[]).map(Number));
  return [1,2,3,4,5,6,7].map(d=>'<label class="proc-day-check"><input type="checkbox" data-supplier-day="'+d+'" '+(set.has(d)?'checked':'')+'><span>'+WEEKDAY_LABELS[d]+'</span></label>').join('');
}
function supplierContractsHtml(supplierId){
  const rows=supplierContractsFor(supplierId);
  if(!rows.length)return '<div class="proc-rfq-empty">Договоров пока нет.</div>';
  return rows.map(c=>'<div class="proc-contract-row"><div><strong>'+esc(c.number||c.title||'Договор')+'</strong><small>'+esc(c.title||'')+(c.startDate||c.endDate?' · '+esc(c.startDate||'—')+' → '+esc(c.endDate||'—'):'')+'</small><span class="proc-status-badge '+supplierContractTone(c)+'">'+supplierContractLabel(c)+'</span></div><div class="proc-actions"><button type="button" class="proc-btn small ghost" data-contract-edit="'+c.id+'">Изменить</button><button type="button" class="proc-btn small danger" data-contract-delete="'+c.id+'">Удалить</button></div></div>').join('');
}
function openSupplierModal(supplier){
  const p=supplierProfileFor(supplier.id)||{},contracts=supplierContractsFor(supplier.id);
  openModal('Поставщик · '+(supplier.name||supplier.id),'КАРТОЧКА ПОСТАВЩИКА',
    '<form id="proc-supplier-form"><div class="proc-form-grid">'+
    '<label class="proc-field"><span>Поставщик</span><input value="'+esc(supplier.name||supplier.id)+'" disabled></label>'+
    '<label class="proc-field"><span>VÖEN</span><input id="proc-sup-tax" value="'+esc(p.taxId||'')+'" placeholder="Налоговый номер"></label>'+
    '<label class="proc-field"><span>Контактное лицо</span><input id="proc-sup-contact" value="'+esc(p.contactPerson||'')+'"></label>'+
    '<label class="proc-field"><span>Телефон</span><input id="proc-sup-phone" value="'+esc(p.phone||'')+'"></label>'+
    '<label class="proc-field"><span>Email</span><input id="proc-sup-email" type="email" value="'+esc(p.email||'')+'"></label>'+
    '<label class="proc-field"><span>Отсрочка, дней</span><input id="proc-sup-payment-days" type="number" min="0" step="1" value="'+num(p.paymentDays)+'"></label>'+
    '<label class="proc-field wide"><span>Адрес</span><input id="proc-sup-address" value="'+esc(p.address||'')+'"></label>'+
    '<label class="proc-field wide"><span>Условия оплаты</span><input id="proc-sup-payment" value="'+esc(p.paymentTerms||'')+'" placeholder="По факту / 7 дней / предоплата…"></label>'+
    '<label class="proc-field"><span>Минимальная сумма заказа</span><input id="proc-sup-min-order" type="number" min="0" step="0.01" value="'+num(p.minOrderAmount)+'"></label>'+
    '<label class="proc-field wide"><span>Категории товаров</span><input id="proc-sup-categories" value="'+esc((p.categories||[]).join(', '))+'" placeholder="Овощи, мясо, напитки…"></label>'+
    '<div class="proc-field wide"><span>Дни поставки</span><div class="proc-day-grid">'+supplierDaysChecks(p.deliveryDays||[])+'</div></div>'+
    '<label class="proc-field wide"><span>Комментарий</span><textarea id="proc-sup-note">'+esc(p.note||'')+'</textarea></label>'+
    '</div><div class="proc-modal-actions"><button type="button" id="proc-supplier-cancel" class="proc-btn ghost">Закрыть</button><button class="proc-btn primary">Сохранить карточку</button></div></form>'+
    '<div class="proc-contract-block"><div class="proc-edit-head"><strong>Договоры · '+contracts.length+'</strong><button type="button" id="proc-contract-add" class="proc-btn small secondary">+ Договор</button></div><div id="proc-contract-list">'+supplierContractsHtml(supplier.id)+'</div></div>');
  $('proc-supplier-cancel').onclick=closeModal;
  $('proc-supplier-form').onsubmit=async e=>{e.preventDefault();try{setBusy(true);await procPost('save-supplier-profile',{supplierId:key(supplier.id),supplierName:supplier.name||'',taxId:$('proc-sup-tax').value,contactPerson:$('proc-sup-contact').value,phone:$('proc-sup-phone').value,email:$('proc-sup-email').value,address:$('proc-sup-address').value,paymentTerms:$('proc-sup-payment').value,paymentDays:num($('proc-sup-payment-days').value),minOrderAmount:num($('proc-sup-min-order').value),deliveryDays:[...document.querySelectorAll('[data-supplier-day]:checked')].map(x=>Number(x.dataset.supplierDay)),categories:$('proc-sup-categories').value.split(',').map(x=>x.trim()).filter(Boolean),note:$('proc-sup-note').value});await reloadProc();toast('Карточка поставщика сохранена.');openSupplierModal(supplier)}catch(err){toast(err.message||String(err),'error')}finally{setBusy(false)}};
  $('proc-contract-add').onclick=()=>openSupplierContractModal(supplier);
  $('proc-contract-list').addEventListener('click',e=>{const edit=e.target.closest('[data-contract-edit]'),del=e.target.closest('[data-contract-delete]');if(edit){const c=supplierContractsFor(supplier.id).find(x=>x.id===edit.dataset.contractEdit);return openSupplierContractModal(supplier,c)}if(del&&confirm('Удалить договор?')){setBusy(true);procPost('delete-supplier-contract',{id:del.dataset.contractDelete}).then(()=>reloadProc()).then(()=>{toast('Договор удалён.');openSupplierModal(supplier)}).catch(err=>toast(err.message||String(err),'error')).finally(()=>setBusy(false))}});
}
function openSupplierContractModal(supplier,contract=null){
  const c=contract||{};
  openModal((contract?'Договор · ':'Новый договор · ')+(supplier.name||supplier.id),'ДОГОВОР ПОСТАВЩИКА',
    '<form id="proc-contract-form"><div class="proc-form-grid">'+
    '<label class="proc-field"><span>Номер договора</span><input id="proc-contract-number" value="'+esc(c.number||'')+'"></label>'+
    '<label class="proc-field"><span>Статус</span><select id="proc-contract-status"><option value="ACTIVE" '+(c.status==='ACTIVE'?'selected':'')+'>Активен</option><option value="DRAFT" '+(c.status==='DRAFT'?'selected':'')+'>Черновик</option><option value="CANCELLED" '+(c.status==='CANCELLED'?'selected':'')+'>Отменён</option></select></label>'+
    '<label class="proc-field"><span>Название</span><input id="proc-contract-title" value="'+esc(c.title||'')+'" placeholder="Основной договор поставки"></label>'+
    '<label class="proc-field"><span>Дата начала</span><input id="proc-contract-start" type="date" value="'+esc(c.startDate||'')+'"></label>'+
    '<label class="proc-field"><span>Дата окончания</span><input id="proc-contract-end" type="date" value="'+esc(c.endDate||'')+'"></label>'+
    '<label class="proc-field wide"><span>Условия оплаты</span><input id="proc-contract-payment" value="'+esc(c.paymentTerms||'')+'"></label>'+
    '<label class="proc-field wide"><span>Комментарий</span><textarea id="proc-contract-comment">'+esc(c.comment||'')+'</textarea></label>'+
    '</div><div class="proc-modal-actions"><button id="proc-contract-back" type="button" class="proc-btn ghost">Назад</button><button class="proc-btn primary">Сохранить договор</button></div></form>');
  $('proc-contract-back').onclick=()=>openSupplierModal(supplier);
  $('proc-contract-form').onsubmit=async e=>{e.preventDefault();try{setBusy(true);await procPost('save-supplier-contract',{id:c.id||'',supplierId:key(supplier.id),number:$('proc-contract-number').value,title:$('proc-contract-title').value,startDate:$('proc-contract-start').value,endDate:$('proc-contract-end').value,paymentTerms:$('proc-contract-payment').value,status:$('proc-contract-status').value,comment:$('proc-contract-comment').value});await reloadProc();toast('Договор сохранён.');openSupplierModal(supplier)}catch(err){toast(err.message||String(err),'error')}finally{setBusy(false)}};
}
function renderAnalytics(){
  const a=state.data?.analytics||{};$('proc-a-estimate').textContent=money(a.requisitionEstimate);$('proc-a-ordered').textContent=money(a.orderedAmount);$('proc-a-received').textContent=money(a.receivedAmount);$('proc-a-savings').textContent=money(a.estimatedSavings);
  const tb=$('proc-suppliers-table').querySelector('tbody'),rows=state.data?.supplierPerformance||[];
  tb.innerHTML=rows.map(x=>{const b=state.supplierBalances.get(key(x.supplierId))||{};return '<tr><td><strong>'+esc(x.supplierName||x.supplierId)+'</strong></td><td>'+num(x.orders)+'</td><td>'+money(x.totalAmount)+'</td><td>'+money(x.receivedAmount)+'</td><td>'+money(b.debt||0)+'</td><td>'+money(b.advance||0)+'</td><td>'+num(x.completedOrders)+'</td><td>'+num(x.avgCompletion).toFixed(1)+'%</td></tr>'}).join('')||'<tr><td colspan="8" class="proc-empty">Данных по поставщикам пока нет.</td></tr>';
}
function renderSettings(){
  const s=state.data?.settings||{},tiers=s.approvalTiers||[],m=tiers.find(x=>x.code==='MANAGER'),d=tiers.find(x=>x.code==='DIRECTOR');
  $('proc-limit-manager').value=m?.maxAmount??300;$('proc-limit-director').value=d?.maxAmount??2000;$('proc-lead-days').value=s.defaultLeadDays??2;$('proc-auto-needs').checked=s.autoNeedEnabled!==false;$('proc-over-receipt').checked=s.allowOverReceipt===true;
}
function switchTab(tab){const map={needs:'catalog',norms:'norms',requisitions:'requests',orders:'orders',analytics:'analytics',settings:'settings'};goProcurementView(map[tab]||'catalog')}
function productOptions(){return state.refs.products.map(p=>'<option value="'+esc(productLabel(p.id,p.name))+'"></option>').join('')}
function resolveProductLabel(v){return state.productLabelToId.get(String(v||''))||''}
function warehouseOptions(selected=''){return '<option value="">Выберите склад</option>'+state.refs.warehouses.map(x=>'<option value="'+esc(key(x.id))+'" '+(key(x.id)===key(selected)?'selected':'')+'>'+esc(x.name)+'</option>').join('')}
function supplierOptions(selected=''){return '<option value="">Выберите поставщика</option>'+state.refs.suppliers.map(x=>'<option value="'+esc(key(x.id))+'" '+(key(x.id)===key(selected)?'selected':'')+'>'+esc(x.name)+'</option>').join('')}
function vatOptions(selected=0){
  return [0,2,8,18].map(v=>'<option value="'+v+'" '+(num(selected)===v?'selected':'')+'>'+v+'%</option>').join('');
}
function prLineHtml(line={}){
  const pid=key(line.productId),name=line.productName||productName(pid),unit=line.unit||unitFor(pid),price=num(line.expectedPrice??line.unitPrice);
  const quantity=num(line.quantity??line.recommendedQty??line.manualQty??1),packageSize=num(line.packageSize,1)||1,packageCount=num(line.packageCount,quantity/packageSize)||1,vat=num(line.vatPercent,0);
  return '<div class="proc-edit-row proc-pack-row" data-pr-line data-product-id="'+esc(pid)+'">'+
    '<div class="proc-field"><span>Товар</span><input data-f="product" list="proc-products-list" value="'+esc(productLabel(pid,name))+'" placeholder="Начните вводить название"></div>'+
    '<div class="proc-field proc-package-field"><span>Фасовка</span><select data-f="packageChoice">'+packagingChoiceHtml(pid,{containerId:line.containerId,packageSize,packageName:line.packageName})+'</select><input data-f="packageSize" type="number" min="0.001" step="0.001" value="'+packageSize+'"></div>'+
    '<div class="proc-field"><span>Упаковок</span><input data-f="packageCount" type="number" min="0.001" step="0.001" value="'+packageCount+'"></div>'+
    '<div class="proc-field"><span>Итого '+esc(unit||'ед.')+'</span><input data-f="quantity" type="number" value="'+(packageSize*packageCount).toFixed(3).replace(/\.000$/,'')+'" readonly></div>'+
    '<div class="proc-field"><span>НДС</span><select data-f="vatPercent">'+vatOptions(vat)+'</select></div>'+
    '<div class="proc-field"><span>Цена / упак.</span><input data-f="price" type="number" min="0" step="0.01" value="'+price+'"></div>'+
    '<strong class="line-total">'+money(packageCount*price)+'</strong><button class="remove" type="button">×</button>'+
    '<input data-f="containerId" type="hidden" value="'+esc(line.containerId||'')+'"><input data-f="packageName" type="hidden" value="'+esc(line.packageName||'')+'">'+
    '<input data-f="unit" type="hidden" value="'+esc(unit)+'"><input data-f="currentStock" type="hidden" value="'+num(line.currentStock)+'"><input data-f="minStock" type="hidden" value="'+(line.minStock??'')+'"><input data-f="maxStock" type="hidden" value="'+(line.maxStock??'')+'"><input data-f="storeId" type="hidden" value="'+esc(line.storeId||'')+'"><input data-f="storeName" type="hidden" value="'+esc(line.storeName||'')+'"></div>';
}
function bindEditRows(root){
  root.querySelectorAll('[data-pr-line]').forEach(row=>{
    row.querySelector('.remove').onclick=()=>{row.remove();recalcPrModal()};
    row.querySelector('[data-f="product"]').onchange=e=>{const pid=resolveProductLabel(e.target.value);row.dataset.productId=pid;if(pid)row.querySelector('[data-f="unit"]').value=unitFor(pid);row.querySelector('[data-f="containerId"]').value='';row.querySelector('[data-f="packageName"]').value='';syncPackagingRow(row);recalcPrModal()};
    row.querySelector('[data-f="packageChoice"]').onchange=()=>{applyPackagingChoice(row);recalcPrModal()};
    ['packageSize','packageCount','price'].forEach(name=>row.querySelector('[data-f="'+name+'"]').oninput=recalcPrModal);
    row.querySelector('[data-f="vatPercent"]').onchange=recalcPrModal;
    applyPackagingChoice(row);
  });
}
function recalcPrModal(){
  let total=0;
  document.querySelectorAll('#proc-pr-lines [data-pr-line]').forEach(row=>{
    const pack=num(row.querySelector('[data-f="packageSize"]').value,1),count=num(row.querySelector('[data-f="packageCount"]').value),price=num(row.querySelector('[data-f="price"]').value);
    row.querySelector('[data-f="quantity"]').value=(pack*count).toFixed(3).replace(/\.000$/,'');
    total+=count*price;row.querySelector('.line-total').textContent=money(count*price);
  });
  if($('proc-pr-total'))$('proc-pr-total').textContent=money(total);
}
function collectPrLines(){
  return [...document.querySelectorAll('#proc-pr-lines [data-pr-line]')].map(row=>{
    const label=row.querySelector('[data-f="product"]').value,pid=key(row.dataset.productId||resolveProductLabel(label));if(!pid)throw Error('Выберите номенклатуру из списка.');
    const packageSize=num(row.querySelector('[data-f="packageSize"]').value),packageCount=num(row.querySelector('[data-f="packageCount"]').value);
    const containerId=key(row.querySelector('[data-f="containerId"]').value),packs=productPackagings(pid);
    if(packs.length&&!containerId)throw Error(productName(pid)+': выберите фасовку из iiko.');
    if(!(packageSize>0))throw Error(productName(pid)+': фасовка не определена в iiko.');
    if(!(packageCount>0))throw Error(productName(pid)+': укажите количество упаковок.');
    return{productId:pid,productName:productName(pid),unit:row.querySelector('[data-f="unit"]').value||unitFor(pid),quantity:packageSize*packageCount,packageSize,packageCount,containerId,packageName:row.querySelector('[data-f="packageName"]').value||'',vatPercent:num(row.querySelector('[data-f="vatPercent"]').value),expectedPrice:num(row.querySelector('[data-f="price"]').value),currentStock:num(row.querySelector('[data-f="currentStock"]').value),minStock:row.querySelector('[data-f="minStock"]').value===''?null:num(row.querySelector('[data-f="minStock"]').value),maxStock:row.querySelector('[data-f="maxStock"]').value===''?null:num(row.querySelector('[data-f="maxStock"]').value),storeId:row.querySelector('[data-f="storeId"]').value,storeName:row.querySelector('[data-f="storeName"]').value};
  });
}
function openPrModal(seed=[],existing=null){
  const lines=(existing?.lines?.length?existing.lines:seed.length?seed:[{productId:'',productName:'',quantity:1,packageSize:1,packageCount:1,vatPercent:0,expectedPrice:0}]).map(x=>{const quantity=num(x.quantity??x.recommendedQty??x.manualQty??1);const packageSize=num(x.packageSize,1)||1;return{...x,quantity,packageSize,packageCount:num(x.packageCount,quantity/packageSize)||1,vatPercent:num(x.vatPercent,0),expectedPrice:x.expectedPrice??x.lastPrice,currentStock:x.currentStock,minStock:x.minStock,maxStock:x.maxStock,storeId:x.storeId,storeName:x.storeName}});
  const source=existing?.source||(seed.length&&seed.every(x=>x.autoRecommended)?'AUTO_MINMAX':'MANUAL');
  const sameStore=lines.length&&lines.every(x=>key(x.storeId)===key(lines[0].storeId))?lines[0].storeId:'',warehouse=existing?.warehouseId||sameStore||state.refs.warehouses[0]?.id||'',lead=num(state.data?.settings?.defaultLeadDays,2);
  openModal(existing?'Изменить заявку '+existing.number:'Новая заявка на закупку','PURCHASE REQUISITION','<form id="proc-pr-form"><datalist id="proc-products-list">'+productOptions()+'</datalist><datalist id="proc-pack-sizes"><option value="0.1"></option><option value="0.25"></option><option value="0.5"></option><option value="1"></option><option value="2"></option><option value="2.5"></option><option value="5"></option><option value="10"></option></datalist><div class="proc-form-grid"><label class="proc-field"><span>Склад назначения</span><select id="proc-pr-warehouse">'+warehouseOptions(warehouse)+'</select></label><label class="proc-field"><span>Нужно к дате</span><input id="proc-pr-needed" type="date" value="'+esc(existing?.neededBy||addDays(today(),lead))+'"></label><label class="proc-field"><span>Источник</span><input value="'+esc(source)+'" disabled></label><label class="proc-field wide"><span>Комментарий</span><textarea id="proc-pr-comment" placeholder="Причина, проект, пожелания закупщику…">'+esc(existing?.comment||'')+'</textarea></label></div><div class="proc-edit-lines"><div class="proc-edit-head"><strong>Позиции заявки</strong><button id="proc-pr-add-line" type="button" class="proc-btn small ghost">＋ Добавить</button></div><div id="proc-pr-lines">'+lines.map(prLineHtml).join('')+'</div></div><div class="proc-modal-summary"><span>Оценочная сумма заявки</span><strong id="proc-pr-total">0,00 ₼</strong></div><div class="proc-modal-actions"><button type="button" class="proc-btn ghost" id="proc-pr-cancel">Отмена</button><button class="proc-btn primary" type="submit">'+(existing?'Сохранить изменения':'Создать PR')+'</button></div></form>');
  bindEditRows($('proc-pr-lines'));recalcPrModal();$('proc-pr-cancel').onclick=closeModal;$('proc-pr-add-line').onclick=()=>{$('proc-pr-lines').insertAdjacentHTML('beforeend',prLineHtml({quantity:1,packageSize:1,packageCount:1,vatPercent:0}));bindEditRows($('proc-pr-lines'));recalcPrModal()};
  $('proc-pr-form').onsubmit=async e=>{e.preventDefault();try{setBusy(true);const wid=key($('proc-pr-warehouse').value),w=state.refs.warehouses.find(x=>key(x.id)===wid);if(!wid)throw Error('Выберите склад назначения.');const payload={id:existing?.id,warehouseId:wid,warehouseName:w?.name||'',neededBy:$('proc-pr-needed').value,comment:$('proc-pr-comment').value,source,lines:collectPrLines()};await procPost(existing?'update-requisition':'create-requisition',payload);closeModal();await reloadProc();toast(existing?'Заявка обновлена.':'Заявка создана.');goProcurementView('requests')}catch(err){toast(err.message||String(err),'error')}finally{setBusy(false)}};
}
function quoteLineHtml(l,supplierId){
  const h=historyPrice(l.productId,supplierId),price=h?num(h.price):num(l.expectedPrice);
  const packageSize=num(l.packageSize,1)||1,packageCount=num(l.packageCount,num(l.quantity)/packageSize)||1,vat=num(l.vatPercent,0);
  return '<div class="proc-edit-row proc-quote-pack-row" data-quote-line data-product-id="'+esc(l.productId)+'"><div class="proc-field"><span>Товар</span><input value="'+esc(l.productName||l.productId)+'" disabled></div><div class="proc-field"><span>Фасовка</span><input data-f="packageSize" value="'+packageSize+'" disabled><small>'+esc(l.packageName||'iiko')+'</small></div><div class="proc-field"><span>Упаковок</span><input data-f="packageCount" type="number" min="0.001" step="0.001" value="'+packageCount+'"></div><div class="proc-field"><span>НДС</span><select data-f="vatPercent">'+vatOptions(vat)+'</select></div><div class="proc-field"><span>Цена / упак.</span><input data-f="price" type="number" min="0.01" step="0.01" value="'+price+'"></div><strong class="line-total">'+money(packageCount*price)+'</strong><span></span><input data-f="containerId" type="hidden" value="'+esc(l.containerId||'')+'"><input data-f="packageName" type="hidden" value="'+esc(l.packageName||'')+'"><input data-f="unit" type="hidden" value="'+esc(l.unit||'')+'"></div>';
}
function recalcQuote(){let total=0;document.querySelectorAll('[data-quote-line]').forEach(row=>{const x=num(row.querySelector('[data-f="packageCount"]').value)*num(row.querySelector('[data-f="price"]').value);total+=x;row.querySelector('.line-total').textContent=money(x)});if($('proc-quote-total'))$('proc-quote-total').textContent=money(total)}
function openRfqModal(r){
  const suppliers=state.refs.suppliers||[];
  if(!suppliers.length){toast('Список поставщиков не загружен. Нажмите «Обновить» и повторите.','error');return}
  openModal('Новый RFQ · '+r.number,'REQUEST FOR QUOTATION',
    '<div class="proc-form-grid"><label class="proc-field"><span>Срок ответа</span><input id="proc-rfq-deadline" type="date" value="'+addDays(today(),3)+'"></label><label class="proc-field wide"><span>Сообщение поставщикам</span><textarea id="proc-rfq-message">Просим предоставить цены и условия поставки по указанным позициям.</textarea></label></div>'+
    '<div class="proc-edit-lines"><div class="proc-edit-head"><strong>Кому отправить запрос</strong><span class="proc-history-note">Можно выбрать несколько поставщиков</span></div><div class="proc-rfq-supplier-grid">'+suppliers.map(s=>'<label class="proc-rfq-supplier"><input type="checkbox" data-rfq-supplier="'+esc(key(s.id))+'"><span><strong>'+esc(s.name||s.id)+'</strong><small>'+esc(s.code||'')+'</small></span></label>').join('')+'</div></div>'+
    '<div class="proc-modal-actions"><button id="proc-rfq-cancel" type="button" class="proc-btn ghost">Отмена</button><button id="proc-rfq-save" type="button" class="proc-btn primary">Создать RFQ</button></div>');
  $('proc-rfq-cancel').onclick=closeModal;
  $('proc-rfq-save').onclick=async()=>{
    const selected=[...document.querySelectorAll('[data-rfq-supplier]:checked')].map(x=>{const id=key(x.dataset.rfqSupplier),s=state.refs.suppliers.find(v=>key(v.id)===id);return{id,name:s?.name||id}});
    if(!selected.length){toast('Выберите хотя бы одного поставщика.','error');return}
    try{setBusy(true);await procPost('create-rfq',{requisitionId:r.id,deadline:$('proc-rfq-deadline').value,message:$('proc-rfq-message').value,suppliers:selected});closeModal();await reloadProc();toast('RFQ создан. Теперь его можно отправить поставщикам.')}catch(e){toast(e.message||String(e),'error')}finally{setBusy(false)}
  };
}
async function copyRfq(r,rfq){
  const lines=(r.lines||[]).map((l,i)=>(i+1)+'. '+(l.productName||l.productId)+' — '+qty(l.packageCount||l.quantity)+' уп. × '+qty(l.packageSize||1)+' '+(l.unit||'')+' = '+qty(l.quantity)+' '+(l.unit||'')).join('\n');
  const text=['Smart Horeca · Request for Quotation',rfq.number,'PR: '+r.number,'Срок ответа: '+(rfq.deadline||'—'),'Поставщики: '+(rfq.supplierNames||[]).join(', '),'',rfq.message||'Просим предоставить ценовое предложение.','',lines].join('\n');
  try{await navigator.clipboard.writeText(text);toast('RFQ скопирован. Можно отправить поставщику по email/WhatsApp.')}catch(e){toast('Не удалось скопировать RFQ: '+(e.message||e),'error')}
}
function showRfqSupplierLink(r,rfq,supplierId,result){
  const idx=(rfq.supplierIds||[]).findIndex(x=>key(x)===key(supplierId)),supplier=(rfq.supplierNames||[])[idx]||supplierId,link=result?.link||'';
  openModal('Ссылка для поставщика','RFQ · '+rfq.number,
    '<div class="proc-rfq-link-box"><strong>'+esc(supplier)+'</strong><p>Поставщик откроет ссылку без регистрации, укажет цены и условия. Ответ автоматически появится в сравнении RFQ.</p><textarea id="proc-rfq-link-value" readonly>'+esc(link)+'</textarea><small>Ссылка действует до '+esc(result?.expiresAt?new Date(result.expiresAt).toLocaleString('ru-RU'):'—')+'. Создание новой ссылки заменит предыдущую.</small></div><div class="proc-modal-actions"><button id="proc-rfq-link-close" type="button" class="proc-btn ghost">Закрыть</button><button id="proc-rfq-link-copy" type="button" class="proc-btn primary">Копировать ссылку</button></div>');
  $('proc-rfq-link-close').onclick=closeModal;
  $('proc-rfq-link-copy').onclick=async()=>{try{await navigator.clipboard.writeText(link);$('proc-rfq-link-copy').textContent='Скопировано ✓'}catch(e){const el=$('proc-rfq-link-value');el.focus();el.select();document.execCommand('copy');$('proc-rfq-link-copy').textContent='Скопировано ✓'}};
}
function openQuoteModal(r,rfqId=''){
  const rfq=(r.rfqs||[]).find(x=>key(x.id)===key(rfqId))||null;
  const allowed=rfq?new Set((rfq.supplierIds||[]).map(key)):null;
  const supplierHtml='<option value="">Выберите поставщика</option>'+state.refs.suppliers.filter(x=>!allowed||allowed.has(key(x.id))).map(x=>'<option value="'+esc(key(x.id))+'">'+esc(x.name)+'</option>').join('');
  openModal('Предложение поставщика · '+r.number,'СРАВНЕНИЕ ПОСТАВЩИКОВ','<form id="proc-quote-form"><div class="proc-form-grid"><label class="proc-field"><span>Поставщик</span><select id="proc-quote-supplier">'+supplierHtml+'</select></label><label class="proc-field"><span>Срок доставки, дней</span><input id="proc-quote-days" type="number" min="0" step="1" value="1"></label><label class="proc-field"><span>Предложение действует до</span><input id="proc-quote-valid" type="date" value="'+addDays(today(),7)+'"></label><label class="proc-field wide"><span>Условия оплаты</span><input id="proc-quote-payment" placeholder="Например: 7 дней / предоплата / по факту"></label><label class="proc-field wide"><span>Комментарий</span><textarea id="proc-quote-comment"></textarea></label></div><div class="proc-edit-lines"><div class="proc-edit-head"><strong>Цены предложения</strong><span class="proc-history-note">Если есть история накладных этого поставщика, подставим последнюю цену.</span></div><div id="proc-quote-lines">'+(r.lines||[]).map(l=>quoteLineHtml(l,'')).join('')+'</div></div><div class="proc-modal-summary"><span>Итого предложение</span><strong id="proc-quote-total">0,00 ₼</strong></div><div class="proc-modal-actions"><button type="button" id="proc-quote-cancel" class="proc-btn ghost">Отмена</button><button class="proc-btn primary">Сохранить предложение</button></div></form>');
  const bind=()=>document.querySelectorAll('[data-quote-line] input,[data-quote-line] select').forEach(x=>{x.oninput=recalcQuote;x.onchange=recalcQuote});bind();recalcQuote();$('proc-quote-cancel').onclick=closeModal;
  $('proc-quote-supplier').onchange=e=>{const sid=e.target.value;document.querySelectorAll('[data-quote-line]').forEach((row,i)=>{const l=r.lines[i],h=historyPrice(l.productId,sid);if(h)row.querySelector('[data-f="price"]').value=h.price});recalcQuote()};
  $('proc-quote-form').onsubmit=async e=>{e.preventDefault();try{setBusy(true);const sid=key($('proc-quote-supplier').value),sup=state.refs.suppliers.find(x=>key(x.id)===sid);if(!sid)throw Error('Выберите поставщика.');const lines=[...document.querySelectorAll('[data-quote-line]')].map(row=>{const pid=row.dataset.productId;const packageSize=num(row.querySelector('[data-f="packageSize"]').value,1),packageCount=num(row.querySelector('[data-f="packageCount"]').value);return{productId:pid,productName:productName(pid),unit:row.querySelector('[data-f="unit"]').value,quantity:packageSize*packageCount,packageSize,packageCount,containerId:key(row.querySelector('[data-f="containerId"]').value),packageName:row.querySelector('[data-f="packageName"]').value||'',vatPercent:num(row.querySelector('[data-f="vatPercent"]').value),unitPrice:num(row.querySelector('[data-f="price"]').value)}});await procPost('add-quote',{requisitionId:r.id,rfqId:rfq?.id||'',supplierId:sid,supplierName:sup?.name||'',deliveryDays:num($('proc-quote-days').value),paymentTerms:$('proc-quote-payment').value,validUntil:$('proc-quote-valid').value,comment:$('proc-quote-comment').value,lines});closeModal();await reloadProc();toast('Предложение поставщика сохранено.')}catch(err){toast(err.message||String(err),'error')}finally{setBusy(false)}};
}
async function simpleAction(action,id,message){try{setBusy(true);await procPost(action,{id});await reloadProc();toast(message)}catch(e){toast(e.message||String(e),'error')}finally{setBusy(false)}}
async function createPoFromQuote(reqId,quoteId){try{setBusy(true);await procPost('create-order',{requisitionId:reqId,quoteId});await reloadProc();toast('Заказ PO создан.');goProcurementView('orders')}catch(e){toast(e.message||String(e),'error')}finally{setBusy(false)}}
function openLinkInvoiceModal(o){
  const linked=new Set((o.receipts||[]).map(r=>String(r.iikoDocumentNumber||'').trim().toLowerCase()));
  const candidates=(state.historyDocs||[]).filter(d=>{
    const sameSupplier=!o.supplierId||key(d.supplierId)===key(o.supplierId);
    const sameStore=!o.warehouseId||key(d.storeId)===key(o.warehouseId)||(d.items||[]).some(x=>key(x.storeId)===key(o.warehouseId));
    const unlinked=!linked.has(String(d.documentNumber||'').trim().toLowerCase());
    return sameSupplier&&sameStore&&unlinked;
  }).slice(0,80);
  if(!candidates.length){toast('За последние 90 дней подходящих накладных этого поставщика и склада не найдено.','error');return}
  const opts=candidates.map((d,i)=>'<option value="'+i+'">'+esc((d.documentNumber||'без №')+' · '+String(d.dateIncoming||d.incomingDate||'').slice(0,10)+' · '+money(d.sum||d.documentSum||0))+'</option>').join('');
  openModal('Привязать накладную к '+o.number,'PO ↔ ПРИЁМКА ↔ НАКЛАДНАЯ','<div class="proc-form-grid"><label class="proc-field wide"><span>Существующая приходная накладная</span><select id="proc-link-invoice">'+opts+'</select></label></div><div id="proc-link-preview" class="proc-edit-lines"></div><div class="proc-history-note">Подходит для накладных, созданных вручную или через AI Документы. Smart Horeca не создаёт дубликат — только связывает существующий документ с PO и проверяет количество/цены.</div><div class="proc-modal-actions"><button id="proc-link-cancel" type="button" class="proc-btn ghost">Отмена</button><button id="proc-link-save" type="button" class="proc-btn primary">Связать с PO</button></div>');
  function selected(){return candidates[Number($('proc-link-invoice').value||0)]}
  function preview(){const d=selected();$('proc-link-preview').innerHTML='<div class="proc-edit-head"><strong>'+esc(d?.documentNumber||'Накладная')+'</strong><span class="proc-history-note">'+esc(d?.supplierName||'')+'</span></div>'+(d?.items||[]).map(x=>{const l=procurementLineFromInvoiceItem(x);return '<div class="proc-line"><span>'+esc(x.productName||x.productId||'Товар')+'</span><strong>'+qty(l.packageCount)+' уп. × '+qty(l.packageSize)+' '+esc(l.unit)+'</strong><span>'+money(x.price)+'/уп. · НДС '+num(x.vatPercent)+'% · '+money(x.sum||l.packageCount*num(x.price))+'</span></div>'}).join('')}
  $('proc-link-invoice').onchange=preview;preview();$('proc-link-cancel').onclick=closeModal;
  $('proc-link-save').onclick=async()=>{const d=selected();if(!d)return;const lines=(d.items||[]).map(procurementLineFromInvoiceItem).filter(x=>x.productId&&x.quantity>0);try{setBusy(true);await procPost('receive-order',{id:o.id,iikoDocumentNumber:d.documentNumber||d.incomingDocumentNumber||'',iikoDocumentId:d.id||'',iikoStatus:d.status||'PROCESSED',documentDate:String(d.dateIncoming||d.incomingDate||today()).slice(0,10),comment:d.comment||('Связано с '+o.number),lines});closeModal();await reloadProc();toast('Накладная привязана к PO. Выполнена сверка количества и цен.')}catch(e){toast(e.message||String(e),'error')}finally{setBusy(false)}};
}
function receiptLineHtml(l){
  const packageSize=num(l.packageSize,1)||1,packageCount=Math.max(0,num(l.remainingQty)/packageSize),vat=num(l.vatPercent,0);
  return '<div class="proc-edit-row proc-pack-row" data-receipt-line data-product-id="'+esc(l.productId)+'"><div class="proc-field"><span>Товар</span><input value="'+esc(l.productName||l.productId)+'" disabled></div><div class="proc-field proc-package-field"><span>Фасовка</span><select data-f="packageChoice">'+packagingChoiceHtml(l.productId,{containerId:l.containerId,packageSize,packageName:l.packageName})+'</select><input data-f="packageSize" type="number" min="0.001" step="0.001" value="'+packageSize+'"></div><div class="proc-field"><span>Упаковок</span><input data-f="packageCount" type="number" min="0.001" step="0.001" value="'+packageCount+'"></div><div class="proc-field"><span>Итого '+esc(l.unit||'ед.')+'</span><input data-f="quantity" type="number" readonly value="'+num(l.remainingQty)+'"></div><div class="proc-field"><span>НДС</span><select data-f="vatPercent">'+vatOptions(vat)+'</select></div><div class="proc-field"><span>Цена / упак.</span><input data-f="price" type="number" min="0.01" step="0.01" value="'+num(l.unitPrice)+'"></div><strong class="line-total">'+money(packageCount*num(l.unitPrice))+'</strong><span></span><input data-f="containerId" type="hidden" value="'+esc(l.containerId||'')+'"><input data-f="packageName" type="hidden" value="'+esc(l.packageName||'')+'"><input data-f="unit" type="hidden" value="'+esc(l.unit||'')+'"></div>';
}
function recalcReceipt(){
  let total=0;document.querySelectorAll('[data-receipt-line]').forEach(row=>{const pack=num(row.querySelector('[data-f="packageSize"]').value,1),count=num(row.querySelector('[data-f="packageCount"]').value),price=num(row.querySelector('[data-f="price"]').value);row.querySelector('[data-f="quantity"]').value=(pack*count).toFixed(3).replace(/\.000$/,'');const v=count*price;total+=v;row.querySelector('.line-total').textContent=money(v)});if($('proc-receipt-total'))$('proc-receipt-total').textContent=money(total)
}
function bindReceiptPackaging(){
  document.querySelectorAll('[data-receipt-line]').forEach(row=>{row.querySelector('[data-f="packageChoice"]').onchange=()=>{applyPackagingChoice(row);recalcReceipt()};['packageSize','packageCount','price'].forEach(name=>row.querySelector('[data-f="'+name+'"]').oninput=recalcReceipt);row.querySelector('[data-f="vatPercent"]').onchange=recalcReceipt;applyPackagingChoice(row)});
}
function pendingKey(){return 'shProcurementPendingReceipt'}
function rememberPending(p){try{localStorage.setItem(pendingKey(),JSON.stringify(p))}catch(_){}}
function clearPending(){try{localStorage.removeItem(pendingKey())}catch(_){}}
async function registerReceipt(payload){const out=await procPost('receive-order',payload);clearPending();return out}
async function flushPending(){
  let p=null;try{p=JSON.parse(localStorage.getItem(pendingKey())||'null')}catch(_){}
  if(!p?.id)return;
  try{await registerReceipt(p);await loadProcurement();toast('Восстановлена связь ранее созданной накладной с PO.')}catch(e){console.warn('Pending procurement receipt not registered',e)}
}
function openReceiptModal(o){
  const lines=(o.lines||[]).filter(x=>num(x.remainingQty)>0.0005);if(!lines.length){toast('Заказ уже полностью принят.','error');return}
  const draftNo='RC-'+Date.now().toString().slice(-9);
  openModal('Приёмка · '+o.number,'ФАКТИЧЕСКОЕ ИСПОЛНЕНИЕ PO','<div class="proc-form-grid"><label class="proc-field"><span>Поставщик</span><input value="'+esc(o.supplierName||o.supplierId)+'" disabled></label><label class="proc-field"><span>Склад</span><input value="'+esc(o.warehouseName||o.warehouseId)+'" disabled></label><label class="proc-field"><span>Дата</span><input id="proc-receipt-date" type="date" value="'+today()+'"></label><label class="proc-field"><span>Номер накладной</span><input id="proc-receipt-number" value="'+draftNo+'"></label><label class="proc-field"><span>PO / входящий номер</span><input value="'+esc(o.number)+'" disabled></label><label class="proc-field"><span>Статус</span><input value="Приёмка товара" disabled></label></div><div class="proc-edit-lines"><div class="proc-edit-head"><strong>Фактически получено</strong><span class="proc-history-note">Можно принять заказ частично.</span></div><div id="proc-receipt-lines">'+lines.map(receiptLineHtml).join('')+'</div></div><div class="proc-modal-summary"><span>Итого фактической поставки</span><strong id="proc-receipt-total">0,00 ₼</strong></div><div class="proc-history-note">После сохранения Smart Horeca создаст приходную накладную на связанном Server. Проведение сразу обновит склад.</div><div class="proc-receipt-choice"><button id="proc-receipt-cancel" class="proc-btn ghost" type="button">Отмена</button><button id="proc-receipt-save" class="proc-btn secondary" type="button">Сохранить без проведения</button><button id="proc-receipt-post" class="proc-btn primary" type="button">Сохранить и провести</button></div>');
  bindReceiptPackaging();recalcReceipt();$('proc-receipt-cancel').onclick=closeModal;
  async function save(process){
    let documentNumber=$('proc-receipt-number').value.trim()||draftNo;
    const rlines=[...document.querySelectorAll('[data-receipt-line]')].map(row=>{const pid=key(row.dataset.productId),packageSize=num(row.querySelector('[data-f="packageSize"]').value),packageCount=num(row.querySelector('[data-f="packageCount"]').value),vatPercent=num(row.querySelector('[data-f="vatPercent"]').value),unitPrice=num(row.querySelector('[data-f="price"]').value),containerId=key(row.querySelector('[data-f="containerId"]').value);if(productPackagings(pid).length&&!containerId)throw Error(productName(pid)+': выберите фасовку из iiko.');if(!(packageSize>0))throw Error(productName(pid)+': фасовка не определена в iiko.');return{productId:pid,productName:productName(pid),unit:row.querySelector('[data-f="unit"]').value,quantity:packageSize*packageCount,packageSize,packageCount,containerId,packageName:row.querySelector('[data-f="packageName"]').value||'',vatPercent,unitPrice}}).filter(x=>x.quantity>0&&x.packageCount>0);
    if(!rlines.length){toast('Укажите фактически принятое количество.','error');return}
    try{
      setBusy(true);setStatus('Создаём приходную накладную на Smart Horeca Server…');
      const document={documentNumber,dateIncoming:$('proc-receipt-date').value+'T00:00:00',supplierId:o.supplierId,defaultStore:o.warehouseId,incomingDocumentNumber:o.number,comment:'Smart Horeca Procurement · '+o.number,items:rlines.map((x,i)=>{const sum=x.packageCount*x.unitPrice,vatSum=x.vatPercent>0?sum*x.vatPercent/(100+x.vatPercent):0;return{num:i+1,productId:x.productId,amount:x.packageCount,actualAmount:x.quantity,actualUnitWeight:x.packageSize,amountUnit:x.unit,containerId:x.containerId||undefined,vatPercent:x.vatPercent,vatSum:Number(vatSum.toFixed(2)),priceWithoutVat:Number((x.vatPercent>0?x.unitPrice/(1+x.vatPercent/100):x.unitPrice).toFixed(4)),price:x.unitPrice,sum,store:o.warehouseId}}),documentTotal:rlines.reduce((s,x)=>s+x.packageCount*x.unitPrice,0)};
      const rr=await (window.SH_IikoContext?.fetchWithTimeout||fetch)('/api/iiko/document-action',{method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify({connection:state.binding.connection,type:'incoming',action:process?'save-and-process':'save',document,departmentIds:state.binding.departmentIds||[],chainScope:chainScope()})},90000);
      const x=await rr.json().catch(()=>({}));if(!rr.ok||x.success===false)throw Error(x.message||('Server HTTP '+rr.status));
      documentNumber=x.validation?.documentNumber||x.validation?.otherSuggestedNumber||documentNumber;
      const payload={id:o.id,iikoDocumentNumber:documentNumber,iikoStatus:process?'PROCESSED':'DRAFT',documentDate:$('proc-receipt-date').value,comment:'Smart Horeca Procurement · '+o.number,lines:rlines};
      rememberPending(payload);
      try{await registerReceipt(payload)}catch(linkError){try{await registerReceipt(payload)}catch(second){throw Error('Накладная '+documentNumber+' создана, но связь с PO временно не сохранилась: '+second.message)}}
      closeModal();await reloadProc();toast(process?'Поставка принята и накладная проведена.':'Поставка сохранена черновиком и привязана к PO.');
    }catch(e){toast(e.message||String(e),'error')}finally{setBusy(false)}
  }
  $('proc-receipt-save').onclick=()=>save(false);$('proc-receipt-post').onclick=()=>save(true);
}
async function copyPo(o){
  const lines=(o.lines||[]).map((l,i)=>(i+1)+'. '+(l.productName||l.productId)+' — '+qty(l.packageCount||l.orderedQty)+' уп. × '+qty(l.packageSize||1)+' '+(l.unit||'')+' = '+qty(l.orderedQty)+' '+(l.unit||'')+' · '+money(l.unitPrice)+'/уп. · НДС '+num(l.vatPercent)+'%').join('\n');
  const text=['Smart Horeca · Purchase Order',o.number,'Поставщик: '+(o.supplierName||o.supplierId),'Склад: '+(o.warehouseName||o.warehouseId),'',lines,'','Итого: '+money(o.totalAmount),'Комментарий: '+(o.comment||'—')].join('\n');
  try{await navigator.clipboard.writeText(text);toast('PO скопирован. Можно отправить поставщику в удобном канале.')}catch(e){toast('Не удалось скопировать PO: '+(e.message||e),'error')}
}
async function reloadProc(){await loadProcurement();renderAll()}
async function loadAll(){
  try{
    setBusy(true);state.cacheWarnings=[];setStatus('Загружаем закупки…');
    state.token=await authToken();state.binding=await window.SH_IikoContext.getBinding();
    if(!state.binding?.connection?.ip)throw Error('Сначала подключите Smart Horeca Server в настройках.');

    // D1 procurement data must stay usable even if one heavy SH Server report is slow.
    await loadProcurement();
    renderAll();applyProcurementView();
    document.documentElement.style.visibility='visible';

    const view=state.view||currentProcurementView(),canCost=window.SHAccess?.can?.('procurement.prices.view')||window.SHAccess?.can?.('sensitive.cost.view')||false;
    const tasks=[];
    if(['catalog','sourcing','suppliers','receiving','norms'].includes(view))tasks.push(['Справочники',loadReferences]);
    if(['catalog','norms'].includes(view))tasks.push(['Остатки',loadStocks]);
    if(canCost&&['catalog','sourcing'].includes(view))tasks.push(['История цен',loadHistory]);
    if(canCost&&['sourcing','suppliers','analytics'].includes(view))tasks.push(['Баланс поставщиков',loadSupplierBalances]);
    setStatus(tasks.length?'Загружаем данные раздела…':'Данные закупок загружены.');
    const results=await Promise.allSettled(tasks.map(x=>x[1]()));
    const warnings=[];
    results.forEach((r,i)=>{if(r.status==='rejected'){const msg=r.reason?.message||String(r.reason);warnings.push(tasks[i][0]+': '+msg);console.warn('Procurement optional load failed',tasks[i][0],r.reason)}});

    if(['orders','receiving'].includes(view)){try{await reconcileLinkedReceipts()}catch(e){warnings.push('Сверка накладных: '+(e?.message||String(e)));console.warn('Procurement reconciliation failed',e)}}
    renderAll();applyProcurementView();
    try{await flushPending()}catch(e){console.warn('Pending receipt flush failed',e)}

    const allWarnings=[...state.cacheWarnings,...warnings];
    if(allWarnings.length){
      setStatus('Модуль загружен. '+allWarnings.join(' · '),'warning');
    }else{
      setStatus('Данные закупок обновлены.','ok');setTimeout(()=>setStatus(''),2500);
    }
  }catch(e){
    console.error(e);setStatus(e.message||String(e),'error');document.documentElement.style.visibility='visible';
  }finally{setBusy(false);document.documentElement.style.visibility='visible'}
}
async function saveSettings(e){
  e.preventDefault();try{setBusy(true);const m=num($('proc-limit-manager').value),d=num($('proc-limit-director').value);if(d<m)throw Error('Лимит директора должен быть не меньше лимита менеджера.');const settings={approvalTiers:[{code:'MANAGER',name:'Менеджер',maxAmount:m},{code:'DIRECTOR',name:'Директор',maxAmount:d},{code:'OWNER',name:'Владелец',maxAmount:null}],autoNeedEnabled:$('proc-auto-needs').checked,defaultLeadDays:Math.max(0,Math.round(num($('proc-lead-days').value))),allowOverReceipt:$('proc-over-receipt').checked,targetMode:'MAX_OR_MIN'};await procPost('save-settings',{settings});await reloadProc();toast('Настройки закупок сохранены.')}catch(err){toast(err.message||String(err),'error')}finally{setBusy(false)}
}
function bind(){
  state.view=currentProcurementView();
  // Apply the requested workflow section before any API calls so the default catalog never flashes.
  applyProcurementView();
  document.body?.classList.remove('procurement-view-booting');
  document.documentElement.style.visibility='visible';
  $('proc-modal-close').onclick=closeModal;$('proc-modal').addEventListener('click',e=>{if(e.target===$('proc-modal'))closeModal()});document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('proc-modal').hidden)closeModal()});
  document.querySelectorAll('.proc-tabs button[data-tab]').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  $('proc-refresh').onclick=loadAll;$('proc-new-pr').onclick=()=>openPrModal();
  $('proc-needs-search').oninput=renderNeeds;$('proc-needs-store').onchange=()=>{state.selectedNeeds.clear();renderNeeds()};$('proc-needs-filter').onchange=renderNeeds;
  $('proc-norms-search').oninput=renderNorms;$('proc-norms-store').onchange=renderNorms;$('proc-norms-filter').onchange=renderNorms;$('proc-norms-save').onclick=saveNorms;
  if($('proc-suppliers-search'))$('proc-suppliers-search').oninput=renderSuppliers;
  if($('proc-supplier-master-table'))$('proc-supplier-master-table').addEventListener('click',e=>{const b=e.target.closest('[data-supplier-edit]');if(!b)return;const s=(state.refs.suppliers||[]).find(x=>key(x.id)===key(b.dataset.supplierEdit));if(s)openSupplierModal(s)});
  $('proc-norms-table').addEventListener('input',e=>{const row=e.target.closest('[data-norm-row]');if(!row)return;updateNormDraftFromRow(row);renderKpis()});
  $('proc-norms-table').addEventListener('change',e=>{const row=e.target.closest('[data-norm-row]');if(!row)return;updateNormDraftFromRow(row)});
  $('proc-select-all-needs').onclick=()=>{
    const visible=[...document.querySelectorAll('#proc-needs-table [data-need]:not(:disabled)')];if(!visible.length)return;
    const all=visible.every(x=>x.checked);
    visible.forEach(x=>{x.checked=!all;if(!all)state.selectedNeeds.add(x.dataset.need);else state.selectedNeeds.delete(x.dataset.need)});
    $('proc-create-selected').disabled=state.selectedNeeds.size===0;
  };
  $('proc-create-selected').onclick=()=>{
    const rows=state.purchaseRows.filter(x=>state.selectedNeeds.has(x.id));if(!rows.length)return;
    openPrModal(rows);
  };
  $('proc-needs-table').addEventListener('change',e=>{
    const checkbox=e.target.closest('[data-need]');if(!checkbox)return;
    checkbox.checked?state.selectedNeeds.add(checkbox.dataset.need):state.selectedNeeds.delete(checkbox.dataset.need);
    $('proc-create-selected').disabled=state.selectedNeeds.size===0;
  });
  $('proc-needs-table').addEventListener('click',e=>{
    const b=e.target.closest('[data-create-need]');if(!b)return;
    const row=state.purchaseRows.find(x=>x.id===b.dataset.createNeed);if(row)openPrModal([row]);
  });
  $('proc-pr-list').addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;const id=b.dataset.prEdit||b.dataset.prSubmit||b.dataset.prApprove||b.dataset.prCancel||b.dataset.prClose||b.dataset.prQuote||b.dataset.poCreate||b.dataset.rfqCreate||b.dataset.rfqCopy||b.dataset.rfqSend||b.dataset.rfqClose||b.dataset.rfqLink;if(!id)return;
    const r=(state.data?.requisitions||[]).find(x=>x.id===id)||(state.data?.requisitions||[]).find(x=>(x.rfqs||[]).some(q=>q.id===id));
    if(b.dataset.prEdit&&r)return openPrModal([],r);
    if(b.dataset.rfqCreate&&r)return openRfqModal(r);
    if((b.dataset.rfqCopy||b.dataset.rfqSend||b.dataset.rfqClose||b.dataset.rfqLink)&&r){
      const rfq=(r.rfqs||[]).find(x=>x.id===id);if(!rfq)return;
      if(b.dataset.rfqCopy)return copyRfq(r,rfq);
      if(b.dataset.rfqLink)return procPost('create-rfq-link',{id:rfq.id,supplierId:b.dataset.supplier}).then(result=>showRfqSupplierLink(r,rfq,b.dataset.supplier,result)).catch(e=>toast(e.message||String(e),'error'));
      if(b.dataset.rfqSend)return simpleAction('send-rfq',rfq.id,'RFQ отмечен как отправленный поставщикам.');
      if(b.dataset.rfqClose&&confirm('Закрыть '+rfq.number+'?'))return simpleAction('close-rfq',rfq.id,'RFQ закрыт.');
    }
    if(b.dataset.prQuote&&r)return openQuoteModal(r,b.dataset.rfq||'');
    if(b.dataset.prClose&&r){const reason=prompt('Причина ручного закрытия '+r.number+':');if(reason?.trim())return procPost('close-requisition',{id:r.id,reason:reason.trim()}).then(()=>reloadProc()).then(()=>toast('Заявка закрыта.')).catch(e=>toast(e.message||String(e),'error'));return}
    if(b.dataset.poCreate)return createPoFromQuote(b.dataset.poCreate,b.dataset.quote);
    if(b.dataset.prSubmit)return simpleAction('submit-requisition',id,'Заявка отправлена на согласование.');
    if(b.dataset.prApprove)return simpleAction('approve-requisition',id,'Заявка согласована.');
    if(b.dataset.prCancel&&confirm('Отменить заявку '+(r?.number||'')+'?'))return simpleAction('cancel-requisition',id,'Заявка отменена.');
  });
  $('proc-po-list').addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;const id=b.dataset.poSend||b.dataset.poConfirm||b.dataset.poReceive||b.dataset.poLink||b.dataset.poCopy||b.dataset.poCancel;if(!id)return;const o=(state.data?.orders||[]).find(x=>x.id===id);
    if(b.dataset.poReceive&&o)return openReceiptModal(o);
    if(b.dataset.poLink&&o)return openLinkInvoiceModal(o);
    if(b.dataset.poCopy&&o)return copyPo(o);
    if(b.dataset.poSend)return simpleAction('send-order',id,'PO отмечен как отправленный поставщику.');
    if(b.dataset.poConfirm)return simpleAction('confirm-order',id,'Поставщик подтвердил заказ.');
    if(b.dataset.poCancel&&confirm('Отменить PO '+(o?.number||'')+'?'))return simpleAction('cancel-order',id,'PO отменён.');
  });
  $('proc-settings-form').onsubmit=saveSettings;
  window.addEventListener('sh:iiko-selection-changed',()=>location.reload());
  loadAll();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind,{once:true});else bind();
})();