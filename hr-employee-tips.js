(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const employeeId=new URLSearchParams(location.search).get('id')||'';
  let loaded=false,busy=false,current=null;
  const fields=['shTipsPos','shTipsHolder','shTipsLast4','shTipsBank','shTipsGuest'];
  function message(value,kind=''){const e=$('shTipsMessage');if(e){e.textContent=value;e.className='hr-status '+kind}}
  function disabled(value){for(const id of [...fields,'shTipsSave','shTipsRotate'])if($(id))$(id).disabled=value}
  async function request(path,body){
    const client=await window.SHAuth?.createClient?.();
    const session=await client?.auth.getSession();
    const token=session?.data?.session?.access_token;
    if(!token)throw Error('Войдите в Smart Horeca ещё раз');
    const response=await fetch(path,{method:body?'POST':'GET',cache:'no-store',headers:{
      Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})
    },...(body?{body:JSON.stringify(body)}:{})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.success)throw Error(data.message||'Ошибка '+response.status);
    return data;
  }
  function paint(data){
    current=data;
    const t=data.tips||{};
    $('shTipsCode').textContent=t.personalCode||'Не создан';
    $('shTipsPos').value=t.posWaiterId||'';
    $('shTipsHolder').value=t.cardHolder||'';
    $('shTipsLast4').value=t.cardLast4||'';
    $('shTipsBank').value=t.bankName||'';
    $('shTipsGuest').checked=!!t.guestEnabled;
    $('shTipsPayoutStatus').textContent=t.cardConnected?'Подключена и подтверждена Payriff':'Не подключена — выплаты заблокированы';
    disabled(!data.canEdit);
    if(!data.canEdit)message('Только бухгалтер с правом проведения оплат может менять эти настройки.');
    else message('Справочник готов. Полные данные карты не вводятся здесь.','ok');
  }
  async function load(force=false){
    if(busy||loaded&&!force||!employeeId)return;
    busy=true;disabled(true);message('Загрузка…','loading');
    try{paint(await request('/api/hr/tips-profile?id='+encodeURIComponent(employeeId)));loaded=true}
    catch(e){message(e.message||String(e),'error')}
    finally{busy=false;if(current)disabled(!current.canEdit)}
  }
  async function save(action){
    if(busy||!current?.canEdit)return;
    if(action==='rotateCode'&&!confirm('Старый персональный код перестанет действовать. Продолжить?'))return;
    busy=true;disabled(true);message('Сохранение…','loading');
    try{
      const body={action,employeeId};
      if(action==='save')Object.assign(body,{
        posWaiterId:$('shTipsPos').value.trim(),
        cardHolder:$('shTipsHolder').value.trim(),
        cardLast4:$('shTipsLast4').value.trim(),
        bankName:$('shTipsBank').value.trim(),
        guestEnabled:$('shTipsGuest').checked
      });
      paint(await request('/api/hr/tips-profile',body));
      message(action==='rotateCode'?'Новый код выпущен':'Настройки сохранены','ok');
    }catch(e){message(e.message||String(e),'error')}
    finally{busy=false;disabled(!current?.canEdit)}
  }
  function bind(){
    if(!$('shTipsSave'))return;
    $('shTipsSave').addEventListener('click',()=>save('save'));
    $('shTipsRotate').addEventListener('click',()=>save('rotateCode'));
    document.querySelector('[data-tab="tips"]')?.addEventListener('click',()=>load());
    if(new URLSearchParams(location.search).get('tab')==='tips')
      document.querySelector('[data-tab="tips"]')?.click();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();