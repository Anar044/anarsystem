(()=>{
"use strict";
const $=id=>document.getElementById(id),esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const statusNames={DRAFT:"Черновик",SUBMITTED:"На согласовании",APPROVED:"Подтверждён",PICKING:"Комплектуется",READY:"Готов к отгрузке",REJECTED:"Отклонён",CANCELLED:"Отменён"};
const state={token:"",data:null,refs:[],binding:null,storeCache:new Map(),selected:null,verification:null,autoChecked:new Set(),busy:false,view:new URLSearchParams(location.search).get("view")||"my"};
const date=v=>v?new Date(String(v).slice(0,10)+"T12:00:00").toLocaleDateString("ru-RU"):"—";
const number=v=>Number(v||0).toLocaleString("ru-RU",{maximumFractionDigits:3});
function note(msg,kind=""){const x=$("io-message");x.textContent=msg||"";x.className="io-message"+(kind?" "+kind:"")}
function busy(b){
  state.busy=b;
  document.querySelectorAll(".io-btn").forEach(btn=>{
    if(b){
      if(btn.dataset.wasDisabledBeforeBusy===undefined)btn.dataset.wasDisabledBeforeBusy=btn.disabled?"1":"0";
      btn.disabled=true;
    }else if(btn.dataset.wasDisabledBeforeBusy!==undefined){
      btn.disabled=btn.dataset.wasDisabledBeforeBusy==="1";
      delete btn.dataset.wasDisabledBeforeBusy;
    }
  });
}
async function token(){const c=await window.SHAuth?.createClient?.();if(!c)throw Error("Авторизация Smart Horeca недоступна");const r=await c.auth.getSession();if(!r.data?.session?.access_token)throw Error("Необходимо войти заново");return r.data.session.access_token}
async function api(path,options={}){
  const headers=new Headers(options.headers||{});headers.set("Authorization","Bearer "+state.token);if(options.body)headers.set("Content-Type","application/json");
  const r=await fetch(path,{...options,headers,cache:"no-store"});
  const j=await r.json().catch(()=>({}));
  if(!r.ok||j.success===false){
    const diag=j.diagnostics,details=diag&&j.code==="INTERNAL_RMS_STORES_UNRESOLVED"
      ?" (справочник складов: HTTP "+(diag.storeEndpointStatus??"—")+
        ", структура RMS: HTTP "+(diag.departmentEndpointStatus??"—")+
        ", складов в структуре: "+(diag.storesFromDepartmentHierarchy??0)+
        ", всего обнаружено: "+(diag.totalStores??0)+")":"";
    throw Error((j.message||"HTTP "+r.status)+details);
  }
  return j;
}
const get=(action="list",id="")=>api("/api/internal-orders?action="+encodeURIComponent(action)+(id?"&departmentId="+encodeURIComponent(id):""));
const post=(action,body={})=>api("/api/internal-orders",{method:"POST",body:JSON.stringify({action,...body})});
function selection(sel,items,placeholder="Выберите…",value=""){const x=$(sel);x.innerHTML='<option value="">'+esc(placeholder)+"</option>"+items.map(d=>'<option value="'+esc(d.id)+'"'+(d.id===value?" selected":"")+'>'+esc(d.name||d.id)+"</option>").join("")}
async function stores(dept){
  if(!dept)return[];
  if(state.storeCache.has(dept))return state.storeCache.get(dept);
  const j=await get("stores",dept);state.storeCache.set(dept,j.stores||[]);return j.stores||[];
}
async function fillStores(deptId,selectId,value=""){
  const select=$(selectId);select.innerHTML='<option value="">Загрузка…</option>';
  try{selection(selectId,await stores(deptId),"Выберите склад",value)}catch(e){select.innerHTML='<option value="">Ошибка загрузки складов</option>';note(e.message,"error")}
}
async function load(){
  state.data=await get();const d=state.data;
  $("io-open-create").hidden=!d.permissions?.request;
  $("io-config-panel").hidden=!(d.permissions?.configure&&state.view==="settings");
  $("io-config-panel").hidden=!(d.permissions?.configure&&state.view==="settings");
  $("io-central-label").textContent=d.settings?("Склад по умолчанию: "+d.settings.centralDepartmentName+" · "+d.settings.centralStoreName):"Центральный RMS можно выбрать в настройках; заказы между ресторанами уже доступны";
  if(d.permissions?.configure){
    selection("io-central-dept",d.configurableDepartments||[],"Выберите центральный RMS",d.settings?.centralDepartmentId||"");
    await fillStores($("io-central-dept").value,"io-central-store",d.settings?.centralStoreId||"");
  }
  selection("io-destination-dept",d.departments||[],"Выберите получателя");
  selection("io-source-dept",d.sendingDepartments||[],"Выберите RMS-отправителя",d.settings?.centralDepartmentId||"");
  // If the central warehouse has a valid default, auto-select it for a new order.
  const selectedSource=$("io-source-dept").value;
  if(selectedSource)await fillStores(selectedSource,"io-source-store",d.settings?.centralStoreId||"");
  updateView();
  $("io-kpi-submitted").textContent=d.orders.filter(x=>x.status==="SUBMITTED").length;
  $("io-kpi-active").textContent=d.orders.filter(x=>["APPROVED","PICKING","READY"].includes(x.status)).length;
  $("io-kpi-all").textContent=d.orders.length;
  render();
}
function updateView(){
  if(!state.data)return;
  const roles=state.data.permissions||{};
  const available=["my","incoming","preparing","all","settings"];
  if(!available.includes(state.view)||((state.view==="all"||state.view==="settings")&&!roles.configure)||(["incoming","preparing"].includes(state.view)&&!roles.fulfill&&!roles.configure))state.view="my";
  document.querySelectorAll("[data-io-view]").forEach(btn=>{
    const mode=btn.dataset.ioView;
    btn.hidden=((mode==="settings"||mode==="all")&&!roles.configure)||((mode==="incoming"||mode==="preparing")&&!roles.fulfill&&!roles.configure);
    btn.classList.toggle("active",mode===state.view);
    btn.setAttribute("aria-pressed",String(mode===state.view));
  });
  $("io-config-panel").hidden=state.view!=="settings"||!roles.configure;
  $("io-list-panel").hidden=state.view==="settings";
  $("io-kpis").hidden=state.view==="settings";
  $("io-open-create").hidden=state.view==="settings"||!roles.request;
  const titles={my:"Мои заявки",incoming:"Входящие заказы",preparing:"Комплектация и готовые к отгрузке",all:"Все внутренние заказы",settings:"Настройки внутренних заказов"};
  $("io-list-title").textContent=titles[state.view]||"Внутренние заказы";
}
function selectView(view){
  state.view=view;
  const url=new URL(location.href);url.searchParams.set("view",view);history.replaceState(null,"",url);
  state.selected=null;$("io-detail").hidden=true;
  updateView();render();
}
function render(){
  const d=state.data;if(!d)return;
  const query=$("io-query").value.trim().toLocaleLowerCase(),status=$("io-status-filter").value;
  const allowed=new Set((d.departments||[]).map(x=>x.id)),admin=d.permissions?.configure;
  const mode=state.view;
  const shown=d.orders.filter(o=>{
    const mine=admin||allowed.has(o.destinationDepartmentId);
    const incoming=admin||(d.permissions?.fulfill&&allowed.has(o.sourceDepartmentId));
    if(mode==="my"&&!mine)return false;
    if(mode==="incoming"&&!incoming)return false;
    if(mode==="preparing"&&(!incoming||!["APPROVED","PICKING","READY"].includes(o.status)))return false;
    return (!status||o.status===status)&&(!query||[o.number,o.sourceDepartmentName,o.sourceStoreName,o.destinationDepartmentName,o.destinationStoreName,...o.lines.map(x=>x.productName)].join(" ").toLocaleLowerCase().includes(query));
  });
  $("io-rows").innerHTML=shown.map(o=>'<tr><td><strong>'+esc(o.number)+'</strong><small>'+esc(date(o.createdAt))+'</small></td><td><strong>'+esc(o.sourceDepartmentName||o.centralDepartmentName)+'</strong><small>'+esc(o.sourceStoreName||o.centralStoreName)+' → '+esc(o.destinationDepartmentName)+' / '+esc(o.destinationStoreName)+'</small></td><td>'+esc(date(o.neededBy))+'</td><td>'+o.lines.length+'</td><td><span class="io-pill" data-status="'+esc(o.status)+'">'+esc(statusNames[o.status]||o.status)+'</span></td><td><button class="io-btn io-outline" data-open="'+esc(o.id)+'">Открыть</button></td></tr>').join("");
  $("io-empty").hidden=shown.length>0;
  $("io-rows").querySelectorAll("[data-open]").forEach(b=>b.onclick=()=>openDetail(b.dataset.open));
  if(state.selected){
    const selected=d.orders.find(x=>x.id===state.selected.id);
    if(selected)detail(selected);else $("io-detail").hidden=true;
  }
}
function detail(o){
  state.selected=o;
  const d=state.data,perms=d.permissions||{},sourceAllowed=d.departments.some(x=>x.id===o.sourceDepartmentId);
  const canFulfill=perms.fulfill&&sourceAllowed;
  const isCreator=o.createdBy===state.userId;
  const canRequest=perms.request&&isCreator&&d.departments.some(x=>x.id===o.destinationDepartmentId);
  const active=o.status==="SUBMITTED"&&canFulfill;
  let body='<div class="io-detail-top"><div class="io-section-head"><h2>'+esc(o.number)+'</h2><p>'+esc(o.sourceDepartmentName)+' · '+esc(o.sourceStoreName)+' → '+esc(o.destinationDepartmentName)+' · '+esc(o.destinationStoreName)+'</p></div><button class="io-btn io-outline" id="io-hide-detail">Закрыть</button></div>';
  body+='<p class="io-detail-comment">Дата поставки: '+esc(date(o.neededBy))+' · Автор: '+esc(o.createdByName)+' · Статус: '+esc(statusNames[o.status]||o.status)+'</p>';
  if(o.comment)body+='<p class="io-detail-comment">Комментарий: '+esc(o.comment)+'</p>';
  if(o.reviewComment)body+='<p class="io-detail-comment">Причина: '+esc(o.reviewComment)+'</p>';
  body+='<table class="io-detail-lines"><thead><tr><th>Товар</th><th>Фасовка</th><th>Запрошено</th><th>Подтверждено</th></tr></thead><tbody>';
  for(const l of o.lines){
    const ap=o.approvedLines.find(x=>x.productId===l.productId);
    body+='<tr><td>'+esc(l.productName)+'</td><td>'+esc(l.packageName||"Основная единица")+' × '+number(l.packageSize)+'</td><td>'+number(l.packageCount)+' фас. / '+number(l.quantity)+' '+esc(l.unit)+'</td><td>'+(active?'<input type="number" min="0" max="'+esc(l.packageCount)+'" step="0.001" data-approve-id="'+esc(l.productId)+'" value="'+esc(l.packageCount)+'">':(ap?number(ap.packageCount)+' фас. / '+number(ap.quantity)+' '+esc(l.unit):"—"))+'</td></tr>';
  }
  body+='</tbody></table><div class="io-detail-actions">';
  if(canRequest&&o.status==="DRAFT")body+='<button class="io-btn io-primary" data-action="submit">Отправить на склад</button><button class="io-btn io-danger" data-action="cancel">Отменить</button>';
  if(canRequest&&o.status==="SUBMITTED")body+='<button class="io-btn io-danger" data-action="cancel">Отменить</button>';
  if(active)body+='<button class="io-btn io-primary" data-action="approve">Подтвердить количество</button><button class="io-btn io-danger" data-action="reject">Отклонить</button>';
  if(canFulfill&&o.status==="APPROVED")body+='<button class="io-btn io-primary" data-action="picking">Начать комплектацию</button>';
  if(canFulfill&&o.status==="PICKING")body+='<button class="io-btn io-primary" data-action="ready">Готов к отгрузке</button>';
  if(canFulfill&&o.status==="READY")body+='<div class="io-ready-next"><strong>Следующий этап — оформление расходной накладной</strong><p>Готовность заказа не создаёт документ в iiko. Сначала оформите отгрузку ниже; сверка появится после сохранения накладной.</p><button type="button" class="io-btn io-primary" id="io-go-shipment">Перейти к оформлению отгрузки</button></div>';
  body+='</div>';
  if(o.status==="READY")body+='<section class="io-shipment-section" id="io-shipment-section"><p class="io-muted">Загрузка документов отгрузки…</p></section>';
  const verified=state.verification?.orderId===o.id?state.verification.data:null;
  if(verified){
    body+='<div class="io-invoice-check"><strong>Сверка с iiko: '+esc(verified.documentNumber||"не найдена")+'</strong><p class="io-muted">'+esc(verified.message||"")+'</p>';
    if(verified.valid){
      body+='<p class="io-muted">Статус расходной: '+esc(verified.status)+' · '+(verified.partial?"Частичная отгрузка":"Количество соответствует заказу")+'</p>';
      body+='<p class="io-muted">Контрагент в iiko: '+esc(verified.counteragentId||"не указан")+'. Необходимо подтвердить, что это именно RMS-получатель.</p>';
      body+='<p class="io-muted">Связанная приходная в RMS получателя ещё не сверена. Статус заказа не изменён, остатки не затронуты.</p>';
      body+='<table class="io-detail-lines"><thead><tr><th>Товар iiko ID</th><th>Согласовано</th><th>В расходной</th></tr></thead><tbody>'+verified.items.map(x=>'<tr><td>'+esc(x.productId)+'</td><td>'+number(x.approvedQty)+'</td><td>'+number(x.documentQty)+'</td></tr>').join("")+'</tbody></table>';
    }
    body+='</div>';
  }
  const panel=$("io-detail");panel.innerHTML=body;panel.hidden=false;
  panel.querySelector("#io-hide-detail").onclick=()=>{panel.hidden=true;state.selected=null};
  panel.querySelectorAll("[data-action]").forEach(b=>b.onclick=()=>transition(o,b.dataset.action));
  const jump=panel.querySelector("#io-go-shipment");
  if(jump)jump.onclick=()=>panel.querySelector("#io-shipment-section")?.scrollIntoView({behavior:"smooth",block:"start"});
  if(o.status==="READY")loadShipments(o);
  panel.scrollIntoView({behavior:"smooth",block:"start"});
}

const shStatus={PREPARED:"Подготовлена",IMPORTING:"Сохранение в iiko",CHECK_REQUIRED:"Ошибка iiko — нужна сверка",DRAFT_SAVED:"Черновик отправлен в iiko",DRAFT_VERIFIED:"Готова к отгрузке",PROCESSING:"Проводится в iiko — ждём сверку",IIKO_PROCESSED:"Отгружено в iiko · ждём приёмки",CANCELLED:"Отменена"};
const shipGet=orderId=>api("/api/internal-order-shipments?orderId="+encodeURIComponent(orderId));
const shipPost=(action,body)=>api("/api/internal-order-shipments",{method:"POST",body:JSON.stringify({action,...body})});
async function loadShipments(o){
  const block=$("io-shipment-section");
  if(!block)return;
  try{
    const r=await shipGet(o.id);
    if(state.selected?.id!==o.id)return;
    renderShipments(o,r);
  }catch(e){if(state.selected?.id===o.id)block.innerHTML='<p class="io-muted">'+esc(e.message)+'</p>'}
}
function renderShipments(o,data){
  const block=$("io-shipment-section");
  if(!block||!data)return;
  let body='<h3>Отгрузки и расходные накладные iiko</h3>';
  body+='<p class="io-muted">'+(data.canDispatch?"Укажите количество для отгрузки. Перед проведением система повторно проверит документы.":"Отгрузка ещё не разрешена: сначала проверяем маршрут и механизм создания связанной приходной через iikoChain.")+'</p>';
  const shipments=data.shipments||[];
  if(data.confirmedReceiverMapping){
    const m=data.confirmedReceiverMapping;
    body+='<div class="io-pair-document"><strong>Получатель сопоставлен со справочником iiko</strong>'+
      '<p>Склад отправителя: '+esc(o.sourceStoreName)+' → Склад получателя: '+esc(o.destinationStoreName)+'</p>'+
      '<p>Покупатель в расходной: <strong>'+esc(m.outgoingBuyerName)+'</strong> · ID контрагента: <code>'+esc(m.outgoingBuyerId)+'</code></p>'+
      '<p>Поставщик связанной приходной: '+esc(m.incomingSupplierName)+'</p>'+
      '<p>Проверено по проведённой паре №'+esc(m.evidenceOutgoingNumber)+' / №'+esc(m.evidenceIncomingNumber)+'.</p>'+
      '<p class="io-muted">Контрагент определён, но автоматическое создание связанной приходной через REST пока не подтверждено. Отгрузка остаётся заблокирована.</p></div>';
  }
  if(data.dispatchBlockedReason){
    body+='<div class="io-shipment-error io-route-error"><strong>Автоматическая отгрузка между RMS временно заблокирована</strong><p>'+esc(data.dispatchBlockedReason)+'</p><p>Выбранные отправитель и получатель верны. Не создавайте повторную расходную по уже отправленному номеру. Требуется проверить поддерживаемый API iikoChain для связанной пары расходная → приходная.</p></div>';
  }
  const hint=$("io-detail")?.querySelector(".io-ready-next");
  if(hint&&data.canFulfill){
    const prepared=shipments.some(x=>x.status==="PREPARED");
    const saved=shipments.some(x=>["CHECK_REQUIRED","DRAFT_SAVED","DRAFT_VERIFIED","IIKO_PROCESSED"].includes(x.status));
    const title=hint.querySelector("strong"),message=hint.querySelector("p"),button=hint.querySelector("#io-go-shipment");
    if(data.dispatchBlockedReason){
      title.textContent="Обнаружена несовместимость формата накладной с iiko API";
      message.textContent="iiko пытается прочитать склад-покупатель как User. Отправка отключена до исправления интеграции. Уже выполненная попытка не повторяется.";
      button.textContent="Посмотреть диагностику";
    }else if(shipments.some(x=>["CHECK_REQUIRED","PROCESSING"].includes(x.status))){
      title.textContent="Результат отгрузки ещё не подтверждён";
      message.textContent="Smart Horeca проверяет документ в iiko. Повторная отправка заблокирована во избежание двойного списания.";
      button.textContent="Посмотреть состояние";
    }else if(prepared){
      title.textContent="Расходная подготовлена";
      message.textContent="Нажмите «Отгрузить» рядом с документом. Система сама проведёт его в iiko.";
      button.textContent="К отгрузке";
    }else if(saved){
      title.textContent="Документы отгрузки";
      message.textContent="Smart Horeca автоматически проверяет их состояние в iiko.";
      button.textContent="Посмотреть документы";
    }else{
      title.textContent="Следующий этап — отгрузка";
      message.textContent="Проверьте количество и нажмите «Отгрузить». Накладная создаётся автоматически.";
      button.textContent="Перейти к отгрузке";
    }
  }
  if(data.canFulfill){
    body+='<div class="io-pair-document"><button type="button" class="io-btn io-outline" id="io-route-preview">Проверить маршрут (без отгрузки)</button>'+
      '<p class="io-muted">Проверяются склад отправителя, склад RMS-получателя и контрагенты из действующего справочника iiko. Документы не создаются, остатки не меняются.</p>'+
      '<div id="io-route-preview-result" aria-live="polite"></div></div>';
  }
  if(!shipments.length)body+='<p class="io-shipment-empty">'+(data.canDispatch?"Накладных пока нет. Для новой отгрузки заполните форму ниже.":"Накладных пока нет. Создание документов отключено до проверки интеграции.")+'</p>';
  if(shipments.length){
    body+='<div class="io-table-wrap"><table class="io-detail-lines"><thead><tr><th>Расходная</th><th>Сумма, ₼</th><th>Состояние</th><th>Действия</th></tr></thead><tbody>';
    for(const sh of shipments){
      const status=shStatus[sh.status]||sh.status;
      const actions=!data.canDispatch?"—":sh.status==="PREPARED"
        ?'<button type="button" class="io-btn io-primary" data-ship-action="dispatch-existing" data-ship-id="'+esc(sh.id)+'">Отгрузить</button> <button type="button" class="io-btn io-outline" data-ship-action="cancel" data-ship-id="'+esc(sh.id)+'">Отменить</button>'
        :sh.status==="DRAFT_VERIFIED"?'<button type="button" class="io-btn io-primary" data-ship-action="process-iiko" data-ship-id="'+esc(sh.id)+'">Отгрузить</button>':"—";
      body+='<tr><td><strong>'+esc(sh.number)+'</strong><small>'+esc(date(sh.documentDate))+' · '+sh.lines.length+' поз.</small></td><td>'+number(sh.totalCents/100)+'</td><td>'+esc(status)+(sh.error?'<small>'+esc(sh.error)+'</small>':'')+'</td><td>'+actions+'</td></tr>';
      if(sh.status==="IIKO_PROCESSED")body+='<tr><td colspan="4" class="io-muted">Расходная проведена в iiko. Связанная приходная получателя ещё не сверена — заказ не закрыт.</td></tr>';
      if(sh.status==="CHECK_REQUIRED"||sh.status==="PROCESSING")body+='<tr><td colspan="4" class="io-shipment-error">Ответ iiko не подтверждён. Система выполняет безопасную проверку в фоне. Повторная отправка заблокирована, чтобы не списать товар дважды. Если ошибка сохраняется, нужен разбор ответа iiko администратором.</td></tr>';
    }
    body+='</tbody></table></div>';
  }
  const remaining=(data.remaining||[]).filter(l=>l.remaining>0);
  if(data.canFulfill&&data.canDispatch&&remaining.length){
    body+='<form id="io-shipment-form" class="io-shipment-form"><h4>Подготовить новую отгрузку</h4>';
    body+='<p class="io-muted">Отправитель: <strong>'+esc(o.sourceDepartmentName)+' / '+esc(o.sourceStoreName)+'</strong> → Получатель: <strong>'+esc(o.destinationDepartmentName)+' / '+esc(o.destinationStoreName)+'</strong></p>';
    body+='<p class="io-muted">Покупатель iiko — склад получателя <strong>'+esc(o.destinationStoreName)+'</strong>. Он уже выбран в заказе и автоматически подставляется в накладную.</p>';
    body+='<div class="io-ship-fields"><label>Дата расходной<input id="io-ship-date" type="date" required></label></div>';
    body+='<p id="io-cost-message" class="io-muted">Загружаем себестоимость склада отправителя из iiko…</p>';
    body+='<table class="io-detail-lines"><thead><tr><th>Товар</th><th>Согласовано</th><th>Осталось</th><th>К отгрузке</th><th>Себестоимость за ед., ₼</th></tr></thead><tbody>';
    for(const l of remaining){
      const original=o.approvedLines.find(x=>String(x.productId).toLowerCase()===String(l.productId).toLowerCase());
      body+='<tr data-ship-item="'+esc(l.productId)+'"><td>'+esc(original?.productName||l.productId)+'</td><td>'+number(l.approved)+'</td><td>'+number(l.remaining)+'</td><td><input type="number" min="0" max="'+l.remaining+'" step="0.001" value="'+l.remaining+'" data-ship-qty></td><td><strong data-ship-cost>Загрузка…</strong><small data-ship-available></small></td></tr>';
    }
    body+='</tbody></table><p class="io-muted">Себестоимость берётся непосредственно из iikoChain по складу-отправителю, наценка 0%. Если себестоимость или остатки неизвестны, оформление будет заблокировано.</p>';
    body+='<button class="io-btn io-primary" type="submit" disabled>Отгрузить</button></form>';
  }else if(!remaining.length&&shipments.some(x=>x.status!=="CANCELLED"))body+='<p class="io-muted">Все согласованные количества распределены по отгрузкам.</p>';
  else if(!data.canFulfill)body+='<p class="io-muted">Оформление отгрузок доступно сотрудникам RMS-отправителя.</p>';
  block.innerHTML=body;
  const routeButton=block.querySelector("#io-route-preview");
  if(routeButton)routeButton.onclick=async()=>{
    const out=block.querySelector("#io-route-preview-result");
    routeButton.disabled=true;
    if(out)out.textContent="Проверяем только чтением…";
    try{
      const reply=await shipPost("preview-route",{orderId:o.id});
      const v=reply.preview||{};
      if(out){
        out.innerHTML='<strong>'+esc(v.valid?"Соответствие подтверждено":"Маршрут не подтверждён")+'</strong>'+
          '<p>'+esc(v.message||"Результат проверки отсутствует.")+'</p>'+
          (v.valid?'<p>Склад расходной (defaultStoreId): <code>'+esc(v.outgoing?.defaultStoreId||"")+'</code></p>'+
          '<p>Покупатель расходной (counteragentId): <strong>'+esc(v.outgoing?.counteragentName||"")+'</strong> · <code>'+esc(v.outgoing?.counteragentId||"")+'</code></p>'+
          '<p>Склад связанной приходной: <code>'+esc(v.expectedIncoming?.recipientStoreId||"")+'</code> · Поставщик: '+esc(v.expectedIncoming?.supplierName||"")+'</p>':
          '')+'<p class="io-muted">Только чтение. Реальная отгрузка и создание связанной приходной остаются заблокированными.</p>';
      }
    }catch(e){if(out)out.textContent="Проверка не выполнена: "+String(e?.message||e)}
    finally{routeButton.disabled=false}
  };
  const form=block.querySelector("#io-shipment-form");
  if(form){
    const dateInput=block.querySelector("#io-ship-date");
    const message=block.querySelector("#io-cost-message");
    const submit=form.querySelector('button[type="submit"]');
    dateInput.value=new Date().toISOString().slice(0,10);
    let quoteValid=false,latestQuote=null,licenceBlocked=false,requestVersion=0;
    function recalcQuantity(){
      quoteValid=false;submit.disabled=true;
      if(!latestQuote)return;
      const byId=new Map((latestQuote.quotes||[]).map(x=>[String(x.productId).toLowerCase(),x]));
      let missing=false,anySelected=false;
      for(const row of form.querySelectorAll("[data-ship-item]")){
        const v=byId.get(String(row.dataset.shipItem).toLowerCase()),qty=Number(row.querySelector("[data-ship-qty]").value);
        const cost=row.querySelector("[data-ship-cost]"),available=row.querySelector("[data-ship-available]");
        cost.textContent=v?.verified&&v?.unitCost!=null?Number(v.unitCost).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:6}):"Нет себестоимости";
        available.textContent=v?.available!=null?"Остаток: "+number(v.available):"Нет данных по складу";
        if(qty>0){
          anySelected=true;
          if(!v?.verified||qty>Number(v.available)+0.00001)missing=true;
        }
      }
      quoteValid=anySelected&&!missing;submit.disabled=!quoteValid;
      message.textContent=missing?"Недостаточно остатков или себестоимость не определена в iiko. Проверьте склад и количество."
        :anySelected?"Себестоимость загружена со склада "+o.sourceStoreName+". Наценка 0%.":"Укажите количество для отгрузки.";
    }
    async function reloadCost(manual=false){
      if(licenceBlocked&&!manual){
        message.textContent="Доступ к REST API iiko ограничен лицензией. Повторная проверка возможна после освобождения подключения.";
        return;
      }
      if(manual)licenceBlocked=false;
      const thisRequest=++requestVersion;
      latestQuote=null;quoteValid=false;submit.disabled=true;
      message.textContent="Проверяем себестоимость и остатки на складе "+o.sourceStoreName+" в iiko…";
      form.querySelectorAll("[data-ship-cost]").forEach(x=>x.textContent="Загрузка…");
      form.querySelectorAll("[data-ship-available]").forEach(x=>x.textContent="");
      try{
        const result=await shipPost("quote",{orderId:o.id,documentDate:dateInput.value});
        if(!form.isConnected||thisRequest!==requestVersion)return;
        latestQuote=result;
        recalcQuantity();
      }catch(e){
        if(!form.isConnected||thisRequest!==requestVersion)return;
        const text=String(e?.message||e);
        licenceBlocked=/REST_API|RestApi|лицензированного подключения REST API|License enhancement is required/i.test(text);
        latestQuote=null;quoteValid=false;submit.disabled=true;
        form.querySelectorAll("[data-ship-cost]").forEach(x=>x.textContent="Недоступно");
        form.querySelectorAll("[data-ship-available]").forEach(x=>x.textContent="Нет данных от iiko");
        message.textContent=text+" ";
        const retry=document.createElement("button");
        retry.type="button";retry.className="io-btn io-outline io-retry-cost";
        retry.textContent="Повторить проверку";
        retry.onclick=()=>reloadCost(true);
        message.appendChild(retry);
      }
    }
    dateInput.onchange=()=>reloadCost();
    // Changing quantity only uses the already loaded iiko snapshot. It must NOT
    // open another licensed iiko REST API connection on every keystroke.
    form.querySelectorAll("[data-ship-qty]").forEach(x=>x.oninput=recalcQuantity);
    void reloadCost();
    form.onsubmit=async event=>{
      event.preventDefault();
      if(!quoteValid){note("Себестоимость товара ещё не проверена в iiko.","error");return}
      const lines=[...form.querySelectorAll("[data-ship-item]")].map(row=>({
        productId:row.dataset.shipItem,amount:Number(row.querySelector("[data-ship-qty]").value)
      })).filter(x=>x.amount>0);
      if(!lines.length){note("Укажите количество для отгрузки.","error");return}
      if(!confirm("Отгрузить со склада "+o.sourceStoreName+" на "+o.destinationStoreName+"? Smart Horeca создаст и ПРОВЕДЁТ расходную накладную в iiko. Это изменит остатки отправителя. Продолжить?"))return;
      try{
        busy(true);
        const result=await shipPost("dispatch",{orderId:o.id,documentDate:dateInput.value,lines});
        note(result.message||"Запрос отправки обработан.",result.success?"ok":"error");
        await loadShipments(o);
      }catch(e){note(e.message||String(e),"error");await loadShipments(o)}finally{busy(false)}
    };
  }
  block.querySelectorAll("[data-ship-action]").forEach(btn=>btn.onclick=async()=>{
    const action=btn.dataset.shipAction,shipmentId=btn.dataset.shipId;
    if(action==="cancel"&&!confirm("Отменить неподанную расходную?"))return;
    if(["dispatch-existing","process-iiko"].includes(action)&&!confirm("Отгрузить со склада "+o.sourceStoreName+" на "+o.destinationStoreName+"? Накладная будет проведена в iiko, остаток отправителя изменится. Продолжить?"))return;
    try{
      busy(true);
      const r=await shipPost(action,{orderId:o.id,shipmentId});
      if(r.verification)note(r.verification.message,r.verification.valid?"ok":"error");
      else note(r.message||"Операция выполнена.","ok");
      await loadShipments(o);
    }catch(e){note(e.message||String(e),"error");await loadShipments(o)}finally{busy(false)}
  });

  // Verification belongs to the system, not to the cashier workflow.
  // A single read-only refresh per shipment/status on this page load.
  for(const sh of shipments.filter(x=>["CHECK_REQUIRED","PROCESSING","DRAFT_SAVED"].includes(x.status))){
    const checkKey=sh.id+":"+sh.status;
    if(state.autoChecked.has(checkKey))continue;
    state.autoChecked.add(checkKey);
    void (async()=>{
      try{
        const check=await shipPost("verify-iiko",{orderId:o.id,shipmentId:sh.id});
        if(check?.verification?.valid&&state.selected?.id===o.id)await loadShipments(o);
      }catch(e){console.warn("Background iiko shipment lookup unavailable",String(e?.message||e))}
    })();
  }

}

