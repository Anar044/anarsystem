(function () {
    "use strict";

    // Единое подключение iiko берём напрямую из D1-контекста.
    // Никаких UI-окон восстановления подключения здесь нет.
    const KEYS = new Set(["iikoConnection", "iikoDepartmentIdentity"]);
    const storage = window.localStorage;
    const get0 = Storage.prototype.getItem;
    const set0 = Storage.prototype.setItem;
    const remove0 = Storage.prototype.removeItem;
    const shadow = { iikoConnection: null, iikoDepartmentIdentity: null };

    function patchStorage() {
        Storage.prototype.getItem = function (key) {
            if (this === storage && KEYS.has(String(key))) {
                const value = shadow[String(key)];
                return value == null ? null : JSON.stringify(value);
            }
            return get0.call(this, key);
        };
        Storage.prototype.setItem = function (key, value) {
            if (this === storage && KEYS.has(String(key))) {
                try { shadow[String(key)] = JSON.parse(String(value)); }
                catch { shadow[String(key)] = String(value); }
                return;
            }
            return set0.call(this, key, value);
        };
        Storage.prototype.removeItem = function (key) {
            if (this === storage && KEYS.has(String(key))) {
                shadow[String(key)] = null;
                return;
            }
            return remove0.call(this, key);
        };
    }

    patchStorage();

    let ready = null;
    async function prepare() {
        if (ready) return ready;
        ready = (async () => {
            if (!window.SH_IikoContext?.get) throw new Error("Единый iiko context не готов");
            const state = await window.SH_IikoContext.get();
            shadow.iikoConnection = state?.connection || null;
            shadow.iikoDepartmentIdentity = state?.identity || null;
            window.SH_IikoD1 = { connection: shadow.iikoConnection, identity: shadow.iikoDepartmentIdentity, state };
            return state;
        })().catch(error => {
            ready = null;
            throw error;
        });
        return ready;
    }

    // Начинаем запрос сразу, пока браузер строит DOM.
    prepare().catch(error => console.warn("[reports-context] iiko D1 unavailable:", error));

    // reports.js должен получить D1-подключение до своего init,
    // но пользователю никакое окно загрузки не показываем.
    const add0 = document.addEventListener.bind(document);
    document.addEventListener = function (type, listener, options) {
        if (type === "DOMContentLoaded" && typeof listener === "function") {
            return add0(type, async function (event) {
                try { await prepare(); }
                catch (error) { console.warn("[reports-context]", error); }
                return listener.call(this, event);
            }, options);
        }
        return add0(type, listener, options);
    };

    window.SH_ReportsContext = { prepare };
})();
