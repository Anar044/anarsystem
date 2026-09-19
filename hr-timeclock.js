(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data={devices:[],employees:[],bindings:[],events:[],counts:{}},busy=false,currentDeviceToken='',tokenDeviceId='',editingDeviceId='';

  async function token(){const client=await window.SHAuth?.createClient?.();if(!client)throw new Error('Supabase Auth не готов');const{data,error}=await client.auth.getSession();const t=data?.session?.access_token;if(error||!t)throw new Error('Сессия пользователя не найдена');return t}
  function setStatus(text,kind=''){const el=$('tcStatus');if(!el)return;el.textContent=text;el.className=`hr-status ${kind}`.trim()}
  function showError(message){const err=$('tcError');err.hidden=!message;err.textContent=message||''}
  async function api(body=null){const t=await token();const opt={headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}};if(body){opt.method='POST';opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}const r=await fetch('/api/hr/timeclock',opt);const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);return j}
  function employeeName(id){const e=(data.employees||[]).find(x=>x.id===id);return e?.name||[e?.lastName,e?.firstName].filter(Boolean).join(' ')||id||'—'}
  function deviceName(id){return (data.devices||[]).find(x=>x.id===id)?.name||id||'—'}
  function localDate(v){if(!v)return'';try{return new Date(v).toLocaleString('ru-RU')}catch{return String(v)}}
  function connectorBadge(d){const s=d.connectorStatus||'OFFLINE';if(s==='ONLINE')return'<span class="hr-badge linked">Connector online</span>';if(s==='STALE')return'<span class="hr-badge pending">Связь устарела</span>';return'<span class="hr-badge fired">Connector offline</span>'}
  function adapterLabel(v){return v==='ZKEMKEEPER'?'ZKEMKEEPER / SDK':'TA Push / ADMS'}

  function renderSummary(){const c=data.counts||{};$('tcSummary').innerHTML=`
    <article class="hr-summary-card"><span>Устройства</span><strong>${Number(c.devices||0)}</strong><small>Активные источники отметок</small></article>
    <article class="hr-summary-card"><span>Connector online</span><strong>${Number(c.onlineConnectors||0)}</strong><small>Heartbeat за последние 90 секунд</small></article>
    <article class="hr-summary-card"><span>Связано с Face ID</span><strong>${Number(c.bindings||0)}</strong><small>Сопоставления employee ID</small></article>
    <article class="hr-summary-card"><span>Ключи connector</span><strong>${Number(c.deviceTokens||0)}</strong><small>${Number(c.unmatchedEvents||0)} неопознанных событий</small></article>`}

  function renderDevices(){
    const box=$('deviceList'),list=data.devices||[];
    box.innerHTML=list.length?list.map(d=>`<article class="hr-device-card">
      <div class="hr-device-main"><span>${esc(d.provider)} · ${esc(d.model||'Модель не указана')}</span><strong>${esc(d.name)}</strong><small>${esc(d.location||'Место не указано')} · ${esc(d.timezone||'Asia/Baku')}</small><small>${esc(adapterLabel(d.adapter))} · ${esc(d.ipAddress||'IP не указан')}:${esc(d.port||4370)}${d.serialNumber?` · SN ${esc(d.serialNumber)}`:''}</small></div>
      <div class="hr-device-meta">
        <div class="hr-device-badges">${connectorBadge(d)}<span class="hr-badge ${d.active?'active':'fired'}">${d.active?'Активно':'Отключено'}</span><span class="hr-badge ${d.tokenConfigured?'linked':'pending'}">${d.tokenConfigured?'Ключ настроен':'Нет ключа'}</span></div>
        <small>${d.connectorLastSeenAt?'Heartbeat: '+esc(localDate(d.connectorLastSeenAt)):'Connector ещё не выходил на связь'}</small>
        <small>${d.lastSyncAt?'Последняя отметка: '+esc(localDate(d.lastSyncAt)):'Отметки ещё не загружались'}</small>
        <div class="hr-device-actions"><button type="button" class="hr-link-button" data-check-device="${esc(d.id)}">Проверить Connector</button><button type="button" class="hr-link-button" data-edit-device="${esc(d.id)}">Редактировать</button><button type="button" class="hr-link-button" data-token-device="${esc(d.id)}">${d.tokenConfigured?'Перевыпустить ключ':'Создать ключ'}</button><button type="button" class="hr-link-button" data-toggle-device="${esc(d.id)}" data-active="${d.active?'1':'0'}">${d.active?'Отключить':'Включить'}</button>${d.tokenConfigured?`<button type="button" class="hr-link-button danger" data-revoke-device="${esc(d.id)}">Отозвать ключ</button>`:''}</div>
      </div>
    </article>`).join(''):'<div class="hr-empty">Устройства пока не добавлены</div>';
    box.querySelectorAll('[data-check-device]').forEach(btn=>btn.onclick=()=>checkConnector(btn.dataset.checkDevice));
    box.querySelectorAll('[data-edit-device]').forEach(btn=>btn.onclick=()=>editDevice(btn.dataset.editDevice));
    box.querySelectorAll('[data-token-device]').forEach(btn=>btn.onclick=()=>rotateDeviceToken(btn.dataset.tokenDevice));
    box.querySelectorAll('[data-toggle-device]').forEach(btn=>btn.onclick=()=>toggleDevice(btn.dataset.toggleDevice,btn.dataset.active!=='1'));
    box.querySelectorAll('[data-revoke-device]').forEach(btn=>btn.onclick=()=>revokeDeviceToken(btn.dataset.revokeDevice));
  }

  function renderSelectors(){const devices=(data.devices||[]).filter(x=>x.active),employees=(data.employees||[]).filter(x=>!x.deleted&&!x.fireDate);const d=$('bindingDevice'),e=$('bindingEmployee');d.innerHTML=devices.length?devices.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.model||x.provider)}</option>`).join(''):'<option value="">Сначала добавьте устройство</option>';e.innerHTML=employees.length?employees.map(x=>`<option value="${esc(x.id)}">${esc(x.name||x.code)}${x.roleName?' · '+esc(x.roleName):''}</option>`).join(''):'<option value="">Сначала синхронизируйте сотрудников</option>';}
  function renderBindings(){const list=data.bindings||[];$('bindingCount').textContent=`${list.length} связей`;$('bindingRows').innerHTML=list.length?list.map(b=>`<tr><td class="text-left"><div class="hr-name">${esc(employeeName(b.employeeId))}</div></td><td>${esc(deviceName(b.deviceId))}</td><td><span class="hr-badge linked">${esc(b.externalEmployeeId)}</span>${b.externalLabel?`<div class="hr-sub">${esc(b.externalLabel)}</div>`:''}</td><td>${esc(b.provider)}</td><td><button class="hr-link-button" data-unlink-device="${esc(b.deviceId)}" data-unlink-employee="${esc(b.employeeId)}">Удалить связь</button></td></tr>`).join(''):'<tr><td colspan="5" class="hr-empty">Сотрудники ещё не связаны с устройствами</td></tr>';$('bindingRows').querySelectorAll('[data-unlink-device]').forEach(btn=>btn.onclick=()=>unlink(btn.dataset.unlinkDevice,btn.dataset.unlinkEmployee));}
  function renderEvents(){const list=data.events||[];$('eventCount').textContent=`${list.length} последних событий`;$('eventRows').innerHTML=list.length?list.map(x=>`<tr><td>${esc(localDate(x.eventTime))}</td><td class="text-left"><div class="hr-name">${esc(x.employeeName||'Не сопоставлен')}</div>${x.employeeCode?`<div class="hr-sub">№ ${esc(x.employeeCode)}</div>`:''}</td><td><span class="hr-badge ${x.eventType==='IN'?'active':x.eventType==='OUT'?'pending':''}">${esc(x.eventType)}</span></td><td>${esc(deviceName(x.deviceId))}</td><td>${esc(x.externalEmployeeId||'—')}</td><td>${x.employeeId?'<span class="hr-badge linked">Связан</span>':'<span class="hr-badge pending">Не сопоставлен</span>'}</td></tr>`).join(''):'<tr><td colspan="6" class="hr-empty">Журнал пока пуст. События появятся после подключения устройства.</td></tr>';}
  function render(){renderSummary();renderDevices();renderSelectors();renderBindings();renderEvents()}

  function resetDeviceForm(){editingDeviceId='';$('deviceProvider').value='ZKTECO';$('deviceModel').value='SenseFace 2A';$('deviceName').value='';$('deviceLocation').value='';$('deviceAdapter').value='TA_PUSH';$('deviceIp').value='';$('devicePort').value='4370';$('deviceSerial').value='';$('deviceTimezone').value='Asia/Baku';$('saveDeviceButton').textContent='+ Добавить устройство';$('cancelDeviceEdit').hidden=true}
  function editDevice(deviceId){const d=(data.devices||[]).find(x=>x.id===deviceId);if(!d)return;editingDeviceId=d.id;$('deviceProvider').value=d.provider||'ZKTECO';const model=[...$('deviceModel').options].some(o=>o.value===d.model)?d.model:'Other';$('deviceModel').value=model;$('deviceName').value=d.name||'';$('deviceLocation').value=d.location||'';$('deviceAdapter').value=d.adapter||'TA_PUSH';$('deviceIp').value=d.ipAddress||'';$('devicePort').value=String(d.port||4370);$('deviceSerial').value=d.serialNumber||'';$('deviceTimezone').value=d.timezone||'Asia/Baku';$('saveDeviceButton').textContent='Сохранить устройство';$('cancelDeviceEdit').hidden=false;$('deviceForm').scrollIntoView({behavior:'smooth',block:'center'});setStatus('Редактирование устройства','loading')}

  function showDeviceToken(deviceId,value){currentDeviceToken=String(value||'');tokenDeviceId=deviceId;const d=(data.devices||[]).find(x=>x.id===deviceId);$('deviceTokenTitle').textContent=`${d?.name||'Устройство'} · новый ключ`;$('deviceTokenValue').textContent=currentDeviceToken;$('deviceTokenPanel').hidden=false;$('deviceTokenPanel').scrollIntoView({behavior:'smooth',block:'nearest'})}
  function hideDeviceToken(){currentDeviceToken='';tokenDeviceId='';$('deviceTokenValue').textContent='';$('deviceTokenPanel').hidden=true}
  async function copyText(value,ok){if(!value)return;try{await navigator.clipboard.writeText(value)}catch{const ta=document.createElement('textarea');ta.value=value;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove()}setStatus(ok,'ok')}
  async function copyDeviceToken(){await copyText(currentDeviceToken,'Token скопирован')}

  function connectorConfigObject(){
    const d=(data.devices||[]).find(x=>x.id===tokenDeviceId);if(!d||!currentDeviceToken)throw new Error('Сначала создайте или перевыпустите ключ устройства');
    return{
      Server:{BaseUrl:location.origin,IngestPath:'/api/hr/device-ingest',TimeoutSeconds:30,SyncIntervalSeconds:5},
      Queue:{BatchSize:200,RetentionDays:90},
      TaPushListenPort:8088,
      UtcOffsetMinutes:240,
      DataDirectory:'',
      Devices:[{Key:d.id,Name:d.name,Model:d.model||'',Adapter:d.adapter||'TA_PUSH',IpAddress:d.ipAddress||'',Port:Number(d.port||4370),SerialNumber:d.serialNumber||'',MachineNumber:1,PollSeconds:60,LookbackDays:90,DeviceToken:currentDeviceToken,Enabled:true}]
    }
  }
  function connectorConfigText(){return JSON.stringify(connectorConfigObject(),null,2)}
  async function copyConnectorConfig(){try{await copyText(connectorConfigText(),'connector.json скопирован')}catch(e){showError(e.message)}}
  function downloadConnectorConfig(){try{const d=(data.devices||[]).find(x=>x.id===tokenDeviceId);const blob=new Blob([connectorConfigText()],{type:'application/json;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`connector-${String(d?.name||'zkteco').replace(/[^a-z0-9а-яё_-]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase()||'zkteco'}.json`;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},0);setStatus('connector.json скачан','ok')}catch(e){showError(e.message)}}

  async function load(){if(busy)return;try{busy=true;$('tcRefresh').disabled=true;showError('');setStatus('Загрузка…','loading');data=await api();render();setStatus('Готово','ok')}catch(e){console.error(e);showError(e?.message||String(e));setStatus('Ошибка','error')}finally{busy=false;$('tcRefresh').disabled=false}}
  async function saveDevice(ev){ev.preventDefault();try{showError('');setStatus('Сохраняем…','loading');const wasEditing=Boolean(editingDeviceId);const payload={action:'saveDevice',id:editingDeviceId||undefined,provider:$('deviceProvider').value,model:$('deviceModel').value,name:$('deviceName').value,location:$('deviceLocation').value,adapter:$('deviceAdapter').value,ipAddress:$('deviceIp').value,port:Number($('devicePort').value||4370),serialNumber:$('deviceSerial').value,timezone:$('deviceTimezone').value,connectionMode:'LOCAL_CONNECTOR'};data=await api(payload);render();resetDeviceForm();setStatus(wasEditing?'Устройство обновлено':'Устройство сохранено','ok')}catch(e){showError(e.message);setStatus('Ошибка','error')}}
  async function checkConnector(deviceId){try{showError('');setStatus('Проверяем heartbeat…','loading');const result=await api({action:'checkConnector',deviceId});data=result;render();const d=(data.devices||[]).find(x=>x.id===deviceId);if(d?.connectorStatus==='ONLINE')setStatus('Connector online','ok');else if(d?.connectorStatus==='STALE')setStatus('Heartbeat устарел','loading');else setStatus('Connector offline','error')}catch(e){showError(e.message);setStatus('Ошибка','error')}}
  async function toggleDevice(deviceId,active){try{data=await api({action:'setDeviceActive',deviceId,active});render();setStatus(active?'Устройство включено':'Устройство отключено','ok')}catch(e){showError(e.message);setStatus('Ошибка','error')}}
  async function rotateDeviceToken(deviceId){try{const d=(data.devices||[]).find(x=>x.id===deviceId);if(d?.tokenConfigured&&!confirm('Старый ключ перестанет работать сразу после перевыпуска. Продолжить?'))return;setStatus('Создаём ключ…','loading');const result=await api({action:'rotateDeviceToken',deviceId});data=result;render();showDeviceToken(deviceId,result.deviceToken);setStatus('Новый ключ создан','ok')}catch(e){showError(e.message);setStatus('Ошибка','error')}}
  async function revokeDeviceToken(deviceId){if(!confirm('Отозвать ключ устройства? Connector сразу потеряет доступ к отправке событий.'))return;try{setStatus('Отзываем ключ…','loading');data=await api({action:'revokeDeviceToken',deviceId});hideDeviceToken();render();setStatus('Ключ отозван','ok')}catch(e){showError(e.message);setStatus('Ошибка','error')}}
  async function link(ev){ev.preventDefault();try{setStatus('Сохраняем связь…','loading');data=await api({action:'linkEmployee',deviceId:$('bindingDevice').value,employeeId:$('bindingEmployee').value,externalEmployeeId:$('bindingExternalId').value,externalLabel:$('bindingLabel').value});$('bindingExternalId').value='';$('bindingLabel').value='';render();setStatus('Связь сохранена','ok')}catch(e){showError(e.message);setStatus('Ошибка','error')}}
  async function unlink(deviceId,employeeId){if(!confirm('Удалить связь сотрудника с устройством?'))return;try{data=await api({action:'unlinkEmployee',deviceId,employeeId});render();setStatus('Связь удалена','ok')}catch(e){showError(e.message)}}
  function bind(){$('tcRefresh').onclick=load;$('deviceForm').onsubmit=saveDevice;$('bindingForm').onsubmit=link;$('copyDeviceToken').onclick=copyDeviceToken;$('copyConnectorConfig').onclick=copyConnectorConfig;$('downloadConnectorConfig').onclick=downloadConnectorConfig;$('closeDeviceToken').onclick=hideDeviceToken;$('cancelDeviceEdit').onclick=()=>{resetDeviceForm();setStatus('Редактирование отменено','ok')}}
  async function init(){bind();resetDeviceForm();await load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
