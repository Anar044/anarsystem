(() => {
  'use strict';

  const CONNECTION_KEY = 'iikoConnection';
  const IDENTITY_KEY = 'iikoDepartmentIdentity';
  let ready = null;

  function setActionState(disabled, title = '') {
    for (const id of ['syncBtn', 'publishBtn']) {
      const button = document.getElementById(id);
      if (!button) continue;
      button.disabled = disabled;
      if (title) button.title = title;
      else button.removeAttribute('title');
    }
  }

  async function prepare(force = false) {
    if (!force && ready) return ready;

    ready = (async () => {
      if (!window.SH_IikoContext?.get) {
        throw new Error('Единый iiko context не готов');
      }

      setActionState(true, 'Загружаем подключение SH Server…');
      const state = await window.SH_IikoContext.get(force);
      const connection = state?.connection || null;
      const identity = state?.identity || null;

      // /api/iiko/state exposes only SERVER_PASSWORD_MARKER here. The real
      // password never enters browser storage; Cloudflare middleware resolves
      // it from D1 when /api/iiko/qr-menu receives the marker.
      if (connection) localStorage.setItem(CONNECTION_KEY, JSON.stringify(connection));
      else localStorage.removeItem(CONNECTION_KEY);

      if (identity) localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
      else localStorage.removeItem(IDENTITY_KEY);

      const usable = Boolean(connection?.ip && connection?.port && connection?.login && connection?.passwordStored !== false && connection?.password);
      setActionState(!usable, usable ? '' : 'Подключите SH Server в разделе «Настройки»');
      return state;
    })().catch(error => {
      ready = null;
      setActionState(false);
      console.warn('[qr-menu-context] cannot prepare iiko compatibility state', error);
      return null;
    });

    return ready;
  }

  window.SH_QRMenuContext = { prepare };
  prepare(false);
  window.addEventListener('sh:iiko-context-changed', () => prepare(true));
})();
