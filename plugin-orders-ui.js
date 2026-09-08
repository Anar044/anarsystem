(() => {
  const resultSummary = document.getElementById('result-summary');
  if (!resultSummary) return;

  const style = document.createElement('style');
  style.textContent = `
    /* Orders are rendered by plugin-orders.js. This file is visual-only. */
    .connected-panel,.request-panel{display:none!important}
    .result-panel{display:none!important}
    #cash-visible-result #result-summary{display:block!important}
    #cash-visible-result .orders-dashboard{display:block!important}
    #cash-visible-result .orders-table-wrap{width:100%!important}
    #cash-visible-result .orders-table tbody tr{cursor:pointer!important}
    #cash-visible-result .orders-table tbody tr:hover td{background:#13221f!important}
    .order-action-button{appearance:none;border:1px solid rgba(66,211,146,.30);background:rgba(66,211,146,.08);color:#42d392;font:inherit;font-size:8px;font-weight:850;line-height:1;padding:5px 7px;border-radius:7px;cursor:pointer;white-space:nowrap;margin-left:7px}
    .order-action-button:hover{background:rgba(66,211,146,.16);border-color:#42d392}
    @media(max-width:700px){.order-action-button{font-size:8px;padding:5px 6px}}
  `;
  document.head.appendChild(style);

  const decorate = () => {
    resultSummary.querySelectorAll('.orders-table tbody tr').forEach(row => {
      if (row.querySelector('.order-action-button')) return;
      const first = row.querySelector('td:first-child');
      if (!first) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'order-action-button';
      button.textContent = 'Открыть ↗';
      button.title = 'Открыть заказ';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        row.click();
      });
      first.appendChild(button);
    });
  };

  new MutationObserver(decorate).observe(resultSummary,{childList:true,subtree:true});
  decorate();
})();