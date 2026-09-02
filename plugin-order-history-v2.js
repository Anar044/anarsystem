(() => {
  const escapeHtml = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
  const text = value => String(value ?? "").toLowerCase();

  const EVENT_TITLES = {
    newOrder: "🟢 Заказ открыт",
    deletionOfNotPrintedItem: "🗑️ Удалено нераспечатанное блюдо",
    deletionOfPrintedItem: "🗑️ Удалено распечатанное блюдо",
    addingDiscount: "🏷️ Применена скидка",
    removingDiscount: "🏷️ Скидка удалена",
    orderGuestBill: "🧾 Сформирован пречек",
    cancellationOfGuestBill: "↩️ Пречек отменён",
    voidReceipt: "↩️ Чек аннулирован",
    deletingAnOrder: "🗑️ Заказ удалён",
    closingOrder: "🔒 Заказ закрыт",
    orderTableHasBeenChanged: "🪑 Изменён стол",
    ordersWaiterHasChanged: "👤 Изменён официант",
    addingSurcharge: "➕ Добавлена наценка",
    removingSurcharge: "➖ Наценка удалена",
    printer: "🖨️ Печать",
    cashRegisterStart: "💵 Открыта кассовая смена",
    cashRegisterShutDown: "💵 Закрыта кассовая смена"
  };

  const style = document.createElement("style");
  style.textContent = `
    .history-v2-total{display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-top:12px;padding:13px 15px;border:1px solid var(--line);border-radius:12px;background:var(--surface2)}
    .history-v2-total span{color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase}.history-v2-total strong{font-size:18px;color:var(--pc-green)}
    .history-v2-note{margin-top:8px;color:var(--muted);font-size:10px}
    .history-v2-error{padding:16px;border:1px dashed var(--line);border-radius:12px;color:var(--muted)}
  `;
  document.head.appendChild(style);

  function first(value) {
    if (value === null || value === undefined || value === "") return null;
    if (["string", "number", "boolean"].includes(typeof value)) return value;
    if (Array.isArray(value)) { for (const x of value) { const v = first(x); if (v !== null) return v; } return null; }
    if (typeof value === "object") {
      for (const key of ["name","title","value","itemName","productName","dishName","Name","ItemName","ProductName"]) {
        if (value[key] !== undefined && value[key] !== null && value[key] !== "") return first(value[key]);
      }
    }
    return null;
  }

  function get(obj, names) {
    if (!obj || typeof obj !== "object") return null;
    for (const name of names) {
      const key = Object.keys(obj).find(k => k.toLowerCase() === name.toLowerCase());
      if (key && obj[key] !== null && obj[key] !== undefined && obj[key] !== "") return obj[key];
    }
    return null;
  }

  function eventTime(event) {
    return get(event, ["eventAt","receivedAt","createdAt","timestamp","time"]) || get(event?.data, ["updateTime","openTime","closeTime","billTime"]);
  }

  function eventTitle(type) { return EVENT_TITLES[type] || `🔹 ${type || "Событие заказа"}`; }

  function eventDescription(data) {
    const parts = [];
    const actor = first(get(data,["user","userName","employee","employeeName","employeeFullName","waiter","waiterName","cashier","cashierName"]));
    const item = first(get(data,["item","itemName","product","productName","dishName","deletedItem","addedItem","orderItem"]));
    const qty = first(get(data,["amount","quantity","count","itemsAmount","itemAmount"]));
    const discount = first(get(data,["discount","discountPercent","discountSum","discountAmount","valuePercent","value"]));
    const payment = first(get(data,["payment","paymentType","paymentTypeName","paymentMethod","paymentName"]));
    const reason = first(get(data,["reason","comment","reasonName"]));
    const sum = first(get(data,["revenue","sum","amountSum","resultSum","orderSum"]));
    if (actor) parts.push(`Сотрудник: ${actor}`);
    if (item) parts.push(`Блюдо: ${item}`);
    if (qty !== null) parts.push(`Количество: ${qty}`);
    if (discount !== null && /(discount|addingDiscount|removingDiscount)/i.test(JSON.stringify(data))) parts.push(`Скидка: ${discount}`);
    if (payment) parts.push(`Оплата: ${payment}`);
    if (sum !== null && !/(discount|item)/i.test(JSON.stringify(data))) parts.push(`Сумма: ${sum}`);
    if (reason) parts.push(`Причина: ${reason}`);
    return parts.join(" · ");
  }

  function compactData(data) {
    if (!data || typeof data !== "object") return data;
    const important = ["orderNum","orderNumber","number","tables","floor","waiter","cashier","revenue","item","itemName","product","productName","dishName","amount","quantity","discount","discountPercent","discountSum","discountAmount","value","valuePercent","payment","payments","paymentType","paymentTypeName","reason","comment","openTime","billTime","closeTime"];
    const out = {};
    for (const [key,value] of Object.entries(data)) if (important.some(x => x.toLowerCase() === key.toLowerCase())) out[key] = value;
    return Object.keys(out).length ? out : data;
  }

  function pluginQuery() {
    const select = document.getElementById("plugin-select");
    const option = select?.selectedOptions?.[0];
    const pluginId = option?.dataset?.pluginId || option?.value || "";
    return pluginId ? pluginId : "";
  }

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString("ru-RU", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit" });
  }

  function orderField(order, names) { return first(get(order, names)); }

  function setDetail(modal, id, value) {
    const el = modal.querySelector(`#${id}`);
    if (el) el.textContent = value ?? "—";
  }

  function renderComposition(slot, order) {
    const items = Array.isArray(order?.items) ? order.items.filter(Boolean) : [];
    if (!items.length) {
      slot.innerHTML = '<div class="order-empty">В текущем заказе нет оставшихся блюд.</div>';
      return;
    }

    const rows = items.map(item => {
      const name = orderField(item,["name","itemName","productName","dishName","Name"]) || "—";
      const qty = orderField(item,["amount","quantity","count","Amount"]) ?? 1;
      const price = orderField(item,["price","unitPrice","Price"]);
      const sum = orderField(item,["resultSum","sum","itemSum","total","ResultSum"]);
      const modifiers = Array.isArray(item.modifiers) ? item.modifiers : [];
      const modifierText = modifiers.map(m => {
        const mn = orderField(m,["name","Name"]);
        const ma = orderField(m,["amount","quantity","Amount"]);
        return mn ? ` · ${mn}${ma && Number(ma) !== 1 ? ` × ${ma}` : ""}` : "";
      }).join("");
      return `<tr><td><strong>${escapeHtml(name)}</strong>${escapeHtml(modifierText)}</td><td>${escapeHtml(qty)}</td><td>${escapeHtml(price ?? "—")}</td><td>${escapeHtml(sum ?? "—")}</td></tr>`;
    }).join("");

    const total = orderField(order,["revenue","Revenue"]);
    slot.innerHTML = `<table class="order-items"><thead><tr><th>Блюдо</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${rows}</tbody></table>${total !== null ? `<div class="history-v2-total"><span>Итоговая сумма чека</span><strong>${escapeHtml(total)}</strong></div>` : ""}<div class="history-v2-note">Состав взят из актуальных данных заказа iiko. Удалённые блюда, скидки и служебные операции сюда не попадают.</div>`;
  }

  async function requestFullOrder(number) {
    const pluginId = pluginQuery();
    const body = { action: "get_order", params: { orderNum: Number(number) || number } };
    if (pluginId) body.pluginId = pluginId;
    const response = await fetch("/api/plugin/request", { method:"POST", headers:{"Content-Type":"application/json","Accept":"application/json"}, cache:"no-store", body:JSON.stringify(body) });
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error || `HTTP ${response.status}`);
    return json.data || null;
  }

  async function requestHistory(number) {
    const pluginId = pluginQuery();
    const suffix = pluginId ? `&pluginId=${encodeURIComponent(pluginId)}` : "";
    const response = await fetch(`/api/plugin/order-history?orderNum=${encodeURIComponent(number)}${suffix}`, { cache:"no-store" });
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error(json.error || `HTTP ${response.status}`);
    return Array.isArray(json.history) ? json.history : [];
  }

  function historyDetails(history) {
    const result = {};
    for (const event of history || []) {
      const data = event?.data || {};
      for (const [target, names] of Object.entries({
        tables:["tables","Tables","orderTables","OrderTables","table","Table"],
        floor:["floor","Floor","floorName","FloorName","restaurantSection","RestaurantSection"],
        waiter:["waiter","Waiter","waiterName","WaiterName","employee","Employee","employeeName","EmployeeName","waiterFullName","WaiterFullName"],
        cashier:["cashier","Cashier","cashierName","CashierName","cashierFullName","CashierFullName"],
        revenue:["revenue","Revenue","resultSum","ResultSum","orderSum","OrderSum"],
        openTime:["openTime","OpenTime","orderOpenDate","OrderOpenDate"],
        billTime:["billTime","BillTime","orderBillTime","OrderBillTime"],
        closeTime:["closeTime","CloseTime","orderCloseDate","OrderCloseDate","orderCloseTime","OrderCloseTime"]
      })) {
        const value = get(data, names);
        if (value !== null && value !== undefined && value !== "") result[target] = value;
      }
    }
    return result;
  }

  function applyTableHistory(row, history) {
    const details = historyDetails(history);
    const cells = row.querySelectorAll("td");
    const values = [details.tables, details.floor, details.waiter, details.cashier, details.revenue, details.openTime, details.billTime, details.closeTime];
    const indexes = [2,3,4,5,6,7,8,9];
    indexes.forEach((index, i) => {
      if (values[i] !== undefined && values[i] !== null && values[i] !== "") {
        cells[index].textContent = i >= 5 ? formatDate(values[i]) : String(first(values[i]) ?? values[i]);
      }
    });
  }

  async function enrichOrdersTable() {
    const rows = Array.from(document.querySelectorAll("#orders-table-body tr.order-click"));
    for (const row of rows) {
      if (row.dataset.historyV2 === "loading" || row.dataset.historyV2 === "done") continue;
      const number = row.dataset.orderNumber;
      if (!number) continue;
      row.dataset.historyV2 = "loading";
      try {
        const history = await requestHistory(number);
        applyTableHistory(row, history);
        row.dataset.historyV2 = "done";
      } catch (_) {
        row.dataset.historyV2 = "error";
      }
    }
  }

  async function openV2(number, sourceOrder) {
    const modal = document.createElement("div");
    modal.className = "order-modal";
    modal.innerHTML = `<div class="order-modal-card"><div class="order-modal-head"><div><div class="panel-muted">ДЕТАЛИ ЗАКАЗА</div><h2>Заказ #${escapeHtml(number)}</h2><div class="timeline-meta">Актуальный состав отдельно от полного журнала действий</div></div><button class="order-modal-close" type="button">Закрыть</button></div><div class="order-detail-grid"><div class="order-detail-box"><span>Стол</span><strong id="v2-table">—</strong></div><div class="order-detail-box"><span>Зал</span><strong id="v2-floor">—</strong></div><div class="order-detail-box"><span>Официант</span><strong id="v2-waiter">—</strong></div><div class="order-detail-box"><span>Кассир</span><strong id="v2-cashier">—</strong></div><div class="order-detail-box"><span>Сумма</span><strong id="v2-revenue">—</strong></div><div class="order-detail-box"><span>Открыт</span><strong id="v2-open">—</strong></div><div class="order-detail-box"><span>Пречек</span><strong id="v2-bill">—</strong></div><div class="order-detail-box"><span>Закрыт</span><strong id="v2-close">—</strong></div></div><div class="order-modal-section"><h3>Состав заказа</h3><div id="history-v2-items" class="order-loading">Загружаем актуальный состав…</div></div><div class="order-modal-section"><h3>История событий</h3><div id="history-v2-events" class="order-loading">Загружаем историю…</div></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector(".order-modal-close").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });

    setDetail(modal,"v2-table",orderField(sourceOrder,["tables","Tables","orderTables"]));
    setDetail(modal,"v2-floor",orderField(sourceOrder,["floor","Floor"]));
    setDetail(modal,"v2-waiter",orderField(sourceOrder,["waiter","Waiter"]));
    setDetail(modal,"v2-cashier",orderField(sourceOrder,["cashier","Cashier"]));
    setDetail(modal,"v2-revenue",orderField(sourceOrder,["revenue","Revenue","orderExpectedRevenue"]));
    setDetail(modal,"v2-open",formatDate(orderField(sourceOrder,["openTime","OpenTime","orderOpenDate"])));
    setDetail(modal,"v2-bill",formatDate(orderField(sourceOrder,["billTime","BillTime","orderBillTime"])));
    setDetail(modal,"v2-close",formatDate(orderField(sourceOrder,["closeTime","CloseTime","orderCloseDate","orderCloseTime"])));

    const historyPromise = requestHistory(number).then(history => {
      const slot = modal.querySelector("#history-v2-events");
      if (!history.length) {
        slot.innerHTML = '<div class="order-empty">Для этого заказа пока нет сохранённых событий.</div>';
        return;
      }
      history.sort((a,b) => new Date(eventTime(a) || 0) - new Date(eventTime(b) || 0));
      const details = historyDetails(history);
      setDetail(modal,"v2-table",details.tables ?? orderField(sourceOrder,["tables","Tables","orderTables"]));
      setDetail(modal,"v2-floor",details.floor ?? orderField(sourceOrder,["floor","Floor"]));
      setDetail(modal,"v2-waiter",details.waiter ?? orderField(sourceOrder,["waiter","Waiter"]));
      setDetail(modal,"v2-cashier",details.cashier ?? orderField(sourceOrder,["cashier","Cashier"]));
      setDetail(modal,"v2-revenue",details.revenue ?? orderField(sourceOrder,["revenue","Revenue","orderExpectedRevenue"]));
      setDetail(modal,"v2-open",formatDate(details.openTime ?? orderField(sourceOrder,["openTime","OpenTime","orderOpenDate"])));
      setDetail(modal,"v2-bill",formatDate(details.billTime ?? orderField(sourceOrder,["billTime","BillTime","orderBillTime"])));
      setDetail(modal,"v2-close",formatDate(details.closeTime ?? orderField(sourceOrder,["closeTime","CloseTime","orderCloseTime"])));
      slot.className = "order-timeline";
      slot.innerHTML = history.map(event => {
        const data = event.data || {};
        const desc = eventDescription(data);
        const compact = compactData(data);
        return `<div class="timeline-item"><div class="timeline-event"><div class="timeline-time">${escapeHtml(eventTime(event) ? formatDate(eventTime(event)) : "—")}</div><div class="timeline-title">${escapeHtml(eventTitle(event.pluginEventType))}</div>${desc ? `<div class="timeline-meta">${escapeHtml(desc)}</div>` : ""}<details class="timeline-details"><summary>Показать данные события</summary><div class="timeline-data">${escapeHtml(JSON.stringify(compact,null,2))}</div></details></div></div>`;
      }).join("");
    }).catch(error => {
      modal.querySelector("#history-v2-events").innerHTML = `<div class="history-v2-error">Не удалось загрузить историю: ${escapeHtml(error.message)}</div>`;
    });

    const orderPromise = requestFullOrder(number).then(order => {
      if (!order) throw new Error("Плагин не вернул данные заказа");
      setDetail(modal,"v2-table",orderField(order,["tables","Tables"]));
      setDetail(modal,"v2-floor",orderField(order,["floor","Floor"]));
      setDetail(modal,"v2-waiter",orderField(order,["waiter","Waiter"]));
      setDetail(modal,"v2-cashier",orderField(order,["cashier","Cashier"]));
      setDetail(modal,"v2-revenue",orderField(order,["revenue","Revenue"]));
      setDetail(modal,"v2-open",formatDate(orderField(order,["openTime","OpenTime"])));
      setDetail(modal,"v2-bill",formatDate(orderField(order,["billTime","BillTime"])));
      setDetail(modal,"v2-close",formatDate(orderField(order,["closeTime","CloseTime","orderCloseDate","orderCloseTime"])));
      renderComposition(modal.querySelector("#history-v2-items"), order);
    }).catch(error => {
      modal.querySelector("#history-v2-items").innerHTML = `<div class="history-v2-error">Не удалось получить актуальный состав заказа: ${escapeHtml(error.message)}</div><div class="history-v2-note">История событий продолжает загружаться отдельно.</div>`;
    });

    await Promise.allSettled([historyPromise, orderPromise]);
  }

  document.addEventListener("click", event => {
    const row = event.target.closest?.("tr.order-click");
    if (!row) return;
    const number = row.dataset.orderNumber;
    if (!number) return;
    const cells = row.querySelectorAll("td");
    const order = {
      orderNum:number,
      tables:cells[2]?.textContent?.trim(),
      floor:cells[3]?.textContent?.trim(),
      waiter:cells[4]?.textContent?.trim(),
      cashier:cells[5]?.textContent?.trim(),
      revenue:cells[6]?.textContent?.trim(),
      openTime:cells[7]?.textContent?.trim(),
      billTime:cells[8]?.textContent?.trim(),
      closeTime:cells[9]?.textContent?.trim()
    };
    event.preventDefault();
    event.stopPropagation();
    openV2(number, order);
  }, true);

  const tableObserver = new MutationObserver(() => enrichOrdersTable());
  tableObserver.observe(document.body, { childList:true, subtree:true });
  setTimeout(enrichOrdersTable, 250);
})();