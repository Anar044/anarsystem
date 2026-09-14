(() => {
  'use strict';

  const CACHE_TTL_MS = 10000;
  let cache = { expiresAt: 0, binding: null, plugins: [] };
  let pending = null;

  const unwrap = value => {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return value; }
  };

  async function jsonFetch(path, init = {}) {
    const response = await fetch(path, { cache: 'no-store', ...init });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`HTTP ${response.status}: ответ не JSON`); }
    if (!response.ok || (data?.success === false && data?.error)) {
      throw new Error(data?.error || data?.message || `HTTP ${response.status}`);
    }
    return unwrap(data);
  }

  async function getBinding(force = false) {
    if (!window.SH_IikoContext?.getBinding) {
      return { departmentIds: [], restaurants: [], connection: null, identity: null };
    }
    return window.SH_IikoContext.getBinding(force);
  }

  function normalizePlugins(payload, departmentIds) {
    const root = unwrap(payload);
    const list = Array.isArray(root)
      ? root
      : (root?.plugins || root?.data || root?.items || []);
    const allowed = new Set((departmentIds || []).map(String));

    return (Array.isArray(list) ? list : [])
      .map(item => item?.data ? { ...item, ...item.data } : item)
      .filter(item => item?.pluginId)
      .filter(item => !allowed.size || allowed.has(String(item.departmentId)));
  }

  async function refresh(force = false) {
    const now = Date.now();
    if (!force && cache.binding && cache.expiresAt > now) return cache;
    if (!force && pending) return pending;

    pending = (async () => {
      const binding = await getBinding(force);
      const departmentIds = Array.isArray(binding?.departmentIds)
        ? binding.departmentIds.map(String).filter(Boolean)
        : [];

      let plugins = [];
      if (departmentIds.length) {
        const query = new URLSearchParams({ departmentIds: departmentIds.join(',') });
        const payload = await jsonFetch(`/api/plugin/data?${query.toString()}`);
        plugins = normalizePlugins(payload, departmentIds);
      }

      cache = {
        binding,
        plugins,
        expiresAt: Date.now() + CACHE_TTL_MS
      };
      return cache;
    })().finally(() => { pending = null; });

    return pending;
  }

  async function getPlugins(force = false) {
    return (await refresh(force)).plugins;
  }

  async function getPlugin(pluginId, force = false) {
    const id = String(pluginId || '');
    if (!id) return null;
    const plugins = await getPlugins(force);
    return plugins.find(plugin => String(plugin?.pluginId || '') === id) || null;
  }

  async function pluginRequest(inputBody) {
    const body = inputBody && typeof inputBody === 'object' ? { ...inputBody } : {};
    if (!body.pluginId) throw new Error('pluginId is required');

    if (!Array.isArray(body.departmentIds) || !body.departmentIds.length) {
      const plugin = await getPlugin(body.pluginId);
      if (plugin?.departmentId) body.departmentIds = [String(plugin.departmentId)];
    }

    return jsonFetch('/api/plugin/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  async function orderHistory(pluginId, orderNum) {
    const plugin = await getPlugin(pluginId);
    const query = new URLSearchParams({
      pluginId: String(pluginId || ''),
      orderNum: String(orderNum || '')
    });
    if (plugin?.departmentId) query.set('departmentIds', String(plugin.departmentId));
    return jsonFetch(`/api/plugin/order-history?${query.toString()}`);
  }

  function invalidate() {
    cache = { expiresAt: 0, binding: null, plugins: [] };
    pending = null;
  }

  window.addEventListener('sh:iiko-selection-changed', invalidate);
  window.addEventListener('sh:iiko-context-changed', invalidate);

  window.SH_CashContext = {
    getBinding,
    getPlugins,
    getPlugin,
    pluginRequest,
    orderHistory,
    invalidate
  };
})();
