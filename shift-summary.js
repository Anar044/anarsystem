(() => {
  "use strict";

  const closedEl = document.getElementById("shift-closed-sum");
  const openEl = document.getElementById("shift-open-sum");
  const expectedEl = document.getElementById("shift-expected-sum");
  const statusEl = document.getElementById("shift-summary-status");
  const resultSummary = document.getElementById("result-summary");

  if (!closedEl || !openEl || !expectedEl || !resultSummary) return;

  const money = value => {
    const n = Number(value);
    return Number.isFinite(n)
      ? n.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })
      : "—";
  };

  function normalize(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function number(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    let text = String(value ?? "").replace(/\s/g, "").replace(/[^0-9,.-]/g, "");
    if (text.includes(",") && text.includes(".")) {
      if (text.lastIndexOf(",") > text.lastIndexOf(".")) text = text.replace(/\./g, "").replace(",", ".");
      else text = text.replace(/,/g, "");
    } else if (text.includes(",")) {
      text = text.replace(",", ".");
    }
    const n = Number(text);
    return Number.isFinite(n) ? n : NaN;
  }

  function readSalesMetric(name) {
    const wanted = normalize(name);
    for (const card of resultSummary.querySelectorAll(".cash-result-kpi")) {
      if (normalize(card.querySelector("span")?.textContent) !== wanted) continue;
      const value = number(card.querySelector("strong")?.textContent);
      if (Number.isFinite(value)) return value;
    }
    return NaN;
  }

  function setTextIfChanged(el, value) {
    if (el && el.textContent !== String(value)) el.textContent = value;
  }

  function updateFromSalesReport() {
    const closed = readSalesMetric("closed orders money sum");
    const open = readSalesMetric("open orders money sum");
    const expected = readSalesMetric("expected revenue money sum");
    if (!Number.isFinite(closed) || !Number.isFinite(open) || !Number.isFinite(expected)) return;

    setTextIfChanged(closedEl, money(closed));
    setTextIfChanged(openEl, money(open));
    setTextIfChanged(expectedEl, money(expected));
    setTextIfChanged(statusEl, `Данные из отчёта «Продажи» · ${money(closed)} закрытых / ${money(open)} открытых`);
  }

  function enhancePaymentDetails() {
    for (const panel of resultSummary.querySelectorAll(".cash-result-panel:has(.cash-data-table)")) {
      const title = panel.querySelector(".cash-result-panel-title");
      if (title && title.textContent !== "Детализация оплат") title.textContent = "Детализация оплат";
      panel.querySelectorAll(".cash-data-table tbody tr").forEach(row => {
        const type = row.children[2];
        if (type && type.getAttribute("data-payment-type") !== type.textContent.trim()) {
          type.setAttribute("data-payment-type", type.textContent.trim());
        }
      });
    }
  }

  function update() {
    updateFromSalesReport();
    enhancePaymentDetails();
  }

  update();
  setInterval(update, 1000);
})();
