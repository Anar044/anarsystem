(() => {
  const resultSummary = document.getElementById("result-summary");
  if (!resultSummary) return;

  const style = document.createElement("style");
  style.textContent = `.order-action-button{appearance:none;border:1px solid rgba(66,211,146,.32);background:rgba(66,211,146,.08);color:var(--pc-green);font:inherit;font-size:9px;font-weight:850;line-height:1;padding:7px 9px;border-radius:8px;cursor:pointer;white-space:nowrap;transition:.15s ease;margin-top:5px}.order-action-button:hover{background:rgba(66,211,146,.16);border-color:var(--pc-green);transform:translateY(-1px)}.order-action-button:active{transform:translateY(0)}.orders-table td:first-child{vertical-align:middle}`;
  document.head.appendChild(style);

  function decorate() {
    resultSummary.querySelectorAll(".orders-table tbody tr").forEach(row => {
      const firstCell = row.querySelector("td:first-child");
      if (!firstCell || firstCell.querySelector(".order-action-button")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "order-action-button";
      button.textContent = "Открыть ↗";
      button.title = "Открыть детали заказа и историю событий";
      firstCell.appendChild(button);
    });
  }

  const observer = new MutationObserver(decorate);
  observer.observe(resultSummary, { childList: true, subtree: true });
  decorate();
})();