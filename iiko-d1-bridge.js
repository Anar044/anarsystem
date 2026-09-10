(function () {
  "use strict";

  const KEYS = new Set(["iikoConnection", "iikoDepartmentIdentity"]);
  const storage = window.localStorage;
  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;
  const shadow = { iikoConnection: null, iikoDepartmentIdentity: null };
  let prepared = false;

  async function binding() {
    if (!window.SH_IikoContext?.getBinding) return { departmentIds: [], server: null, connection: null, identity: null };
    return window.SH_IikoContext.getBinding();
  }

  async function prepare() {
    if (prepared) return;
    try {
      const state = await window.SH_IikoContext?.get?.();
      shadow.iikoConnection = state?.connection || null;
      shadow.iikoDepartmentIdentity = state?.identity || null;
    } catch (error) {
      console.warn("[iiko-d1-bridge] D1 state unavailable", error);
    }
    prepared = true;
  }

  // cash.js still has a compatibility read through localStorage. Keep that API
  // working without persisting iiko credentials in the browser.
  Storage.prototype.getItem = function (key) {
    if (this === storage && KEYS.has(String(key))) {
      const value = shadow[String(key)];
      return value == null ? null : JSON.stringify(value);
    }
    return originalGetItem.call(this, key);
  };
  Storage.prototype.setItem = function (key, value) {
    if (this === storage && KEYS.has(String(key))) return;
    return originalSetItem.call(this, key, value);
  };
  Storage.prototype.removeItem = function (key) {
    if (this === storage && KEYS.has(String(key))) {
      shadow[String(key)] = null;
      return;
    }
    return originalRemoveItem.call(this, key);
  };

  async function bodyBinding() {
    const b = await binding();
    return b.departmentIds.length ? { departmentIds: b.departmentIds } : {};
  }

  const originalFetch = window.fetch.bind(window);

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input?.url || "";
    const path = (() => {
      try { return new URL(url, location.origin).pathname; } catch (_) { return url; }
    })();

    if (path === "/api/plugin/data") {
      const b = await binding();
      const u = new URL(url, location.origin);
      u.searchParams.delete("departmentIds");
      u.searchParams.delete("departmentId");
      u.searchParams.delete("departments");
      u.searchParams.delete("serverUrl");
      if (b.departmentIds.length) u.searchParams.set("departmentIds", b.departmentIds.join(","));
      return originalFetch(u.toString(), init);
    }

    if (path === "/api/plugin/request" && init?.body) {
      try {
        const current = JSON.parse(init.body);
        const extra = await bodyBinding();
        const next = { ...current, ...extra };
        delete next.serverUrl;
        init = { ...init, body: JSON.stringify(next) };
      } catch (_) {}
      return originalFetch(input, init);
    }

    return originalFetch(input, init);
  };

  // Ensure legacy cash.js sees the D1-backed compatibility values before its
  // DOMContentLoaded handler executes.
  const originalAddEventListener = document.addEventListener.bind(document);
  document.addEventListener = function (type, listener, options) {
    if (type === "DOMContentLoaded" && typeof listener === "function") {
      const wrapped = async function (event) {
        await prepare();
        return listener.call(this, event);
      };
      return originalAddEventListener(type, wrapped, options);
    }
    return originalAddEventListener(type, listener, options);
  };

  window.SHIikoD1 = {
    load: async force => {
      if (force) prepared = false;
      await prepare();
      return window.SH_IikoContext?.get?.(force);
    },
    get: () => window.SH_IikoContext?.get?.(),
    binding
  };
})();
