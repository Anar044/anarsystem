(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data={devices:[],employees:[],bindings:[],events:[],rawAdms:[],admsRequests:[],admsCommands:[],counts:{}},busy=false,currentDeviceToken='';

  async function token(){const client=await window.SHAuth?.createClient?.();if(!client)throw new Error('Supabase Auth не готов');const{data,error}=await client.auth.getSession();const t=data?.session?.access_token;if(error||!t)throw new Error('Сессия пользователя не найдена');return t}
  function setStatus(text,kind=''){const el=$('tcStatus');if(!el)return;el.textContent=text;el.className=`hr-status ${kind}`.trim()}
  async function api(body=null){const t=await token();const opt={headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}};if(body){opt.method='POST';opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}const r=await (window.SH_IikoContext?.fetchWithTimeout||fetch)('/api/hr/timeclock',opt,60000);const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);return j}
  function employeeName(id){const e=(data.employees||[]).find(x=>x.id===id);return e?.name||[e?.lastName,e?.firstName].filter(Boolean).join(' ')||id||'—'}
  function deviceName(id){return (data.devices||[]).find(x=>x.id===id)?.name||id||'—'}
  function localDate(v){if(!v)return'';try{return new Date(v).toLocaleString('ru-RU')}catch{return String(v)}}

  function renderSummary(){const c=data.counts||{};$('tcSummary').innerHTML=`
    <article class="hr-summary-card"><span>Устройства</span><strong>${Number(c.devices||0)}</strong><small>ADMS: ${Number(c.admsDevices||0)}</small></article>
    <article class="hr-summary-card"><span>ADMS online</span><strong>${Number(c.admsOnline||0)}</strong><small>Контакт за последние 5 минут</small></article>
    <article class="hr-summary-card"><span>Связано с сотрудниками</span><strong>${Number(c.bindings||0)}</strong><small>${Number(c.unmatchedEvents||0)} неопознанных событий</small></article>
    <article class="hr-summary-card"><span>RAW ADMS</span><strong>${Number(c.rawAdms||0)}</strong><small>Последние принятые строки аппарата</small></article>`}

  function renderDevices(){
    const box=$('deviceList'),list=data.devices||[];
    box.innerHTML=list.length?list.map(d=>{const adms=d.connectionMode==='ADMS_PUSH',restaurant=(data.restaurantScope?.restaurants||[]).find(x=>String(x.id)===String(d.restaurantId));return`<article class="hr-device-card">
      <div><span>${esc(d.model||d.provider)}</span><strong>${esc(d.name)}</strong><small>${esc(d.location||'Место не указано')} · ${esc(d.timezone||'Asia/Baku')}</small>${d.serialNumber?`<small>SN: ${esc(d.serialNumber)}</small>`:''}<small>RMS: ${esc(restaurant?.name||d.restaurantId||'Не назначен')}</small></div>
      <div class="hr-device-meta">
        <div class="hr-device-badges"><span class="hr-badge ${d.active?'active':'fired'}">${d.active?'Активно':'Отключено'}</span>${adms?`<span class="hr-badge ${d.admsOnline?'linked':'pending'}">${d.admsOnline?'ADMS Online':'ADMS Offline'}</span>`:`<span class="hr-badge ${d.tokenConfigured?'linked':'pending'}">${d.tokenConfigured?'Connector готов':'Нет ключа'}</span>`}</div>
        ${adms?`<small>${d.admsLastSeenAt?'Последний контакт: '+esc(localDate(d.admsLastSeenAt)):'Аппарат ещё не подключался'}</small><small>${d.admsLastEventAt?'Последняя отметка: '+esc(localDate(d.admsLastEventAt)):'ATTLOG ещё не получен'}</small>${d.lastIp?`<small>Последний IP: ${esc(d.lastIp)}</small>`:''}${d.pushVersion?`<small>Push: ${esc(d.pushVersion)}${d.firmware?' · FW '+esc(d.firmware):''}</small>`:''}`:`<small>${d.lastSyncAt?'Последняя синхронизация: '+esc(localDate(d.lastSyncAt)):'События ещё не загружались'}</small>`}
        ${!adms?`<div class="hr-device-actions"><button type="button" class="hr-link-button" data-token-device="${esc(d.id)}">${d.tokenConfigured?'Перевыпустить ключ':'Создать ключ'}</button>${d.tokenConfigured?`<button type="button" class="hr-link-button danger" data-revoke-device="${esc(d.id)}">Отозвать</button>`:''}</div>`:''}
      </div>
    </article>`}).join(''):'<div class="hr-empty">Устройства пока не добавлены</div>';
    box.querySelectorAll('[data-token-device]').forEach(btn=>btn.onclick=()=>rotateDeviceToken(btn.dataset.tokenDevice));
    box.querySelectorAll('[data-revoke-device]').forEach(btn=>btn.onclick=()=>revokeDeviceToken(btn.dataset.revokeDevice));
  }

  function employeesForDevice(deviceId){
    const employees=(data.employees||[]).filter(x=>!x.deleted&&!x.fireDate);
    if(data.restaurantScope?.mode!=='CHAIN')return employees;
    const device=(data.devices||[]).find(d=>String(d.id)===String(deviceId));
    const restaurant=(data.restaurantScope?.restaurants||[]).find(r=>String(r.id)===String(device?.restaurantId||''));
    if(!restaurant?.code)return[];
    const key=String(restaurant.code).trim().toLowerCase();
    return employees.filter(x=>(x.departmentCodes||[x.departmentCode])
      .some(code=>String(code||'').trim().toLowerCase()===key));
  }
  function renderEmployeeSelector(){
    const d=$('bindingDevice'),e=$('bindingEmployee');
    const previous=e.value,employees=employeesForDevice(d.value);
    e.innerHTML=employees.length?employees.map(x=>`<option value="${esc(x.id)}">${esc(x.name||x.code)}${x.roleName?' · '+esc(x.roleName):''}</option>`).join('')
      :'<option value="">Нет сотрудников, привязанных к ресторану устройства</option>';
    if(employees.some(x=>String(x.id)===previous))e.value=previous;
  }
  function renderSelectors(){
    const devices=data.devices||[],d=$('bindingDevice');
    const previous=d.value;
    d.innerHTML=devices.length?devices.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.provider)}</option>`).join('')
      :'<option value="">Сначала добавьте устройство</option>';
    if(devices.some(x=>String(x.id)===previous))d.value=previous;
    renderEmployeeSelector();
  }

  function renderRosterPreview(){
    const box=$('tcRosterPreview');
    if(!box)return;
    const plans=data.rosterPreview||[];
    box.innerHTML=plans.length?plans.map(plan=>{
      const cap=plan.model||{},eligible=plan.preview||[];
      const methods=cap.face?'Лицо и отпечаток':'Только отпечаток';
      const rows=eligible.map(e=>
        `<div style="padding:6px 0;border-bottom:1px solid rgba(128,149,173,.15);font-size:12px">
          <strong>${esc(e.name||e.employeeCode||e.id)}</strong>
          <span class="hr-muted"> · № ${esc(e.employeeCode||'—')} · ${e.suggestedId?'кандидат PIN '+esc(e.suggestedId):'нужен числовой PIN'}</span>
        </div>`).join('');
      return `<article class="hr-device-card">
        <div style="width:100%">
          <span>${esc(cap.name||'Модель не определена')} · ${esc(plan.restaurantName||'Без разрешённого RMS')}</span>
          <strong>${esc(plan.name||plan.deviceId)} · ${Number(plan.eligibleCount||0)} сотрудников</strong>
          <small>${esc(methods)} · ${esc(cap.connection||'Проверьте прошивку')}</small>
          ${plan.rosterStatus==='RESTAURANT_NOT_IN_SCOPE'?'<small>Устройство не относится к выбранным ресторанам</small>':''}
          <div style="margin-top:8px">${rows||'<small>Нет подходящих сотрудников в данном RMS</small>'}</div>
          ${plan.additionalCount?`<small>Ещё ${Number(plan.additionalCount)} сотрудников</small>`:''}
          <small style="margin-top:8px">План составлен · отправка ещё не выполнялась</small>
        </div>
      </article>`;
    }).join(''):'<div class="hr-empty">Добавьте устройство, чтобы увидеть сотрудников, подготовленных для его RMS.</div>';
  }
  function renderBindings(){const list=data.bindings||[];$('bindingCount').textContent=`${list.length} связей`;$('bindingRows').innerHTML=list.length?list.map(b=>`<tr><td class="text-left"><div class="hr-name">${esc(employeeName(b.employeeId))}</div></td><td>${esc(deviceName(b.deviceId))}</td><td><span class="hr-badge linked">${esc(b.externalEmployeeId)}</span>${b.externalLabel?`<div class="hr-sub">${esc(b.externalLabel)}</div>`:''}</td><td>${esc(b.provider)}</td><td><button class="hr-link-button" data-unlink-device="${esc(b.deviceId)}" data-unlink-employee="${esc(b.employeeId)}">Удалить связь</button></td></tr>`).join(''):'<tr><td colspan="5" class="hr-empty">Сотрудники ещё не связаны с устройствами</td></tr>';$('bindingRows').querySelectorAll('[data-unlink-device]').forEach(btn=>btn.onclick=()=>unlink(btn.dataset.unlinkDevice,btn.dataset.unlinkEmployee));}

  function renderEvents(){const list=data.events||[];$('eventCount').textContent=`${list.length} последних событий`;$('eventRows').innerHTML=list.length?list.map(x=>`<tr><td>${esc(localDate(x.eventTime))}</td><td class="text-left"><div class="hr-name">${esc(x.employeeName||'Не сопоставлен')}</div>${x.employeeCode?`<div class="hr-sub">№ ${esc(x.employeeCode)}</div>`:''}</td><td><span class="hr-badge active">Отметка</span></td><td>${esc(deviceName(x.deviceId))}</td><td>${esc(x.externalEmployeeId||'—')}</td><td>${x.employeeId?'<span class="hr-badge linked">Связан</span>':'<span class="hr-badge pending">Не сопоставлен</span>'}</td></tr>`).join(''):'<tr><td colspan="6" class="hr-empty">Журнал пока пуст. События появятся после подключения устройства.</td></tr>';}
  function renderAdmsRequests(){const list=(data.admsRequests||[]).slice(0,40);const c=$('admsRequestCount'),rows=$('admsRequestRows');if(!c||!rows)return;c.textContent=`${list.length} запросов`;rows.innerHTML=list.length?list.map(x=>`<tr><td>${esc(localDate(x.receivedAt))}</td><td>${esc(x.endpoint||'—')}</td><td>${esc(x.method||'—')}</td><td>${esc(x.tableName||'—')}</td><td>${Number(x.bodyLength||0)} B</td><td class="text-left"><code>${esc(x.queryText||'—')}</code></td></tr>`).join(''):'<tr><td colspan="6" class="hr-empty">Диагностика пока пуста. После следующего контакта аппарата здесь появится запрос.</td></tr>';}
  function renderAdmsCommands(){const rows=$('admsCommandRows');if(!rows)return;const list=data.admsCommands||[];rows.innerHTML=list.length?list.map(x=>`<tr><td>${Number(x.id||0)}</td><td><span class="hr-badge ${x.status==='ACK'?'linked':x.status==='SENT'?'active':'pending'}">${esc(x.status||'—')}</span></td><td>${esc(localDate(x.createdAt))}</td><td>${esc(x.sentAt?localDate(x.sentAt):'—')}</td><td>${esc(x.acknowledgedAt?localDate(x.acknowledgedAt):'—')}${x.returnCode?' · '+esc(x.returnCode):''}</td><td class="text-left"><code>${esc(x.commandText||'')}</code></td></tr>`).join(''):'<tr><td colspan="6" class="hr-empty">Команды аппарату ещё не отправлялись.</td></tr>';}

  function renderRawAdms(){const list=data.rawAdms||[];$('rawAdmsCount').textContent=`${list.length} записей`;$('rawAdmsRows').innerHTML=list.length?list.map(x=>`<tr><td>${esc(localDate(x.receivedAt))}</td><td>${esc(x.tableName||'—')}</td><td>${esc(x.serialNumber||'—')}</td><td>${esc(x.externalEmployeeId||'—')}</td><td>${esc(x.eventTime?localDate(x.eventTime):'—')}</td><td>${esc(x.status||'—')}</td><td>${esc(x.verifyType||'—')}</td><td class="text-left"><code>${esc(x.rawLine||'')}</code></td></tr>`).join(''):'<tr><td colspan="8" class="hr-empty">RAW ADMS пока пуст. После первого подключения здесь увидим точный формат данных SenseFace 2A.</td></tr>';}
  function renderAdmsSetup(){$('admsServerHost').textContent=location.hostname;$('admsServerPort').textContent=location.protocol==='https:'?'443':(location.port||'80')}
  function render(){renderSummary();renderDevices();renderRosterPreview();renderDeleteButtons();renderSelectors();renderBindings();renderAdmsRequests();renderAdmsCommands();renderRawAdms();renderEvents();renderAdmsSetup()}

  function renderDeleteButtons(){
    document.querySelectorAll('#deviceList .hr-device-card').forEach((card,index)=>{
      const d=(data.devices||[])[index];if(!d)return;
      let actions=card.querySelector('.hr-device-actions');
      if(!actions){actions=document.createElement('div');actions.className='hr-device-actions';card.querySelector('.hr-device-meta')?.appendChild(actions)}
      if(d.connectionMode==='ADMS_PUSH'&&!actions.querySelector('[data-correct-serial]')){
        const edit=document.createElement('button');
        edit.type='button';edit.className='hr-link-button';
        edit.dataset.correctSerial=d.id;edit.textContent='Исправить SN';
        edit.title='Исправить серийный номер по экрану Device Info, сохранив устройство и журнал';
        edit.onclick=()=>correctDeviceSerial(d.id);
        actions.appendChild(edit);
      }
      if(data.restaurantScope?.mode==='CHAIN'&&data.restaurantScope?.deviceScope==='ALL'&&
         !actions.querySelector('[data-reassign-rms]')){
        const reassign=document.createElement('button');
        reassign.type='button';reassign.className='hr-link-button';
        reassign.dataset.reassignRms=d.id;reassign.textContent='Изменить RMS';
        reassign.title='Переназначить RMS до появления первых отметок';
        reassign.onclick=()=>reassignDeviceRestaurant(d.id);
        actions.appendChild(reassign);
      }
      if(actions.querySelector('[data-delete-device]'))return;
      const btn=document.createElement('button');
      btn.type='button';btn.className='hr-link-button danger';btn.dataset.deleteDevice=d.id;btn.textContent='Удалить';
      btn.onclick=()=>deleteDevice(d.id);actions.appendChild(btn);
    });
  }
  async function correctDeviceSerial(deviceId){
    const device=(data.devices||[]).find(x=>String(x.id)===String(deviceId));
    if(!device||device.connectionMode!=='ADMS_PUSH')return;
    const input=prompt('Введите точный серийный номер SN из меню Device Info аппарата (включая буквенный префикс, если он есть):',device.serialNumber||'');
    if(input===null)return;
    const next=String(input).trim().toUpperCase();
    if(!/^[A-Z0-9-]{6,64}$/.test(next)){
      $('tcError').hidden=false;$('tcError').textContent='Укажите полный SN: латинские буквы, цифры и дефисы (6–64 символа).';return;
    }
    if(next===String(device.serialNumber||'').toUpperCase())return;
    if(!confirm('Перепривязать ADMS с SN '+device.serialNumber+' на '+next+'? Карточка аппарата и сохранённые явки останутся. Проверьте SN именно в Device Info.'))return;
    try{
      setStatus('Исправляем серийный номер…','loading');
      const response=await api({action:'correctDeviceSerial',deviceId,serialNumber:next});
      data=response;render();
      $('tcError').hidden=true;
      setStatus('SN исправлен · ожидаем контакт ADMS','ok');
    }catch(e){
      $('tcError').hidden=false;$('tcError').textContent=e.message;
      setStatus('Ошибка исправления SN','error');
    }
  }
  async function reassignDeviceRestaurant(deviceId){
    const d=(data.devices||[]).find(x=>String(x.id)===String(deviceId));
    const restaurants=data.restaurantScope?.restaurants||[];
    if(!d||!restaurants.length)return;
    const choices=restaurants.map((x,i)=>(i+1)+'. '+x.name+' ('+x.code+')').join('\n');
    const old=restaurants.find(x=>String(x.id)===String(d.restaurantId));
    const input=prompt('Выберите номер RMS для '+d.name+'. Переназначение возможно только ДО первых отметок:\n'+choices,
      String(Math.max(1,restaurants.findIndex(x=>String(x.id)===String(d.restaurantId))+1)));
    if(input===null)return;
    const index=Number(input)-1;
    if(!Number.isInteger(index)||index<0||index>=restaurants.length){
      $('tcError').hidden=false;$('tcError').textContent='Выберите номер RMS из списка.';return;
    }
    const next=restaurants[index];
    if(String(next.id)===String(d.restaurantId))return;
    if(!confirm('Перенести '+d.name+' из «'+(old?.name||d.restaurantId)+'» в «'+next.name+'»? Если есть прежние отметки, сервер запретит перенос.'))return;
    try{
      setStatus('Меняем подразделение устройства…','loading');
      data=await api({action:'reassignDeviceRestaurant',deviceId,restaurantId:next.id});
      render();$('tcError').hidden=true;
      setStatus('Новый RMS устройства сохранён','ok');
    }catch(e){
      $('tcError').hidden=false;$('tcError').textContent=e.message;
      setStatus('Ошибка смены RMS','error');
    }
  }
  async function deleteDevice(deviceId){
    const d=(data.devices||[]).find(x=>String(x.id)===String(deviceId));
    if(!confirm('Удалить устройство «'+(d?.name||deviceId)+'»? Связи сотрудников и RAW ADMS этого устройства будут удалены.'))return;
    try{
      setStatus('Удаляем устройство…','loading');
      data=await api({action:'deleteDevice',deviceId});
      render();
      setStatus('Устройство удалено','ok');
    }catch(e){
      $('tcError').hidden=false;$('tcError').textContent=e.message;setStatus('Ошибка','error');
    }
  }
  function showDeviceToken(deviceId,value){currentDeviceToken=String(value||'');const d=(data.devices||[]).find(x=>x.id===deviceId);$('deviceTokenTitle').textContent=`${d?.name||'Устройство'} · новый ключ`;$('deviceTokenValue').textContent=currentDeviceToken;$('deviceTokenPanel').hidden=false;$('deviceTokenPanel').scrollIntoView({behavior:'smooth',block:'nearest'})}
  function hideDeviceToken(){currentDeviceToken='';$('deviceTokenValue').textContent='';$('deviceTokenPanel').hidden=true}
  async function copyDeviceToken(){if(!currentDeviceToken)return;try{await navigator.clipboard.writeText(currentDeviceToken);setStatus('Ключ скопирован','ok')}catch{const ta=document.createElement('textarea');ta.value=currentDeviceToken;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();setStatus('Ключ скопирован','ok')}}

  async function load(){if(busy)return;const err=$('tcError');try{busy=true;$('tcRefresh').disabled=true;err.hidden=true;setStatus('Загрузка…','loading');data=await api();render();setStatus('Готово','ok');}catch(e){console.error(e);err.hidden=false;err.textContent=e?.message||String(e);setStatus('Ошибка','error')}finally{busy=false;$('tcRefresh').disabled=false}}
  async function saveDevice(ev){ev.preventDefault();try{setStatus('Сохраняем…','loading');data=await api({action:'saveDevice',provider:$('deviceProvider').value,model:$('deviceModel').value,serialNumber:$('deviceSerial').value,name:$('deviceName').value,location:$('deviceLocation').value,timezone:$('deviceTimezone').value,connectionMode:$('deviceConnectionMode').value});$('deviceName').value='';$('deviceLocation').value='';$('deviceSerial').value='';render();setStatus('Устройство добавлено','ok')}catch(e){$('tcError').hidden=false;$('tcError').textContent=e.message;setStatus('Ошибка','error')}}
  async function rotateDeviceToken(deviceId){try{const d=(data.devices||[]).find(x=>x.id===deviceId);if(d?.tokenConfigured&&!confirm('Старый ключ перестанет работать сразу после перевыпуска. Продолжить?'))return;setStatus('Создаём ключ…','loading');const result=await api({action:'rotateDeviceToken',deviceId});data=result;render();showDeviceToken(deviceId,result.deviceToken);setStatus('Новый ключ создан','ok')}catch(e){$('tcError').hidden=false;$('tcError').textContent=e.message;setStatus('Ошибка','error')}}
  async function revokeDeviceToken(deviceId){if(!confirm('Отозвать ключ устройства? Connector сразу потеряет доступ к отправке событий.'))return;try{setStatus('Отзываем ключ…','loading');data=await api({action:'revokeDeviceToken',deviceId});hideDeviceToken();render();setStatus('Ключ отозван','ok')}catch(e){$('tcError').hidden=false;$('tcError').textContent=e.message;setStatus('Ошибка','error')}}
  async function link(ev){ev.preventDefault();try{setStatus('Сохраняем связь…','loading');data=await api({action:'linkEmployee',deviceId:$('bindingDevice').value,employeeId:$('bindingEmployee').value,externalEmployeeId:$('bindingExternalId').value,externalLabel:$('bindingLabel').value});$('bindingExternalId').value='';$('bindingLabel').value='';render();setStatus('Связь сохранена','ok')}catch(e){$('tcError').hidden=false;$('tcError').textContent=e.message;setStatus('Ошибка','error')}}
  async function unlink(deviceId,employeeId){if(!confirm('Удалить связь сотрудника с устройством?'))return;try{data=await api({action:'unlinkEmployee',deviceId,employeeId});render();setStatus('Связь удалена','ok')}catch(e){$('tcError').hidden=false;$('tcError').textContent=e.message}}
  async function requestAttendanceLog(){
    const device=(data.devices||[]).find(x=>x.connectionMode==='ADMS_PUSH'&&x.active)||(data.devices||[])[0];
    if(!device){$('tcError').hidden=false;$('tcError').textContent='ADMS устройство не найдено';return}
    try{
      setStatus('Запрашиваем ATTLOG…','loading');
      const out=await api({action:'requestAttendanceLog',deviceId:device.id});
      data=out;render();
      setStatus('Запрос ATTLOG поставлен в очередь','ok');
      let tries=0;
      const watch=async()=>{if(++tries>8)return;await new Promise(r=>setTimeout(r,5000));try{data=await api();render();const cmd=(data.admsCommands||[]).find(x=>Number(x.id)===Number(out.commandId));if(cmd&&['ACK','SUPERSEDED'].includes(cmd.status))return}catch(_){}watch()};
      watch();
    }catch(e){
      $('tcError').hidden=false;$('tcError').textContent=e.message;setStatus('Ошибка','error');
    }
  }
  function bind(){$('tcRefresh').onclick=load;$('requestAttlog').onclick=requestAttendanceLog;$('deviceForm').onsubmit=saveDevice;$('bindingForm').onsubmit=link;$('bindingDevice').onchange=renderEmployeeSelector;$('copyDeviceToken').onclick=copyDeviceToken;$('closeDeviceToken').onclick=hideDeviceToken;$('deviceConnectionMode').onchange=()=>{$('deviceSerial').required=$('deviceConnectionMode').value==='ADMS_PUSH'}}
  async function init(){bind();await load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