function openDetail(id){const o=state.data?.orders.find(x=>x.id===id);if(o)detail(o)}
async function transition(o,action){
  const payload={id:o.id};const labels={submit:"отправить",cancel:"отменить",approve:"подтвердить",reject:"отклонить",picking:"начать комплектацию",ready:"отметить готовность"};
  if(!confirm("Действительно "+(labels[action]||action)+" заказ "+o.number+"?"))return;
  if(action==="approve")payload.approvedLines=o.lines.map(l=>({productId:l.productId,packageCount:Number($("io-detail").querySelector('[data-approve-id="'+CSS.escape(l.productId)+'"]').value)}));
  if(action==="reject"){payload.comment=prompt("Причина отклонения (обязательно):","")||"";if(!payload.comment)return}
  try{busy(true);await post(action,payload);note("Заказ "+o.number+": операция сохранена.","ok");await load()}catch(e){note(e.message,"error")}finally{busy(false)}
}
async function products(){
  if(state.refs.length)return state.refs;
  state.binding=state.binding||await window.SH_IikoContext?.getBinding?.();
  if(!state.binding?.connection?.ip)throw Error("Не настроено подключение к Smart Horeca Server");
  const b=state.binding,mode=String(b.identity?.mode||b.connection?.connectionType||"RMS").toUpperCase();
  const r=await api("/api/iiko/invoice-reference-data",{method:"POST",body:JSON.stringify({connection:b.connection,departmentIds:b.departmentIds||[],chainScope:{mode,selectedDepartmentIds:b.departmentIds||[],allowedDepartmentIds:b.allDepartmentIds||b.departmentIds||[]}})});
  state.refs=(r.products||[]).filter(x=>x.id&&x.name);
  return state.refs;
}
function productLabel(p){return p.name+" · "+String(p.id).slice(-8)}
function productByText(text){return state.refs.find(p=>productLabel(p)===text)}
function rowPackaging(w,p){
  const select=w.querySelector('[data-f="packaging"]'),pack=p?.packagings||[];
  select.innerHTML='<option value="">Основная единица · 1</option>'+pack.filter(x=>Number(x.count)>0).map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name||x.num||number(x.count))+' · '+number(x.count)+'</option>').join("");
  w.querySelector('[data-f="product"]').dataset.productId=p?.id||"";
}
function newLine(){
  const w=document.createElement("div");w.className="io-line";
  w.innerHTML='<input data-f="product" list="io-products" placeholder="Начни вводить название товара" required><select data-f="packaging" aria-label="Фасовка"><option value="">Основная единица · 1</option></select><input data-f="count" type="number" min="0.001" step="0.001" value="1" required aria-label="Количество фасовок"><span class="io-muted" data-f="total">1 шт.</span><button type="button" class="io-btn io-danger io-remove">×</button>';
  w.querySelector("[data-f='product']").onchange=()=>{
    const p=productByText(w.querySelector('[data-f="product"]').value);
    rowPackaging(w,p);updateTotal(w);
    if(!p)note("Выберите товар из подсказок справочника.","error");
  };
  w.querySelector("[data-f='packaging']").onchange=()=>updateTotal(w);
  w.querySelector("[data-f='count']").oninput=()=>updateTotal(w);
  w.querySelector(".io-remove").onclick=()=>w.remove();
  $("io-lines").appendChild(w);
}
function updateTotal(w){
  const p=state.refs.find(x=>x.id===w.querySelector("[data-f='product']").dataset.productId);
  const selected=w.querySelector("[data-f='packaging']").value;
  const pack=p?.packagings?.find(x=>String(x.id)===selected);
  w.querySelector("[data-f='total']").textContent=number(Number(pack?.count||1)*Number(w.querySelector("[data-f='count']").value||0))+" "+(p?.unit||"");
}
function formLines(){
  const out=[];
  for(const w of $("io-lines").children){
    const p=state.refs.find(x=>x.id===w.querySelector("[data-f='product']").dataset.productId);
    if(!p)throw Error("Товар не выбран из справочника iiko");
    const pid=w.querySelector("[data-f='packaging']").value,pack=p.packagings?.find(x=>String(x.id)===pid);
    out.push({productId:p.id,productName:p.name,unit:p.unit||"",containerId:pack?.id||"",packageName:pack?.name||"Основная единица",packageSize:Number(pack?.count||1),packageCount:Number(w.querySelector("[data-f='count']").value)});
  }
  if(!out.length)throw Error("Добавьте товары");
  return out;
}
async function openCreate(){
  $("io-modal").hidden=false;
  $("io-create-form").reset();
  const settings=state.data?.settings;
  if(settings?.centralDepartmentId){$("io-source-dept").value=settings.centralDepartmentId;await fillStores(settings.centralDepartmentId,"io-source-store",settings.centralStoreId||"");}
  else selection("io-source-store",[],"Выберите RMS отправителя");
  selection("io-destination-store",[],"Выберите RMS получателя");
  $("io-lines").innerHTML="";
  $("io-needed-by").value=new Date(Date.now()+86400000).toISOString().slice(0,10);
  $("io-open-create").disabled=true;
  try{
    note("Загружаем справочник товаров iiko…");
    const refs=await products();
    $("io-products").innerHTML=refs.map(p=>'<option value="'+esc(productLabel(p))+'"></option>').join("");
    newLine();note("Выберите ресторан, склад и товары.","ok");
  }catch(e){note(e.message,"error")}finally{$("io-open-create").disabled=false}
}
function closeCreate(){$("io-modal").hidden=true}
async function start(){
  try{
    state.token=await token();state.binding=await window.SH_IikoContext?.getBinding?.();
    const c=await window.SHAuth?.getUser?.();state.userId=c?.id||c?.user?.id||"";
    await load();note("Список внутренних заказов загружен.","ok");
  }catch(e){note(e.message,"error")}
  document.documentElement.style.visibility="visible";
}
async function handleCreate(e){
  e.preventDefault();
  try{busy(true);const j=await post("create",{sourceDepartmentId:$("io-source-dept").value,sourceStoreId:$("io-source-store").value,destinationDepartmentId:$("io-destination-dept").value,destinationStoreId:$("io-destination-store").value,neededBy:$("io-needed-by").value,comment:$("io-comment").value,lines:formLines()});closeCreate();note("Заказ "+j.number+" сохранён как черновик.","ok");await load();openDetail(j.id)}catch(e){note(e.message,"error")}finally{busy(false)}
}
async function handleConfig(e){
  e.preventDefault();
  try{busy(true);await post("save-settings",{centralDepartmentId:$("io-central-dept").value,centralStoreId:$("io-central-store").value});state.storeCache.clear();note("Центральный склад сохранён.","ok");await load()}catch(e){note(e.message,"error")}finally{busy(false)}
}
$("io-refresh").onclick=async()=>{try{busy(true);await load();note("Данные обновлены.","ok")}catch(e){note(e.message,"error")}finally{busy(false)}};
$("io-query").oninput=render;$("io-status-filter").onchange=render;
document.querySelectorAll("[data-io-view]").forEach(btn=>btn.onclick=()=>selectView(btn.dataset.ioView));
$("io-open-create").onclick=openCreate;$("io-close").onclick=closeCreate;$("io-cancel").onclick=closeCreate;$("io-modal-shade").onclick=closeCreate;$("io-add-product").onclick=newLine;
$("io-central-dept").onchange=()=>fillStores($("io-central-dept").value,"io-central-store");
$("io-destination-dept").onchange=()=>fillStores($("io-destination-dept").value,"io-destination-store");
$("io-source-dept").onchange=()=>fillStores($("io-source-dept").value,"io-source-store");
async function handleIikoPairProbe(event){
  event.preventDefault();
  const result=$("io-pair-results"),button=$("io-pair-probe-form").querySelector('button[type="submit"]');
  button.disabled=true;result.textContent="Читаем две проведённые накладные iikoChain. Складские данные не изменяются…";
  try{
    const r=await shipPost("diagnose-pair",{
      documentDate:$("io-pair-date").value,
      outgoingNumber:$("io-pair-outgoing").value.trim(),
      incomingNumber:$("io-pair-incoming").value.trim()
    });
    const o=r.outgoing?.document,i=r.incoming?.document,c=r.comparison||{};
    let html='<p><strong>Диагностика выполнена — только чтение.</strong> '+(c.linkConfirmed?"Связь подтверждена полями API.":"Связь пока не подтверждена полями API.")+'</p>';
    html+='<div class="io-pair-grid">';
    const fields=(doc,kind)=>doc?'<div class="io-pair-document"><strong>'+kind+': №'+esc(doc.number)+'</strong>'+
      '<p>Статус: '+esc(doc.status||"не получен")+' · дата '+esc(doc.date||"не возвращена")+'</p>'+
      '<p>ID документа: <code>'+esc(doc.id||"—")+'</code></p>'+
      '<p>Склад: <code>'+esc(doc.storeId||"—")+'</code></p>'+
      '<p>Покупатель / counteragentId: <code>'+esc(doc.counteragentId||"—")+'</code></p>'+
      '<p>Тип покупателя (если есть в XML): '+esc(doc.counteragentType||"не передан")+'</p>'+
      '<p>Поставщик / supplier: <code>'+esc(doc.supplierId||"—")+'</code></p>'+
      '<p>Входящий номер: '+esc(doc.incomingDocumentNumber||"—")+'</p>'+
      '<p>ID связанной расходной: <code>'+esc(doc.linkedOutgoingInvoiceId||"—")+'</code></p>'+
      '<p>Позиции: '+doc.itemsCount+'</p></div>':
      '<div class="io-pair-document"><strong>'+kind+' не найдена через API</strong><p>Проверьте номер, дату и REST-доступ к iikoChain. Документы на скриншотах могут храниться в другом RMS или контуре.</p></div>';
    html+=fields(o,"Расходная")+fields(i,"Приходная")+'</div>';
    html+='<p>Связь: '+esc(c.linkEvidence||"данных недостаточно")+'. Товары и количества: '+(c.productsMatch?"совпадают по ID":"не подтверждены либо различаются")+'.</p>';
    const refs=r.supplierReferences||{};
    html+='<div class="io-pair-document"><strong>Проверка контрагентов по справочнику iiko</strong>'+
      '<p>Поиск в справочнике: '+esc(refs.supplierLookupStatus||"не выполнялся")+' · записей '+esc(refs.supplierDirectoryEntries??"—")+'</p>'+
      '<p>Покупатель расходной №50001: <strong>'+esc(refs.outgoingBuyerSupplier?.name||"название пока не определено")+'</strong> '+
      (refs.supplierDirectoryMatchedOutgoingBuyer?"(найден в справочнике поставщиков)":"(в справочнике пока не найден)")+'</p>'+
      '<p>ID покупателя совпадает с ID склада-получателя: <strong>'+(refs.outgoingBuyerIsDestinationStore?"да":"нет")+'</strong></p>'+
      '<p>Поставщик приходной №10001: <strong>'+esc(refs.incomingSupplierRecord?.name||"название пока не определено")+'</strong> '+
      (refs.supplierDirectoryMatchedIncomingSupplier?"(найден в справочнике)":"(не найден)")+'</p>'+
      '<p>ID поставщика совпадает с ID склада-отправителя: <strong>'+(refs.incomingSupplierIsSenderStore?"да":"нет")+'</strong></p>'+
      (refs.supplierLookupError?'<p>Ошибка справочника: '+esc(refs.supplierLookupError)+'</p>':"")+
      '<p class="io-muted">Это проверка существующих справочников. Никакая привязка автоматически не меняется.</p></div>';

    for(const [label,part] of [["Расходная",r.outgoing],["Приходная",r.incoming]]){
      html+='<details><summary>REST-запросы: '+label+'</summary><ul>'+((part?.attempts||[]).map(a=>'<li>'+esc(a.dateFormat||"")+" · HTTP "+esc(a.httpStatus??"ошибка")+" · документов "+esc(a.totalDocuments??0)+" · совпадений "+esc(a.matchingDocuments??0)+'</li>').join("")||"<li>Запросов нет</li>")+'</ul></details>';
    }
    const candidate=r.mappingCandidate||{};
    if(candidate.valid){
      html+='<div class="io-pair-document"><strong>Соответствие складов и внутренних контрагентов подтверждено</strong>'+
        '<p>Склад отправителя: <code>'+esc(candidate.sourceStoreId)+'</code></p>'+
        '<p>Склад получателя: <code>'+esc(candidate.destinationStoreId)+'</code></p>'+
        '<p>Покупатель расходной: '+esc(candidate.outgoingBuyerName)+' (ID <code>'+esc(candidate.outgoingBuyerId)+'</code>)</p>'+
        '<p>Поставщик приходной: '+esc(candidate.incomingSupplierName)+'</p>'+
        '<button type="button" class="io-btn io-primary" id="io-save-pair-map">Сохранить соответствие для этих двух складов</button>'+
        '<p class="io-muted">Запись настройки не создаёт документов, не изменяет остатки и не разрешает отгрузку. Другие RMS остаются без сопоставления, пока нет подтверждённой пары.</p></div>';
    }else{
      html+='<p class="io-shipment-error">Сохранить сопоставление пока нельзя: '+esc(candidate.reason||"Нет достаточных данных iiko")+'</p>';
    }
    html+='<p class="io-muted">Это диагностическая проверка. Никакие накладные не создавались и не проводились.</p>';
    result.innerHTML=html;
    const mapButton=result.querySelector("#io-save-pair-map");
    if(mapButton)mapButton.onclick=async()=>{
      if(!confirm("Сохранить точное соответствие контрагентов iiko для складов этой проведённой пары? Это только настройка, без отгрузки."))return;
      mapButton.disabled=true;
      try{
        const saved=await shipPost("confirm-pair-mapping",{
          documentDate:$("io-pair-date").value,outgoingNumber:$("io-pair-outgoing").value.trim(),
          incomingNumber:$("io-pair-incoming").value.trim()
        });
        note(saved.message||"Соответствие сохранено.","ok");
        mapButton.textContent="Соответствие сохранено";
      }catch(e){note(e.message||String(e),"error");mapButton.disabled=false}
    };
  }catch(e){result.textContent="Не удалось получить документы из iiko: "+String(e?.message||e)}
  finally{button.disabled=false}
}
$("io-config-form").onsubmit=handleConfig;$("io-create-form").onsubmit=handleCreate;
$("io-pair-probe-form").onsubmit=handleIikoPairProbe;
start();
})();