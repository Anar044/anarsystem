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
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();