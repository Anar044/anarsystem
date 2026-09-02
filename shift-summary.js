(() => {
  "use strict";

  const closedEl = document.getElementById("shift-closed-sum");
  const openEl = document.getElementById("shift-open-sum");
  const expectedEl = document.getElementById("shift-expected-sum");
  const statusEl = document.getElementById("shift-summary-status");
  if (!closedEl || !openEl || !expectedEl) return;

  const API = "/api/plugin/request";
  const REFRESH_MS = 10000;
  let inFlight = false;

  const money = value => Number(value || 0).toLocaleString("ru-RU", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });

  const title = document.querySelector(".shift-summary-panel .panel-title");
  if (title) title.textContent = "Сводка текущей смены";

  function scalar(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value !== "object") return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = scalar(item);
        if (result !== null && result !== "") return result;
      }
      return null;
    }
    for (const key of ["name", "title", "value", "number", "code", "id"]) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const result = scalar(value[key]);
        if (result !== null && result !== "") return result;
      }
    }
    return null;
  }

  function directValue(object, names) {
    if (!object || typeof object !== "object" || Array.isArray(object)) return null;
    const wanted = new Set(names.map(name => String(name).toLowerCase()));
    for (const [key, value] of Object.entries(object)) {
      if (wanted.has(String(key).toLowerCase()) && value !== null && value !== undefined && value !== "") return value;
    }
    return null;
  }

  function deepValue(object, names, depth = 0) {
    if (object === null || object === undefined || typeof object !== "object" || depth > 12) return null;
    const direct = directValue(object, names);
    if (direct !== null) return direct;
    if (Array.isArray(object)) {
      for (const item of object) {
        const found = deepValue(item, names, depth + 1);
        if (found !== null && found !== undefined && found !== "") return found;
      }
      return null;
    }
    for (const child of Object.values(object)) {
      const found = deepValue(child, names, depth + 1);
      if (found !== null && found !== undefined && found !== "") return found;
    }
    return null;
  }

  function amount(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    if (value === null || value === undefined || value === "") return NaN;
    if (typeof value === "object") return amount(directValue(value, ["value", "amount", "sum", "total", "revenue"]));

    let text = String(value).trim().replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
    if (text.includes(",") && text.includes(".")) {
      if (text.lastIndexOf(",") > text.lastIndexOf(".")) text = text.replace(/\./g, "").replace(",", ".");
      else text = text.replace(/,/g, "");
    } else if (text.includes(",")) {
      text = text.replace(",", ".");
    }
    const result = Number(text);
    return Number.isFinite(result) ? result : NaN;
  }

  function orderAmount(row) {
    // Prefer the order-level total. Never take a nested dish/item sum first.
    const names = [
      "orderExpectedRevenue", "OrderExpectedRevenue",
      "orderSum", "OrderSum", "revenue", "Revenue",
      "resultSum", "ResultSum", "total", "Total",
      "sum", "Sum", "amount", "Amount"
    ];
    const direct = amount(directValue(row, names));
    if (Number.isFinite(direct)) return direct;
    return amount(scalar(deepValue(row, names)));
  }

  function orderNumber(row) {
    const names = ["orderNum", "OrderNum", "orderNumber", "OrderNumber", "orderNo", "OrderNo"];
    return scalar(directValue(row, names) ?? deepValue(row, names));
  }

  function orderState(row) {
    const statusNames = [
      "orderStatus", "OrderStatus", "status", "Status",
      "state", "State", "orderState", "OrderState",
      "statusName", "StatusName"
    ];
    const raw = scalar(directValue(row, statusNames) ?? deepValue(row, statusNames));
    const status = String(raw ?? "").trim().toLowerCase();

    if (/(closed|close|completed|complete|paid|закрыт|закрыто|оплачен|заверш)/.test(status)) return "closed";
    if (/(open|opened|active|new|bill|открыт|открыто|актив|новый|пречек)/.test(status)) return "open";

    const flag = directValue(row, ["isClosed", "IsClosed", "closed", "Closed", "isClosedOrder", "IsClosedOrder"]);
    if (flag === true || String(flag).toLowerCase() === "true") return "closed";
    if (flag === false || String(flag).toLowerCase() === "false") return "open";

    if (directValue(row, ["closeTime", "CloseTime", "orderCloseTime", "OrderCloseTime", "closedAt", "ClosedAt", "closingTime", "ClosingTime", "closeDate", "CloseDate"])) return "closed";
    if (directValue(row, ["openTime", "OpenTime", "orderOpenDate", "OrderOpenDate", "openedAt", "OpenedAt", "openingTime", "OpeningTime", "openDate", "OpenDate"])) return "open";

    return "unknown";
  }

  function looksLikeOrder(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const number = orderNumber(value);
    const total = orderAmount(value);
    const state = orderState(value);
    return number !== null && number !== undefined && number !== "" && (Number.isFinite(total) || state !== "unknown");
  }

  function collectOrders(value, result = [], seen = new WeakSet(), depth = 0) {
    if (value === null || value === undefined || typeof value !== "object" || depth > 15) return result;
    if (seen.has(value)) return result;
    seen.add(value);

    if (looksLikeOrder(value)) {
      result.push(value);
      return result;
    }

    if (Array.isArray(value)) {
      for (const item of value) collectOrders(item, result, seen, depth + 1);
    } else {
      for (const child of Object.values(value)) collectOrders(child, result, seen, depth + 1);
    }
    return result;
  }

  function chooseOrder(existing, candidate) {
    if (!existing) return candidate;
    const oldState = orderState(existing);
    const newState = orderState(candidate);
    const oldAmount = orderAmount(existing);
    const newAmount = orderAmount(candidate);

    if (oldState !== "closed" && newState === "closed") return candidate;
    if (!Number.isFinite(oldAmount) && Number.isFinite(newAmount)) return candidate;
    return existing;
  }

  function buildOrders(payload) {
    let data = payload;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (_) {}
    }

    const map = new Map();
    for (const row of collectOrders(data)) {
      const number = orderNumber(row);
      if (number === null || number === undefined || number === "") continue;
      const key = String(number);
      map.set(key, chooseOrder(map.get(key), row));
    }
    return [...map.values()];
  }

  function render(closed, open, closedCount, openCount, unknownCount) {
    closedEl.textContent = money(closed);
    openEl.textContent = money(open);
    expectedEl.textContent = money(closed + open);
    statusEl.textContent = unknownCount
      ? `По всем заказам · ${closedCount} закрытых / ${openCount} открытых · ${unknownCount} без статуса`
      : `По всем заказам · ${closedCount} закрытых / ${openCount} открытых`;
  }

  async function refresh() {
    const pluginId = document.querySelector("#plugin-select")?.value;
    if (!pluginId || inFlight) return;
    inFlight = true;

    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "get_orders", pluginId, params: {} })
      });

      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || json.message || `HTTP ${response.status}`);

      const orders = buildOrders(json.data);
      let closed = 0, open = 0, closedCount = 0, openCount = 0, unknownCount = 0;

      for (const row of orders) {
        const total = orderAmount(row);
        if (!Number.isFinite(total)) continue;
        const state = orderState(row);
        if (state === "closed") { closed += total; closedCount++; }
        else if (state === "open") { open += total; openCount++; }
        else unknownCount++;
      }

      render(closed, open, closedCount, openCount, unknownCount);
    } catch (error) {
      console.error("SHIFT SUMMARY ERROR", error);
      statusEl.textContent = "Не удалось обновить данные кассы";
    } finally {
      inFlight = false;
    }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
})();
