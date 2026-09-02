(() => {
  const actionSelect = document.getElementById("action-select");
  const resultSummary = document.getElementById("result-summary");
  const resultOutput = document.getElementById("result-output");
  if (!actionSelect || !resultSummary || !resultOutput) return;

  const escapeHtml = value => String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

  const valueOf = (row, names) => {
    const entries = Object.entries(row || {});
    for (const name of names) {
      const hit = entries.find(([key]) => key.toLowerCase() === name.toLowerCase());
      if (hit && hit[1] !== null && hit[1] !== undefined && hit[1] !== "") return hit[1];
    }
    return null;
  };

  const text = value => String(value ?? "").toLowerCase();

  function orderState(row) {
    const closedFlag = valueOf(row, ["isClosed", "closed", "isClosedOrder"]);
    if (closedFlag === true || text(closedFlag) === "true") return "closed";
    if (closedFlag === false || text(closedFlag) === "false") return "open";

    const status = valueOf(row, ["status", "state", "orderStatus", "orderState", "statusName"]);
    const s = text(status);
    if (/(closed|close|completed|complete|paid|закрыт|закрыто|оплачен|заверш)/.test(s)) return "closed";
    if (/(open|opened|active|openedorder|открыт|открыто|актив)/.test(s)) return "open";

    const closeTime = valueOf(row, ["closeTime", "closedAt", "closingTime", "closeDate"]);
    const openTime = valueOf(row, ["openTime", "openedAt", "openingTime", "openDate"]);
    if (closeTime) return "closed";
    if (openTime) return "open";
    return "unknown";
  }

  function orderNumber(row, index) {
    return valueOf(row, ["orderNum", "orderNumber", "number", "orderNo", "num"]) ?? `#${index + 1}`;
  }

  function renderOrderRows(rows) {
    return rows.slice(0, 200).map((row, index) => {
      const state = orderState(row);
      const number = orderNumber(row, index);
      const table = valueOf(row, ["table", "tables", "tableName"]);
      const floor = valueOf(row, ["floor", "floorName"]);
      const waiter = valueOf(row, ["waiter", "waiterName", "employee", "employeeName"]);
      const cashier = valueOf(row, ["cashier", "cashierName"]);
      const amount = valueOf(row, ["revenue", "sum", "total", "amount", "orderSum"]);
      const opened = valueOf(row, ["openTime", "openedAt", "openingTime", "createdAt"]);
      const closed = valueOf(row, ["closeTime", "closedAt", "closingTime", "closedDate"]);
      const status = state === "closed" ? "Закрыт" : state === "open" ? "Открыт" : "Не определён";
      const statusClass = state === "closed" ? "closed" : state === "open" ? "open" : "unknown";
      return `<tr data-order-state="${state}">
        <td><strong>#${escapeHtml(number)}</strong></td>
        <td><span class="order-state ${statusClass}">${status}</span></td>
        <td>${escapeHtml(table ?? "—")}</td>
        <td>${escapeHtml(floor ?? "—")}</td>
        <td>${escapeHtml(waiter ?? "—")}</td>
        <td>${escapeHtml(cashier ?? "—")}</td>
        <td>${escapeHtml(amount ?? "—")}</td>
        <td>${escapeHtml(opened ?? "—")}</td>
        <td>${escapeHtml(closed ?? "—")}</td>
      </tr>`;
    }).join("");
  }

  function renderOrders(rows) {
    const states = rows.map(orderState);
    const open = states.filter(s => s === "open").length;
    const closed = states.filter(s => s === "closed").length;
    const unknown = states.filter(s => s === "unknown").length;

    resultSummary.innerHTML = `
      <div class="orders-dashboard">
        <div class="orders-stats">
          <button type="button" class="order-stat active" data-order-filter="all"><span>Все заказы</span><strong>${rows.length}</strong></button>
          <button type="button" class="order-stat open" data-order-filter="open"><span>Открытые</span><strong>${open}</strong></button>
          <button type="button" class="order-stat closed" data-order-filter="closed"><span>Закрытые</span><strong>${closed}</strong></button>
          ${unknown ? `<button type="button" class="order-stat unknown" data-order-filter="unknown"><span>Без статуса</span><strong>${unknown}</strong></button>` : ""}
        </div>
        <div class="orders-toolbar">
          <div><strong>Заказы текущей смены</strong><span>${rows.length} записей</span></div>
          <span class="orders-live"><i></i> обновляется автоматически</span>
        </div>
        <div class="data-table-wrap orders-table-wrap">
          <table class="data-table orders-table">
            <thead><tr><th>Заказ</th><th>Статус</th><th>Стол</th><th>Зал</th><th>Официант</th><th>Кассир</th><th>Сумма</th><th>Открыт</th><th>Закрыт</th></tr></thead>
            <tbody id="orders-table-body">${renderOrderRows(rows)}</tbody>
          </table>
        </div>
        ${rows.length > 200 ? `<div class="table-note">Показаны первые 200 заказов.</div>` : ""}
      </div>`;

    resultSummary.querySelectorAll("[data-order-filter]").forEach(button => {
      button.addEventListener("click", () => {
        resultSummary.querySelectorAll("[data-order-filter]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        const filter = button.dataset.orderFilter;
        resultSummary.querySelectorAll("#orders-table-body tr").forEach(row => {
          row.hidden = filter !== "all" && row.dataset.orderState !== filter;
        });
      });
    });
  }

  function tryRenderOrders() {
    if (actionSelect.value !== "get_orders") return;
    try {
      const response = JSON.parse(resultOutput.textContent || "{}");
      if (!response.success) return;
      const data = response.data;
      const find = (value, depth = 0) => {
        if (depth > 6 || value == null) return null;
        if (Array.isArray(value)) return value.filter(item => item && typeof item === "object");
        if (typeof value !== "object") return null;
        for (const key of ["items","rows","orders","data","result","records","report"]) {
          if (value[key] !== undefined) {
            const found = find(value[key], depth + 1);
            if (found && found.length) return found;
          }
        }
        for (const child of Object.values(value)) {
          const found = find(child, depth + 1);
          if (found && found.length) return found;
        }
        return null;
      };
      const rows = find(data);
      if (rows && rows.length) renderOrders(rows);
    } catch (_) {}
  }

  const observer = new MutationObserver(tryRenderOrders);
  observer.observe(resultOutput, { childList: true, characterData: true, subtree: true });
  actionSelect.addEventListener("change", () => setTimeout(tryRenderOrders, 250));
  setInterval(tryRenderOrders, 1000);
})();
