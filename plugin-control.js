const API_BASE = "/api/plugin";
const DATA_ENDPOINT = "/api/plugin/data";
const AUTO_REFRESH_MS = 10000;
const STATUS_REFRESH_MS = 5000;

const $ = id => document.getElementById(id);
const pluginsList = $("plugins-list");
const pluginSelect = $("plugin-select");
const sendButton = $("send-request");
const refreshButton = $("refresh-status");
const connectionPill = $("connection-pill");
const statusText = $("status-text");
const checkedAt = $("checked-at");
const requestStatus = $("request-status");
const resultOutput = $("result-output");
const resultSummary = $("result-summary");
const resultTitle = $("result-title");
const resultSubtitle = $("result-subtitle");
const actionSelect = $("action-select");
const dateFrom = $("date-from");
const dateTo = $("date-to");
const autoRefresh = $("auto-refresh");
const autoRefreshLabel = $("auto-refresh-label");
const nextRefresh = $("next-refresh");
const overviewOnline = $("overview-online");
const overviewOnlineText = $("overview-online-text");
const overviewActivity = $("overview-activity");
const overviewEvent = $("overview-event");
const overviewReport = $("overview-report");
const overviewReportStatus = $("overview-report-status");
const overviewSync = $("overview-sync");
const overviewSyncText = $("overview-sync-text");

const ACTION_NAMES = { get_sales:"Продажи", get_orders:"Заказы", get_payments:"Оплаты", get_products:"Товары", get_employees:"Сотрудники" };
const ACTION_SUBTITLES = {
  get_sales:"Сводка продаж, полученная непосредственно от подключённой кассы.",
  get_orders:"Текущие заказы, полученные непосредственно от подключённой кассы.",
  get_payments:"Сводка оплат по данным подключённой кассы.",
  get_products:"Топ товаров по выручке по данным подключённой кассы.",
  get_employees:"Сводка по официантам по данным подключённой кассы."
};

let currentPlugins = [];
let requestInFlight = false;
let countdownTimer = null;
let autoRequestTimer = null;
let countdownSeconds = AUTO_REFRESH_MS / 1000;
let dateDebounceTimer = null;

