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
function renderTable(rows){ const cols=collectColumns(rows); if(!cols.length)return ""; const head=cols.map(k=>`<th>${escapeHtml(k)}</th>`).join(""); const body=rows.slice(0,100).map(r=>`<tr>${cols.map(k=>`<td>${escapeHtml(formatValue(r[k]))}</td>`).join("")}</tr>`).join(""); return `<div class="result-table-title"><span>Детализация</span><b>${rows.length} строк</b></div><div class="data-table-wrap"><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`; }
function primitiveEntries(v){ return v&&typeof v==="object"&&!Array.isArray(v)?Object.entries(v).filter(([,x])=>x==null||["string","number","boolean"].includes(typeof x)):[]; }
function renderRequestResult(data,action){
  resultTitle.textContent=ACTION_NAMES[action]||"Результат"; resultSubtitle.textContent=ACTION_SUBTITLES[action]||"Данные получены от подключённого плагина.";
  const rows=findRows(data); let html="";
  if(data&&typeof data==="object"&&!Array.isArray(data)&&data.summary&&typeof data.summary==="object") html+=`<div class="result-headline">${primitiveEntries(data.summary).slice(0,8).map(([k,v])=>`<div class="result-stat"><span>${escapeHtml(k)}</span><strong>${escapeHtml(typeof v==="number"?formatMoney(v):formatValue(v))}</strong></div>`).join("")}</div>`;
  if(rows?.length) html+=renderTable(rows); else if(data&&typeof data==="object"){ const e=primitiveEntries(data).slice(0,12); if(e.length)html+=`<div class="result-headline">${e.map(([k,v])=>`<div class="result-stat"><span>${escapeHtml(k)}</span><strong>${escapeHtml(typeof v==="number"?formatMoney(v):formatValue(v))}</strong></div>`).join("")}</div>`; }
  resultSummary.innerHTML=html||'<div class="empty-note">Плагин вернул пустой результат.</div>';
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

async function init(){ const needs=["get_sales","get_orders","get_payments"].includes(actionSelect.value);dateFrom.disabled=!needs;dateTo.disabled=!needs;updateCountdownLabel();await loadStatus();if(pluginSelect.value)await sendPluginRequest({silent:true});restartAutoRefresh();setInterval(loadStatus,STATUS_REFRESH_MS); }
init();

// SHIFT SUMMARY: always independent from the selected report (Продажи / Заказы / Оплаты / ...)
(() => {
  const closedEl = document.getElementById("shift-closed-sum");
  const openEl = document.getElementById("shift-open-sum");
  const expectedEl = document.getElementById("shift-expected-sum");
  const statusEl = document.getElementById("shift-summary-status");
  if (!closedEl || !openEl || !expectedEl) return;

  const money = value => Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });
  const text = value => String(value ?? "").toLowerCase();

  const first = value => {
    if (value == null || value === "") return null;
    if (typeof value !== "object") return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = first(item);
        if (found != null && found !== "") return found;
      }
      return null;
    }
    for (const key of ["name", "title", "value", "number", "code", "id"]) {
      const found = first(value[key]);
      if (found != null && found !== "") return found;
    }
    return null;
  };

  const deep = (value, names, depth = 0) => {
    if (value == null || typeof value !== "object" || depth > 12) return null;
    const wanted = names.map(x => String(x).toLowerCase());
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = deep(item, names, depth + 1);
        if (found != null && found !== "") return found;
      }
      return null;
    }
    for (const [key, child] of Object.entries(value)) {
      if (wanted.includes(key.toLowerCase()) && child != null && child !== "") return child;
    }
    for (const child of Object.values(value)) {
      const found = deep(child, names, depth + 1);
      if (found != null && found !== "") return found;
    }
    return null;
  };

  const parseNumber = value => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value == null) return NaN;
    const normalized = String(value).replace(/\s/g, "").replace(/[^0-9,.-]/g, "").replace(/,(?=.*[,])/g, "").replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  };

  const rowsOf = (value, depth = 0) => {
    if (value == null || depth > 12) return null;
    if (Array.isArray(value)) {
      const rows = value.filter(item => item && typeof item === "object");
      return rows.length ? rows : null;
    }
    if (typeof value !== "object") return null;
    for (const key of ["orders", "items", "rows", "data", "result", "records", "report"]) {
      if (value[key] !== undefined) {
        const rows = rowsOf(value[key], depth + 1);
        if (rows?.length) return rows;
      }
    }
    for (const child of Object.values(value)) {
      const rows = rowsOf(child, depth + 1);
      if (rows?.length) return rows;
    }
    return null;
  };

  async function updateShiftSummary() {
    try {
      const stateResponse = await fetch("/api/plugin/data", { cache: "no-store" });
      const state = await stateResponse.json();
      const plugin = state?.plugins?.[0];
      if (!plugin?.pluginId) throw new Error("Касса не подключена");

      const response = await fetch("/api/plugin/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "get_orders", pluginId: plugin.pluginId, params: {} })
      });
      const result = await response.json();
      if (!response.ok || !result.success) throw new Error(result.error || `HTTP ${response.status}`);

      let payload = result.data;
      if (typeof payload === "string") {
        try { payload = JSON.parse(payload); } catch (_) {}
      }
      const rows = rowsOf(payload) || [];
      let closed = 0, open = 0, closedCount = 0, openCount = 0;

      for (const row of rows) {
        const amount = parseNumber(first(deep(row, ["revenue", "resultSum", "orderExpectedRevenue", "orderSum", "sum", "total", "amount"])));
        if (!Number.isFinite(amount)) continue;
        const status = text(first(deep(row, ["orderStatus", "status", "state", "orderState", "statusName"])));
        const closeTime = deep(row, ["closeTime", "orderCloseTime", "closedAt", "closingTime"]);
        const isClosed = /(closed|close|completed|complete|paid|закрыт|закрыто|оплачен|заверш)/.test(status) || !!closeTime;
        if (isClosed) { closed += amount; closedCount++; }
        else { open += amount; openCount++; }
      }

      closedEl.textContent = money(closed);
      openEl.textContent = money(open);
      expectedEl.textContent = money(closed + open);
      statusEl.textContent = `По всем заказам · ${closedCount} закрытых / ${openCount} открытых`;
    } catch (error) {
      statusEl.textContent = error.message === "Касса не подключена" ? "Касса не подключена" : "Не удалось обновить";
    }
  }

  updateShiftSummary();
  setInterval(updateShiftSummary, 10000);
})();
