const API_BASE = "/api/plugin";
const DATA_ENDPOINT = "/api/plugin/data";

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
  return date.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
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
  Object.values(liveFields).forEach(element => {
    if (element) element.textContent = "—";
  });
}

function renderLiveData(plugin) {
  if (!plugin) {
    resetLiveData();
    return;
  }

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
}

function renderPlugins(plugins) {
  pluginSelect.innerHTML = "";

  if (!plugins.length) {
    pluginSelect.disabled = true;
    sendButton.disabled = true;
    pluginSelect.innerHTML = "<option value=\"\">Нет подключённых касс</option>";
    pluginsList.innerHTML = '<div class="empty-note">Сейчас ни один плагин не подключён.</div>';
    resetLiveData();
    return;
  }

  pluginSelect.disabled = false;
  sendButton.disabled = false;

  plugins.forEach((plugin, index) => {
    const option = document.createElement("option");
    option.value = plugin.pluginId || "";
    option.textContent = plugin.pluginName || plugin.pluginId || `Касса ${index + 1}`;
    pluginSelect.appendChild(option);
  });

  pluginsList.innerHTML = plugins.map((plugin) => `
    <div class="plugin-card">
      <div class="plugin-card-head">
        <div>
          <div class="plugin-name"><span class="online-dot">●</span> ${escapeHtml(plugin.pluginName || "Без названия")}</div>
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
  if (selected) {
    pluginSelect.value = selected.pluginId;
    renderLiveData(selected);
  }
}

function findRows(value, depth = 0) {
  if (depth > 5 || value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.filter(item => item && typeof item === "object");
  if (typeof value !== "object") return null;

  const preferredKeys = ["items", "rows", "data", "orders", "sales", "payments", "products", "employees", "result", "records"];
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
  rows.slice(0, 50).forEach(row => {
    Object.keys(row).forEach(key => {
      if (!keys.includes(key) && keys.length < 10) keys.push(key);
    });
  });
  return keys;
}

function renderTable(rows) {
  const columns = collectColumns(rows);
  if (!columns.length) return "";

  const head = columns.map(key => `<th>${escapeHtml(key)}</th>`).join("");
  const body = rows.slice(0, 100).map(row => `
    <tr>${columns.map(key => `<td>${escapeHtml(formatValue(row[key]))}</td>`).join("")}</tr>
  `).join("");

  return `
    <div class="data-table-wrap">
      <table class="data-table">
        <thead><tr>${head}</tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderRequestResult(data, action) {
  resultTitle.textContent = ACTION_NAMES[action] || "Результат";
  resultSubtitle.textContent = "Данные получены непосредственно от подключённого плагина.";

  const rows = findRows(data);
  const stats = [];

  if (Array.isArray(data)) stats.push(["Записей", data.length]);
  if (rows) stats.push(["Строк", rows.length]);

  if (data && typeof data === "object" && !Array.isArray(data)) {
    const summary = data.summary;
    if (summary && typeof summary === "object" && !Array.isArray(summary)) {
      Object.entries(summary).slice(0, 4).forEach(([key, value]) => {
        if (["number", "string"].includes(typeof value)) stats.push([key, formatValue(value)]);
      });
    }
  }

  const statsHtml = stats.length
    ? `<div class="result-headline">${stats.map(([label, value]) => `<div class="result-stat"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>`
    : "";

  if (rows && rows.length) {
    resultSummary.innerHTML = statsHtml + renderTable(rows);
    return;
  }

  if (data && typeof data === "object") {
    const entries = Object.entries(data).filter(([, value]) => typeof value !== "object").slice(0, 12);
    if (entries.length) {
      resultSummary.innerHTML = statsHtml + `<div class="result-headline">${entries.map(([key, value]) => `<div class="result-stat"><span>${escapeHtml(key)}</span><strong>${escapeHtml(formatValue(value))}</strong></div>`).join("")}</div>`;
      return;
    }
  }

  resultSummary.innerHTML = statsHtml || '<div class="empty-note">Плагин вернул пустой результат.</div>';
}

async function loadStatus() {
  setConnectionState(false, "Получаем данные от плагина…");

  try {
    const response = await fetch(DATA_ENDPOINT, { cache: "no-store" });
    const data = await response.json();

    if (!response.ok || !data.success) {
      throw new Error(data.error || data.message || `HTTP ${response.status}`);
    }

    const plugins = Array.isArray(data.plugins) ? data.plugins.map(normalizePluginData) : [];
    renderPlugins(plugins);

    const online = plugins.length > 0;
    setConnectionState(
      online,
      online ? `${plugins.length} подключён${plugins.length === 1 ? "ная касса" : "ных касс"}` : "Подключённых касс нет"
    );
    checkedAt.textContent = new Date().toLocaleTimeString("ru-RU");
  } catch (error) {
    renderPlugins([]);
    setConnectionState(false, `Ошибка получения данных: ${error.message}`);
    checkedAt.textContent = new Date().toLocaleTimeString("ru-RU");
  }
}

async function sendPluginRequest() {
  const pluginId = pluginSelect.value;
  const action = actionSelect.value;

  if (!pluginId) {
    requestStatus.textContent = "Выбери подключённую кассу.";
    return;
  }

  const params = {};
  if (dateFrom.value) params.dateFrom = dateFrom.value;
  if (dateTo.value) params.dateTo = dateTo.value;

  requestStatus.textContent = "Запрашиваем данные у плагина…";
  sendButton.disabled = true;
  resultSummary.innerHTML = '<div class="empty-note">Получаем данные…</div>';
  resultOutput.textContent = "Ожидание ответа плагина…";

  try {
    const response = await fetch(`${API_BASE}/request`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, pluginId, params })
    });

    const data = await response.json();
    resultOutput.textContent = JSON.stringify(data, null, 2);

    if (!response.ok || !data.success) {
      requestStatus.textContent = data.error || data.message || `Ошибка HTTP ${response.status}`;
      resultSummary.innerHTML = `<div class="empty-note">Не удалось получить данные: ${escapeHtml(data.error || data.message || `HTTP ${response.status}`)}</div>`;
      return;
    }

    renderRequestResult(data.data, action);
    requestStatus.textContent = `Ответ получен: ${ACTION_NAMES[action] || action}`;
    setTimeout(loadStatus, 300);
  } catch (error) {
    requestStatus.textContent = `Ошибка: ${error.message}`;
    resultSummary.innerHTML = `<div class="empty-note">Ошибка запроса: ${escapeHtml(error.message)}</div>`;
    resultOutput.textContent = error.stack || error.message;
  } finally {
    sendButton.disabled = !pluginSelect.value;
  }
}

dateFrom.value = todayISO();
dateTo.value = todayISO();

refreshButton.addEventListener("click", loadStatus);
sendButton.addEventListener("click", sendPluginRequest);
pluginSelect.addEventListener("change", loadStatus);

actionSelect.addEventListener("change", () => {
  const needsDates = ["get_sales", "get_orders", "get_payments"].includes(actionSelect.value);
  dateFrom.disabled = !needsDates;
  dateTo.disabled = !needsDates;
});

actionSelect.dispatchEvent(new Event("change"));
loadStatus();
