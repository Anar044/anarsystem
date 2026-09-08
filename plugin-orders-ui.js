(() => {
  const resultSummary = document.getElementById("result-summary");
  if (!resultSummary) return;

  const style = document.createElement("style");
  style.textContent = `
    #result-summary:has(.orders-dashboard) .cash-result{display:none!important}
    #result-summary:has(.orders-dashboard) .cash-result-panel{display:none!important}
    .orders-dashboard{width:100%;padding-top:2px}.orders-table-wrap{border:0!important;background:transparent!important;overflow-x:auto!important;padding:0!important}.orders-table{border-collapse:separate!important;border-spacing:0 5px!important;table-layout:fixed!important}.orders-table thead th{padding:9px 12px!important;color:#718294!important;font-size:8px!important;letter-spacing:.09em!important;font-weight:850!important;border:0!important;background:transparent!important}.orders-table tbody tr{height:54px!important}.orders-table tbody td{padding:10px 12px!important;background:#101923!important;border-top:1px solid #202d3a!important;border-bottom:1px solid #202d3a!important;font-size:11px!important;line-height:1.25!important}.orders-table tbody td:first-child{border-left:1px solid #202d3a!important;border-radius:10px 0 0 10px!important}.orders-table tbody td:last-child{border-right:1px solid #202d3a!important;border-radius:0 10px 10px 0!important}.orders-table tbody tr:hover td{background:#14221f!important;border-color:#294c3e!important}.orders-table td:nth-child(1) strong{font-size:12px!important;font-weight:850!important}.orders-table td:nth-child(2){white-space:nowrap!important}.orders-table td:nth-child(3),.orders-table td:nth-child(5),.orders-table td:nth-child(7),.orders-table td:nth-child(11){white-space:nowrap!important;overflow:hidden!important;text-overflow:ellipsis!important}.orders-table td:nth-child(7){font-weight:800!important}.orders-table td:nth-child(8),.orders-table td:nth-child(10){color:#aab7c4!important;font-size:10px!important}.orders-stats{margin-bottom:13px!important}.order-stat{min-height:72px!important;padding:12px 14px!important;border-radius:12px!important}.order-stat span{font-size:8px!important}.order-stat strong{font-size:21px!important}.orders-toolbar{margin-bottom:8px!important}.orders-toolbar strong{font-size:11px!important}.orders-toolbar span{font-size:9px!important}.order-action-button{display:block!important;appearance:none!important;border:1px solid rgba(66,211,146,.34)!important;background:rgba(66,211,146,.07)!important;color:var(--pc-green)!important;font:inherit!important;font-size:8px!important;font-weight:850!important;line-height:1!important;padding:6px 8px!important;border-radius:7px!important;cursor:pointer!important;white-space:nowrap!important;transition:.15s ease!important;margin-top:5px!important}.order-action-button:hover{background:rgba(66,211,146,.16)!important;border-color:var(--pc-green)!important;transform:translateY(-1px)!important}.order-action-button:active{transform:translateY(0)!important}
    @media(max-width:900px){.orders-table tbody td{padding:9px 10px!important}.orders-table thead th{padding:8px 10px!important}}
  `;
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