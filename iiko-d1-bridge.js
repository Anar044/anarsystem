(function () {
  "use strict";

  async function binding() {
    if (!window.SH_IikoContext?.getBinding) return { departmentIds: [], server: null, connection: null, identity: null };
    return window.SH_IikoContext.getBinding();
  }

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

  window.SHIikoD1 = {
    load: force => window.SH_IikoContext?.load(force),
    get: () => window.SH_IikoContext?.get(),
    binding
  };
})();
