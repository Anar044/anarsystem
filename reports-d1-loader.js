(function () {
    "use strict";

    const IIKO_KEYS = new Set(["iikoConnection", "iikoDepartmentIdentity"]);
    const storage = window.localStorage;
    const originalGetItem = Storage.prototype.getItem;
    const originalSetItem = Storage.prototype.setItem;
    const originalRemoveItem = Storage.prototype.removeItem;

    let shadow = {
        iikoConnection: null,
        iikoDepartmentIdentity: null
    };

    function patchStorage() {
        Storage.prototype.getItem = function (key) {
            if (this === storage && IIKO_KEYS.has(String(key))) {
                const value = shadow[String(key)];
                return value == null ? null : JSON.stringify(value);
            }
            return originalGetItem.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
            if (this === storage && IIKO_KEYS.has(String(key))) {
                try { shadow[String(key)] = JSON.parse(String(value)); }
                catch { shadow[String(key)] = String(value); }
                return;
            }
            return originalSetItem.call(this, key, value);
        };
        Storage.prototype.removeItem = function (key) {
            if (this === storage && IIKO_KEYS.has(String(key))) {
                shadow[String(key)] = null;
                return;
            }
            return originalRemoveItem.call(this, key);
        };
    }

    function finishLoading() {
        const loader = document.getElementById("reports-loading");
        if (!loader) return;
        loader.style.transition = "opacity .18s ease, transform .18s ease";
        loader.style.opacity = "0";
        loader.style.transform = "translateY(4px)";
        window.setTimeout(() => loader.remove(), 190);
    }

    let preparePromise = null;
    async function prepareD1() {
        if (preparePromise) return preparePromise;
        preparePromise = (async () => {
            try {
                if (!window.SH_IikoContext?.get) throw new Error("Единый iiko context не готов");
                const state = await window.SH_IikoContext.get();
                shadow.iikoConnection = state?.connection || null;
                shadow.iikoDepartmentIdentity = state?.identity || null;
                window.SH_IikoD1 = {
                    connection: shadow.iikoConnection,
                    identity: shadow.iikoDepartmentIdentity,
                    state
                };
            } catch (error) {
                // Auth/context may initialize slightly later. Allow the shared context to retry.
                console.warn("[reports-d1] Не удалось загрузить iiko из D1:", error);
                window.SH_IikoD1 = {
                    connection: null,
                    identity: null,
                    error: error?.message || String(error)
                };
            }
            patchStorage();
        })();
        return preparePromise;
    }

    // reports.js, account-sync.js and other page scripts may all register their
    // own DOMContentLoaded handler. The old loader wrapped only the FIRST one,
    // so reports.js could run before the D1 shadow was populated. Wrap every
    // DOMContentLoaded listener and reuse the same bootstrap promise.
    const originalAddEventListener = document.addEventListener.bind(document);
    document.addEventListener = function (type, listener, options) {
        if (type === "DOMContentLoaded" && typeof listener === "function") {
            const wrapped = async function (event) {
                await prepareD1();
                finishLoading();
                return listener.call(this, event);
            };
            return originalAddEventListener(type, wrapped, options);
        }
        return originalAddEventListener(type, listener, options);
    };

    // Start loading immediately as well, so the context is already warm by the
    // time DOMContentLoaded fires.
    prepareD1().catch(() => {});
})();
