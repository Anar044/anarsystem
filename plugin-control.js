const API_BASE = "/api/plugin";
const DATA_ENDPOINT = "http://68.233.120.197/api/plugin/data";

const pluginsList = document.getElementById("plugins-list");
const pluginSelect = document.getElementById("plugin-select");
const sendButton = document.getElementById("send-request");
const refreshButton = document.getElementById("refresh-status");
const connectionPill = document.getElementById("connection-pill");
const statusText = document.getElementById("status-text");
const checkedAt = document.getElementById("checked-at");
const requestStatus = document.getElementById("request-status");
const resultOutput = document.getElementById("result-output");
const actionSelect = document.getElementById("action-select");
const dateFrom = document.getElementById("date-from");
const dateTo = document.getElementById("date-to");

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

function renderPlugins(plugins) {
  pluginSelect.innerHTML = "";

  if (!plugins.length) {
    pluginSelect.disabled = true;
    sendButton.disabled = true;
    pluginSelect.innerHTML = "<option value=\"\">Нет подключённых касс</option>";
    pluginsList.innerHTML = '<div class="empty-note">Сейчас ни один плагин не подключён.</div>';
    resultOutput.textContent = "Плагин пока не передал данные.";
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
        <div class="meta-box"><div class="meta-label">Последняя активность</div><div class="meta-value">${escapeHtml(plugin.lastEventAt || "—")}</div></div>
        <div class="meta-box"><div class="meta-label">Последнее событие</div><div class="meta-value">${escapeHtml(plugin.eventType || "—")}</div></div>
        <div class="meta-box"><div class="meta-label">Заказ / событие</div><div class="meta-value">${escapeHtml(plugin.payload?.orderNum ?? "—")}</div></div>
      </div>
    </div>
  `).join("");

  const selected = plugins.find(p => p.pluginId === pluginSelect.value) || plugins[0];
  if (selected) renderPluginData(selected);
}

function renderPluginData(plugin) {
  if (!plugin) return;

  const event = {
    pluginId: plugin.pluginId,
    pluginName: plugin.pluginName,
    departmentId: plugin.departmentId,
    departmentName: plugin.departmentName,
    groupId: plugin.groupId,
    groupName: plugin.groupName,
    version: plugin.version,
    lastEventAt: plugin.lastEventAt,
    eventType: plugin.eventType,
    eventUuid: plugin.eventUuid,
    data: plugin.payload
  };

  resultOutput.textContent = JSON.stringify(event, null, 2);
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
      return;
    }

    requestStatus.textContent = `Ответ получен: ${action}`;
    setTimeout(loadStatus, 300);
  } catch (error) {
    requestStatus.textContent = `Ошибка: ${error.message}`;
    resultOutput.textContent = error.stack || error.message;
  } finally {
    sendButton.disabled = !pluginSelect.value;
  }
}

dateFrom.value = todayISO();
dateTo.value = todayISO();

refreshButton.addEventListener("click", loadStatus);
sendButton.addEventListener("click", sendPluginRequest);
pluginSelect.addEventListener("change", () => {
  const selectedId = pluginSelect.value;
  loadStatus().then(() => {
    const option = [...pluginSelect.options].find(item => item.value === selectedId);
    if (option) pluginSelect.value = selectedId;
  });
});

actionSelect.addEventListener("change", () => {
  const needsDates = actionSelect.value === "get_sales" || actionSelect.value === "get_orders" || actionSelect.value === "get_payments";
  dateFrom.disabled = !needsDates;
  dateTo.disabled = !needsDates;
});

actionSelect.dispatchEvent(new Event("change"));
loadStatus();
