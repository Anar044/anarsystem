(()=>{
'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null,busy=false,reloadSequence=0;
async function api(body,path='/api/qr-menu/order-admin'){
  const auth=await window.SHAuth?.createClient?.();
  const session=await auth?.auth.getSession();
  const key=session?.data?.session?.access_token;
  if(!key)throw Error('Сессия Smart Horeca отсутствует');
  const r=await fetch(path,{method:body?'POST':'GET',cache:'no-store',headers:{
    Authorization:'Bearer '+key,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})
  },...(body?{body:JSON.stringify(body)}:{})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||!j.success){const error=new Error(j.message||'HTTP '+r.status);error.code=j.code||'';error.status=r.status;throw error;}
  return j;
}
const status=(v,id='qrOrderError')=>{$(id).textContent=v||''};
const editableIds=['qrOrderMode','qrOrderPlugin','qrPosListReload','qrOrderSave',
  'qrTableName','qrPosTable','qrAddTable'];
function allowEditing(allowed){
  for(const id of editableIds){const el=$(id);if(el)el.disabled=!allowed;}
}
function showPrerequisite(error){
  const needsMenu=error?.code==='QR_MENU_NOT_PUBLISHED';
  $('qrOrderPrerequisite').hidden=false;
  $('qrOrderPrerequisiteTitle').textContent=needsMenu
    ?'Сначала опубликуйте QR-меню'
    :'Не удалось загрузить настройки QR-заказов';
  $('qrOrderPrerequisiteMessage').textContent=needsMenu
    ?'Для выбранного ресторана пока нет опубликованного QR-меню. В тестовом ресторане откройте редактор, проверьте блюда и нажмите «Опубликовать меню». Затем вернитесь сюда и нажмите «Проверить повторно».'
    :'Настройки кассы и столов недоступны: '+(error?.message||'не удалось получить ответ сервера')+'. Проверьте подключение и повторите попытку.';
  $('qrOrderOpenEditor').hidden=!needsMenu;
  state=null;
  allowEditing(false);
  $('qrOrderEnabled').checked=false;
  $('qrOrderEnabled').disabled=true;
  $('qrPosRestaurantName').textContent=needsMenu?'Меню не опубликовано':'Не удалось загрузить';
  $('qrPosRestaurantId').textContent='';
  $('qrPosSelectedPlugin').textContent='Недоступен';
  $('qrPosConnectionState').textContent='Не проверено';
  $('qrPosLastSeen').textContent='';
  $('qrPosServerState').textContent='Нет данных';
  $('qrPosServerHint').textContent='Секреты не отображаются в браузере.';
  $('qrPosNextStep').textContent=needsMenu
    ?'Шаг 1: опубликуйте меню тестового ресторана. Приём заказов остаётся выключен.'
    :'Настройка кассы приостановлена до восстановления ответа API.';
  $('qrOrderSafety').textContent='Приём заказов выключен: настройки ещё не загружены.';
  $('qrPosBridgeReady').textContent='Проверка кассы пока недоступна.';
  $('qrPosListStatus').textContent=needsMenu?'Опубликуйте меню для начала настройки кассы.':'Реестр касс пока недоступен.';
  $('qrOrderPlugin').replaceChildren(registerOption('','— Нет данных —'));
  $('qrOrderGlobalLink').replaceChildren();
  $('qrOrderTables').replaceChildren();
  $('qrOrderRows').replaceChildren();
  $('qrPosCatalogGroups').replaceChildren();
  $('qrPosCatalogStatus').textContent='Ожидаем подключения кассы…';
  $('qrTableImport').disabled=true;
  status(needsMenu?'':(error?.message||'Не удалось загрузить QR-заказы.'));
}

function registerOption(value,label){
  const option=document.createElement('option');option.value=value;option.textContent=label;
  return option;
}
async function loadRegisters(){
  const select=$('qrOrderPlugin'),hint=$('qrPosListStatus');
  if(!select||!state)return;
  const restaurant=state.restaurantId;
  const saved=state.settings.posPluginId||'';
  const selected=select.value||saved;
  hint.textContent='Обновляем зарегистрированные кассы выбранного ресторана…';
  try{
    const payload=await api(null,'/api/qr-menu/pos-registers');
    // Do not render a late response from a previously selected restaurant.
    if(!state||payload.restaurantId!==state.restaurantId||restaurant!==state.restaurantId)return;
    const devices=Array.isArray(payload.registers)?payload.registers:[];
    select.replaceChildren(registerOption('','— Выберите кассу —'));
    for(const pos of devices){
      const name=String(pos.name||'Касса без имени');
      const group=pos.groupName?' · '+pos.groupName:'';
      const version=pos.version?' · v'+pos.version:'';
      select.append(registerOption(pos.pluginId,(pos.online?'● Онлайн · ':'○ Офлайн · ')+name+group+version));
    }
    // Keep an existing selection visible until the operator intentionally
    // unlinks it; never silently reassign to an arbitrary online device.
    if(saved&&!devices.some(x=>x.pluginId.toLowerCase()===saved.toLowerCase()))
      select.append(registerOption(saved,'Сохранённый плагин (сейчас нет в реестре) · '+saved));
    select.value=Array.from(select.options).some(o=>o.value===selected)?selected:saved||'';
    hint.textContent=devices.length
      ?'Найдено касс в этом ресторане: '+devices.length+'. Сохранение дополнительно проверяет принадлежность на сервере.'
      :'Зарегистрированных касс этого ресторана пока не найдено.';
    $('qrPosSelectedPlugin').textContent=select.value||'Плагин не выбран';
  }catch(err){
    select.replaceChildren(registerOption('','— Нет связи с реестром —'));
    if(saved)select.append(registerOption(saved,'Сохранённый плагин · '+saved));
    select.value=saved;
    hint.textContent='Не удалось обновить список касс. Ранее сохранённая привязка не удалена. '+
      (err.message||'Проверьте связь с сервером Smart Horeca.');
    $('qrPosSelectedPlugin').textContent=saved||'Плагин не выбран';
  }
}
async function action(data){
  if(busy)return;
  busy=true;
  const isSettingsSave=data?.action==='saveSettings';
  if(isSettingsSave)status('Сохраняем настройки…','qrOrderSaveStatus');
  try{
    const result=await api(data);
    await reload();
    if(isSettingsSave){
      const persisted=state?.settings?.posPluginId===data.posPluginId&&
        state?.settings?.serviceMode===data.serviceMode&&
        state?.settings?.orderingEnabled===data.orderingEnabled;
      status(persisted
        ?'✓ Настройки сохранены. Касса привязана к выбранному ресторану.'
        :'✓ Сервер принял настройки. Проверьте выбранную кассу после обновления данных.',
        'qrOrderSaveStatus');
    }else if(result?.notice){
      status(result.notice);
    }
  }catch(e){
    if(isSettingsSave)status('Не удалось сохранить: '+(e.message||String(e)),'qrOrderSaveStatus');
    else status(e.message||String(e));
  }finally{busy=false}
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
function renderPosCatalog(){
  const host=$('qrPosCatalogGroups'),hint=$('qrPosCatalogStatus'),importBtn=$('qrTableImport');
  host.replaceChildren();importBtn.disabled=true;
  if(!state||state.settings.serviceMode!=='TABLE')return;
  if(!state.settings.posPluginId){
    hint.textContent='Сначала выберите кассу ресторана и нажмите «Сохранить режим».';
    return;
  }
  const cfg=state.settings.backendSetup||{};
  if(!cfg.tableSyncAllowed){
    hint.textContent='Синхронизация пока недоступна: разрешите только этот тестовый ресторан и кассу в настройках QR Bridge. Отдельная D1 не требуется.';
    return;
  }
  const snapshot=state.posTableCatalog||{};
  if(!snapshot.available){
    hint.textContent='Нет свежего списка столов от кассы. Установите QR Bridge с поддержкой столов, включите безопасную диагностику и проверьте подключение.';
    return;
  }
  const tables=Array.isArray(snapshot.tables)?snapshot.tables:[];
  const imported=new Set((state.tables||[]).map(t=>String(t.pos_table_id||'').toLowerCase()));
  const grouped=new Map();
  for(const t of tables){
    const section=String(t.sectionName||'Зал');
    const id=String(t.sectionId||'');
    const key=id||section;
    if(!grouped.has(key))grouped.set(key,{section,tables:[]});
    grouped.get(key).tables.push(t);
  }
  const countExisting=tables.filter(t=>imported.has(String(t.posTableId).toLowerCase())).length;
  hint.textContent='Касса передала '+tables.length+' столов · уже добавлено '+countExisting+
    ' · обновлено '+new Date(snapshot.lastSeenAt).toLocaleString('ru-RU')+
    '. Выберите столы, затем нажмите «Добавить выбранные столы».';
  if(!tables.length){
    host.textContent='На выбранной кассе нет столов. Проверьте настройки залов в POS.';
    return;
  }
  for(const {section,tables:sectionTables} of [...grouped.values()].sort((a,b)=>
    a.section.localeCompare(b.section,'ru'))){
    const group=document.createElement('section');group.className='qro-catalog-group';
    const head=document.createElement('div');head.className='qro-catalog-heading';
    head.textContent=section+' · '+sectionTables.length;
    group.append(head);
    const items=document.createElement('div');items.className='qro-catalog-items';
    for(const table of sectionTables.sort((a,b)=>a.number-b.number||
        a.name.localeCompare(b.name,'ru'))){
      const label=document.createElement('label');label.className='qro-catalog-item';
      const checkbox=document.createElement('input');checkbox.type='checkbox';
      checkbox.dataset.posTableId=table.posTableId;
      const linked=imported.has(String(table.posTableId).toLowerCase());
      checkbox.checked=table.isActive&&!linked;
      checkbox.disabled=!table.isActive;
      const name=document.createElement('span');name.textContent=table.name||'Стол '+table.number;
      const note=document.createElement('small');
      note.textContent=!table.isActive?'Неактивен':linked?'QR готов':'Новый';
      label.append(checkbox,name,note);
      items.append(label);
    }
    group.append(items);host.append(group);
  }
  const update=()=>{
    importBtn.disabled=!host.querySelector('input[type="checkbox"]:checked');
  };
  host.onchange=update;
  update();
}
function renderTables(){
  const container=$('qrOrderTables');container.replaceChildren();
  $('qrTablePanel').hidden=state.settings.serviceMode!=='TABLE';
  let currentSection=null;
  for(const t of [...(state.tables||[])].sort((a,b)=>
    String(a.section_name||'').localeCompare(String(b.section_name||''),'ru')||
    String(a.table_label).localeCompare(String(b.table_label),'ru'))){
    const section=String(t.section_name||'Без указанного зала');
    if(section!==currentSection){
      currentSection=section;
      const sectionTitle=document.createElement('h3');
      sectionTitle.className='qro-section-title';
      sectionTitle.style.gridColumn='1/-1';
      sectionTitle.textContent=section;
      container.append(sectionTitle);
    }
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
  const sequence=++reloadSequence;
  try{
    const loaded=await api();
    if(sequence!==reloadSequence)return;
    state=loaded;
    $('qrOrderPrerequisite').hidden=true;
    allowEditing(true);
    $('qrOrderError').textContent='';
    $('qrOrderMode').value=state.settings.serviceMode;
    $('qrOrderEnabled').checked=state.settings.orderingEnabled;
    $('qrOrderPlugin').replaceChildren(registerOption(state.settings.posPluginId||'',state.settings.posPluginId||'— Выберите кассу —'));
    $('qrPosBridgeReady').textContent=state.settings.posBridgeReady
      ?'✓ Касса подключена: приём заказов и печать кухни разрешены (5 минут)'
      :state.settings.posBridgeConnected
        ?'✓ Касса подключена. Режим диагностики: заказы и печать отключены.'
        :'POS-мост не подключён. Настройте HTTPS API и проверьте авторизацию.';
    const cfg=state.settings.backendSetup||{};
    const hasConfig=Boolean(cfg.bridgeTokenConfigured&&
      (cfg.singleKeyDiagnosticMode||cfg.ingressTokenConfigured));
    const tableAllowed=cfg.tableSyncAllowed===true;
    const sharedTest=cfg.tableSyncMode==='shared-test';
    $('qrPosRestaurantName').textContent=state.menuName||'Ресторан не определён';
    $('qrPosRestaurantId').textContent='ID подразделения: '+(state.restaurantId||'не определён');
    $('qrPosSelectedPlugin').textContent=state.settings.posPluginId||'Плагин не выбран';
    $('qrPosConnectionState').textContent=state.settings.posBridgeReady
      ?'Готов к тестовым заказам и кухонной печати'
      :state.settings.posBridgeConnected
        ?'Подключён — безопасная диагностика'
        :'Не подключён или не подтверждал связь последние 5 минут';
    $('qrPosLastSeen').textContent=state.settings.posBridgeLastSeen
      ?'Последний подтверждённый hello: '+new Date(state.settings.posBridgeLastSeen).toLocaleString('ru-RU')
      :'Данных о недавнем подключении нет';
    $('qrPosServerState').textContent=!tableAllowed
      ?'Синхронизация столов не разрешена для этой тестовой кассы'
      :!hasConfig?'Требуется настройка ключей QR Bridge'
      :sharedTest?'Общая D1 — тестовая касса разрешена; заказы выключены'
      :'Тестовая касса разрешена; заказы выключены';
    const missing=[
      !cfg.bridgeTokenConfigured?'QR_POS_BRIDGE_TOKEN':null,
      !cfg.singleKeyDiagnosticMode&&!cfg.ingressTokenConfigured?'PLUGIN_INGEST_TOKEN':null
    ].filter(Boolean);
    $('qrPosServerHint').textContent=!tableAllowed
      ?'Нужны серверные разрешения QR_TABLE_SYNC_MODE=shared-test и точные ID тестового ресторана, плагина и preview-хоста.'
      :missing.length
        ?'Отсутствуют: '+missing.join(', ')+'. Значения задаются только на сервере.'
        :cfg.singleKeyDiagnosticMode
          ?'Для тестовой синхронизации нужен только QR_POS_BRIDGE_TOKEN. Старый PLUGIN_INGEST_TOKEN менять и копировать не нужно.'
          :'Ключи не показываются. Импорт ограничен выбранным тестовым рестораном и кассой.';
    $('qrPosNextStep').textContent=!state.settings.posPluginId
      ?'Шаг 1: выберите и сохраните тестовую кассу, не включая гостевые заказы.'
      :!tableAllowed
        ?'Шаг 2: разрешите именно эту пару ресторан/касса на preview в общей D1.'
        :!hasConfig
          ?'Шаг 3: настройте ключи QR Bridge на сервере и тестовой кассе.'
          :!state.settings.posBridgeConnected
            ?'Шаг 4: настройте диагностическое HTTPS-подключение на тестовой кассе.'
            :'Связь проверена. Приём заказов остаётся выключенным; можно импортировать столы по залам.';
    $('qrOrderEnabled').disabled=(sharedTest&&!state.settings.orderingEnabled)||
      (!state.settings.posBridgeReady&&!state.settings.orderingEnabled);
    $('qrOrderSafety').textContent=sharedTest
      ?'На общей D1 сейчас разрешено только чтение столов из кассы. Приём QR-заказов и кухонная печать выключены.'
      :state.settings.posBridgeReady
        ?'Перед включением убедитесь, что выбран тестовый ресторан, а принтер направлен на тестовую кухню.'
      :state.settings.orderingEnabled
        ?'Касса недоступна. Приём новых заказов блокируется сервером; снимите галочку, чтобы полностью отключить режим.'
        :'Нельзя включить приём: касса пока не подтвердила все функции (создание, печать кухни и фискальный ответ).';
    const global=$('qrOrderGlobalLink');global.replaceChildren();
    const a=document.createElement('a');a.href=state.menuUrl;a.target='_blank';a.rel='noopener';a.textContent=state.menuUrl;global.append(a);
    if(state.settings.serviceMode==='FAST_FOOD'){
      const box=document.createElement('div');box.className='qro-qr';box.style.width='150px';box.style.margin='12px 0';
      qr(box,state.menuUrl);global.append(box);
    }else{
      const note=document.createElement('p');note.textContent='В режиме ресторана используются QR-коды конкретных столов ниже.';global.append(note);
    }
    renderTables();renderOrders();renderPosCatalog();
    await loadRegisters();
  }catch(e){if(sequence===reloadSequence)showPrerequisite(e)}
}
function bind(){
  $('qrOrderReload').onclick=reload;
  $('qrOrderCheckConnection').onclick=reload;
  $('qrOrderRetry').onclick=reload;
  $('qrTableRefresh').onclick=reload;
  $('qrTableImport').onclick=()=>{
    const selected=[...$('qrPosCatalogGroups').querySelectorAll('input[type="checkbox"]:checked')]
      .map(x=>x.dataset.posTableId);
    if(!selected.length)return;
    action({action:'syncPosTables',posTableIds:selected});
  };
  $('qrPosListReload').onclick=loadRegisters;
  $('qrOrderPlugin').onchange=()=>{$('qrPosSelectedPlugin').textContent=$('qrOrderPlugin').value||'Плагин не выбран'};
  $('qrOrderSave').onclick=()=>action({action:'saveSettings',serviceMode:$('qrOrderMode').value,
    orderingEnabled:$('qrOrderEnabled').checked,posPluginId:$('qrOrderPlugin').value.trim()});
  $('qrAddTable').onclick=()=>action({action:'addTable',label:$('qrTableName').value.trim(),posTableId:$('qrPosTable').value.trim()});
  reload();
  window.addEventListener('sh:iiko-selection-changed',reload);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bind);else bind();
})();