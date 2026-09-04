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
    const closed = readSalesMetric(["closed orders money sum"]);
    const open = readSalesMetric(["open orders money sum"]);
    const expected = readSalesMetric(["expected revenue money sum"]);

    if (!Number.isFinite(closed) || !Number.isFinite(open) || !Number.isFinite(expected)) return false;

    closedEl.textContent = money(closed);
    openEl.textContent = money(open);
    expectedEl.textContent = money(expected);

    statusEl.textContent = `Данные из отчёта «Продажи» · ${money(closed)} закрытых / ${money(open)} открытых`;
    return true;
  }

  function update() {
    if (updateFromSalesReport()) return;
  }

  const observer = new MutationObserver(update);
  observer.observe(resultSummary, { childList: true, subtree: true, characterData: true });

  /* Payment detail presentation — visual only. */
  function ensurePaymentDetailStyle() {
    if (document.getElementById("hc-payment-detail-style")) return;
    const style = document.createElement("style");
    style.id = "hc-payment-detail-style";
    style.textContent = `
      .cash-result-panel:has(.cash-data-table){
        margin-top:16px!important;
        border:1px solid #263746!important;
        border-radius:15px!important;
        background:linear-gradient(145deg,#111c26,#0e161f)!important;
        box-shadow:0 10px 28px rgba(0,0,0,.12)!important;
        overflow:hidden!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-result-panel-head{
        min-height:58px!important;
        padding:13px 16px!important;
        background:linear-gradient(180deg,#14212c,#111a23)!important;
        border-bottom:1px solid #263746!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-result-panel-title{
        display:flex!important;
        align-items:center!important;
        gap:10px!important;
        font-size:15px!important;
        font-weight:850!important;
        color:#f5f8fa!important;
        letter-spacing:-.01em!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-result-panel-title:before{
        content:"₼"!important;
        display:grid!important;
        place-items:center!important;
        width:30px!important;
        height:30px!important;
        border-radius:9px!important;
        background:#152d29!important;
        border:1px solid #285342!important;
        color:#42d392!important;
        font-size:14px!important;
        font-weight:900!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-result-panel-count{
        padding:6px 10px!important;
        border:1px solid #293947!important;
        border-radius:999px!important;
        background:#101a23!important;
        color:#91a0ae!important;
        font-size:10px!important;
        font-weight:750!important;
      }
      .cash-result-panel:has(.cash-data-table)>div[style*="overflow"]{
        overflow:visible!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-data-table{
        border-collapse:separate!important;
        border-spacing:0!important;
        width:100%!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-data-table th{
        height:38px!important;
        padding:0 16px!important;
        background:#0f1821!important;
        color:#738596!important;
        font-size:9px!important;
        font-weight:850!important;
        letter-spacing:.08em!important;
        border-bottom:1px solid #243441!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-data-table td{
        height:52px!important;
        padding:0 16px!important;
        background:#111b25!important;
        color:#e6edf2!important;
        font-size:12px!important;
        font-weight:650!important;
        border-bottom:1px solid #202d39!important;
        transition:background .18s ease,transform .18s ease!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-data-table tbody tr:last-child td{
        border-bottom:0!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-data-table tbody tr:hover td{
        background:#15222d!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-data-table td:nth-child(1){
        font-weight:750!important;
        color:#f2f6f8!important;
        width:52%!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-data-table td:nth-child(1):before{
        content:""!important;
        display:inline-block!important;
        width:7px!important;
        height:7px!important;
        margin-right:9px!important;
        border-radius:50%!important;
        background:#42d392!important;
        box-shadow:0 0 10px rgba(66,211,146,.35)!important;
        vertical-align:middle!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-data-table tbody tr:nth-child(2) td:nth-child(1):before{
        background:#4ca8ff!important;
        box-shadow:0 0 10px rgba(76,168,255,.3)!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-data-table td:nth-child(2){
        width:26%!important;
        color:#42d392!important;
        font-size:14px!important;
        font-weight:850!important;
        font-variant-numeric:tabular-nums!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-data-table td:nth-child(3){
        width:22%!important;
        color:#aab7c3!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-data-table td:nth-child(3){
        font-size:0!important;
      }
      .cash-result-panel:has(.cash-data-table) .cash-data-table td:nth-child(3):after{
        content:attr(data-payment-type)!important;
        display:inline-flex!important;
        align-items:center!important;
        min-height:24px!important;
        padding:0 9px!important;
        border-radius:999px!important;
        background:#16212b!important;
        border:1px solid #2a3947!important;
        color:#a9b7c3!important;
        font-size:9px!important;
        font-weight:800!important;
      }
      @media(max-width:700px){
        .cash-result-panel:has(.cash-data-table) .cash-data-table th,
        .cash-result-panel:has(.cash-data-table) .cash-data-table td{padding:0 11px!important}
        .cash-result-panel:has(.cash-data-table) .cash-data-table td:nth-child(1){width:48%!important}
        .cash-result-panel:has(.cash-data-table) .cash-data-table td:nth-child(2){width:28%!important}
        .cash-result-panel:has(.cash-data-table) .cash-data-table td:nth-child(3){width:24%!important}
      }
    `;
    document.head.appendChild(style);
  }

  function enhancePaymentDetails() {
    ensurePaymentDetailStyle();
    const panels = resultSummary.querySelectorAll(".cash-result-panel:has(.cash-data-table)");
    panels.forEach(panel => {
      const title = panel.querySelector(".cash-result-panel-title");
      if (title) title.textContent = "Детализация оплат";
      panel.querySelectorAll(".cash-data-table tbody tr").forEach(row => {
        const type = row.children[2];
        if (type) type.setAttribute("data-payment-type", type.textContent.trim());
      });
    });
  }

  const paymentObserver = new MutationObserver(enhancePaymentDetails);
  paymentObserver.observe(resultSummary, { childList: true, subtree: true, characterData: true });
  enhancePaymentDetails();

  update();
  setInterval(update, 500);
})();
