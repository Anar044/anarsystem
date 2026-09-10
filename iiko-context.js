(function () {
  "use strict";

  // Единый источник iiko для всех страниц AnarSystem.
  // Подключение хранится в D1 и загружается один раз за открытие страницы.
  // Никаких отдельных форм/авторизаций iiko для вкладок не требуется.

  let promise = null;
  let cache = null;

  async function getClient() {
    if (!window.SHAuth?.createClient) throw new Error("SH Auth не готов");
    const client = await window.SHAuth.createClient();
    if (!client) throw new Error("Supabase Auth не настроен");
    return client;
  }

  async function load(force = false) {
    if (!force && promise) return promise;

    promise = (async () => {
      const client = await getClient();
      const { data, error } = await client.auth.getSession();
      const token = data?.session?.access_token;
      if (error || !token) throw new Error("Сессия пользователя не найдена");

      const response = await fetch("/api/iiko/state", {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${token}`
        },
        cache: "no-store"
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.success === false) {
        throw new Error(result.message || `iiko D1 HTTP ${response.status}`);
      }

      cache = result?.state || null;
      return cache;
    })().catch(error => {
      cache = null;
      throw error;
    });

    return promise;
  }

  function connection(state) {
    return state?.connection || null;
  }

  function identity(state) {
    return state?.identity || null;
  }

  function departmentIds(state) {
    const ids = identity(state)?.departmentIds;
    return Array.isArray(ids)
      ? [...new Set(ids.map(String).map(x => x.trim()).filter(Boolean))]
      : [];
  }

  function server(state) {
    return identity(state)?.server || connection(state)?.server || null;
  }

  async function getConnection(force = false) {
    return connection(await load(force));
  }

  async function getIdentity(force = false) {
    return identity(await load(force));
  }

  async function getBinding(force = false) {
    const state = await load(force);
    return {
      departmentIds: departmentIds(state),
      server: server(state),
      connection: connection(state),
      identity: identity(state)
    };
  }

  window.SH_IikoContext = {
    load,
    get: load,
    getConnection,
    getIdentity,
    getBinding,
    departmentIds: state => departmentIds(state),
    getCached: () => cache
  };
})();
