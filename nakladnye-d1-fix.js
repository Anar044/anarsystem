(() => {
  'use strict';
  let replay = false;

  async function handle(event) {
    const btn = event.target?.closest?.('#invoice-load');
    if (!btn || replay) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    try {
      if (!window.SH_IikoContext?.get) {
        throw new Error('Единый iiko-контекст D1 не загружен. Обновите страницу.');
      }
      const state = await window.SH_IikoContext.get();
      const connection = state?.connection || null;
      const identity = state?.identity || null;
      if (!connection?.ip || !connection?.port || !connection?.login || !connection?.password) {
        throw new Error('Не найдено сохранённое подключение к iiko Server в D1. Откройте «Настройки» и подключитесь.');
      }

      // unified bridge keeps these values in memory only; nothing is persisted to browser storage.
      localStorage.setItem('iikoConnection', JSON.stringify(connection));
      localStorage.setItem('iikoDepartmentIdentity', JSON.stringify(identity || {}));

      replay = true;
      btn.click();
      replay = false;
    } catch (error) {
      replay = false;
      const status = document.getElementById('invoice-status');
      if (status) {
        status.textContent = error?.message || String(error);
        status.className = 'invoice-status error';
      }
    }
  }

  document.addEventListener('click', handle, true);
})();
