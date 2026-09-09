(function () {
    "use strict";

    // System defaults for SALES OLAP. These mirror the iiko report filters:
    // show only non-deleted dishes and non-deleted orders.
    const DEFAULT_FILTERS = {
        DeletedWithWriteoff: {
            filterType: "IncludeValues",
            values: ["NOT_DELETED"]
        },
        OrderDeleted: {
            filterType: "IncludeValues",
            values: ["NOT_DELETED"]
        }
    };

    const originalFetch = window.fetch.bind(window);

    function mergeDefaultFilters(filters) {
        const merged = filters && typeof filters === "object" && !Array.isArray(filters)
            ? { ...filters }
            : {};

        for (const [field, rule] of Object.entries(DEFAULT_FILTERS)) {
            // User-defined filters for these fields take precedence.
            if (!Object.prototype.hasOwnProperty.call(merged, field)) {
                merged[field] = {
                    filterType: rule.filterType,
                    values: [...rule.values]
                };
            }
        }

        return merged;
    }

    // Do not touch OLAP construction/calculation code. Add the two mandatory
    // defaults only at the transport boundary immediately before the request.
    window.fetch = async function (input, init) {
        const url = typeof input === "string" ? input : (input?.url || "");

        if (url.includes("/api/iiko/olap") && init && typeof init.body === "string") {
            try {
                const body = JSON.parse(init.body);
                if (body.action === "query") {
                    body.filters = mergeDefaultFilters(body.filters);
                    init = { ...init, body: JSON.stringify(body) };
                }
            } catch (error) {
                console.warn("[OLAP default filters] Request was not changed:", error);
            }
        }

        return originalFetch(input, init);
    };

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
