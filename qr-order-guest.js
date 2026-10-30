(()=>{
'use strict';
const params=new URLSearchParams(location.search),slug=params.get('id')||'',table=params.get('table')||'';
let enabled=false,config=null,submitting=false,cartKey='',fingerprint='',receiptTicket='';
const $=id=>document.getElementById(id);
function status(message,isError=false){const el=$('qroGuestStatus');if(el){el.textContent=message;el.classList.toggle('error',isError)}}
function key(){return 'shqr_receipt:'+slug+':'+table}
function snapshot(){return window.SHQRReference?.getSelectedItems?.()||[]}
function setup(){
  const basket=$('shqrBasketOverlay')?.querySelector('.shqr-basket-sheet');
  if(!basket||$('qroOrderButton')||!enabled)return;
  const info=document.createElement('section');info.className='qro-guest-info';
  const title=document.createElement('strong');title.textContent=config.mode==='TABLE'?'Заказ · '+config.tableLabel:'Фастфуд · заказ навынос';
  const hint=document.createElement('span');
  hint.textContent='Оплата только на кассе. Создание и фискальное закрытие на POS подтверждаются отдельно.';
  info.append(title,hint);
  const note=document.createElement('textarea');note.id='qroGuestNote';note.className='qro-guest-note';note.maxLength=280;
  note.placeholder='Комментарий к заказу (по желанию)';
  const button=document.createElement('button');button.id='qroOrderButton';button.className='qro-submit';
  button.type='button';button.textContent='Оформить заказ · оплатить на кассе';
  const msg=document.createElement('div');msg.id='qroGuestStatus';msg.className='qro-guest-status';msg.setAttribute('role','status');
  const receipt=document.createElement('div');receipt.id='qroGuestReceipt';receipt.hidden=true;receipt.className='qro-guest-receipt';
  button.onclick=submit;
  const oldNote=basket.querySelector('.shqr-basket-note');
  if(oldNote)oldNote.textContent='Это оформление настоящего QR-заказа в Smart Horeca. Кассовая передача и оплата подтверждаются отдельно.';
  basket.append(info,note,button,msg,receipt);
  if(receiptTicket){
    button.disabled=true;
    button.textContent='Заказ уже зарегистрирован';
    window.SHQRReference?.clearSelectedItems?.();
    refreshStatus();
  }
}
function orderText(code){
  return ({AWAITING_POS:'Заказ зарегистрирован в Smart Horeca и ожидает кассу',
    LEASED:'Передаётся на кассу',POS_OPEN:'Заказ создан на кассе',
    POS_FAILED:'Ошибка передачи — сотрудник ресторана проверит заказ',
    CLOSED:'Оплачен и фискально закрыт на кассе',CANCELLED:'Заказ отменён'})[code]||code||'Неизвестное состояние';
}
function showReceipt(order){
  const box=$('qroGuestReceipt');if(!box)return;box.hidden=false;box.replaceChildren();
  const head=document.createElement('b');head.textContent='Заказ № '+order.orderNumber;
  const label=document.createElement('small');
  label.textContent=orderText(order.status)+' · '+order.totalAZN+' ₼'+(order.kitchenStatus==='PRINTED'?' · На кухню отправлено':'');
  const refresh=document.createElement('button');refresh.className='qro-submit';refresh.type='button';
  refresh.textContent='Проверить статус';refresh.style.background='#2a6445';refresh.onclick=refreshStatus;
  const newOrder=document.createElement('button');newOrder.type='button';
  newOrder.className='qro-submit';newOrder.style.background='#5e6975';
  newOrder.textContent='Начать новый заказ';
  newOrder.onclick=()=>{
    if(!confirm('Новый заказ создаётся отдельно от предыдущего. Продолжить?'))return;
    receiptTicket='';cartKey='';fingerprint='';
    try{sessionStorage.removeItem(key())}catch(_){}
    window.SHQRReference?.clearSelectedItems?.();
    const button=$('qroOrderButton');
    if(button){button.disabled=false;button.textContent='Оформить заказ · оплатить на кассе'}
    const note=$('qroGuestNote');if(note)note.value='';
    box.hidden=true;status('Выберите блюда для нового заказа.');
  };
  box.append(head,label,refresh,newOrder);
}
async function refreshStatus(){
  if(!receiptTicket)return;
  try{
    const r=await fetch('/api/qr-menu/guest-orders?ticket='+encodeURIComponent(receiptTicket),{cache:'no-store'});
    const j=await r.json();
    if(!r.ok||!j.success)throw Error(j.message||'Статус не получен');
    showReceipt(j.order);
  }catch(e){status(e.message||String(e),true)}
}
async function submit(){
  if(submitting||!enabled||receiptTicket)return;
  const items=snapshot();
  if(!items.length){status('Выберите хотя бы одно блюдо',true);return}
  const note=$('qroGuestNote')?.value.trim()||'';
  const current=JSON.stringify({items,note});
  if(!cartKey||fingerprint!==current){cartKey=crypto.randomUUID();fingerprint=current}
  const b=$('qroOrderButton');submitting=true;b.disabled=true;status('Регистрируем заказ в Smart Horeca…');
  try{
    const r=await fetch('/api/qr-menu/guest-orders',{method:'POST',
      headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({id:slug,table,clientKey:cartKey,items,note})});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.success)throw Error(j.message||'Не удалось сохранить заказ');
    receiptTicket=j.ticket;
    try{sessionStorage.setItem(key(),receiptTicket)}catch(_){}
    showReceipt(j.order);
    status('Заказ зарегистрирован. Это ещё не подтверждение создания заказа на кассе.');
    b.textContent='Заказ зарегистрирован';b.disabled=true;
    window.SHQRReference?.clearSelectedItems?.();
  }catch(e){status(e.message||String(e),true);b.disabled=false}
  finally{submitting=false}
}
async function init(){
  if(!slug)return;
  try{
    const r=await fetch('/api/qr-menu/guest-orders?id='+encodeURIComponent(slug)+'&table='+encodeURIComponent(table),{cache:'no-store'});
    const j=await r.json().catch(()=>({}));
    if(!r.ok||!j.success)return;
    config=j;enabled=!!j.orderingEnabled;
    try{receiptTicket=sessionStorage.getItem(key())||''}catch(_){}
    if(!enabled)return;setup();
    const observer=new MutationObserver(()=>{if(!$('qroOrderButton'))setup()});
    observer.observe(document.body,{childList:true,subtree:true});
  }catch(e){console.warn('[QR order mode] unavailable',e?.message||e)}
}

let sandboxEnabled=false,sandboxBusy=false,sandboxTicket='',sandboxKey='';
function sandboxTicketKey(){return 'shqr_payriff_test:'+slug+':'+table}
function paymentBanner(){
  let box=$('shqrPayriffStatusBox');
  if(box)return box;
  box=document.createElement('aside');
  box.id='shqrPayriffStatusBox';
  box.style.cssText='position:fixed;z-index:150;bottom:16px;left:12px;right:12px;max-width:620px;'+
    'margin:auto;padding:14px 16px;background:#102d26;color:#fff;border:1px solid #49d2a2;'+
    'border-radius:14px;box-shadow:0 12px 32px #0007;font:14px system-ui';
  const text=document.createElement('div');text.id='shqrPayriffStatusText';
  text.textContent='Тестовая оплата Payriff: проверяем состояние…';
  const actions=document.createElement('div');actions.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin-top:9px';
  const check=document.createElement('button');check.type='button';check.id='shqrPayriffCheck';
  check.textContent='Проверить оплату';check.style.cssText='background:#43d19a;color:#063426;border:0;border-radius:8px;padding:9px 13px;font-weight:700';
  check.onclick=checkSandboxPayment;
  const hide=document.createElement('button');hide.type='button';hide.textContent='Свернуть';
  hide.style.cssText='background:#2c4640;color:white;border:1px solid #8db9a4;border-radius:8px;padding:9px 13px';
  hide.onclick=()=>{box.hidden=true};
  actions.append(check,hide);box.append(text,actions);document.body.append(box);
  return box;
}
async function checkSandboxPayment(){
  if(!sandboxTicket)return;
  const box=paymentBanner();box.hidden=false;
  const text=$('shqrPayriffStatusText');
  text.textContent='Проверяем у Payriff, был ли платёж успешно проведён…';
  try{
    const response=await fetch('/api/qr-menu/payment-checkout?ticket='+encodeURIComponent(sandboxTicket),
      {cache:'no-store',headers:{Accept:'application/json'}});
    const json=await response.json().catch(()=>({}));
    if(!response.ok||!json.success)throw Error(json.message||'Проверка оплаты недоступна');
    const p=json.payment;
    text.textContent=p.paidVerified
      ?'✓ Тестовая оплата '+p.amountAZN+' AZN подтверждена. Кассовый заказ НЕ создан, кухонная печать выключена.'
      :p.notice+' · '+p.amountAZN+' AZN. Кассовый заказ не создавался.';
  }catch(e){
    text.textContent='Не удалось подтвердить платёж: '+e.message+
      '. Не начинайте повторную оплату без проверки.';
  }
}
function setupSandboxPayment(){
  if(!sandboxEnabled||$('shqrPayriffButton'))return;
  const basket=$('shqrBasketOverlay')?.querySelector('.shqr-basket-sheet');
  if(!basket)return;
  const btn=document.createElement('button');
  btn.id='shqrPayriffButton';btn.className='qro-submit';btn.type='button';
  btn.style.cssText='background:#21ad7b;color:#fff;width:100%;border:0;border-radius:12px;padding:14px;font-weight:800;margin-top:12px';
  btn.textContent='Оплатить через Payriff (тест)';
  btn.disabled=Boolean(sandboxTicket);
  btn.onclick=submitSandboxPayment;
  const note=basket.querySelector('.shqr-basket-note');
  if(note)note.textContent='Тестовый Payriff Development. До подтверждённой оплаты касса и кухня не получают заказ.';
  const hint=document.createElement('div');hint.style.cssText='font:12px system-ui;color:#697b70;margin-top:7px';
  hint.textContent='Только тестовая оплата · никаких заказов и кухонной печати.';
  basket.append(btn,hint);
}
async function submitSandboxPayment(){
  if(!sandboxEnabled||sandboxBusy||sandboxTicket)return;
  const items=snapshot();
  if(!items.length){alert('Сначала добавьте блюда в корзину');return}
  sandboxBusy=true;
  const btn=$('shqrPayriffButton');if(btn){btn.disabled=true;btn.textContent='Готовим тестовую оплату…'}
  try{
    const note=$('qroGuestNote')?.value.trim()||'';
    if(!sandboxKey)sandboxKey=crypto.randomUUID();
    const r=await fetch('/api/qr-menu/payment-checkout',{
      method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({id:slug,table,items,note,clientKey:sandboxKey})});
    const res=await r.json().catch(()=>({}));
    if(!r.ok||!res.success)throw Error(res.message||'Не удалось открыть тестовый платёж');
    const u=new URL(res.paymentUrl);
    if(u.protocol!=='https:'||!(u.hostname==='pay.payriff.com'||u.hostname.endsWith('.payriff.com')))
      throw Error('Неверный адрес страницы оплаты');
    sandboxTicket=res.ticket;
    try{sessionStorage.setItem(sandboxTicketKey(),sandboxTicket)}catch{}
    location.assign(u.href);
  }catch(e){
    alert(e.message||String(e));
    if(btn){btn.disabled=false;btn.textContent='Оплатить через Payriff (тест)'}
  }finally{sandboxBusy=false}
}
async function initSandboxPayment(){
  if(!slug)return;
  try{
    const fromReturn=params.get('qrPaymentTicket');
    sandboxTicket=fromReturn||sessionStorage.getItem(sandboxTicketKey())||'';
  }catch{}
  if(sandboxTicket){paymentBanner();checkSandboxPayment()}
  try{
    const res=await fetch('/api/qr-menu/payment-checkout?id='+encodeURIComponent(slug)+
      '&table='+encodeURIComponent(table),{cache:'no-store'});
    const json=await res.json().catch(()=>({}));
    sandboxEnabled=Boolean(res.ok&&json.testCheckoutEnabled);
    if(!sandboxEnabled)return;
    setupSandboxPayment();
    const observer=new MutationObserver(()=>{if(!$('shqrPayriffButton'))setupSandboxPayment()});
    observer.observe(document.body,{childList:true,subtree:true});
  }catch(e){console.warn('[QR Pay] sandbox not ready')}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initSandboxPayment);else initSandboxPayment();
})();