function ensureCashVisualStyle(){
  if(document.getElementById("hc-cash-visual-style")) return;
  const style=document.createElement("style");
  style.id="hc-cash-visual-style";
  style.textContent=`
  .cash-result{display:grid;gap:14px}
  .cash-result-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
  .cash-result-kpi{min-width:0;padding:15px 16px;border:1px solid var(--border);border-radius:13px;background:linear-gradient(145deg,#141e28,#101720);box-shadow:0 8px 20px rgba(0,0,0,.10)}
  .cash-result-kpi span{display:block;color:var(--muted);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px}
  .cash-result-kpi strong{display:block;color:#f7fafc;font-size:22px;line-height:1.15;font-weight:850;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cash-result-kpi em{display:block;margin-top:6px;color:#697789;font-size:10px;font-style:normal;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cash-result-kpi.money strong{color:var(--green)}
  .cash-result-panel{border:1px solid var(--border);border-radius:14px;background:#111923;overflow:hidden}
  .cash-result-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border-bottom:1px solid var(--border)}
  .cash-result-panel-title{font-size:12px;font-weight:800;color:#f4f7fa}
  .cash-result-panel-count{font-size:10px;color:var(--muted)}
  .cash-orders{display:grid;gap:1px;background:var(--border)}
  .cash-order{background:#111923}
  .cash-order-main{display:grid;grid-template-columns:92px 1fr auto auto auto;align-items:center;gap:12px;padding:13px 15px}
  .cash-order-number{font-size:13px;font-weight:850;color:#fff}
  .cash-order-meta{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}
  .cash-tag{display:inline-flex;align-items:center;padding:3px 7px;border-radius:999px;background:#18231f;border:1px solid #284536;color:#a8cdbb;font-size:10px}
  .cash-tag.muted{background:#151e28;border-color:var(--border);color:var(--muted)}
  .cash-order-amount{font-size:14px;font-weight:850;color:var(--green);white-space:nowrap}
  .cash-order-time{font-size:10px;color:var(--muted);white-space:nowrap}
  .cash-status{display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border-radius:999px;font-size:10px;font-weight:750;white-space:nowrap}
  .cash-status.closed{background:#12251d;color:var(--green);border:1px solid #244a38}
  .cash-status.open{background:#2a2112;color:#ffbf69;border:1px solid #57421f}
  .cash-status.unknown{background:#181d24;color:#aab4c0;border:1px solid #303a46}
  .cash-order-details{display:none;padding:12px 15px 14px;border-top:1px solid var(--border);background:#0e151d}
  .cash-order.opened .cash-order-details{display:block}
  .cash-order-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
  .cash-order-detail{padding:9px 10px;border:1px solid var(--border);border-radius:9px;background:#121b24}
  .cash-order-detail span{display:block;color:var(--muted);font-size:9px;text-transform:uppercase;margin-bottom:4px}
  .cash-order-detail strong{display:block;color:#e9eff4;font-size:11px;word-break:break-word}
  .cash-expand{border:0;background:transparent;color:var(--green);font-size:10px;font-weight:750;cursor:pointer}
  .cash-data-table{width:100%;border-collapse:collapse;table-layout:auto}
  .cash-data-table th{padding:10px 12px;text-align:left;color:#728091;font-size:9px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);white-space:nowrap}
  .cash-data-table td{padding:11px 12px;color:#dce4eb;font-size:11px;border-bottom:1px solid #1b2530;vertical-align:middle}
  .cash-data-table tr:last-child td{border-bottom:0}
  .cash-data-table tbody tr:hover{background:#141e28}
  .cash-bar-list{display:grid;gap:11px;padding:14px 15px}
  .cash-bar-row{display:grid;grid-template-columns:minmax(110px,1fr) 70px;gap:12px;align-items:center}
  .cash-bar-label{min-width:0}
  .cash-bar-label strong{display:block;color:#e9eff4;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cash-bar-label small{display:block;color:var(--muted);font-size:9px;margin-top:3px}
  .cash-bar-track{height:6px;margin-top:6px;border-radius:999px;background:#202a34;overflow:hidden}
  .cash-bar-fill{height:100%;border-radius:999px;background:var(--green)}
  .cash-bar-value{text-align:right;color:#f1f5f8;font-size:11px;font-weight:800;white-space:nowrap}
  .cash-empty{padding:25px;text-align:center;color:var(--muted);font-size:12px}
  @media(max-width:1100px){.cash-result-kpis{grid-template-columns:repeat(2,1fr)}.cash-order-main{grid-template-columns:82px 1fr auto}.cash-order-time{display:none}.cash-order-grid{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:700px){.cash-result-kpis{grid-template-columns:1fr}.cash-order-main{grid-template-columns:1fr auto}.cash-order-amount{grid-column:1}.cash-order-grid{grid-template-columns:1fr}.cash-data-table{min-width:620px}}
  `;
  document.head.appendChild(style);
}

