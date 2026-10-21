(()=>{'use strict';
const $=id=>document.getElementById(id);
const state={token:'',data:null,pane:'lots',lotId:'',action:'TRANSFER',busy:false,pendingOperation:null};
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=x=>Number(x||0).toLocaleString('ru-RU',{maximumFractionDigits:3});
const dt=x=>{if(!x)return'—';const d=new Date(x);return Number.isNaN(d.getTime())?esc(x):d.toLocaleString('ru-RU',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})};
const day=x=>x?String(x).slice(0,10).split('-').reverse().join('.'): '—';
const id=()=>crypto.randomUUID();
const findLot=lotId=>(state.data?.lots||[]).find(x=>x.id===lotId);
const findLocation=locId=>(state.data?.locations||[]).find(x=>x.id===locId);
const status=(message='',kind='')=>{const el=$('trace-status');el.textContent=message;el.className='trace-status'+(kind?' '+kind:'')};
const actionNames={RECEIVE:'Приёмка',TRANSFER:'Перемещение',ISSUE:'Выдача',WRITE_OFF:'Списание',CONSUME:'Израсходовано',HOLD:'Карантин',RELEASE:'Снятие карантина'};
const kindNames={CHILLER:'Холодильник',FREEZER:'Морозильник',SHELF:'Полка',ROOM:'Помещение',KITCHEN:'Кухня / цех',OTHER:'Другое'};
function selectOptions(rows,selected='',blank='Выберите…'){
  return '<option value="">'+esc(blank)+'</option>'+rows.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===selected?' selected':'')+'>'+esc(x.label)+'</option>').join('');
}
async function api(path,options={}) {
  const headers=new Headers(options.headers||{});
  headers.set('Authorization','Bearer '+state.token);
  if(options.body)headers.set('Content-Type','application/json');
  const fn=window.SH_IikoContext?.fetchWithTimeout||fetch;
  const r=await fn(path,{...options,headers,cache:'no-store'},45000);
  const data=await r.json().catch(()=>({}));
  if(!r.ok||data.success===false)throw Error(data.message||('HTTP '+r.status));
  return data;
}
async function post(action,values){
  if(state.busy)return;
  state.busy=true;document.querySelectorAll('button').forEach(b=>{if(b.closest('.trace-app'))b.disabled=true});
  status('Сохраняем действие…');
  const signature=JSON.stringify([action,values]);
  const requestId=state.pendingOperation?.signature===signature?state.pendingOperation.requestId:id();
  state.pendingOperation={signature,requestId};
  try{
    const response=await api('/api/procurement-trace',{method:'POST',body:JSON.stringify({action,requestId,...values})});
    state.pendingOperation=null;
    try{
      await load(true);
      status('Действие успешно зарегистрировано.','ok');
    }catch(_){
      status('Действие зарегистрировано, но обновить список не удалось. Нажмите «Обновить».','error');
    }
    return response;
  }catch(error){status(error.message||String(error),'error');throw error}
  finally{state.busy=false;document.querySelectorAll('button').forEach(b=>{if(b.closest('.trace-app'))b.disabled=false})}
}
async function load(quiet=false){
  if(!quiet)status('Обновляем партии и места хранения…');
  try{
    state.data=await api('/api/procurement-trace');
    const deepId=new URLSearchParams(location.search).get('lot');
    if(!state.lotId&&deepId)state.lotId=deepId;
    if(state.lotId&&!findLot(state.lotId))state.lotId='';
    render();
    if(!quiet)status('');
  }catch(error){status(error.message||String(error),'error');if(!quiet)renderEmpty();throw error}
}
function renderEmpty(){
  $('trace-lots-body').innerHTML='<tr><td colspan="7" class="trace-empty">Данные не загружены. Нажмите «Обновить».</td></tr>';
}
function pane(name){
  state.pane=name;
  document.querySelectorAll('[data-pane]').forEach(b=>b.classList.toggle('active',b.dataset.pane===name));
  document.querySelectorAll('[data-pane-panel]').forEach(x=>x.hidden=x.dataset.panePanel!==name);
}
function render(){
  const data=state.data;if(!data)return;
  const lots=data.lots||[],now=new Date(),inThree=new Date(now.getTime()+3*86400000).toISOString().slice(0,10);
  const expiring=lots.filter(x=>x.expiresOn&&x.expiresOn<=inThree&&x.remaining>0.00001);
  const stats=[['Активные партии',lots.filter(x=>x.status==='ACTIVE'&&x.remaining>0.00001).length],
    ['Партии на карантине',lots.filter(x=>x.status==='HOLD').length],
    ['Истекли / ≤ 3 дней',expiring.length],
    ['GRN без полного размещения',(data.receipts||[]).filter(x=>x.remaining>0.00001).length]];
  $('trace-metrics').innerHTML=stats.map(([label,value])=>'<article><span>'+esc(label)+'</span><strong>'+fmt(value)+'</strong></article>').join('');
  renderLots();renderLotCard();renderReceipts();renderLocations();renderHistory();
}
function renderLots(){
  const search=$('trace-search').value.toLowerCase().trim(),filter=$('trace-filter').value;
  const rows=(state.data.lots||[]).filter(x=>{
    const expired=x.expiresOn&&x.expiresOn<new Date().toISOString().slice(0,10);
    if(filter==='active'&&(x.status!=='ACTIVE'||x.remaining<=0))return false;
    if(filter==='hold'&&x.status!=='HOLD')return false;
    if(filter==='expired'&&!expired)return false;
    const storage=(x.balances||[]).map(b=>b.locationName).join(' ');
    return !search||[x.productName,x.lotCode,x.supplierName,storage].join(' ').toLowerCase().includes(search);
  });
  $('trace-lots-body').innerHTML=rows.length?rows.map(x=>{
    const expired=x.expiresOn&&x.expiresOn<new Date().toISOString().slice(0,10);
    const badge=x.status==='HOLD'?'<span class="trace-label hold">Карантин</span>':expired?'<span class="trace-label expired">Срок истёк</span>':x.remaining<=0?'<span class="trace-label">Израсходовано</span>':'<span class="trace-label">Активна</span>';
    return '<tr><td><strong>'+esc(x.productName)+'</strong><small>'+esc(x.lotCode)+'</small></td>'+
      '<td>'+esc(x.supplierName||'—')+'</td><td>'+day(x.expiresOn)+'</td>'+
      '<td>'+fmt(x.remaining)+' '+esc(x.unit||'')+'<small>Принято: '+fmt(x.receivedQty)+'</small></td>'+
      '<td>'+((x.balances||[]).filter(b=>b.quantity>0.00001).map(b=>esc(b.locationName)+' · '+fmt(b.quantity)).join('<br>')||'—')+'</td>'+
      '<td>'+badge+'</td><td><button class="proc-btn small secondary" data-lot-open="'+esc(x.id)+'">Открыть</button></td></tr>';
  }).join(''):'<tr><td colspan="7" class="trace-empty">Партий пока нет. Зарегистрируйте первую из принятого GRN.</td></tr>';
}
function renderLotCard(){
  const x=findLot(state.lotId),el=$('trace-lot-card');
  if(!x){el.hidden=true;el.innerHTML='';return}
  el.hidden=false;
  const manage=state.data.canManage,release=state.data.canRelease,writeOff=state.data.canWriteOff;
  const actions=manage?(
    (x.status==='ACTIVE'?['TRANSFER','ISSUE','CONSUME','HOLD',...(writeOff?['WRITE_OFF']:[])]:writeOff?['WRITE_OFF']:[]).map(a=>
      '<button type="button" data-move-mode="'+a+'" class="'+(state.action===a?'active ':'')+(a==='WRITE_OFF'||a==='HOLD'?'alert':'')+'">'+esc(actionNames[a])+'</button>').join('')+
    (x.status==='HOLD'&&release?'<button type="button" data-move-mode="RELEASE">Снять карантин</button>':'')
  ):(x.status==='HOLD'&&release?'<button type="button" data-move-mode="RELEASE">Снять карантин</button>':'');
  const lotMovements=(state.data.movements||[]).filter(m=>m.lotId===x.id);
  const moveHistory=lotMovements.map(m=>'<tr><td>'+dt(m.at)+'</td><td>'+esc(actionNames[m.action]||m.action)+'</td>'+
    '<td>'+fmt(m.quantity)+' '+esc(x.unit)+'</td><td>'+esc(findLocation(m.fromId)?.name||'—')+
    ' → '+esc(findLocation(m.toId)?.name||m.destination||'—')+'</td><td>'+esc(m.actor)+'<small>'+esc(m.reason||m.reference||'')+'</small></td></tr>').join('');
  el.innerHTML='<div class="trace-heading"><div><h3>'+esc(x.productName)+' · '+esc(x.lotCode)+'</h3>'+
    '<div class="trace-muted">Поставщик: '+esc(x.supplierName||'—')+' · GRN: '+esc((state.data.receipts||[]).find(r=>r.grnId===x.grnId)?.grnNumber||x.grnId)+'</div></div>'+
    '<button class="proc-btn ghost small" id="trace-close-card" type="button">Закрыть ×</button></div>'+
    '<div class="trace-detail"><span>Принято: <strong>'+fmt(x.receivedQty)+' '+esc(x.unit)+'</strong></span>'+
    '<span>Остаток: <strong>'+fmt(x.remaining)+' '+esc(x.unit)+'</strong></span>'+
    '<span>Срок: <strong>'+day(x.expiresOn)+'</strong></span>'+
    '<span>Статус: <strong>'+(x.status==='HOLD'?'Карантин':'Активна')+'</strong></span></div>'+
    '<div class="trace-actions">'+actions+'</div><div id="trace-movement-form"></div>'+
    '<h3>Цепочка движения</h3><div class="trace-table-scroll"><table class="trace-table"><thead><tr>'+
    '<th>Когда</th><th>Операция</th><th>Количество</th><th>Откуда → куда</th><th>Сотрудник / основание</th></tr></thead>'+
    '<tbody>'+(moveHistory||'<tr><td colspan="5" class="trace-empty">Нет зарегистрированных операций</td></tr>')+'</tbody></table></div>';
  $('trace-close-card').onclick=()=>{state.lotId='';el.hidden=true};
  el.querySelectorAll('[data-move-mode]').forEach(b=>b.onclick=()=>{
    state.action=b.dataset.moveMode;renderLotCard();$('trace-movement-form')?.scrollIntoView({block:'nearest',behavior:'smooth'});
  });
  if(actions)renderMovementForm(x);
}
function renderMovementForm(lot){
  let action=state.action;
  if(lot.status==='HOLD'&&!['WRITE_OFF','RELEASE'].includes(action))action=state.data.canWriteOff?'WRITE_OFF':'RELEASE';
  if(action==='RELEASE'&&!state.data.canRelease)action=state.data.canWriteOff?'WRITE_OFF':'TRANSFER';
  if(action==='HOLD'&&lot.status==='HOLD')action='WRITE_OFF';
  const holder=$('trace-movement-form'),isStatus=['HOLD','RELEASE'].includes(action);
  const from=(lot.balances||[]).filter(x=>x.quantity>0.00001).map(x=>({id:x.locationId,label:x.locationName+' · '+fmt(x.quantity)+' '+lot.unit}));
  const to=(state.data.locations||[]).filter(x=>x.warehouseId===lot.warehouseId&&x.active).map(x=>({id:x.id,label:x.name}));
  let inputs='';
  if(!isStatus){
    inputs='<label>Откуда<select name="fromId" required>'+selectOptions(from,'','Выберите место с остатком')+'</select></label>';
    if(action==='TRANSFER')inputs+='<label>Куда<select name="toId" required>'+selectOptions(to,'','Выберите холодильник / кухню')+'</select></label>';
    inputs+='<label>Количество ('+esc(lot.unit||'баз. ед.')+')<input name="quantity" type="number" required min="0.001" step="0.001" max="'+lot.remaining+'" placeholder="0"></label>';
    if(['ISSUE','CONSUME'].includes(action))inputs+='<label>Кому / куда выдали<input name="destination" required maxlength="150" placeholder="Кухня, мясной цех, производственная партия"></label>';
    inputs+='<label>Номер документа / ссылка<input name="reference" maxlength="100" placeholder="Акт, смена, заявка…"></label>';
  }
  inputs+='<label class="trace-wide">Причина / комментарий'+(isStatus||action==='WRITE_OFF'?' *':'')+
    '<input name="reason" maxlength="500" '+(isStatus||action==='WRITE_OFF'?'required':'')+' placeholder="Качество, срок годности, передача на кухню…"></label>';
  holder.innerHTML='<form id="trace-move-form" class="trace-form">'+inputs+'<div class="trace-form-actions trace-wide">'+
    '<button class="proc-btn primary" type="submit">'+(action==='HOLD'?'Отправить на карантин':action==='RELEASE'?'Подтвердить снятие карантина':actionNames[action])+'</button>'+
    '</div></form>'+(action==='TRANSFER'?'<p class="trace-muted">Для непрерывного учёта на кухне создайте место типа «Кухня / цех» и перемещайте туда товар. После приготовления отметьте «Израсходовано».</p>':'');
  $('trace-move-form').onsubmit=async e=>{
    e.preventDefault();const form=e.currentTarget,values=Object.fromEntries(new FormData(form));
    if(action==='HOLD'||action==='RELEASE'){
      if(!confirm(action==='RELEASE'?'Подтвердить снятие карантина?':'Заблокировать выдачу и перемещения этой партии?'))return;
      try{await post('SET_HOLD',{lotId:lot.id,status:action==='HOLD'?'HOLD':'ACTIVE',reason:values.reason})}catch(_){}
    }else{
      if(action==='WRITE_OFF'&&!confirm('Это изменение только учёта полок Smart Horeca. Проведённый акт списания в Smart Horeca Server должен существовать отдельно. Отметить списание '+values.quantity+' '+lot.unit+' по партии '+lot.lotCode+'?'))return;
      try{await post('MOVE',{lotId:lot.id,movement:action,...values})}catch(_){}
    }
  };
}
function renderReceipts(){
  const select=$('trace-receipt'),prior=select.value;
  const rows=(state.data.receipts||[]).filter(x=>x.remaining>0.00001);
  select.innerHTML='<option value="">Выберите GRN и товар</option>'+rows.map((x,i)=>
    '<option value="'+i+'">'+esc(x.grnNumber)+' · '+esc(x.productName)+' · '+esc(x.supplierName||'—')+
    ' · '+fmt(x.remaining)+' '+esc(x.unit)+'</option>').join('');
  if([...select.options].some(o=>o.value===prior))select.value=prior;
  if(!state.data.canManage){$('trace-receipt-form').hidden=true;$('trace-receipt-info').textContent='Для регистрации партий требуется право на приёмку закупок.'}
  else $('trace-receipt-form').hidden=false;
  receiptChanged();
}
function receiptChanged(){
  const n=$('trace-receipt').value,rows=(state.data?.receipts||[]).filter(x=>x.remaining>0.00001);
  const r=n===''?null:rows[Number(n)];
  const place=$('trace-receipt-location'),old=place.value;
  const locations=(state.data?.locations||[]).filter(x=>x.active&&x.warehouseId===r?.warehouseId).map(x=>({id:x.id,label:x.name+' · '+(kindNames[x.kind]||x.kind)}));
  place.innerHTML=selectOptions(locations,old,'Место хранения на складе поставки');
  const info=$('trace-receipt-info');
  info.textContent=r?'Поставщик: '+r.supplierName+' · Склад: '+r.warehouseName+' · GRN: '+r.grnNumber+' · Принято: '+fmt(r.quantity)+' '+r.unit+' · Уже размещено: '+fmt(r.registered)+' · Можно разместить: '+fmt(r.remaining):'Выберите позицию физической приёмки. После создания GRN она появится здесь.';
  $('trace-receipt-form').elements.quantity.value=r?String(r.remaining):'';
}
function renderLocations(){
  const data=state.data,warehouses=data.warehouses||[],current=$('trace-warehouse').value;
  $('trace-warehouse').innerHTML=selectOptions(warehouses.map(x=>({id:x.id,label:x.name})),current,'Выберите склад');
  $('trace-location-form').hidden=!data.canConfigure;
  warehouseChanged();
  const names=new Map((data.locations||[]).map(x=>[x.id,x.name]));
  $('trace-locations-body').innerHTML=(data.locations||[]).map(x=>'<tr><td>'+esc(x.warehouseName||x.warehouseId)+'</td><td><strong>'+
    esc(x.name)+'</strong></td><td>'+esc(kindNames[x.kind]||x.kind)+'</td><td>'+esc(names.get(x.parentId)||'—')+'</td></tr>').join('')||
    '<tr><td colspan="4" class="trace-empty">Места хранения ещё не созданы. Сначала создайте холодильник или полку.</td></tr>';
}
function warehouseChanged(){
  const selected=$('trace-warehouse').value,old=$('trace-parent').value;
  const parents=(state.data?.locations||[]).filter(x=>x.warehouseId===selected&&x.active).map(x=>({id:x.id,label:x.name}));
  $('trace-parent').innerHTML=selectOptions(parents,old,'Основной уровень');
}
function renderHistory(){
  const lots=new Map((state.data.lots||[]).map(x=>[x.id,x])),locations=new Map((state.data.locations||[]).map(x=>[x.id,x.name]));
  $('trace-history-body').innerHTML=(state.data.movements||[]).map(m=>{
    const lot=lots.get(m.lotId);if(!lot)return'';
    return '<tr><td>'+dt(m.at)+'</td><td>'+esc(actionNames[m.action]||m.action)+'</td>'+
      '<td><button class="proc-btn ghost small" data-lot-open="'+esc(lot.id)+'">'+esc(lot.lotCode)+'</button><small>'+esc(lot.productName)+'</small></td>'+
      '<td>'+fmt(m.quantity)+' '+esc(lot.unit)+'</td><td>'+
      esc(locations.get(m.fromId)||'—')+' → '+esc(locations.get(m.toId)||m.destination||'—')+'</td>'+
      '<td>'+esc(m.actor)+'<small>'+esc(m.reason||m.reference||'')+'</small></td></tr>';
  }).join('')||'<tr><td colspan="6" class="trace-empty">Движений пока нет.</td></tr>';
}
async function setup(){
  try{
    const client=await window.SHAuth?.createClient?.();
    if(!client)throw Error('Авторизация Smart Horeca недоступна.');
    const {data,error}=await client.auth.getSession();
    if(error||!data?.session?.access_token)throw Error('Необходим вход в Smart Horeca.');
    state.token=data.session.access_token;
    await load();
    const deep=new URLSearchParams(location.search).get('lot');
    if(deep&&findLot(deep))pane('lots');
  }catch(error){status(error.message||String(error),'error');renderEmpty()}
  finally{document.documentElement.style.visibility='visible'}
}
document.querySelectorAll('[data-pane]').forEach(b=>b.addEventListener('click',()=>pane(b.dataset.pane)));
$('trace-refresh').onclick=()=>load().catch(()=>{});
$('trace-search').oninput=()=>{if(state.data)renderLots()};
$('trace-filter').onchange=()=>{if(state.data)renderLots()};
$('trace-receipt').onchange=receiptChanged;
$('trace-warehouse').onchange=warehouseChanged;
$('trace-lots-body').addEventListener('click',event=>{
  const button=event.target.closest('[data-lot-open]');if(!button)return;
  state.lotId=button.dataset.lotOpen;state.action='TRANSFER';renderLotCard();
  $('trace-lot-card').scrollIntoView({block:'nearest',behavior:'smooth'});
});
$('trace-history-body').addEventListener('click',event=>{
  const button=event.target.closest('[data-lot-open]');if(!button)return;
  state.lotId=button.dataset.lotOpen;state.action='TRANSFER';pane('lots');renderLotCard();
  $('trace-lot-card').scrollIntoView({block:'nearest',behavior:'smooth'});
});
$('trace-receipt-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget,rows=(state.data.receipts||[]).filter(x=>x.remaining>0.00001);
  const r=rows[Number($('trace-receipt').value)];
  if(!r){status('Выберите GRN и товар.','error');return}
  const values=Object.fromEntries(new FormData(form));
  if(!values.locationId){status('Создайте место хранения для склада этой поставки.','error');return}
  if(Number(values.quantity)>r.remaining+0.00001){status('Количество превышает неразмещённый остаток GRN.','error');return}
  try{const result=await post('REGISTER_LOT',{grnId:r.grnId,productId:r.productId,...values});
    state.lotId=result.id;form.reset();pane('lots');renderLotCard();
  }catch(_){}
};
$('trace-location-form').onsubmit=async event=>{
  event.preventDefault();const form=event.currentTarget,values=Object.fromEntries(new FormData(form));
  try{await post('CREATE_LOCATION',values);form.elements.name.value='';form.elements.parentId.value=''}catch(_){}
};
setup();
})();
