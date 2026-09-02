(() => {
  const actionSelect = document.getElementById("action-select");
  const resultSummary = document.getElementById("result-summary");
  const resultOutput = document.getElementById("result-output");
  if (!actionSelect || !resultSummary || !resultOutput) return;

  const style = document.createElement("style");
  style.textContent = `.orders-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}.order-stat{appearance:none;border:1px solid var(--line);border-radius:14px;background:var(--surface2);padding:13px 15px;text-align:left;color:inherit;cursor:pointer;transition:.16s}.order-stat:hover,.order-stat.active{border-color:var(--pc-green);background:var(--pc-green-soft);transform:translateY(-1px)}.order-stat span{display:block;font-size:9px;color:var(--muted);font-weight:800;text-transform:uppercase;letter-spacing:.07em}.order-stat strong{display:block;font-size:22px;margin-top:4px}.order-stat.open strong{color:var(--pc-green)}.order-stat.closed strong{color:var(--pc-red,#ff6b6b)}.order-stat.cash strong{color:#66d9a3}.order-stat.card strong{color:#75a7ff}.orders-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;margin:4px 0 10px}.orders-toolbar strong{font-size:12px}.orders-toolbar span{display:block;color:var(--muted);font-size:10px;margin-top:3px}.orders-live{display:flex!important;align-items:center;gap:6px;color:var(--pc-green)!important}.orders-live i{width:6px;height:6px;border-radius:50%;background:var(--pc-green);display:inline-block}.order-state{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;font-size:9px;font-weight:850}.order-state.open{background:var(--pc-green-soft);color:var(--pc-green)}.order-state.closed{background:rgba(255,107,107,.1);color:var(--pc-red,#ff6b6b)}.order-state.unknown{background:var(--surface2);color:var(--muted)}.payment-badge{display:inline-flex;align-items:center;padding:5px 8px;border-radius:999px;background:var(--surface2);font-size:9px;font-weight:750;white-space:nowrap}.orders-table td{vertical-align:middle}.orders-table tr[hidden]{display:none}@media(max-width:1050px){.orders-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.orders-table-wrap{overflow-x:auto}.orders-table{min-width:980px}}@media(max-width:500px){.orders-stats{grid-template-columns:1fr}}`;
  document.head.appendChild(style);

  const escapeHtml = value => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
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
    const status = valueOf(row, ["orderStatus"]);
    const s = text(status);
    if (/(closed|close|completed|complete|paid|закрыт|закрыто|оплачен|заверш)/.test(s)) return "closed";
    if (/(open|opened|active|открыт|открыто|актив)/.test(s)) return "open";
    const closedFlag = valueOf(row, ["isClosed", "closed", "isClosedOrder"]);
    if (closedFlag === true || text(closedFlag) === "true") return "closed";
    if (closedFlag === false || text(closedFlag) === "false") return "open";
    if (valueOf(row, ["orderCloseTime", "closeTime", "closedAt", "closingTime", "closeDate"])) return "closed";
    if (valueOf(row, ["orderOpenDate", "openTime", "openedAt", "openingTime", "openDate"])) return "open";
    return "unknown";
  }

  function orderNumber(row, index) { return valueOf(row, ["orderNum", "orderNumber", "number", "orderNo", "num"]) ?? index + 1; }
  function formatDate(value) { if (!value) return "—"; const date = new Date(String(value)); if (Number.isNaN(date.getTime())) return String(value); return date.toLocaleString("ru-RU", {day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); }
  function formatMoney(value) { if (value === null || value === undefined || value === "") return "—"; const n = Number(value); return Number.isFinite(n) ? n.toLocaleString("ru-RU", {minimumFractionDigits:2,maximumFractionDigits:2}) : String(value); }

  function paymentName(row) {
    const value = valueOf(row, ["paymentType","paymentTypeName","paymentMethod","paymentMethodName","paymentName","payType","payTypeName","tenderType","tenderName"]);
    if (!value) return "—";
    const s = text(value);
    if (/(cash|налич)/.test(s)) return "Наличные";
    if (/(card|bank|банков|карточ|карта|visa|master)/.test(s)) return "Банковская карта";
    return String(value);
  }

  function renderOrderRows(rows) {
    return rows.slice(0, 200).map((row, index) => {
      const state = orderState(row);
      const number = orderNumber(row, index);
      const table = valueOf(row, ["orderTables","table","tables","tableName"]);
      const floor = valueOf(row, ["floor","floorName"]);
      const waiter = valueOf(row, ["waiter","waiterName","employee","employeeName"]);
      const cashier = valueOf(row, ["cashier","cashierName"]);
      const amount = valueOf(row, ["orderExpectedRevenue","revenue","sum","total","amount","orderSum"]);
      const opened = valueOf(row, ["orderOpenDate","openTime","openedAt","openingTime","createdAt"]);
      const billed = valueOf(row, ["orderBillTime","billTime","precheckTime"]);
      const closed = valueOf(row, ["orderCloseTime","closeTime","closedAt","closingTime","closedDate"]);
      const payment = paymentName(row);
      const status = state === "closed" ? "Закрыт" : state === "open" ? "Открыт" : "Не определён";
      return `<tr data-order-state="${state}"><td><strong>#${escapeHtml(number)}</strong></td><td><span class="order-state ${state}">${status}</span></td><td>${escapeHtml(table ?? "—")}</td><td>${escapeHtml(floor ?? "—")}</td><td>${escapeHtml(waiter ?? "—")}</td><td>${escapeHtml(cashier ?? "—")}</td><td><strong>${escapeHtml(formatMoney(amount))}</strong></td><td>${escapeHtml(formatDate(opened))}</td><td>${escapeHtml(formatDate(billed))}</td><td>${escapeHtml(formatDate(closed))}</td><td><span class="payment-badge">${escapeHtml(payment)}</span></td></tr>`;
    }).join("");
  }

  function renderOrders(rows) {
    const states = rows.map(orderState);
    const open = states.filter(s => s === "open").length;
    const closed = states.filter(s => s === "closed").length;
    const unknown = states.filter(s => s === "unknown").length;
    const payments = rows.map(paymentName);
    const cash = payments.filter(v => v === "Наличные").length;
    const card = payments.filter(v => v === "Банковская карта").length;

    resultSummary.innerHTML = `<div class="orders-dashboard"><div class="orders-stats"><button type="button" class="order-stat active" data-order-filter="all"><span>Все заказы</span><strong>${rows.length}</strong></button><button type="button" class="order-stat open" data-order-filter="open"><span>Открытые</span><strong>${open}</strong></button><button type="button" class="order-stat closed" data-order-filter="closed"><span>Закрытые</span><strong>${closed}</strong></button><button type="button" class="order-stat cash" data-order-filter="cash"><span>Наличные</span><strong>${cash}</strong></button><button type="button" class="order-stat card" data-order-filter="card"><span>Банковская карта</span><strong>${card}</strong></button>${unknown ? `<button type="button" class="order-stat unknown" data-order-filter="unknown"><span>Без статуса</span><strong>${unknown}</strong></button>` : ""}</div><div class="orders-toolbar"><div><strong>Заказы текущей смены</strong><span>${rows.length} записей · данные напрямую от подключённой кассы</span></div><span class="orders-live"><i></i> обновляется автоматически</span></div><div class="data-table-wrap orders-table-wrap"><table class="data-table orders-table"><thead><tr><th>Заказ</th><th>Статус</th><th>Стол</th><th>Зал</th><th>Официант</th><th>Кассир</th><th>Сумма</th><th>Открыт</th><th>Пречек</th><th>Закрыт</th><th>Оплата</th></tr></thead><tbody id="orders-table-body">${renderOrderRows(rows)}</tbody></table></div>${rows.length > 200 ? `<div class="table-note">Показаны первые 200 заказов.</div>` : ""}</div>`;

    resultSummary.querySelectorAll("[data-order-filter]").forEach(button => {
      button.addEventListener("click", () => {
        resultSummary.querySelectorAll("[data-order-filter]").forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        const filter = button.dataset.orderFilter;
        resultSummary.querySelectorAll("#orders-table-body tr").forEach(row => {
          let visible = filter === "all" || row.dataset.orderState === filter;
          if (filter === "cash" || filter === "card") { const payment = row.querySelector(".payment-badge")?.textContent || ""; visible = filter === "cash" ? payment === "Наличные" : payment === "Банковская карта"; }
          row.hidden = !visible;
        });
      });
    });
  }

  function collectArrays(value, out = [], depth = 0) {
    if (depth > 8 || value == null) return out;
    if (Array.isArray(value)) { const objects = value.filter(item => item && typeof item === "object" && !Array.isArray(item)); if (objects.length) out.push(objects); objects.forEach(item => collectArrays(item, out, depth + 1)); return out; }
    if (typeof value !== "object") return out;
    Object.values(value).forEach(child => collectArrays(child, out, depth + 1));
    return out;
  }
  function orderArrayScore(rows) {
    const keys = ["orderNum","orderOpenDate","orderBillTime","orderCloseTime","orderExpectedRevenue","orderStatus","orderTables","table","tableName","waiter","waiterName","cashier","cashierName","isClosed","closed","status","orderState","openTime","closeTime"];
    return rows.reduce((score,row) => { const lower = Object.keys(row).map(key => key.toLowerCase()); return score + keys.filter(key => lower.includes(key.toLowerCase())).length; }, 0);
  }
  function findRows(value) { const arrays = collectArrays(value); if (!arrays.length) return null; arrays.sort((a,b) => { const scoreA=orderArrayScore(a), scoreB=orderArrayScore(b); if(scoreA!==scoreB) return scoreB-scoreA; return b.length-a.length; }); return arrays[0]; }
  function tryRenderOrders() { if (actionSelect.value !== "get_orders") return; try { const response=JSON.parse(resultOutput.textContent||"{}"); if(!response.success)return; const rows=findRows(response.data); if(rows&&rows.length)renderOrders(rows); } catch(_){} }

  const observer = new MutationObserver(tryRenderOrders);
  observer.observe(resultOutput, {childList:true,characterData:true,subtree:true});
  actionSelect.addEventListener("change", () => setTimeout(tryRenderOrders,250));
  setInterval(tryRenderOrders,1000);
})();
