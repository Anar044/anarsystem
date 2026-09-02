const API_BASE = "/api/plugin";
const DATA_ENDPOINT = "/api/plugin/data";
const AUTO_REFRESH_MS = 10000;
const STATUS_REFRESH_MS = 5000;

const pluginsList = document.getElementById("plugins-list");
const pluginSelect = document.getElementById("plugin-select");
const sendButton = document.getElementById("send-request");
const refreshButton = document.getElementById("refresh-status");
const connectionPill = document.getElementById("connection-pill");
const statusText = document.getElementById("status-text");
const checkedAt = document.getElementById("checked-at");
const requestStatus = document.getElementById("request-status");
const resultOutput = document.getElementById("result-output");
const resultSummary = document.getElementById("result-summary");
const resultTitle = document.getElementById("result-title");
const resultSubtitle = document.getElementById("result-subtitle");
const actionSelect = document.getElementById("action-select");
const dateFrom = document.getElementById("date-from");
const dateTo = document.getElementById("date-to");
const autoRefresh = document.getElementById("auto-refresh");
const autoRefreshLabel = document.getElementById("auto-refresh-label");
const nextRefresh = document.getElementById("next-refresh");

const overviewOnline = document.getElementById("overview-online");
const overviewOnlineText = document.getElementById("overview-online-text");
const overviewActivity = document.getElementById("overview-activity");
const overviewEvent = document.getElementById("overview-event");
const overviewReport = document.getElementById("overview-report");
const overviewReportStatus = document.getElementById("overview-report-status");
const overviewSync = document.getElementById("overview-sync");
const overviewSyncText = document.getElementById("overview-sync-text");

const liveFields = {
  event: document.getElementById("live-event"),
  revenue: document.getElementById("live-revenue"),
  order: document.getElementById("live-order"),
  table: document.getElementById("live-table"),
  floor: document.getElementById("live-floor"),
  waiter: document.getElementById("live-waiter"),
  cashier: document.getElementById("live-cashier"),
  openTime: document.getElementById("live-open-time"),
  closeTime: document.getElementById("live-close-time"),
  updateTime: document.getElementById("live-update-time"),
  lastEvent: document.getElementById("live-last-event")
};

const ACTION_NAMES = {
  get_sales: "Продажи",
  get_orders: "Заказы",
  get_payments: "Оплаты",
  get_products: "Товары",
  get_employees: "Сотрудники"
};

const ACTION_SUBTITLES = {
  get_sales: "Сводка продаж, полученная непосредственно от подключённой кассы.",
  get_orders: "Текущие заказы, полученные непосредственно от подключённой кассы.",
  get_payments: "Сводка оплат по данным подключённой кассы.",
  get_products: "Топ товаров по выручке по данным подключённой кассы.",
  get_employees: "Сводка по официантам по данным подключённой кассы."
};

let currentPlugins = [];
let requestInFlight = false;
let countdownTimer = null;
let autoRequestTimer = null;
let countdownSeconds = AUTO_REFRESH_MS / 1000;
let dateDebounceTimer = null;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", second:"2-digit" });
}

function formatShortTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("ru-RU", { hour:"2-digit", minute:"2-digit", second:"2-digit" });
}

function formatMoney(value, currency = "") {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return formatValue(value);
  return `${number.toLocaleString("ru-RU", { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`;
}

function setConnectionState(online, text) {
  connectionPill.className = `status-pill ${online ? "online" : "offline"}`;
  connectionPill.textContent = online ? "● Касса подключена" : "● Нет подключения";
  statusText.textContent = text;
}

function normalizePluginData(item) {
  const event = item?.data || {};
  const payload = event.data || event;
  return {
    pluginId: item?.pluginId || "",
    pluginName: item?.pluginName || "",
    departmentId: item?.departmentId || "",
    departmentName: item?.departmentName || "",
    groupId: item?.groupId || "",
    groupName: item?.groupName || "",
    version: item?.version || "",
    lastEventAt: item?.lastEventAt || "",
    serverUrl: item?.serverUrl || "",
    currencyCode: payload?.currencyCode || item?.currencyCode || "",
    eventType: event?.pluginEventType || "",
    eventUuid: event?.uuid || "",
    payload
  };
}

