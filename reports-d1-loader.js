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

    function isTargetStorage(instance) {
        return instance === storage;
    }

    function patchStorage() {
        Storage.prototype.getItem = function (key) {
            if (isTargetStorage(this) && IIKO_KEYS.has(String(key))) {
                const value = shadow[String(key)];
                return value == null ? null : JSON.stringify(value);
            }
            return originalGetItem.call(this, key);
        };

        Storage.prototype.setItem = function (key, value) {
            if (isTargetStorage(this) && IIKO_KEYS.has(String(key))) {
                try {
                    shadow[String(key)] = JSON.parse(String(value));
                } catch {
                    shadow[String(key)] = String(value);
                }
                return;
            }
            return originalSetItem.call(this, key, value);
        };

        Storage.prototype.removeItem = function (key) {
            if (isTargetStorage(this) && IIKO_KEYS.has(String(key))) {
                shadow[String(key)] = null;
                return;
            }
            return originalRemoveItem.call(this, key);
        };
    }

    async function getD1State() {
        // IMPORTANT: reuse the authenticated Supabase client created by auth.js.
        // Creating a second client with persistSession:false loses the existing session.
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

    function injectReportsScript() {
        // reports.js is intentionally loaded only after D1 state is ready,
        // so its legacy localStorage reads receive a temporary in-memory value.
        const script = document.createElement("script");
        script.src = "reports.js?v=20260910-9";
        script.dataset.d1Loader = "1";
        script.onload = () => {
            window.dispatchEvent(new CustomEvent("sh-reports-d1-ready", {
                detail: window.SH_IikoD1
            }));
        };
        script.onerror = () => console.error("Не удалось загрузить reports.js");
        document.body.appendChild(script);
    }

    async function init() {
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
        injectReportsScript();
    }

    init();
})();