function todayISO(){ return new Date().toISOString().slice(0,10); }
function escapeHtml(v){ return String(v ?? "").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;"); }
function formatValue(v){ if(v===null||v===undefined||v==="")return "—"; if(typeof v==="object")return JSON.stringify(v); return String(v); }
function formatDateTime(v){ if(!v)return "—"; const d=new Date(v); return Number.isNaN(d.getTime())?String(v):d.toLocaleString("ru-RU",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
function formatShortTime(v){ if(!v)return "—"; const d=new Date(v); return Number.isNaN(d.getTime())?String(v):d.toLocaleTimeString("ru-RU",{hour:"2-digit",minute:"2-digit",second:"2-digit"}); }
function formatMoney(v,currency=""){ if(v===null||v===undefined||v==="")return "—"; const n=Number(v); return Number.isFinite(n)?`${n.toLocaleString("ru-RU",{maximumFractionDigits:2})}${currency?` ${currency}`:""}`:formatValue(v); }
function setConnectionState(online,text){ connectionPill.className=`status-pill ${online?"online":"offline"}`; connectionPill.textContent=online?"● Касса подключена":"● Нет подключения"; statusText.textContent=text; }
function normalizePluginData(item){ const event=item?.data||{}; const payload=event.data||event; return {pluginId:item?.pluginId||"",pluginName:item?.pluginName||"",departmentName:item?.departmentName||"",groupName:item?.groupName||"",version:item?.version||"",lastEventAt:item?.lastEventAt||"",eventType:event?.pluginEventType||"",payload,currencyCode:payload?.currencyCode||item?.currencyCode||""}; }

function renderPlugins(plugins){
  currentPlugins=plugins;
  const previous=pluginSelect.value;
  pluginSelect.innerHTML="";
  if(!plugins.length){
    pluginSelect.disabled=true; sendButton.disabled=true;
    pluginSelect.innerHTML='<option value="">Нет подключённых касс</option>';
    pluginsList.innerHTML='<div class="empty-note">Сейчас ни один плагин не подключён.</div>';
    overviewOnline.textContent="0"; overviewOnlineText.textContent="Нет активных подключений";
    overviewActivity.textContent="—"; overviewEvent.textContent="Ожидание события";
    return;
  }
  pluginSelect.disabled=false; sendButton.disabled=requestInFlight;
  plugins.forEach((p,i)=>{ const o=document.createElement("option"); o.value=p.pluginId; o.textContent=p.pluginName||p.pluginId||`Касса ${i+1}`; pluginSelect.appendChild(o); });
  pluginSelect.value=plugins.some(p=>p.pluginId===previous)?previous:plugins[0].pluginId;
  pluginsList.innerHTML=plugins.map(p=>`<div class="plugin-card"><div class="plugin-card-head"><div><div class="plugin-name"><span class="online-dot">●</span>${escapeHtml(p.pluginName||"Без названия")}</div><div class="panel-muted">Plugin ID: ${escapeHtml(p.pluginId||"—")}</div></div><span class="status-pill online">Подключён</span></div><div class="plugin-meta"><div class="meta-box"><div class="meta-label">Отдел</div><div class="meta-value">${escapeHtml(p.departmentName||"—")}</div></div><div class="meta-box"><div class="meta-label">Группа</div><div class="meta-value">${escapeHtml(p.groupName||"—")}</div></div><div class="meta-box"><div class="meta-label">Версия</div><div class="meta-value">${escapeHtml(p.version||"—")}</div></div><div class="meta-box"><div class="meta-label">Последняя активность</div><div class="meta-value">${escapeHtml(formatDateTime(p.lastEventAt))}</div></div><div class="meta-box"><div class="meta-label">Последнее событие</div><div class="meta-value">${escapeHtml(p.eventType||"—")}</div></div><div class="meta-box"><div class="meta-label">Заказ / событие</div><div class="meta-value">${escapeHtml(p.payload?.orderNum??"—")}</div></div></div></div>`).join("");
  const selected=plugins.find(p=>p.pluginId===pluginSelect.value)||plugins[0];
  overviewOnline.textContent=String(plugins.length); overviewOnlineText.textContent=plugins.length===1?"Подключённая касса работает":"Подключённых касс";
  overviewActivity.textContent=formatShortTime(selected.lastEventAt); overviewEvent.textContent=selected.eventType||"Событие не определено";
}

function findRows(value,depth=0){
  if(depth>8||value==null)return null;
  if(Array.isArray(value))return value.filter(x=>x&&typeof x==="object");
  if(typeof value!=="object")return null;
  for(const k of ["items","rows","orders","sales","payments","products","employees","data","result","records","report"]){ if(value[k]!==undefined){ const r=findRows(value[k],depth+1); if(r?.length)return r; } }
  for(const x of Object.values(value)){ const r=findRows(x,depth+1); if(r?.length)return r; }
  return null;
}
function collectColumns(rows){ const keys=[]; rows.slice(0,100).forEach(r=>Object.keys(r).forEach(k=>{if(!keys.includes(k)&&keys.length<16)keys.push(k);})); return keys; }
function primitiveEntries(v){ return v&&typeof v==="object"&&!Array.isArray(v)?Object.entries(v).filter(([,x])=>x==null||["string","number","boolean"].includes(typeof x)):[]; }
function deepGet(obj,names,depth=0){if(obj==null||depth>8||typeof obj!=="object")return null;const wanted=names.map(x=>String(x).toLowerCase());if(Array.isArray(obj)){for(const x of obj){const r=deepGet(x,names,depth+1);if(r!==null&&r!==undefined&&r!=="")return r;}return null;}for(const[k,v]of Object.entries(obj)){if(wanted.includes(k.toLowerCase())&&v!==null&&v!==undefined&&v!=="")return v;}for(const x of Object.values(obj)){const r=deepGet(x,names,depth+1);if(r!==null&&r!==undefined&&r!=="")return r;}return null;}
function scalar(v){if(v==null||v==="")return null;if(typeof v!=="object")return v;if(Array.isArray(v)){for(const x of v){const r=scalar(x);if(r!==null&&r!=="")return r;}return null;}for(const k of ["name","title","value","number","code","id"]){if(v[k]!==undefined){const r=scalar(v[k]);if(r!==null&&r!=="")return r;}}return null;}
function rowNumber(r){return scalar(deepGet(r,["orderNum","orderNumber","orderNo","number","num"]));}
function rowAmount(r){const v=deepGet(r,["orderExpectedRevenue","orderSum","revenue","resultSum","total","sum","amount","value","moneySum"]);const n=Number(String(scalar(v)??v??"").replace(/\s/g,"").replace(",","."));return Number.isFinite(n)?n:NaN;}
function rowState(r){const v=String(scalar(deepGet(r,["orderStatus","status","state","orderState","statusName","isClosed","closed"]))??"").toLowerCase();if(v==="true"||/(closed|close|completed|complete|paid|закрыт|закрыто|оплачен|заверш)/.test(v))return "closed";if(v==="false"||/(open|opened|active|new|открыт|открыто|актив|новый)/.test(v))return "open";if(deepGet(r,["closeTime","orderCloseTime","closedAt","closingTime"]))return "closed";return "unknown";}
function rowCurrency(r){return scalar(deepGet(r,["currencyCode","currency","currencyName"]))||"";}
function rowTime(r){return deepGet(r,["closeTime","orderCloseTime","closedAt","openTime","orderOpenDate","openedAt","createdAt","date","time"]);}
function rowItems(r){const v=deepGet(r,["items","orderItems","products","menuItems"]);return Array.isArray(v)?v:[];}
function humanKey(k){const map={orderNum:"Заказ",orderNumber:"Заказ",orderNo:"Заказ",orderStatus:"Статус",status:"Статус",state:"Статус",orderExpectedRevenue:"Сумма",orderSum:"Сумма",revenue:"Выручка",resultSum:"Сумма",total:"Итого",sum:"Сумма",amount:"Сумма",waiter:"Официант",waiterName:"Официант",cashier:"Кассир",cashierName:"Кассир",tables:"Стол",tableName:"Стол",floor:"Зал",floorName:"Зал",paymentType:"Оплата",paymentTypeName:"Оплата",payments:"Оплата",openTime:"Открыт",closeTime:"Закрыт",createdAt:"Время",productName:"Товар",itemName:"Товар",quantity:"Количество",price:"Цена"};return map[k]||k.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/^./,x=>x.toUpperCase());}
function looksMoneyKey(k){return /(revenue|sum|total|amount|price|money)/i.test(k);}

function renderOrders(rows,currency){
  const orders=[];const seen=new Set();
  rows.slice(0,100).forEach(r=>{const n=rowNumber(r);if(n==null)return;const key=String(n);if(seen.has(key))return;seen.add(key);orders.push(r);});
  if(!orders.length)return '<div class="cash-empty">Касса не вернула заказов за выбранный период.</div>';
  const closed=orders.filter(x=>rowState(x)==="closed");const open=orders.filter(x=>rowState(x)==="open");
  const total=orders.reduce((s,r)=>{const n=rowAmount(r);return s+(Number.isFinite(n)?n:0)},0);
  const cards=`<div class="cash-result-kpis"><div class="cash-result-kpi money"><span>Общая сумма</span><strong>${escapeHtml(formatMoney(total,currency))}</strong><em>по полученным заказам</em></div><div class="cash-result-kpi"><span>Всего заказов</span><strong>${orders.length}</strong><em>получено с кассы</em></div><div class="cash-result-kpi"><span>Закрытые</span><strong>${closed.length}</strong><em>оплаченные заказы</em></div><div class="cash-result-kpi"><span>Открытые</span><strong>${open.length}</strong><em>текущие заказы</em></div></div>`;
  const list=orders.map((r,i)=>{const n=rowNumber(r);const amount=rowAmount(r);const state=rowState(r);const waiter=scalar(deepGet(r,["waiter","waiterName","waiterFullName"]));const table=scalar(deepGet(r,["tables","table","tableName","orderTables"]));const floor=scalar(deepGet(r,["floor","floorName","restaurantSection"]));const payment=scalar(deepGet(r,["paymentType","paymentTypeName","paymentMethod","paymentName","payments"]));const time=rowTime(r);const items=rowItems(r);return `<article class="cash-order"><div class="cash-order-main"><div><div class="cash-order-number">#${escapeHtml(n)}</div><div class="cash-order-meta">${table?`<span class="cash-tag">Стол ${escapeHtml(table)}</span>`:""}${floor?`<span class="cash-tag muted">${escapeHtml(floor)}</span>`:""}</div></div><div><div class="cash-order-meta">${waiter?`<span class="cash-tag muted">${escapeHtml(waiter)}</span>`:""}${payment?`<span class="cash-tag muted">${escapeHtml(payment)}</span>`:""}</div></div><div class="cash-order-amount">${escapeHtml(formatMoney(amount,currency))}</div><div class="cash-status ${state}">${state==="closed"?"● Закрыт":state==="open"?"● Открыт":"● Статус не определён"}</div><button class="cash-expand" type="button">Детали ↓</button></div><div class="cash-order-details"><div class="cash-order-grid"><div class="cash-order-detail"><span>Номер заказа</span><strong>#${escapeHtml(n)}</strong></div><div class="cash-order-detail"><span>Официант</span><strong>${escapeHtml(waiter||"—")}</strong></div><div class="cash-order-detail"><span>Стол / зал</span><strong>${escapeHtml([table,floor].filter(Boolean).join(" · ")||"—")}</strong></div><div class="cash-order-detail"><span>Время</span><strong>${escapeHtml(formatDateTime(time))}</strong></div><div class="cash-order-detail"><span>Оплата</span><strong>${escapeHtml(payment||"—")}</strong></div><div class="cash-order-detail"><span>Товаров</span><strong>${items.length||"—"}</strong></div><div class="cash-order-detail"><span>Сумма</span><strong>${escapeHtml(formatMoney(amount,currency))}</strong></div></div></div></article>`;}).join("");
  return cards+`<div class="cash-result-panel"><div class="cash-result-panel-head"><span class="cash-result-panel-title">Заказы</span><span class="cash-result-panel-count">${orders.length} строк · ${closed.length} закрытых · ${open.length} открытых</span></div><div class="cash-orders">${list}</div></div>`;
}

function renderBars(rows,action,currency){
  const names=action==="get_products"?["productName","itemName","dishName","name","title"]:["employeeName","employee","waiterName","waiter","name","title"];
  const amountNames=["revenue","sum","total","amount","resultSum","value"];
  const data=rows.map(r=>({name:String(scalar(deepGet(r,names))??"Без названия"),value:Number(String(scalar(deepGet(r,amountNames))??"").replace(/\s/g,"").replace(",","."))})).filter(x=>Number.isFinite(x.value)).sort((a,b)=>b.value-a.value).slice(0,10);
  if(!data.length)return '<div class="cash-empty">Касса не вернула подходящих данных.</div>';
  const max=Math.max(...data.map(x=>x.value),1);
  return `<div class="cash-result-panel"><div class="cash-result-panel-head"><span class="cash-result-panel-title">${action==="get_products"?"Топ товаров":"Официанты"}</span><span class="cash-result-panel-count">Топ ${data.length}</span></div><div class="cash-bar-list">${data.map((x,i)=>`<div class="cash-bar-row"><div class="cash-bar-label"><strong>${i+1}. ${escapeHtml(x.name)}</strong><div class="cash-bar-track"><div class="cash-bar-fill" style="width:${Math.max(4,(x.value/max)*100)}%"></div></div></div><div class="cash-bar-value">${escapeHtml(formatMoney(x.value,currency))}</div></div>`).join("")}</div></div>`;
}

function renderGeneric(rows,currency){
  if(!rows?.length)return '<div class="cash-empty">Касса не вернула данных.</div>';
  const cols=collectColumns(rows).filter(k=>!/(^|_)(requestId|pluginId)$/i.test(k));
  return `<div class="cash-result-panel"><div class="cash-result-panel-head"><span class="cash-result-panel-title">Детализация</span><span class="cash-result-panel-count">${rows.length} строк</span></div><div style="overflow:auto"><table class="cash-data-table"><thead><tr>${cols.map(k=>`<th>${escapeHtml(humanKey(k))}</th>`).join("")}</tr></thead><tbody>${rows.slice(0,100).map(r=>`<tr>${cols.map(k=>{const v=r[k];const text=looksMoneyKey(k)&&Number.isFinite(Number(v))?formatMoney(v,currency):formatValue(v);return `<td>${escapeHtml(text)}</td>`}).join("")}</tr>`).join("")}</tbody></table></div></div>`;
}

function renderRequestResult(data,action){
  ensureCashVisualStyle();
  resultTitle.textContent=ACTION_NAMES[action]||"Результат";
  resultSubtitle.textContent=ACTION_SUBTITLES[action]||"Данные получены от подключённого плагина.";
  let payload=data;if(typeof payload==="string"){try{payload=JSON.parse(payload)}catch(_) {}}
  const currency=String(deepGet(payload,["currencyCode","currency","currencyName"])||currentPlugins.find(p=>p.pluginId===pluginSelect.value)?.currencyCode||"");
  const rows=findRows(payload)||[];
  let html="";
  if(action==="get_orders") html=renderOrders(rows,currency);
  else if(action==="get_products") html=renderBars(rows,action,currency);
  else if(action==="get_employees") html=renderBars(rows,action,currency);
  else if(action==="get_sales"||action==="get_payments"){
    const entries=primitiveEntries(payload?.summary).length?primitiveEntries(payload.summary):primitiveEntries(payload);
    const important=entries.filter(([k,v])=>v!==null&&v!==undefined).slice(0,8);
    html+=`<div class="cash-result-kpis">${important.map(([k,v])=>`<div class="cash-result-kpi ${looksMoneyKey(k)?"money":""}"><span>${escapeHtml(humanKey(k))}</span><strong>${escapeHtml(looksMoneyKey(k)&&Number.isFinite(Number(v))?formatMoney(v,currency):formatValue(v))}</strong><em>данные кассы</em></div>`).join("")}</div>`;
    if(rows.length) html+=renderGeneric(rows,currency);
  } else html=renderGeneric(rows,currency);
  resultSummary.innerHTML=html||'<div class="cash-empty">Плагин вернул пустой результат.</div>';
  resultSummary.querySelectorAll(".cash-expand").forEach(btn=>btn.addEventListener("click",()=>{const row=btn.closest(".cash-order");row.classList.toggle("opened");btn.textContent=row.classList.contains("opened")?"Скрыть ↑":"Детали ↓";}));
}

async function loadStatus(){
  try{
    const r=await fetch(DATA_ENDPOINT,{cache:"no-store"}); const j=await r.json();
    if(!r.ok||!j.success)throw new Error(j.error||j.message||`HTTP ${r.status}`);
    const plugins=Array.isArray(j.plugins)?j.plugins.map(normalizePluginData):[];
    renderPlugins(plugins); const online=plugins.length>0;
    setConnectionState(online,online?`${plugins.length} подключён${plugins.length===1?"ная касса":"ных касс"}`:"Подключённых касс нет");
    checkedAt.textContent=formatShortTime(new Date()); overviewSync.textContent=formatShortTime(new Date()); overviewSyncText.textContent="VPS отвечает нормально";
  }catch(e){
    renderPlugins([]); setConnectionState(false,`Ошибка получения данных: ${e.message}`); checkedAt.textContent=formatShortTime(new Date()); overviewSync.textContent="Ошибка"; overviewSyncText.textContent=e.message;
  }
}

async function sendPluginRequest(options={}){
  const silent=Boolean(options.silent); const pluginId=pluginSelect.value; const action=actionSelect.value;
  if(!pluginId){ if(!silent)requestStatus.textContent="Выбери подключённую кассу."; return; }
  if(requestInFlight)return;
  const params={}; if(dateFrom.value)params.dateFrom=dateFrom.value; if(dateTo.value)params.dateTo=dateTo.value;
  requestInFlight=true; sendButton.disabled=true; overviewReport.textContent=ACTION_NAMES[action]||action; overviewReportStatus.textContent=silent?"Автоматическое обновление…":"Запрашиваем данные…"; requestStatus.textContent=silent?"Автообновление данных…":"Запрашиваем данные у плагина…";
  resultSummary.classList.add("is-loading");
  try{
    const r=await fetch(`${API_BASE}/request`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action,pluginId,params})});
    const j=await r.json(); resultOutput.textContent=JSON.stringify(j,null,2); if(!r.ok||!j.success)throw new Error(j.error||j.message||`HTTP ${r.status}`);
    renderRequestResult(j.data,action); requestStatus.textContent=`Обновлено ${formatShortTime(new Date())}`; overviewReportStatus.textContent=`Обновлено ${formatShortTime(new Date())}`; overviewSync.textContent=formatShortTime(new Date()); overviewSyncText.textContent="Отчёт получен с кассы";
  }catch(e){ requestStatus.textContent=`${silent?"Автообновление: ":"Ошибка: "}${e.message}`; overviewReportStatus.textContent="Не удалось обновить"; }
  finally{ requestInFlight=false; sendButton.disabled=!pluginSelect.value; resultSummary.classList.remove("is-loading"); resetCountdown(); }
}
function resetCountdown(){ countdownSeconds=AUTO_REFRESH_MS/1000; if(countdownTimer)clearInterval(countdownTimer); updateCountdownLabel(); countdownTimer=setInterval(()=>{if(autoRefresh.checked){countdownSeconds=Math.max(0,countdownSeconds-1);updateCountdownLabel();}},1000); }
function updateCountdownLabel(){ if(!autoRefresh.checked){autoRefreshLabel.textContent="Выключено";nextRefresh.textContent="Обновление только вручную";return;} autoRefreshLabel.textContent="Включено";nextRefresh.textContent=`Следующий запрос через ${countdownSeconds} сек`; }
function restartAutoRefresh(){ if(autoRequestTimer)clearInterval(autoRequestTimer); if(!autoRefresh.checked){updateCountdownLabel();return;} autoRequestTimer=setInterval(()=>sendPluginRequest({silent:true}),AUTO_REFRESH_MS); resetCountdown(); }
function scheduleDateRefresh(){ clearTimeout(dateDebounceTimer); dateDebounceTimer=setTimeout(()=>{if(autoRefresh.checked&&pluginSelect.value)sendPluginRequest({silent:true});},500); }
function clearPreviousResultForAction(){ const a=actionSelect.value; resultTitle.textContent=ACTION_NAMES[a]||"Результат"; resultSubtitle.textContent=ACTION_SUBTITLES[a]||"Данные получаются непосредственно от подключённого плагина."; resultSummary.innerHTML='<div class="empty-note">Запрашиваем новые данные с кассы…</div>'; resultOutput.textContent="Ожидание нового ответа…"; requestStatus.textContent="Подготавливаем новый запрос…"; }

