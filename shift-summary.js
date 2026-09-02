(() => {
  const closedEl = document.getElementById("shift-closed-sum");
  const openEl = document.getElementById("shift-open-sum");
  const expectedEl = document.getElementById("shift-expected-sum");
  const statusEl = document.getElementById("shift-summary-status");
  const pluginSelect = document.getElementById("plugin-select");
  if (!closedEl || !openEl || !expectedEl || !pluginSelect) return;

  const API = "/api/plugin/request";
  const REFRESH_MS = 10000;
  let inFlight = false;

  const money = value => Number(value || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 });

  function firstText(value) {
    if (value == null || value === "") return null;
    if (["string", "number", "boolean"].includes(typeof value)) return value;
    if (Array.isArray(value)) {
      for (const item of value) { const v = firstText(item); if (v != null && v !== "") return v; }
      return null;
    }
    for (const key of ["name", "title", "value", "number", "code", "id"]) {
      const v = firstText(value[key]);
      if (v != null && v !== "") return v;
    }
    return null;
  }

  function deepFind(value, names, depth = 0) {
    if (value == null || typeof value !== "object" || depth > 12) return null;
    const wanted = names.map(x => String(x).toLowerCase());
    if (Array.isArray(value)) {
      for (const item of value) { const found = deepFind(item, names, depth + 1); if (found != null && found !== "") return found; }
      return null;
    }
    for (const [key, child] of Object.entries(value)) {
      if (wanted.includes(String(key).toLowerCase()) && child != null && child !== "") return child;
    }
    for (const child of Object.values(value)) {
      const found = deepFind(child, names, depth + 1);
      if (found != null && found !== "") return found;
    }
    return null;
  }

  function findOrderArrays(value, out = [], depth = 0) {
    if (value == null || typeof value !== "object" || depth > 12) return out;
    if (Array.isArray(value)) {
      const objects = value.filter(x => x && typeof x === "object" && !Array.isArray(x));
      if (objects.length) {
        const score = objects.reduce((sum, row) => {
          const keys = Object.keys(row).map(k => k.toLowerCase());
          return sum + ["ordernum", "orderstatus", "orderexpectedrevenue", "revenue", "resultsum", "ordersum"].filter(k => keys.includes(k)).length;
        }, 0);
        if (score > 0) out.push({ rows: objects, score });
      }
      for (const item of value) findOrderArrays(item, out, depth + 1);
      return out;
    }
    for (const child of Object.values(value)) findOrderArrays(child, out, depth + 1);
    return out;
  }

  function parseAmount(row) {
    const raw = firstText(deepFind(row, ["orderExpectedRevenue", "revenue", "resultSum", "orderSum", "sum", "total", "amount"]));
    if (raw == null) return NaN;
    const n = Number(String(raw).replace(/\s/g, "").replace(/[^0-9,.-]/g, "").replace(",", "."));
    return Number.isFinite(n) ? n : NaN;
  }

  function isClosed(row) {
    const status = String(firstText(deepFind(row, ["orderStatus", "status", "state", "orderState", "statusName"])) ?? "").toLowerCase();
    if (/(closed|close|completed|complete|paid|закрыт|закрыто|оплачен|заверш)/.test(status)) return true;
    if (/(open|opened|active|new|новый|открыт|открыто|актив)/.test(status)) return false;
    const closed = deepFind(row, ["isClosed", "closed", "isClosedOrder"]);
    if (closed === true || String(closed).toLowerCase() === "true") return true;
    if (closed === false || String(closed).toLowerCase() === "false") return false;
    return !!deepFind(row, ["closeTime", "orderCloseTime", "closedAt", "closingTime"]);
  }

  function extractRows(data) {
    const arrays = findOrderArrays(data);
    arrays.sort((a, b) => b.score - a.score || b.rows.length - a.rows.length);
    return arrays[0]?.rows || [];
  }

  function render(closed, open, closedCount, openCount) {
    closedEl.textContent = money(closed);
    openEl.textContent = money(open);
    expectedEl.textContent = money(closed + open);
    statusEl.textContent = `По всем заказам · ${closedCount} закрытых / ${openCount} открытых`;
  }

  async function refresh() {
    const pluginId = pluginSelect.value;
    if (!pluginId || inFlight) return;
    inFlight = true;
    try {
      const response = await fetch(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ action: "get_orders", pluginId, params: {} })
      });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || json.message || `HTTP ${response.status}`);
      const rows = extractRows(json.data);
      let closed = 0, open = 0, closedCount = 0, openCount = 0;
      for (const row of rows) {
        const amount = parseAmount(row);
        if (!Number.isFinite(amount)) continue;
        if (isClosed(row)) { closed += amount; closedCount++; }
        else { open += amount; openCount++; }
      }
      render(closed, open, closedCount, openCount);
    } catch (error) {
      statusEl.textContent = `Не удалось обновить: ${error.message}`;
    } finally {
      inFlight = false;
    }
  }

  refresh();
  setInterval(refresh, REFRESH_MS);
  pluginSelect.addEventListener("change", refresh);
})();
