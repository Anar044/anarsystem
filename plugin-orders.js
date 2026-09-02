(() => {
  const actionSelect = document.getElementById("action-select");
  const resultSummary = document.getElementById("result-summary");
  const resultOutput = document.getElementById("result-output");
  if (!actionSelect || !resultSummary || !resultOutput) return;

  const style = document.createElement("style");
  style.textContent = `.orders-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;margin-bottom:14px}.order-stat{appearance:none;border:1px solid var(--line);border-radius:14px;background:var(--surface2);padding:13px 15px;text-align:left;color:inherit;cursor:pointer;transition:.16s}.order-stat:hover,.order-stat.active{border-color:var(--pc-green);background:var(--pc-green-soft);transform:translateY(-1px)}.order-stat span{display:block;font-size:9px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.07em}.order-stat strong{display:block;font-size:22px;margin-top:4px}.order-stat.open strong{color:var(--pc-green)}.order-stat.closed strong{color:var(--pc-red,#ff6b6b)}.orders-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:4px 0 10px}.orders-toolbar strong{font-size:12px}.orders-toolbar span{display:block;color:var(--muted);font-size:10px;margin-top:3px}.orders-live{display:flex!important;align-items:center;gap:6px;color:var(--pc-green)!important}.orders-live i{width:6px;height:6px;border-radius:50%;background:var(--pc-green);display:inline-block}.order-state{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;font-size:9px;font-weight:850}.order-state.open{background:var(--pc-green-soft);color:var(--pc-green)}.order-state.closed{background:rgba(255,107,107,.1);color:var(--pc-red,#ff6b6b)}.order-state.unknown{background:var(--surface2);color:var(--muted)}.orders-table td{vertical-align:middle}.orders-table tr[hidden]{display:none}.orders-pay strong{color:var(--pc-green)}@media(max-width:900px){.orders-stats{grid-template-columns:1fr 1fr 1fr}}@media(max-width:800px){.orders-toolbar{align-items:flex-start;flex-direction:column}}@media(max-width:500px){.orders-stats{grid-template-columns:1fr 1fr}.orders-table{min-width:980px}}`;
  document.head.appendChild(style);

  const escapeHtml = value => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  const keyOf = (row, names) => {
    const entries = Object.entries(row || {});
    for (const name of names) {
      const hit = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
      if (hit && hit[1] !== null && hit[1] !== undefined && hit[1] !== "") return hit[1];
    }
    return null;
  };

  const text = value => String(value ?? "").toLowerCase();

  function firstText(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "string" || typeof value === "number") return value;
    if (Array.isArray(value)) {
      for (const item of value) { const v = firstText(item); if (v !== null) return v; }
      return null;
    }
    if (typeof value === "object") {
      for (const key of ["name", "title", "value", "number", "code", "id"]) {
        const v = firstText(value[key]);
        if (v !== null) return v;
      }
    }
    return null;
  }

  function field(row, names) { return firstText(keyOf(row, names)); }

  function orderState(row) {
    const closedFlag = keyOf(row, ["isClosed", "closed", "isClosedOrder"]);
    if (closedFlag === true || text(closedFlag) === "true") return "closed";
    if (closedFlag === false || text(closedFlag) === "false") return "open";
    const status = field(row, ["orderStatus", "status", "state", "orderState", "statusName"]);
    const s = text(status);
    if (/(closed|close|completed|complete|paid|закрыт|закрыто|оплачен|заверш)/.test(s)) return "closed";
    if (/(open|opened|active|открыт|открыто|актив)/.test(s)) return "open";
    const closeTime = keyOf(row, ["orderCloseTime", "closeTime", "closedAt", "closingTime", "closeDate"]);
    const openTime = keyOf(row, ["orderOpenDate", "openTime", "openedAt", "openingTime", "openDate"]);
    if (closeTime) return "closed";
    if (openTime) return "open";
    return "unknown";
  }

  function orderNumber(row, index) { return field(row, ["orderNum", "orderNumber", "orderNo", "number", "num"]) ?? index + 1; }

  function renderOrderRows(rows) {
    return rows.slice(0, 200).map((row, index) => {
      const state = orderState(row);
      const number = orderNumber(row, index);
      const tables = field(row, ["orderTables", "table", "tables", "tableName"]);
      const floor = field(row, ["floor", "floorName", "orderFloor", "restaurantSection"]);
      const waiter = field(row, ["waiter", "waiterName", "orderWaiter", "employee", "employeeName", "waiterFullName"]);
      const cashier = field(row, ["cashier", "cashierName", "orderCashier", "cashierFullName"]);
      const amount = field(row, ["orderExpectedRevenue", "revenue", "sum", "total", "amount", "orderSum"]);
      const opened = field(row, ["orderOpenDate", "openTime", "openedAt", "openingTime", "createdAt"]);
      const bill = field(row, ["orderBillTime", "billTime", "precheckTime", "precheckAt"]);
      const closed = field(row, ["orderCloseTime", "closeTime", "closedAt", "closingTime", "closedDate"]);
      const payment = field(row, ["paymentType", "paymentTypeName", "paymentMethod", "paymentName", "payType", "payTypeName"]);
      const status = state === "closed" ? "Закрыт" : state === "open" ? "Открыт" : "Не определён";
      return `<tr data-order-state="${state}"><td><strong>#${escapeHtml(number)}</strong></td><td><span class="order-state ${state}">${status}</span></td><td>${escapeHtml(tables ?? "—")}</td><td>${escapeHtml(floor ?? "—")}</td><td>${escapeHtml(waiter ?? "—")}</td><td>${escapeHtml(cashier ?? "—")}</td><td>${escapeHtml(amount ?? "—")}</td><td>${escapeHtml(opened ?? "—")}</td><td>${escapeHtml(bill ?? "—")}</td><td>${escapeHtml(closed ?? "—")}</td><td class="orders-pay">${payment ? `<strong>${escapeHtml(payment)}</strong>` : "—"}</td></tr>`;
    }).join("");
  }

  function renderOrders(rows) {
    const states = rows.map(orderState);
    const open = states.filter(s => s === "open").length;
    const closed = states.filter(s => s === "closed").length;
    const unknown = states.filter(s => s === "unknown").length;
    const payments = rows.map(row => text(field(row, ["paymentType", "paymentTypeName", "paymentMethod", "paymentName", "payType", "payTypeName"])));
    const cash = payments.filter(s => /(cash|налич|касса)/.test(s)).length;
    const card = payments.filter(s => /(card|банков|карта|terminal|терминал)/.test(s)).length;

    resultSummary.innerHTML = `<div class="orders-dashboard"><div class="orders-stats"><button type="button" class="order-stat active" data-order-filter="all"><span>Все заказы</span><strong>${rows.length}</strong></button><button type="button" class="order-stat open" data-order-filter="open"><span>Открытые</span><strong>${open}</strong></button><button type="button" class="order-stat closed" data-order-filter="closed"><span>Закрытые</span><strong>${closed}</strong></button>${unknown ? `<button type="button" class="order-stat unknown" data-order-filter="unknown"><span>Без статуса</span><strong>${unknown}</strong></button>` : ""}<button type="button" class="order-stat"><span>Оплата</span><strong>${cash + card ? `${cash}/${card}` : "—"}</strong></button></div><div class="orders-toolbar"><div><strong>Заказы текущей смены</strong><span>${rows.length} записей · оплата: ${cash} наличные / ${card} карта</span></div><span class="orders-live"><i></i> обновляется автоматически</span></div><div class="data-table-wrap orders-table-wrap"><table class="data-table orders-table"><thead><tr><th>Заказ</th><th>Статус</th><th>Стол</th><th>Зал</th><th>Официант</th><th>Кассир</th><th>Сумма</th><th>Открыт</th><th>Пречек</th><th>Закрыт</th><th>Оплата</th></tr></thead><tbody id="orders-table-body">${renderOrderRows(rows)}</tbody></table></div>${rows.length > 200 ? `<div class="table-note">Показаны первые 200 заказов.</div>` : ""}</div>`;

    resultSummary.querySelectorAll("[data-order-filter]").forEach(button => {
      button.addEventListener("click", () => {
        resultSummary.querySelectorAll("[data-order-filter]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        const filter = button.dataset.orderFilter;
        resultSummary.querySelectorAll("#orders-table-body tr").forEach(row => { row.hidden = filter !== "all" && row.dataset.orderState !== filter; });
      });
    });
  }

  function collectArrays(value, out = [], depth = 0) {
    if (depth > 8 || value == null) return out;
    if (Array.isArray(value)) {
      const objects = value.filter(item => item && typeof item === "object" && !Array.isArray(item));
      if (objects.length) out.push(objects);
      objects.forEach(item => collectArrays(item, out, depth + 1));
      return out;
    }
    if (typeof value !== "object") return out;
    Object.values(value).forEach(child => collectArrays(child, out, depth + 1));
    return out;
  }

  function orderArrayScore(rows) {
    const keys = ["orderNum","orderOpenDate","orderBillTime","orderCloseTime","orderExpectedRevenue","orderStatus","orderTables","table","waiter","cashier","paymentType"];
    return rows.reduce((score, row) => score + keys.filter(key => Object.keys(row).some(k => k.toLowerCase() === key.toLowerCase())).length, 0);
  }

  function findRows(value) {
    const arrays = collectArrays(value);
    if (!arrays.length) return null;
    arrays.sort((a,b) => { const sa=orderArrayScore(a), sb=orderArrayScore(b); return sb-sa || b.length-a.length; });
    return arrays[0];
  }

  function tryRenderOrders() {
    if (actionSelect.value !== "get_orders") return;
    try {
      const response = JSON.parse(resultOutput.textContent || "{}");
      if (!response.success) return;
      const rows = findRows(response.data);
      if (rows && rows.length) renderOrders(rows);
    } catch (_) {}
  }

  const observer = new MutationObserver(tryRenderOrders);
  observer.observe(resultOutput, { childList: true, characterData: true, subtree: true });
  actionSelect.addEventListener("change", () => setTimeout(tryRenderOrders, 250));
  setInterval(tryRenderOrders, 1000);
})();