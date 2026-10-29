(()=>{
'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null,busy=false;
async function api(body){
  const auth=await window.SHAuth?.createClient?.();
  const session=await auth?.auth.getSession();
  const key=session?.data?.session?.access_token;
  if(!key)throw Error('Сессия Smart Horeca отсутствует');
  const r=await fetch('/api/qr-menu/order-admin',{method:body?'POST':'GET',cache:'no-store',headers:{
    Authorization:'Bearer '+key,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})
  },...(body?{body:JSON.stringify(body)}:{})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.success)throw Error(j.message||'HTTP '+r.status);
  return j;
}
const status=(v,id='qrOrderError')=>{$(id).textContent=v||''};
async function action(data){
  if(busy)return;
  busy=true;try{await api(data);await reload()}catch(e){status(e.message||String(e))}
  finally{busy=false}
}
function qr(box,url){
  if(window.QRCode){
    new window.QRCode(box,{text:url,width:122,height:122,correctLevel:window.QRCode.CorrectLevel.M});
  }else box.textContent='QR библиотека недоступна';
}
async function copy(value){
  try{await navigator.clipboard.writeText(value);status('Ссылка скопирована','qrOrderSaveStatus')}
  catch{status('Не удалось скопировать ссылку','qrOrderSaveStatus')}
}
function renderTables(){
  const container=$('qrOrderTables');container.replaceChildren();
  $('qrTablePanel').hidden=state.settings.serviceMode!=='TABLE';
  for(const t of state.tables||[]){
    const card=document.createElement('article');card.className='qro-qr-card';
    const name=document.createElement('strong');name.textContent=t.table_label;
    const badge=document.createElement('div');badge.className='qro-muted';
    badge.textContent=t.active?'Активен':'Выключен';
    const code=document.createElement('div');code.className='qro-qr';
    if(t.active)qr(code,t.url);else code.textContent='Отключён';
    const url=document.createElement('a');url.href=t.url;url.target='_blank';url.rel='noopener';url.textContent='Открыть меню';
    const input=document.createElement('input');input.value=t.pos_table_id||'';input.placeholder='ID стола в POS';input.title='ID стола в POS';
    const actions=document.createElement('div');actions.className='qro-actions';actions.style.marginTop='10px';
    const btn=(text,handler,cls='')=>{const b=document.createElement('button');b.type='button';b.className='qro-btn '+cls;b.textContent=text;b.onclick=handler;return b};
    actions.append(
      btn('Копировать',()=>copy(t.url)),
      btn('Сохранить POS ID',()=>action({action:'setPosTable',tableId:t.id,posTableId:input.value.trim()})),
      btn(t.active?'Выключить':'Включить',()=>action({action:'setTableActive',tableId:t.id,active:!t.active})),
      btn('Новый QR',()=>{if(confirm('Старый QR-код стола перестанет действовать. Продолжить?'))action({action:'rotateTable',tableId:t.id})},'danger')
    );
    card.append(name,badge,code,url,input,actions);container.append(card);
  }
  if(!state.tables?.length)container.textContent='Добавьте стол и распечатайте его QR-код.';
}
function renderOrders(){
  const labels={AWAITING_POS:'Ожидает кассу',LEASED:'Передаётся',POS_OPEN:'Создан на кассе',POS_FAILED:'Ошибка передачи',CLOSED:'Фискально закрыт',CANCELLED:'Отменён'};
  const host=$('qrOrderRows');host.replaceChildren();
  for(const o of state.orders||[]){
    const tr=document.createElement('tr');
    const cell=(text)=>{const td=document.createElement('td');td.textContent=text;tr.append(td);return td};
    cell(new Date(o.created_at).toLocaleString('ru-RU'));
    cell(o.id.slice(0,8).toUpperCase()+' · '+(o.table_label||'Фастфуд'));
    cell(o.totalAZN+' ₼');
    cell((labels[o.state]||o.state)+(o.pos_order_number?' · №'+o.pos_order_number:'')+(o.kitchen_status==='PRINTED'?' · Кухня: отправлено':o.kitchen_status==='CHECK_REQUIRED'?' · Кухня: требуется сверка':' · Кухня: не подтверждена')+(o.last_error?' · '+o.last_error:''));
    const last=cell('');
    if(o.state==='AWAITING_POS'){
      const btn=document.createElement('button');btn.className='qro-btn danger';btn.textContent='Отменить';
      btn.onclick=()=>{if(confirm('Отменить этот заказ, который ещё не создан на кассе?'))action({action:'cancelPending',orderId:o.id})};
      last.append(btn);
    }else if(o.state==='POS_FAILED'&&o.last_error==='POS_VALIDATION_FAILED'){
      const btn=document.createElement('button');btn.className='qro-btn';btn.textContent='Повторить';
      btn.title='Только после исправления причины ошибки на кассе';
      btn.onclick=()=>{if(confirm('После исправления цены или товара вернуть заказ в очередь?'))action({action:'retryValidationFailure',orderId:o.id})};
      last.append(btn);
    }else if(o.state==='POS_FAILED'){
      const warning=document.createElement('small');
      warning.textContent='Требуется сверка с кассой';last.append(warning);
    }
    host.append(tr);
  }
  if(!host.children.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.textContent='Заказов пока нет';tr.append(td);host.append(tr)}
}
async function reload(){
  try{state=await api();$('qrOrderError').textContent='';
    $('qrOrderMode').value=state.settings.serviceMode;
    $('qrOrderEnabled').checked=state.settings.orderingEnabled;
    $('qrOrderPlugin').value=state.settings.posPluginId;
    $('qrPosBridgeReady').textContent=state.settings.posBridgeReady
      ?'✓ Касса подключена: приём заказов и печать кухни разрешены (5 минут)'
      :state.settings.posBridgeConnected
        ?'✓ Касса подключена к тестовому QR API. Режим диагностики: заказы и печать отключены.'
        :'POS-мост не подключён. Настройте тестовый HTTPS API и проверьте авторизацию.';
    const global=$('qrOrderGlobalLink');global.replaceChildren();
    const a=document.createElement('a');a.href=state.menuUrl;a.target='_blank';a.rel='noopener';a.textContent=state.menuUrl;global.append(a);
    if(state.settings.serviceMode==='FAST_FOOD'){
      const box=document.createElement('div');box.className='qro-qr';box.style.width='150px';box.style.margin='12px 0';
      qr(box,state.menuUrl);global.append(box);
    }else{
      const note=document.createElement('p');note.textContent='В режиме ресторана используются QR-коды конкретных столов ниже.';global.append(note);
    }
    renderTables();renderOrders();
  }catch(e){status(e.message||String(e))}
}
function bind(){
  $('qrOrderReload').onclick=reload;
  $('qrOrderSave').onclick=()=>action({action:'saveSettings',serviceMode:$('qrOrderMode').value,
    orderingEnabled:$('qrOrderEnabled').checked,posPluginId:$('qrOrderPlugin').value.trim()});
  $('qrAddTable').onclick=()=>action({action:'addTable',label:$('qrTableName').value.trim(),posTableId:$('qrPosTable').value.trim()});
  reload();
  window.addEventListener('sh:iiko-selection-changed',reload);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();