(function () {
    "use strict";

    const IKOO_KEYS = new Set(["iikoConnection", "iikoDepartmentIdentity"]);
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
            if (isTargetStorage(this) && IKOO_KEYS.has(String(key))) {
                const value = shadow[String(key)];
                return value == null ? null : JSON.stringify(value);
            }
            return originalGetItem.call(this, key);
        };

        Storage.prototype.setItem = function (key, value) {
            if (isTargetStorage(this) && IKOO_KEYS.has(String(key))) {
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
            if (isTargetStorage(this) && IKOO_KEYS.has(String(key))) {
                shadow[String(key)] = null;
                return;
            }
            return originalRemoveItem.call(this, key);
        };
    }

    async function getD1State() {
        const config = window.SH_AUTH_CONFIG || {};
        if (!config.url || !config.publishableKey || !window.supabase?.createClient) {
            throw new Error("Supabase Auth не готов");
        }

        const client = window.supabase.createClient(config.url, config.publishableKey, {
            auth: {
                persistSession: false,
                autoRefreshToken: false,
                detectSessionInUrl: false
            }
        });

        const { data: sessionData, error: sessionError } = await client.auth.getSession();
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
        const script = document.createElement("script");
        script.src = "reports.js?v=20260910-8";
        script.dataset.d1Loader = "1";
        script.onerror = () => console.error("Не удалось загрузить reports.js");
        document.body.appendChild(script);
    }

    async function init() {
        try {
            const data = await getD1State();
            shadow.iikoConnection = data?.connection || null;
            shadow.iikoDepartmentIdentity = data?.identity || null;
            window.SH_IikoD1 = {
                connection: shadow.iikoConnection,
                identity: shadow.iikoDepartmentIdentity
            };
        } catch (error) {
            console.warn("[reports-d1] Не удалось загрузить SH Server из D1:", error);
            window.SH_IikoD1 = { connection: null, identity: null, error: error?.message || String(error) };
        }

        patchStorage();
        injectReportsScript();
    }

    init();
})();
