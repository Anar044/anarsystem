(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let data={devices:[],employees:[],bindings:[],events:[],counts:{}},busy=false,currentDeviceToken='';

  async function token(){const client=await window.SHAuth?.createClient?.();if(!client)throw new Error('Supabase Auth не готов');const{data,error}=await client.auth.getSession();const t=data?.session?.access_token;if(error||!t)throw new Error('Сессия пользователя не найдена');return t}
  function setStatus(text,kind=''){const el=$('tcStatus');if(!el)return;el.textContent=text;el.className=`hr-status ${kind}`.trim()}
  async function api(body=null){const t=await token();const opt={headers:{Authorization:`Bearer ${t}`,Accept:'application/json'}};if(body){opt.method='POST';opt.headers['Content-Type']='application/json';opt.body=JSON.stringify(body)}const r=await fetch('/api/hr/timeclock',opt);const j=await r.json().catch(()=>({success:false,message:'Некорректный ответ API'}));if(!r.ok||!j.success)throw new Error(j.message||`HTTP ${r.status}`);return j}
  function employeeName(id){const e=(data.employees||[]).find(x=>x.id===id);return e?.name||[e?.lastName,e?.firstName].filter(Boolean).join(' ')||id||'—'}
  function deviceName(id){return (data.devices||[]).find(x=>x.id===id)?.name||id||'—'}
  function localDate(v){if(!v)return'';try{return new Date(v).toLocaleString('ru-RU')}catch{return String(v)}}

  function renderSummary(){const c=data.counts||{};const devices=Number(c.devices||0),online=Number(c.connectorsOnline||0);$('tcSummary').innerHTML=`
    <article class="hr-summary-card"><span>Устройства</span><strong>${devices}</strong><small>Активные источники отметок</small></article>
    <article class="hr-summary-card"><span>Сотрудники</span><strong>${Number(c.employees||0)}</strong><small>Из кадрового справочника SH</small></article>
    <article class="hr-summary-card"><span>Связано с Face ID</span><strong>${Number(c.bindings||0)}</strong><small>Сопоставления employee ID</small></article>
    <article class="hr-summary-card"><span>Connector online</span><strong>${online}/${devices}</strong><small>${Number(c.deviceTokens||0)} ключей · ${Number(c.unmatchedEvents||0)} неопознанных событий</small></article>`}

  function renderDevices(){
    const box=$('deviceList'),list=data.devices||[];
    box.innerHTML=list.length?list.map(d=>{
      const deviceLine=[d.model,d.serialNumber?`SN ${d.serialNumber}`:''].filter(Boolean).join(' · ');
      const network=[d.ipAddress,d.port?`:${d.port}`:'',d.protocol].filter(Boolean).join(' ');
      return `<article class="hr-device-card">
      <div><span>${esc(d.provider)}${d.model?' · '+esc(d.model):''}</span><strong>${esc(d.name)}</strong><small>${esc(d.location||'Место не указано')} · ${esc(d.timezone||'Asia/Baku')}</small>${deviceLine?`<small>${esc(deviceLine)}</small>`:''}${network?`<small>${esc(network)}</small>`:''}</div>
      <div class="hr-device-meta">
        <div class="hr-device-badges"><span class="hr-badge ${d.active?'active':'fired'}">${d.active?'Активно':'Отключено'}</span><span class="hr-badge ${d.connectorOnline?'active':'pending'}">${d.connectorOnline?'Connector online':'Connector offline'}</span><span class="hr-badge ${d.tokenConfigured?'linked':'pending'}">${d.tokenConfigured?'Ключ настроен':'Нет ключа'}</span></div>
        <small>${d.connectorLastSeenAt?'Connector: '+esc(localDate(d.connectorLastSeenAt)):'Connector ещё не подключался'}${d.connectorVersion?` · v${esc(d.connectorVersion)}`:''}</small>
        ${d.terminalLastSeenAt?`<small>Терминал: ${esc(localDate(d.terminalLastSeenAt))}</small>`:''}
        ${d.lastSyncAt?`<small>Последнее событие: ${esc(localDate(d.lastSyncAt))}</small>`:'<small>События ещё не загружались</small>'}
        ${Number(d.queueSize)>0?`<small>Offline queue: ${Number(d.queueSize)} событий</small>`:''}
        ${d.tokenLastUsedAt?`<small>Ключ использован: ${esc(localDate(d.tokenLastUsedAt))}</small>`:''}
        <div class="hr-device-actions"><button type="button" class="hr-link-button" data-token-device="${esc(d.id)}">${d.tokenConfigured?'Перевыпустить ключ':'Создать ключ'}</button>${d.tokenConfigured?`<button type="button" class="hr-link-button danger" data-revoke-device="${esc(d.id)}">Отозвать</button>`:''}</div>
      </div>
    </article>`}).join(''):'<div class="hr-empty">Устройства пока не добавлены</div>';
    box.querySelectorAll('[data-token-device]').forEach(btn=>btn.onclick=()=>rotateDeviceToken(btn.dataset.tokenDevice));
    box.querySelectorAll('[data-revoke-device]').forEach(btn=>btn.onclick=()=>revokeDeviceToken(btn.dataset.revokeDevice));
  }

  function renderSelectors(){const devices=data.devices||[],employees=(data.employees||[]).filter(x=>!x.deleted&&!x.fireDate);const d=$('bindingDevice'),e=$('bindingEmployee');d.innerHTML=devices.length?devices.map(x=>`<option value="${esc(x.id)}">${esc(x.name)} · ${esc(x.provider)}</option>`).join(''):'<option value="">Сначала добавьте устройство</option>';e.innerHTML=employees.length?employees.map(x=>`<option value="${esc(x.id)}">${esc(x.name||x.code)}${x.roleName?' · '+esc(x.roleName):''}</option>`).join(''):'<option value="">Сначала синхронизируйте сотрудников</option>';}

  function renderBindings(){const list=data.bindings||[];$('bindingCount').textContent=`${list.length} связей`;$('bindingRows').innerHTML=list.length?list.map(b=>`<tr><td class="text-left"><div class="hr-name">${esc(employeeName(b.employeeId))}</div></td><td>${esc(deviceName(b.deviceId))}</td><td><span class="hr-badge linked">${esc(b.externalEmployeeId)}</span>${b.externalLabel?`<div class="hr-sub">${esc(b.externalLabel)}</div>`:''}</td><td>${esc(b.provider)}</td><td><button class="hr-link-button" data-unlink-device="${esc(b.deviceId)}" data-unlink-employee="${esc(b.employeeId)}">Удалить связь</button></td></tr>`).join(''):'<tr><td colspan="5" class="hr-empty">Сотрудники ещё не связаны с устройствами</td></tr>';$('bindingRows').querySelectorAll('[data-unlink-device]').forEach(btn=>btn.onclick=()=>unlink(btn.dataset.unlinkDevice,btn.dataset.unlinkEmployee));}

  function renderEvents(){const list=data.events||[];$('eventCount').textContent=`${list.length} последних событий`;$('eventRows').innerHTML=list.length?list.map(x=>`<tr><td>${esc(localDate(x.eventTime))}</td><td class="text-left"><div class="hr-name">${esc(x.employeeName||'Не сопоставлен')}</div>${x.employeeCode?`<div class="hr-sub">№ ${esc(x.employeeCode)}</div>`:''}</td><td><span class="hr-badge ${x.eventType==='IN'?'active':x.eventType==='OUT'?'pending':''}">${esc(x.eventType)}</span></td><td>${esc(deviceName(x.deviceId))}</td><td>${esc(x.externalEmployeeId||'—')}</td><td>${x.employeeId?'<span class="hr-badge linked">Связан</span>':'<span class="hr-badge pending">Не сопоставлен</span>'}</td></tr>`).join(''):'<tr><td colspan="6" class="hr-empty">Журнал пока пуст. События появятся после подключения устройства.</td></tr>';}
  function render(){renderSummary();renderDevices();renderSelectors();renderBindings();renderEvents()}

  function showDeviceToken(deviceId,value){currentDeviceToken=String(value||'');const d=(data.devices||[]).find(x=>x.id===deviceId);$('deviceTokenTitle').textContent=`${d?.name||'Устройство'} · новый ключ`;$('deviceTokenValue').textContent=currentDeviceToken;$('deviceTokenPanel').hidden=false;$('deviceTokenPanel').scrollIntoView({behavior:'smooth',block:'nearest'})}
  function hideDeviceToken(){currentDeviceToken='';$('deviceTokenValue').textContent='';$('deviceTokenPanel').hidden=true}
  async function copyDeviceToken(){if(!currentDeviceToken)return;try{await navigator.clipboard.writeText(currentDeviceToken);setStatus('Ключ скопирован','ok')}catch{const ta=document.createElement('textarea');ta.value=currentDeviceToken;document.body.appendChild(ta);ta.select();document.execCommand('copy');ta.remove();setStatus('Ключ скопирован','ok')}}

  async function load(){if(busy)return;const err=$('tcError');try{busy=true;$('tcRefresh').disabled=true;err.hidden=true;setStatus('Загрузка…','loading');data=await api();render();setStatus('Готово','ok')}catch(e){console.error(e);err.hidden=false;err.textContent=e?.message||String(e);setStatus('Ошибка','error')}finally{busy=false;$('tcRefresh').disabled=false}}
  async function saveDevice(ev){ev.preventDefault();try{setStatus('Сохраняем…','loading');data=await api({action:'saveDevice',provider:$('deviceProvider').value,name:$('deviceName').value,location:$('deviceLocation').value,timezone:$('deviceTimezone').value,connectionMode:'LOCAL_CONNECTOR'});$('deviceName').value='';$('deviceLocation').value='';render();setStatus('Устройство добавлено','ok')}catch(e){$('tcError').hidden=false;$('tcError').textContent=e.message;setStatus('Ошибка','error')}}
  async function rotateDeviceToken(deviceId){try{const d=(data.devices||[]).find(x=>x.id===deviceId);if(d?.tokenConfigured&&!confirm('Старый ключ перестанет работать сразу после перевыпуска. Продолжить?'))return;setStatus('Создаём ключ…','loading');const result=await api({action:'rotateDeviceToken',deviceId});data=result;render();showDeviceToken(deviceId,result.deviceToken);setStatus('Новый ключ создан','ok')}catch(e){$('tcError').hidden=false;$('tcError').textContent=e.message;setStatus('Ошибка','error')}}
  async function revokeDeviceToken(deviceId){if(!confirm('Отозвать ключ устройства? Connector сразу потеряет доступ к отправке событий.'))return;try{setStatus('Отзываем ключ…','loading');data=await api({action:'revokeDeviceToken',deviceId});hideDeviceToken();render();setStatus('Ключ отозван','ok')}catch(e){$('tcError').hidden=false;$('tcError').textContent=e.message;setStatus('Ошибка','error')}}
  async function link(ev){ev.preventDefault();try{setStatus('Сохраняем связь…','loading');data=await api({action:'linkEmployee',deviceId:$('bindingDevice').value,employeeId:$('bindingEmployee').value,externalEmployeeId:$('bindingExternalId').value,externalLabel:$('bindingLabel').value});$('bindingExternalId').value='';$('bindingLabel').value='';render();setStatus('Связь сохранена','ok')}catch(e){$('tcError').hidden=false;$('tcError').textContent=e.message;setStatus('Ошибка','error')}}
  async function unlink(deviceId,employeeId){if(!confirm('Удалить связь сотрудника с устройством?'))return;try{data=await api({action:'unlinkEmployee',deviceId,employeeId});render();setStatus('Связь удалена','ok')}catch(e){$('tcError').hidden=false;$('tcError').textContent=e.message}}
  function bind(){$('tcRefresh').onclick=load;$('deviceForm').onsubmit=saveDevice;$('bindingForm').onsubmit=link;$('copyDeviceToken').onclick=copyDeviceToken;$('closeDeviceToken').onclick=hideDeviceToken}
  async function init(){bind();await load()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
