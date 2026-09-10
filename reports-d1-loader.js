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

    async function getD1State() {
        if (!window.SHAuth || typeof window.SHAuth.createClient !== "function") {
            throw new Error("SH Auth не готов");
        }
        const sb = await window.SHAuth.createClient();
        if (!sb) throw new Error("Supabase Auth не настроен");
        const { data: sessionData, error: sessionError } = await sb.auth.getSession();
        if (sessionError || !sessionData?.session?.access_token) {
            throw new Error("Не удалось получить сессию пользователя");
        }
        const response = await fetch("/api/iiko/state", {
            method: "GET",
            headers: {
                Accept: "application/json",
                Authorization: `Bearer ${sessionData.session.access_token}`
            }
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.success === false) {
            throw new Error(data.message || `D1 HTTP ${response.status}`);
        }
        return data;
    }

    async function prepareD1() {
        try {
            const data = await getD1State();
            const state = data?.state || {};
            shadow.iikoConnection = state.connection || null;
            shadow.iikoDepartmentIdentity = state.identity || null;
            window.SH_IikoD1 = {
                connection: shadow.iikoConnection,
                identity: shadow.iikoDepartmentIdentity
            };
        } catch (error) {
            console.warn("[reports-d1] Не удалось загрузить SH Server из D1:", error);
            window.SH_IikoD1 = {
                connection: null,
                identity: null,
                error: error?.message || String(error)
            };
        }
        patchStorage();
    }

    // reports.js registers its DOMContentLoaded handler after this file.
    // We wrap only the first DOMContentLoaded handler (reports.js), so D1 is
    // loaded before reports.js reads its legacy iikoConnection state.
    const originalAddEventListener = document.addEventListener.bind(document);
    let wrappedReportsReady = false;
    document.addEventListener = function (type, listener, options) {
        if (!wrappedReportsReady && type === "DOMContentLoaded" && typeof listener === "function") {
            wrappedReportsReady = true;
            const wrapped = async function (event) {
                await prepareD1();
                return listener.call(this, event);
            };
            return originalAddEventListener(type, wrapped, options);
        }
        return originalAddEventListener(type, listener, options);
    };
})();
