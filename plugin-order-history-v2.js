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

  const EVENT_IGNORE_FOR_COMPOSITION = /(discount|surcharge|payment|delivery|receipt|guestbill|table|waiter|cashier|order|printer|shift|reserve|banquet)/i;
  const EVENT_DELETE = /(delete|deletion|remove|removed|storno|void|cancel)/i;
  const EVENT_ADD = /(add|added|item|product|dish)/i;

  const style = document.createElement("style");
  style.textContent = `
    .history-v2-total{display:flex;justify-content:flex-end;align-items:center;gap:12px;margin-top:12px;padding:13px 15px;border:1px solid var(--line);border-radius:12px;background:var(--surface2)}
    .history-v2-total span{color:var(--muted);font-size:10px;font-weight:800;text-transform:uppercase}.history-v2-total strong{font-size:18px;color:var(--pc-green)}
    .history-v2-note{margin-top:8px;color:var(--muted);font-size:10px}
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
    return get(event, ["eventAt","receivedAt","createdAt","timestamp","time"]) ||
      get(event?.data, ["updateTime","openTime","closeTime","billTime"]);
  }

  function eventTitle(type) {
    return EVENT_TITLES[type] || `🔹 ${type || "Событие заказа"}`;
  }

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

  function normalizeItem(entry) {
    const data = entry?.data || {};
    const name = first(get(data,["item","itemName","product","productName","dishName","deletedItem","addedItem","orderItem"]));
    if (!name) return null;
    const quantity = first(get(data,["quantity","amount","count","itemsAmount","itemAmount"])) ?? 1;
    const price = first(get(data,["price","unitPrice","itemPrice"]));
    const sum = first(get(data,["sum","itemSum","resultSum","itemResultSum"]));
    return { name:String(name), quantity:Number(quantity) || 1, price, sum, eventType:entry.pluginEventType || "", eventAt:eventTime(entry) };
  }

  // Build the final composition from the chronological item events.
  // Deleted items are removed from the final list; discounts and technical events never enter it.
  function buildFinalItems(history) {
    const working = [];
    const sorted = [...history].sort((a,b) => new Date(eventTime(a) || 0) - new Date(eventTime(b) || 0));

    for (const entry of sorted) {
      const type = String(entry.pluginEventType || "");
      if (EVENT_IGNORE_FOR_COMPOSITION.test(type)) continue;
      const item = normalizeItem(entry);
      if (!item) continue;

      if (EVENT_DELETE.test(type)) {
        let left = item.quantity;
        for (let i = working.length - 1; i >= 0 && left > 0; i--) {
          if (text(working[i].name) !== text(item.name)) continue;
          const removed = Math.min(working[i].quantity, left);
          working[i].quantity -= removed;
          left -= removed;
          if (working[i].quantity <= 0) working.splice(i,1);
        }
      } else if (EVENT_ADD.test(type) || !type) {
        working.push(item);
      }
    }

    return working;
  }

  function renderComposition(slot, history, order) {
    let items = Array.isArray(order?.items) ? order.items : [];
    if (!items.length) items = buildFinalItems(history);

    // Never show operational records in the composition.
    items = items.filter(item => {
      const type = String(get(item,["eventType","pluginEventType","type"]) || "");
      const name = text(first(get(item,["name","itemName","productName","dishName","Name"])));
      return !EVENT_IGNORE_FOR_COMPOSITION.test(type) && !/(скидк|наценк|оплат|пречек|заказ открыт|заказ закрыт)/i.test(name);
    });

    if (!items.length) {
      slot.innerHTML = '<div class="order-empty">Финальный состав не найден в данных заказа.</div>';
      return;
    }

    const rows = items.map(item => {
      const name = first(get(item,["name","itemName","productName","dishName","Name"])) || "—";
      const qty = first(get(item,["quantity","amount","count","Amount"])) ?? 1;
      const price = first(get(item,["price","unitPrice","Price"]));
      const sum = first(get(item,["resultSum","sum","itemSum","total","ResultSum"]));
      return `<tr><td><strong>${escapeHtml(name)}</strong></td><td>${escapeHtml(qty)}</td><td>${escapeHtml(price ?? "—")}</td><td>${escapeHtml(sum ?? "—")}</td></tr>`;
    }).join("");

    const total = get(order,["Revenue","revenue","orderExpectedRevenue","sum","total","orderSum"]);
    slot.innerHTML = `<table class="order-items"><thead><tr><th>Блюдо</th><th>Кол-во</th><th>Цена</th><th>Сумма</th></tr></thead><tbody>${rows}</tbody></table>${total !== null ? `<div class="history-v2-total"><span>Итоговая сумма чека</span><strong>${escapeHtml(total)}</strong></div>` : ""}<div class="history-v2-note">Здесь показано только то, что осталось в заказе после всех удалений. Скидки и удалённые блюда находятся только в истории.</div>`;
  }

  function pluginQuery() {
    const select = document.getElementById("plugin-select");
    const option = select?.selectedOptions?.[0];
    const pluginId = option?.dataset?.pluginId || option?.value || "";
    return pluginId ? `&pluginId=${encodeURIComponent(pluginId)}` : "";
  }

  async function openV2(number, sourceOrder) {
    const modal = document.createElement("div");
    modal.className = "order-modal";
    modal.innerHTML = `<div class="order-modal-card"><div class="order-modal-head"><div><div class="panel-muted">ДЕТАЛИ ЗАКАЗА</div><h2>История заказа #${escapeHtml(number)}</h2><div class="timeline-meta">Текущее состояние отдельно от полного журнала действий</div></div><button class="order-modal-close" type="button">Закрыть</button></div><div class="order-detail-grid"><div class="order-detail-box"><span>Стол</span><strong>${escapeHtml(first(get(sourceOrder,["Tables","orderTables","table","tables"])) ?? "—")}</strong></div><div class="order-detail-box"><span>Зал</span><strong>${escapeHtml(first(get(sourceOrder,["Floor","floor","floorName","restaurantSection"])) ?? "—")}</strong></div><div class="order-detail-box"><span>Официант</span><strong>${escapeHtml(first(get(sourceOrder,["Waiter","waiter","waiterName","employeeName"])) ?? "—")}</strong></div><div class="order-detail-box"><span>Кассир</span><strong>${escapeHtml(first(get(sourceOrder,["Cashier","cashier","cashierName","employeeName"])) ?? "—")}</strong></div><div class="order-detail-box"><span>Сумма</span><strong>${escapeHtml(first(get(sourceOrder,["Revenue","orderExpectedRevenue","revenue","sum","total"])) ?? "—")}</strong></div><div class="order-detail-box"><span>Открыт</span><strong>${escapeHtml(first(get(sourceOrder,["OpenTime","openTime","orderOpenDate"])) ? new Date(first(get(sourceOrder,["OpenTime","openTime","orderOpenDate"]))).toLocaleString("ru-RU") : "—")}</strong></div><div class="order-detail-box"><span>Пречек</span><strong>${escapeHtml(first(get(sourceOrder,["BillTime","billTime","orderBillTime"])) ? new Date(first(get(sourceOrder,["BillTime","billTime","orderBillTime"]))).toLocaleString("ru-RU") : "—")}</strong></div><div class="order-detail-box"><span>Закрыт</span><strong>${escapeHtml(first(get(sourceOrder,["CloseTime","closeTime","orderCloseTime"])) ? new Date(first(get(sourceOrder,["CloseTime","closeTime","orderCloseTime"]))).toLocaleString("ru-RU") : "—")}</strong></div></div><div class="order-modal-section"><h3>Состав заказа</h3><div id="history-v2-items" class="order-loading">Загружаем состав…</div></div><div class="order-modal-section"><h3>История событий</h3><div id="history-v2-events" class="order-loading">Загружаем историю…</div></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector(".order-modal-close").addEventListener("click", () => modal.remove());
    modal.addEventListener("click", e => { if (e.target === modal) modal.remove(); });

    try {
      const url = `/api/plugin/order-history?orderNum=${encodeURIComponent(number)}${pluginQuery()}`;
      const response = await fetch(url, { cache:"no-store" });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || `HTTP ${response.status}`);

      const history = Array.isArray(json.history) ? json.history : [];
      renderComposition(modal.querySelector("#history-v2-items"), history, sourceOrder);

      const slot = modal.querySelector("#history-v2-events");
      if (!history.length) {
        slot.innerHTML = '<div class="order-empty">Для этого заказа пока нет сохранённых событий.</div>';
        return;
      }

      history.sort((a,b) => new Date(eventTime(a) || 0) - new Date(eventTime(b) || 0));
      slot.className = "order-timeline";
      slot.innerHTML = history.map(event => {
        const data = event.data || {};
        const desc = eventDescription(data);
        const details = compactData(data);
        return `<div class="timeline-item"><div class="timeline-event"><div class="timeline-time">${escapeHtml(eventTime(event) ? new Date(eventTime(event)).toLocaleString("ru-RU") : "—")}</div><div class="timeline-title">${escapeHtml(eventTitle(event.pluginEventType))}</div>${desc ? `<div class="timeline-meta">${escapeHtml(desc)}</div>` : ""}<details class="timeline-details"><summary>Показать данные события</summary><div class="timeline-data">${escapeHtml(JSON.stringify(details,null,2))}</div></details></div></div>`;
      }).join("");
    } catch (error) {
      modal.querySelector("#history-v2-events").innerHTML = `<div class="order-empty">Не удалось загрузить историю: ${escapeHtml(error.message)}</div>`;
    }
  }

  // The old script still renders the table. This capture handler replaces only its click behaviour.
  document.addEventListener("click", event => {
    const row = event.target.closest?.("tr.order-click");
    if (!row) return;
    const number = row.dataset.orderNumber;
    const index = Number(row.dataset.orderIndex);
    const result = document.getElementById("result-summary");
    const rows = Array.from(result?.querySelectorAll("#orders-table-body tr") || []);
    const source = rows[index] ? null : null;

    // Recover the visible order fields from the row; the history endpoint supplies the event log.
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
})();
