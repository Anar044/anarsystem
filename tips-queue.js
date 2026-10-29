(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const escape=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let loaded=false,busy=false,latest=null,initialized=false;
  const format=minor=>minor===null||minor===undefined?'—':new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(minor)/100)+' ₼';
  const labels={
    WAITING_CARD:'Ожидает привязки карты',WAITING_PROVIDER:'Ожидает настройки Payriff',
    WAITING_BALANCE:'Ожидает данных о балансе',WAITING_FUNDS:'Недостаточно средств',
    READY_FOR_PROVIDER:'Средства есть · перевод не включён',RECONCILE:'Требуется сверка',
    PAID:'Выплачено',CANCELLED:'Отменено'
  };
  async function api(path,body){
    const client=await window.SHAuth?.createClient?.();
    const session=await client?.auth.getSession();
    const token=session?.data?.session?.access_token;
    if(!token)throw Error('Требуется вход в Smart Horeca');
    const response=await fetch(path,{method:body?'POST':'GET',cache:'no-store',headers:{
      Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})
    },...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.success)throw Error(data.message||'Ошибка HTTP '+response.status);
    return data;
  }
  function render(data){
    latest=data;loaded=true;
    const a=data.account||{},s=data.summary||{};
    $('tipReceivingMerchant').value=a.receivingMerchantId||'';
    $('tipPayoutMerchant').value=a.payoutMerchantId||'';
    $('tipBalance').value=a.balanceAZN??'';
    $('tipBalanceSource').textContent=a.balanceSource==='ACCOUNTANT_REPORTED'
      ?'Введён бухгалтером · '+(a.balanceObservedAt?new Date(a.balanceObservedAt).toLocaleString('ru-RU'):'')
      :'Нет данных о балансе';
    $('tipQueueTotal').textContent=format(s.unpaidMinor);
    $('tipQueueShortfall').textContent=format(s.shortfallMinor);
    $('tipQueueCount').textContent=String(s.totalRecords||0);
    $('tipQueueRows').innerHTML=(data.items||[]).map(row=>
      `<tr><td>${escape(row.orderId)}</td><td>${escape(row.employeeName)}</td>
      <td>${escape(row.amountAZN)} ₼</td>
      <td>${escape(labels[row.queueReason]||row.queueReason||row.state)}</td>
      <td>${escape(row.createdAt?new Date(row.createdAt).toLocaleString('ru-RU'):'—')}</td></tr>`
    ).join('')||'<tr><td colspan="5">Пока нет подтверждённых онлайн-чаевых.</td></tr>';
    $('tipQueueNote').textContent=(s.previewOnly?'Показаны первые 200 записей. Общие суммы подсчитаны по всем обязательствам. ':'')
      +'Режим подготовки: выплаты не отправляются в Payriff. Баланс введён бухгалтером и не проверен через API.';
  }
  async function load(){
    if(busy)return;busy=true;
    $('tipQueueRefresh').disabled=true;$('tipAccountMessage').textContent='Загрузка…';
    try{render(await api('/api/tips/queue'));$('tipAccountMessage').textContent='Обновлено'}
    catch(e){$('tipAccountMessage').textContent=e.message||String(e)}
    finally{busy=false;$('tipQueueRefresh').disabled=false}
  }
  async function save(){
    if(busy)return;busy=true;
    $('tipAccountsSave').disabled=true;$('tipAccountMessage').textContent='Сохранение…';
    try{
      await api('/api/tips/queue',{action:'saveAccountSnapshot',
        receivingMerchantId:$('tipReceivingMerchant').value.trim(),
        payoutMerchantId:$('tipPayoutMerchant').value.trim(),
        balanceAZN:$('tipBalance').value.trim()
      });
      render(await api('/api/tips/queue'));
      $('tipAccountMessage').textContent='Настройки сохранены. Переводы пока не включены.';
    }catch(e){$('tipAccountMessage').textContent=e.message||String(e)}
    finally{busy=false;$('tipAccountsSave').disabled=false}
  }
  function init(){
    if(initialized||!$('tipAccountsSave'))return;initialized=true;
    $('tipAccountsSave').addEventListener('click',save);
    $('tipQueueRefresh').addEventListener('click',load);
    load();
    window.addEventListener('sh:iiko-selection-changed',()=>{loaded=false;load()});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();