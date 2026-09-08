(() => {
  const resultSummary = document.getElementById("result-summary");
  if (!resultSummary) return;

  function decorate() {
    resultSummary.querySelectorAll(".orders-table tbody tr").forEach(row => {
      const firstCell = row.querySelector("td:first-child");
      if (!firstCell || firstCell.querySelector(".order-action-button")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "order-action-button order-open-btn";
      button.textContent = "Открыть ↗";
      button.title = "Открыть детали заказа и историю событий";
      firstCell.appendChild(button);
    });
  }

  const observer = new MutationObserver(decorate);
  observer.observe(resultSummary, { childList: true, subtree: true });
  decorate();
})();