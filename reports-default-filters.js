(function () {
    "use strict";

    // Transport enforcement now lives in functions/api/iiko/_middleware.js.
    // This file only shows the two mandatory system filters in the UI.
    function renderSystemFilters() {
        const container = document.getElementById("olap-filters");
        if (!container || container.querySelector("[data-system-olap-filters=\"1\"]")) return;

        const html = `
            <div class="olap-filter-item" data-system-olap-filters="1">
                <div>
                    <strong>Блюдо удалено</strong>
                    <small>Включено • Блюдо не удалено</small>
                </div>
                <span aria-hidden="true">✓</span>
            </div>
            <div class="olap-filter-item" data-system-olap-filters="1">
                <div>
                    <strong>Заказ удален</strong>
                    <small>Включено • Заказ не удален</small>
                </div>
                <span aria-hidden="true">✓</span>
            </div>`;

        container.insertAdjacentHTML("afterbegin", html);
    }

    function init() {
        renderSystemFilters();
        const observer = new MutationObserver(renderSystemFilters);
        observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init, { once: true });
    } else {
        init();
    }
})();