dateFrom.value=todayISO(); dateTo.value=todayISO();
actionSelect.addEventListener("change",()=>{const needs=["get_sales","get_orders","get_payments"].includes(actionSelect.value);dateFrom.disabled=!needs;dateTo.disabled=!needs;clearPreviousResultForAction();if(pluginSelect.value)sendPluginRequest();});
dateFrom.addEventListener("change",scheduleDateRefresh); dateTo.addEventListener("change",scheduleDateRefresh);
refreshButton.addEventListener("click",async()=>{await loadStatus();if(pluginSelect.value)await sendPluginRequest();});
sendButton.addEventListener("click",()=>sendPluginRequest());
pluginSelect.addEventListener("change",()=>{clearPreviousResultForAction();sendPluginRequest();});
autoRefresh.addEventListener("change",()=>{restartAutoRefresh();if(autoRefresh.checked&&pluginSelect.value)sendPluginRequest({silent:true});});

async function init(){ ensureCashVisualStyle(); const needs=["get_sales","get_orders","get_payments"].includes(actionSelect.value);dateFrom.disabled=!needs;dateTo.disabled=!needs;updateCountdownLabel();await loadStatus();if(pluginSelect.value)await sendPluginRequest({silent:true});restartAutoRefresh();setInterval(loadStatus,STATUS_REFRESH_MS); }
init();
