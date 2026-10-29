(()=>{
  'use strict';
  const $=id=>document.getElementById(id),escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let directory=[],selected=null,canEdit=false,busy=false;
  const editFields=['tipPos','tipHolder','tipLast4','tipBank','tipGuest','tipSave','tipRotate'];
  const setDisabled=value=>editFields.forEach(id=>{if($(id))$(id).disabled=value});
  function status(value,error=false){$('tipStatus').textContent=value;if(error){$('tipError').hidden=false;$('tipError').textContent=value}else{$('tipError').hidden=true}}
  function message(value){$('tipSaveStatus').textContent=value}
  async function api(path,body){
    const auth=await window.SHAuth?.createClient?.();
    const session=await auth?.auth.getSession();
    const token=session?.data?.session?.access_token;
    if(!token)throw Error('Нет активной сессии');
    const response=await fetch(path,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const result=await response.json().catch(()=>({}));
    if(!response.ok||result.success===false)throw Error(result.message||'HTTP '+response.status);
    return result;
  }
  function draw(){
    const query=$('tipSearch').value.trim().toLocaleLowerCase();
    const filtered=directory.filter(e=>[e.name,e.code,e.roleName].join(' ').toLocaleLowerCase().includes(query));
    $('tipRows').innerHTML=filtered.map(e=>`<tr>
      <td><strong>${escape(e.name)}</strong><div class="hr-muted">${escape(e.code||'')}</div></td>
      <td>${escape(e.roleName||'—')}</td>
      <td>${e.guestEnabled?'Для гостей':'Выключено'}</td>
      <td>${e.cardConnected?'Подключено':e.cardLast4?'•••• '+escape(e.cardLast4)+' · ожидание Payriff':'Нет привязки'}</td>
      <td><button type="button" class="hr-link-button" data-employee="${escape(e.id)}">Настроить</button></td>
    </tr>`).join('')||'<tr><td colspan="5">Сотрудники не найдены.</td></tr>';
  }
  function edit(data){
    selected=data;
    const t=data.tips||{};canEdit=!!data.canEdit;
    $('tipEmployee').textContent=data.employee.name;
    $('tipCode').textContent=t.personalCode||'Ещё не создан';
    $('tipPos').value=t.posWaiterId||'';
    $('tipHolder').value=t.cardHolder||'';
    $('tipLast4').value=t.cardLast4||'';
    $('tipBank').value=t.bankName||'';
    $('tipGuest').checked=!!t.guestEnabled;
    $('tipBankStatus').textContent=t.cardConnected?'Подтверждено Payriff':'Не подключено — выплаты не выполняются';
    $('tipEditor').hidden=false;
    setDisabled(!canEdit);
    message(canEdit?'Настройки доступны бухгалтеру.':'Недостаточно прав для изменения.');
    $('tipEditor').scrollIntoView({behavior:'smooth',block:'nearest'});
  }
  async function openEmployee(id){
    if(busy)return;busy=true;setDisabled(true);message('Загрузка…');
    try{edit(await api('/api/hr/tips-profile?id='+encodeURIComponent(id)))}
    catch(e){message(e.message||String(e))}
    finally{busy=false;setDisabled(!canEdit)}
  }
  async function load(){
    if(busy)return;busy=true;status('Загрузка сотрудников…');$('tipRefresh').disabled=true;
    try{
      const result=await api('/api/hr/tips-profile?list=1');
      directory=result.items||[];draw();status('Ресторан: '+result.restaurantId+' · сотрудников: '+directory.length);
    }catch(e){directory=[];draw();status(e.message||String(e),true)}
    finally{busy=false;$('tipRefresh').disabled=false}
  }
  async function save(action){
    if(!selected?.employee?.id||busy||!canEdit)return;
    if(action==='rotateCode'&&!confirm('Старый персональный код перестанет действовать. Обновить?'))return;
    busy=true;setDisabled(true);message('Сохранение…');
    try{
      const payload={action,employeeId:selected.employee.id};
      if(action==='save')Object.assign(payload,{
        posWaiterId:$('tipPos').value.trim(),cardHolder:$('tipHolder').value.trim(),
        cardLast4:$('tipLast4').value.trim(),bankName:$('tipBank').value.trim(),
        guestEnabled:$('tipGuest').checked
      });
      edit(await api('/api/hr/tips-profile',payload));
      message(action==='rotateCode'?'Новый код выпущен':'Сохранено');
      const updated=await api('/api/hr/tips-profile?list=1');
      directory=updated.items||[];draw();
    }catch(e){message(e.message||String(e))}
    finally{busy=false;setDisabled(!canEdit)}
  }
  function bind(){
    $('tipSearch').addEventListener('input',draw);
    $('tipRefresh').addEventListener('click',load);
    $('tipRows').addEventListener('click',e=>{
      const button=e.target.closest('[data-employee]');if(button)openEmployee(button.dataset.employee);
    });
    $('tipSave').addEventListener('click',()=>save('save'));
    $('tipRotate').addEventListener('click',()=>save('rotateCode'));
    load();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();