function resetLiveData() {
  Object.values(liveFields).forEach(element => { if (element) element.textContent = "—"; });
  overviewActivity.textContent = "—";
  overviewEvent.textContent = "Ожидание события";
}

function renderLiveData(plugin) {
  if (!plugin) { resetLiveData(); return; }
  const data = plugin.payload || {};
  const currency = plugin.currencyCode || data.currencyCode || "";
  liveFields.event.textContent = plugin.eventType || "—";
  liveFields.revenue.textContent = formatMoney(data.revenue, currency);
  liveFields.order.textContent = formatValue(data.orderNum);
  liveFields.table.textContent = formatValue(data.tables || data.table);
  liveFields.floor.textContent = formatValue(data.floor);
  liveFields.waiter.textContent = formatValue(data.waiter);
  liveFields.cashier.textContent = formatValue(data.cashier);
  liveFields.openTime.textContent = formatDateTime(data.openTime);
  liveFields.closeTime.textContent = formatDateTime(data.closeTime);
  liveFields.updateTime.textContent = formatDateTime(data.updateTime);
  liveFields.lastEvent.textContent = formatDateTime(plugin.lastEventAt);
  overviewActivity.textContent = formatShortTime(plugin.lastEventAt);
  overviewEvent.textContent = plugin.eventType || "Событие не определено";
}

function renderPlugins(plugins) {
  currentPlugins = plugins;
  const previousPluginId = pluginSelect.value;
  pluginSelect.innerHTML = "";

  if (!plugins.length) {
    pluginSelect.disabled = true;
    sendButton.disabled = true;
    pluginSelect.innerHTML = '<option value="">Нет подключённых касс</option>';
    pluginsList.innerHTML = '<div class="empty-note">Сейчас ни один плагин не подключён.</div>';
    resetLiveData();
    overviewOnline.textContent = "0";
    overviewOnlineText.textContent = "Нет активных подключений";
    return;
  }

  pluginSelect.disabled = false;
  sendButton.disabled = requestInFlight;

  plugins.forEach((plugin, index) => {
    const option = document.createElement("option");
    option.value = plugin.pluginId || "";
    option.textContent = plugin.pluginName || plugin.pluginId || `Касса ${index + 1}`;
    pluginSelect.appendChild(option);
  });

  if (plugins.some(p => p.pluginId === previousPluginId)) pluginSelect.value = previousPluginId;

  pluginsList.innerHTML = plugins.map(plugin => `
    <div class="plugin-card">
      <div class="plugin-card-head">
        <div>
          <div class="plugin-name"><span class="online-dot">●</span>${escapeHtml(plugin.pluginName || "Без названия")}</div>
          <div class="panel-muted">Plugin ID: ${escapeHtml(plugin.pluginId || "—")}</div>
        </div>
        <span class="status-pill online">Подключён</span>
      </div>
      <div class="plugin-meta">
        <div class="meta-box"><div class="meta-label">Отдел</div><div class="meta-value">${escapeHtml(plugin.departmentName || plugin.departmentId || "—")}</div></div>
        <div class="meta-box"><div class="meta-label">Группа</div><div class="meta-value">${escapeHtml(plugin.groupName || plugin.groupId || "—")}</div></div>
        <div class="meta-box"><div class="meta-label">Версия</div><div class="meta-value">${escapeHtml(plugin.version || "—")}</div></div>
        <div class="meta-box"><div class="meta-label">Последняя активность</div><div class="meta-value">${escapeHtml(formatDateTime(plugin.lastEventAt))}</div></div>
        <div class="meta-box"><div class="meta-label">Последнее событие</div><div class="meta-value">${escapeHtml(plugin.eventType || "—")}</div></div>
        <div class="meta-box"><div class="meta-label">Заказ / событие</div><div class="meta-value">${escapeHtml(plugin.payload?.orderNum ?? "—")}</div></div>
      </div>
    </div>
  `).join("");

  const selected = plugins.find(p => p.pluginId === pluginSelect.value) || plugins[0];
  pluginSelect.value = selected.pluginId;
  renderLiveData(selected);
  overviewOnline.textContent = String(plugins.length);
  overviewOnlineText.textContent = plugins.length === 1 ? "Подключённая касса работает" : "Подключённых касс";
}

