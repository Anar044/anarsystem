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

let sandboxEnabled=false,sandboxBusy=false,sandboxTicket='',sandboxKey='',sandboxMode='DEVELOPMENT';
const isRealCharge=()=>sandboxMode==='LIVE_PREVIEW_001';
const paymentButtonText=()=>isRealCharge()?'Оплатить 0,01 AZN настоящей картой':'Оплатить через Payriff (Development)';
function sandboxTicketKey(){return 'shqr_payriff_'+sandboxMode+':'+slug+':'+table}
function sandboxClientKeyKey(){return 'shqr_payriff_attempt_'+sandboxMode+':'+slug+':'+table}
function paymentBanner(){
  let box=$('shqrPayriffStatusBox');
  if(box)return box;
  box=document.createElement('aside');
  box.id='shqrPayriffStatusBox';
  box.style.cssText='position:fixed;z-index:150;bottom:16px;left:12px;right:12px;max-width:620px;'+
    'margin:auto;padding:14px 16px;background:#102d26;color:#fff;border:1px solid #49d2a2;'+
    'border-radius:14px;box-shadow:0 12px 32px #0007;font:14px system-ui';
  const text=document.createElement('div');text.id='shqrPayriffStatusText';
  text.textContent='Проверяем подтверждение платежа напрямую через Payriff…';
  const actions=document.createElement('div');actions.style.cssText='display:flex;flex-wrap:wrap;gap:8px;margin-top:9px';
  const check=document.createElement('button');check.type='button';check.id='shqrPayriffCheck';
  check.textContent='Проверить оплату';check.style.cssText='background:#43d19a;color:#063426;border:0;border-radius:8px;padding:9px 13px;font-weight:700';
  check.onclick=checkSandboxPayment;
  const hide=document.createElement('button');hide.type='button';hide.textContent='Свернуть';
  hide.style.cssText='background:#2c4640;color:white;border:1px solid #8db9a4;border-radius:8px;padding:9px 13px';
  hide.onclick=()=>{box.hidden=true};
  const retry=document.createElement('button');
  retry.type='button';retry.id='shqrPayriffRetry';retry.hidden=true;
  retry.textContent='Новая попытка';retry.style.cssText='background:#36434d;color:white;border:1px solid #92a4a8;border-radius:8px;padding:9px 13px';
  retry.onclick=()=>{
    if(!retry.dataset.allowed||retry.dataset.allowed!=='true')return;
    if(!confirm('Payriff подтвердил, что попытка завершилась без оплаты. Создать новую?'))return;
    sandboxTicket='';sandboxKey='';
    try{
      sessionStorage.removeItem(sandboxTicketKey());
      sessionStorage.removeItem(sandboxClientKeyKey());
    }catch{}
    const b=$('shqrPayriffButton');
    if(b){b.disabled=false;b.textContent=paymentButtonText()}
    box.hidden=true;
  };
  actions.append(check,retry,hide);box.append(text,actions);document.body.append(box);
  return box;
}
async function checkSandboxPayment(){
  if(!sandboxTicket&&!sandboxKey)return;
  const box=paymentBanner();box.hidden=false;
  const text=$('shqrPayriffStatusText');
  text.textContent='Проверяем предыдущую попытку без создания новой оплаты…';
  try{
    const url=new URL('/api/qr-menu/payment-checkout',location.origin);
    // A known Payriff order MUST be checked by its ticket. Checking only
    // clientKey reads D1's stale CHECKOUT state without querying Payriff.
    if(sandboxTicket)url.searchParams.set('ticket',sandboxTicket);
    else{
      url.searchParams.set('id',slug);
      url.searchParams.set('table',table);
      url.searchParams.set('clientKey',sandboxKey);
    }
    const response=await fetch(url.href,
      {cache:'no-store',headers:{Accept:'application/json'}});
    const json=await response.json().catch(()=>({}));
    if(!response.ok||!json.success)throw Error(json.message||'Проверка оплаты недоступна');
    if(json.found===false){
      text.textContent='Платёжная попытка не найдена. Обратитесь к администрации для сверки.';
      return;
    }
    if(json.ticket&&!sandboxTicket){
      sandboxTicket=json.ticket;
      try{sessionStorage.setItem(sandboxTicketKey(),sandboxTicket)}catch{}
    }
    const p=json.payment;
    const retry=$('shqrPayriffRetry');
    if(retry){
      retry.hidden=p.state!=='FAILED';
      retry.dataset.allowed=String(p.state==='FAILED');
    }
    text.textContent=p.paidVerified
      ?'✓ Оплата '+p.amountAZN+' AZN подтверждена Payriff. Кассовый заказ НЕ создан, кухонная печать выключена.'
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
  btn.textContent=paymentButtonText();
  btn.disabled=Boolean(sandboxTicket||sandboxKey);
  btn.onclick=submitSandboxPayment;
  const note=basket.querySelector('.shqr-basket-note');
  if(note)note.textContent=isRealCharge()
    ?'НАСТОЯЩИЙ платёж через действующий Payriff Online — 0,01 AZN. Деньги будут списаны с карты после подтверждения. Кассовый заказ и кухня пока не включены.'
    :'Payriff Development. Заказы на кассу пока не отправляются.';
  const hint=document.createElement('div');hint.style.cssText='font:12px system-ui;color:#697b70;margin-top:7px';
  hint.textContent=isRealCharge()
    ?'Реальное списание 0,01 AZN · не нажимайте повторно при ошибке'
    :'Development · создание кассового заказа и кухонная печать выключены.';
  basket.append(btn,hint);
}
async function submitSandboxPayment(){
  if(!sandboxEnabled||sandboxBusy||sandboxTicket)return;
  const items=snapshot();
  if(!items.length){alert('Сначала добавьте блюда в корзину');return}
  if(isRealCharge()&&!confirm('С карты будет РЕАЛЬНО списано 0,01 AZN через Payriff Online. Подтвердить переход к оплате?'))return;
  sandboxBusy=true;
  const btn=$('shqrPayriffButton');if(btn){btn.disabled=true;btn.textContent=isRealCharge()?'Создаём платёж 0,01 AZN…':'Готовим оплату…'}
  try{
    const note=$('qroGuestNote')?.value.trim()||'';
    if(!sandboxKey)sandboxKey=crypto.randomUUID();
    // Preserve the same clientKey across refreshes and network failures.
    // This allows checking the original RRN instead of charging twice.
    try{sessionStorage.setItem(sandboxClientKeyKey(),sandboxKey)}catch{}
    const r=await fetch('/api/qr-menu/payment-checkout',{
      method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},
      body:JSON.stringify({id:slug,table,items,note,clientKey:sandboxKey})});
    const res=await r.json().catch(()=>({}));
    if(!r.ok||!res.success){
      if(res.ticket){
        sandboxTicket=res.ticket;
        try{sessionStorage.setItem(sandboxTicketKey(),sandboxTicket)}catch{}
      }
      const error=new Error(res.message||'Не удалось открыть платёж');
      // A price-validation rejection occurs BEFORE creating an intent.
      // Release the client key so the basket can be corrected safely.
      if(res.code==='PAYRIFF_LIVE_AMOUNT_LIMIT'){
        sandboxKey='';
        try{sessionStorage.removeItem(sandboxClientKeyKey())}catch{}
        error.uncertain=false;
      }else{
        // Never retry on an unknown server/provider result.
        error.uncertain=true;
      }
      throw error;
    }
    const u=new URL(res.paymentUrl);
    if(u.protocol!=='https:'||!(u.hostname==='pay.payriff.com'||u.hostname.endsWith('.payriff.com')))
      throw Error('Неверный адрес страницы оплаты');
    sandboxTicket=res.ticket;
    try{sessionStorage.setItem(sandboxTicketKey(),sandboxTicket)}catch{}
    location.assign(u.href);
  }catch(e){
    // Do not reset the button after a potentially created Payriff order.
    if(e?.uncertain||sandboxTicket||sandboxKey){
      paymentBanner();
      $('shqrPayriffStatusText').textContent=(e.message||'Связь с Payriff не подтверждена')+
        '. Проверьте предыдущую попытку, не платите повторно.';
      if(btn){btn.disabled=true;btn.textContent='Проверить предыдущую оплату'}
      await checkSandboxPayment();
    }else{
      alert(e.message||String(e));
      if(btn){btn.disabled=false;btn.textContent=paymentButtonText()}
    }
  }finally{sandboxBusy=false}
}
function explainSandboxAvailability(message){
  const previewHost='feature-qr-order-internal-co.smarthoreca.pages.dev';
  if(location.hostname!==previewHost)return;
  const noticeId='shqrPayriffAvailability';
  const insert=()=>{
    const basket=$('shqrBasketOverlay')?.querySelector('.shqr-basket-sheet');
    if(!basket||$(noticeId))return Boolean(basket);
    const messageBox=document.createElement('p');messageBox.id=noticeId;
    messageBox.style.cssText='font:12px/1.45 system-ui;background:#fff6e5;color:#553f1d;'+
      'border:1px solid #d9c39c;border-radius:9px;padding:10px;margin-top:12px';
    messageBox.textContent=message;
    basket.append(messageBox);
    return true;
  };
  if(insert())return;
  const observer=new MutationObserver(()=>{if(insert())observer.disconnect()});
  observer.observe(document.body,{childList:true,subtree:true});
}
async function initSandboxPayment(){
  if(!slug)return;
  try{
    const res=await fetch('/api/qr-menu/payment-checkout?id='+encodeURIComponent(slug)+
      '&table='+encodeURIComponent(table),{cache:'no-store'});
    const json=await res.json().catch(()=>({}));
    sandboxEnabled=Boolean(res.ok&&json.testCheckoutEnabled);
    sandboxMode=json.checkoutMode==='LIVE_PREVIEW_001'?'LIVE_PREVIEW_001':'DEVELOPMENT';
    try{
      const fromReturn=params.get('qrPaymentTicket');
      sandboxTicket=fromReturn||sessionStorage.getItem(sandboxTicketKey())||'';
      sandboxKey=sessionStorage.getItem(sandboxClientKeyKey())||'';
    }catch{}
    if(sandboxTicket||sandboxKey){paymentBanner();checkSandboxPayment()}
    if(!sandboxEnabled){
      explainSandboxAvailability(res.ok
        ?'Тестовая оплата для этого QR пока недоступна. Проверьте, что QR выпущен на Preview и Payriff включён для данного ресторана.'
        :'Payriff не смог проверить этот QR: '+String(json.message||'проверьте привязку QR к ресторану'));
      return;
    }
    setupSandboxPayment();
    const observer=new MutationObserver(()=>{if(!$('shqrPayriffButton'))setupSandboxPayment()});
    observer.observe(document.body,{childList:true,subtree:true});
  }catch(e){
    console.warn('[QR Pay] sandbox not ready');
    explainSandboxAvailability('Не удалось проверить тестовую оплату. Попробуйте обновить меню, либо проверьте настройки QR Pay.');
  }
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initSandboxPayment);else initSandboxPayment();
})();