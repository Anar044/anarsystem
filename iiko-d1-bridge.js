(function () {
  "use strict";

  let statePromise = null;

  async function authToken() {
    try {
      if (!window.SHAuth?.createClient) return null;
      const client = await window.SHAuth.createClient();
      if (!client) return null;
      const { data } = await client.auth.getSession();
      return data?.session?.access_token || null;
    } catch (_) {
      return null;
    }
  }

  async function loadState(force = false) {
    if (!force && statePromise) return statePromise;
    statePromise = (async () => {
      const token = await authToken();
      if (!token) return null;
      const response = await fetch("/api/iiko/state", {
        headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      if (!response.ok) throw new Error(`iiko D1 state HTTP ${response.status}`);
      const data = await response.json();
      if (!data.found || !data.state) return null;
      return data.state;
    })();
    return statePromise;
  }

  async function binding() {
    const state = await loadState();
    const identity = state?.identity || {};
    const departments = Array.isArray(identity.departmentIds)
      ? [...new Set(identity.departmentIds.map(String).map(x => x.trim()).filter(Boolean))]
      : [];
    return {
      departmentIds: departments,
      serverUrl: ""
    };
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
        init = { ...init, body: JSON.stringify({ ...current, ...extra, serverUrl: undefined }) };
      } catch (_) {}
      return originalFetch(input, init);
    }

    return originalFetch(input, init);
  };

  window.SHIikoD1 = {
    load: () => loadState(true),
    get: () => loadState(false),
    binding
  };
})();
