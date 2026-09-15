(function () {
  "use strict";

  const LEGACY_KEYS = ["iikoConnection", "iikoDepartmentIdentity"];

  // Remove credentials left by old browser-storage builds. The current
  // connection is resolved through SH_IikoContext/D1 and is never restored
  // to localStorage by this adapter.
  for (const key of LEGACY_KEYS) {
    try { window.localStorage.removeItem(key); } catch (_) {}
  }

  function ensureCashContext() {
    if (window.SH_CashContext || document.querySelector('script[data-sh-cash-context]')) return;
    const script = document.createElement('script');
    script.src = '/cash-context.js?v=20260914-1';
    script.async = false;
    script.dataset.shCashContext = '1';
    script.addEventListener('error', () => console.error('[cash-context] Не удалось загрузить cash-context.js'));
    document.head.appendChild(script);
  }

  async function get(force = false) {
    if (!window.SH_IikoContext?.get) return null;
    return window.SH_IikoContext.get(force);
  }

  async function binding(force = false) {
    if (!window.SH_IikoContext?.getBinding) {
      return {
        departmentIds: [],
        restaurants: [],
        server: null,
        connection: null,
        identity: null
      };
    }
    return window.SH_IikoContext.getBinding(force);
  }

  window.SHIikoD1 = {
    load: get,
    get,
    binding
  };

  ensureCashContext();
})();