function findRows(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.filter(item => item && typeof item === "object");
  if (typeof value !== "object") return null;
  const preferredKeys = ["items","rows","data","orders","sales","payments","products","employees","result","records","report"];
  for (const key of preferredKeys) {
    if (value[key] !== undefined) {
      const rows = findRows(value[key], depth + 1);
      if (rows && rows.length) return rows;
    }
  }
  for (const child of Object.values(value)) {
    const rows = findRows(child, depth + 1);
    if (rows && rows.length) return rows;
  }
  return null;
}

function collectColumns(rows) {
  const keys = [];
  rows.slice(0, 100).forEach(row => Object.keys(row).forEach(key => { if (!keys.includes(key) && keys.length < 12) keys.push(key); }));
  return keys;
}

function renderTable(rows) {
  const columns = collectColumns(rows);
  if (!columns.length) return "";
  const head = columns.map(key => `<th>${escapeHtml(key)}</th>`).join("");
  const body = rows.slice(0, 100).map(row => `<tr>${columns.map(key => `<td>${escapeHtml(formatValue(row[key]))}</td>`).join("")}</tr>`).join("");
  return `<div class="result-table-title"><span>Детализация</span><b>${rows.length} строк</b></div><div class="data-table-wrap"><table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>${rows.length > 100 ? '<div class="table-note">Показаны первые 100 строк. Полный ответ доступен ниже.</div>' : ''}`;
}

function primitiveEntries(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).filter(([, item]) => item === null || ["string","number","boolean"].includes(typeof item));
}

function renderStatsFromObject(value, limit = 8) {
  const entries = primitiveEntries(value).slice(0, limit);
  if (!entries.length) return "";
  return `<div class="result-headline">${entries.map(([key,value]) => `<div class="result-stat"><span>${escapeHtml(key)}</span><strong>${typeof value === "number" ? escapeHtml(formatMoney(value)) : escapeHtml(formatValue(value))}</strong></div>`).join("")}</div>`;
}

function renderNumericChart(rows) {
  if (!Array.isArray(rows) || rows.length < 2) return "";
  const candidates = collectColumns(rows).map(column => ({ column, values: rows.map(row => Number(row[column])).filter(Number.isFinite) })).filter(item => item.values.length >= 2);
  if (!candidates.length) return "";
  const candidate = candidates.sort((a,b) => b.values.length - a.values.length)[0];
  const max = Math.max(...candidate.values.map(Math.abs), 1);
  const labelColumn = collectColumns(rows).find(column => column !== candidate.column && rows.some(row => typeof row[column] === "string" && row[column]));
  const bars = rows.slice(0,10).map(row => {
    const value = Number(row[candidate.column]);
    if (!Number.isFinite(value)) return "";
    const width = Math.max(3, Math.round((Math.abs(value) / max) * 100));
    const label = labelColumn ? formatValue(row[labelColumn]) : candidate.column;
    return `<div class="chart-row"><div class="chart-label" title="${escapeHtml(label)}">${escapeHtml(label)}</div><div class="chart-track"><div class="chart-bar" style="width:${width}%"></div></div><div class="chart-value">${escapeHtml(formatMoney(value))}</div></div>`;
  }).join("");
  return `<div class="mini-chart"><div class="mini-chart-head"><span>Визуализация</span><b>${escapeHtml(candidate.column)}</b></div>${bars}</div>`;
}

