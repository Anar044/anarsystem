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
    return String(value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function number(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
    let text = String(value ?? "")
      .replace(/\s/g, "")
      .replace(/[^0-9,.-]/g, "");

    if (text.includes(",") && text.includes(".")) {
      if (text.lastIndexOf(",") > text.lastIndexOf(".")) {
        text = text.replace(/\./g, "").replace(",", ".");
      } else {
        text = text.replace(/,/g, "");
      }
    } else if (text.includes(",")) {
      text = text.replace(",", ".");
    }

    const n = Number(text);
    return Number.isFinite(n) ? n : NaN;
  }

  function readSalesMetric(names) {
    const wanted = names.map(normalize);
    const cards = resultSummary.querySelectorAll(".cash-result-kpi");

    for (const card of cards) {
      const label = normalize(card.querySelector("span")?.textContent);
      if (!wanted.includes(label)) continue;

      const valueText = card.querySelector("strong")?.textContent;
      const value = number(valueText);
      if (Number.isFinite(value)) return value;
    }

    return NaN;
  }

  function updateFromSalesReport() {
    const closed = readSalesMetric([
      "closed orders money sum",
      "closed orders money sum"
    ]);
    const open = readSalesMetric([
      "open orders money sum",
      "open orders money sum"
    ]);
    const expected = readSalesMetric([
      "expected revenue money sum",
      "expected revenue money sum"
    ]);

    if (!Number.isFinite(closed) || !Number.isFinite(open) || !Number.isFinite(expected)) return false;

    closedEl.textContent = money(closed);
    openEl.textContent = money(open);
    expectedEl.textContent = money(expected);

    statusEl.textContent = `Данные из отчёта «Продажи» · ${money(closed)} закрытых / ${money(open)} открытых`;
    return true;
  }

  function update() {
    if (updateFromSalesReport()) return;

    // Keep the summary untouched while another report is being loaded.
    // The values are updated as soon as the Sales result appears.
  }

  const observer = new MutationObserver(update);
  observer.observe(resultSummary, { childList: true, subtree: true, characterData: true });

  update();
  setInterval(update, 500);
})();