function renderRequestResult(data, action) {
  resultTitle.textContent = ACTION_NAMES[action] || "Результат";
  resultSubtitle.textContent = ACTION_SUBTITLES[action] || "Данные получены непосредственно от подключённого плагина.";
  const rows = findRows(data);
  let html = "";
  if (data && typeof data === "object" && !Array.isArray(data) && data.summary && typeof data.summary === "object" && !Array.isArray(data.summary)) html += renderStatsFromObject(data.summary, 8);
  if (Array.isArray(data)) html += `<div class="result-headline"><div class="result-stat"><span>Записей</span><strong>${data.length}</strong></div></div>`;
  else if (rows) html += `<div class="result-headline"><div class="result-stat"><span>Строк</span><strong>${rows.length}</strong></div></div>`;
  if (rows && rows.length) { html += renderNumericChart(rows); html += renderTable(rows); }
  else if (data && typeof data === "object") {
    const entries = primitiveEntries(data).slice(0,12);
    if (entries.length) html += `<div class="result-headline">${entries.map(([key,value]) => `<div class="result-stat"><span>${escapeHtml(key)}</span><strong>${typeof value === "number" ? escapeHtml(formatMoney(value)) : escapeHtml(formatValue(value))}</strong></div>`).join("")}</div>`;
  }
  resultSummary.innerHTML = html || '<div class="empty-note">Плагин вернул пустой результат.</div>';
}

async function loadStatus() {
  try {
    const response = await fetch(DATA_ENDPOINT, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || data.message || `HTTP ${response.status}`);
    const plugins = Array.isArray(data.plugins) ? data.plugins.map(normalizePluginData) : [];
    renderPlugins(plugins);
    const online = plugins.length > 0;
    setConnectionState(online, online ? `${plugins.length} подключён${plugins.length === 1 ? "ная касса" : "ных касс"}` : "Подключённых касс нет");
    checkedAt.textContent = new Date().toLocaleTimeString("ru-RU");
    overviewSync.textContent = formatShortTime(new Date());
    overviewSyncText.textContent = "VPS отвечает нормально";
  } catch (error) {
    renderPlugins([]);
    setConnectionState(false, `Ошибка получения данных: ${error.message}`);
    checkedAt.textContent = new Date().toLocaleTimeString("ru-RU");
    overviewSync.textContent = "Ошибка";
    overviewSyncText.textContent = error.message;
  }
}

async function sendPluginRequest(options = {}) {
  const silent = Boolean(options.silent);
  const pluginId = pluginSelect.value;
  const action = actionSelect.value;
  if (!pluginId) {
    if (!silent) requestStatus.textContent = "Выбери подключённую кассу.";
    return;
  }
  if (requestInFlight) return;
  const params = {};
  if (dateFrom.value) params.dateFrom = dateFrom.value;
  if (dateTo.value) params.dateTo = dateTo.value;
  requestInFlight = true;
  sendButton.disabled = true;
  overviewReport.textContent = ACTION_NAMES[action] || action;
  overviewReportStatus.textContent = silent ? "Автоматическое обновление…" : "Запрашиваем данные…";
  if (!silent) requestStatus.textContent = "Запрашиваем данные у плагина…";
  else requestStatus.textContent = "Автообновление данных…";
  resultSummary.classList.add("is-loading");
  try {
    const response = await fetch(`${API_BASE}/request`, { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ action, pluginId, params }) });
    const data = await response.json();
    resultOutput.textContent = JSON.stringify(data, null, 2);
    if (!response.ok || !data.success) throw new Error(data.error || data.message || `HTTP ${response.status}`);
    renderRequestResult(data.data, action);
    requestStatus.textContent = `Обновлено ${formatShortTime(new Date())}`;
    overviewReportStatus.textContent = `Обновлено ${formatShortTime(new Date())}`;
    overviewSync.textContent = formatShortTime(new Date());
    overviewSyncText.textContent = "Отчёт получен с кассы";
  } catch (error) {
    if (!silent) requestStatus.textContent = `Ошибка: ${error.message}`;
    else requestStatus.textContent = `Автообновление: ${error.message}`;
    overviewReportStatus.textContent = "Не удалось обновить";
    if (!resultSummary.innerHTML || resultSummary.innerHTML.includes("Получаем данные")) resultSummary.innerHTML = `<div class="empty-note">Не удалось получить данные: ${escapeHtml(error.message)}</div>`;
  } finally {
    requestInFlight = false;
    sendButton.disabled = !pluginSelect.value;
    resultSummary.classList.remove("is-loading");
    resetCountdown();
  }
}

function resetCountdown() {
  countdownSeconds = AUTO_REFRESH_MS / 1000;
  if (countdownTimer) clearInterval(countdownTimer);
  updateCountdownLabel();
  countdownTimer = setInterval(() => {
    if (!autoRefresh.checked) return;
    countdownSeconds = Math.max(0, countdownSeconds - 1);
    updateCountdownLabel();
  }, 1000);
}

function updateCountdownLabel() {
  if (!autoRefresh.checked) {
    autoRefreshLabel.textContent = "Выключено";
    nextRefresh.textContent = "Обновление только вручную";
    return;
  }
  autoRefreshLabel.textContent = "Включено";
  nextRefresh.textContent = `Следующий запрос через ${countdownSeconds} сек`;
}

function restartAutoRefresh() {
  if (autoRequestTimer) clearInterval(autoRequestTimer);
  if (!autoRefresh.checked) { updateCountdownLabel(); return; }
  autoRequestTimer = setInterval(() => sendPluginRequest({ silent:true }), AUTO_REFRESH_MS);
  resetCountdown();
}

function scheduleDateRefresh() {
  clearTimeout(dateDebounceTimer);
  dateDebounceTimer = setTimeout(() => {
    if (autoRefresh.checked && pluginSelect.value) sendPluginRequest({ silent:true });
  }, 500);
}

function clearPreviousResultForAction() {
  const action = actionSelect.value;
  resultTitle.textContent = ACTION_NAMES[action] || "Результат";
  resultSubtitle.textContent = ACTION_SUBTITLES[action] || "Данные получаются непосредственно от подключённого плагина.";
  resultSummary.innerHTML = '<div class="empty-note">Запрашиваем новые данные с кассы…</div>';
  resultOutput.textContent = "Ожидание нового ответа…";
  requestStatus.textContent = "Подготавливаем новый запрос…";
}

dateFrom.value = todayISO();
dateTo.value = todayISO();

actionSelect.addEventListener("change", () => {
  const needsDates = ["get_sales","get_orders","get_payments"].includes(actionSelect.value);
  dateFrom.disabled = !needsDates;
  dateTo.disabled = !needsDates;
  clearPreviousResultForAction();
  if (pluginSelect.value) sendPluginRequest({ silent:false });
});

dateFrom.addEventListener("change", scheduleDateRefresh);
dateTo.addEventListener("change", scheduleDateRefresh);
refreshButton.addEventListener("click", async () => {
  await loadStatus();
  await sendPluginRequest({ silent:false });
});
sendButton.addEventListener("click", () => sendPluginRequest({ silent:false }));
pluginSelect.addEventListener("change", () => {
  clearPreviousResultForAction();
  sendPluginRequest({ silent:false });
});
autoRefresh.addEventListener("change", () => {
  restartAutoRefresh();
  if (autoRefresh.checked && pluginSelect.value) sendPluginRequest({ silent:true });
});

async function init() {
  const needsDates = ["get_sales","get_orders","get_payments"].includes(actionSelect.value);
  dateFrom.disabled = !needsDates;
  dateTo.disabled = !needsDates;
  updateCountdownLabel();
  await loadStatus();
  if (pluginSelect.value) await sendPluginRequest({ silent:true });
  restartAutoRefresh();
  setInterval(loadStatus, STATUS_REFRESH_MS);
}

init();