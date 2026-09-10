(() => {
  'use strict';

  let replay = false;

  async function syncFromD1(event) {
    const btn = event.target?.closest?.('#syncBtn');
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

      // qr-menu.js уже содержит рабочую синхронизацию. Передаём ей
      // актуальное состояние D1 через единый in-memory compatibility bridge.
      localStorage.setItem('iikoConnection', JSON.stringify(connection));
      localStorage.setItem('iikoDepartmentIdentity', JSON.stringify(identity || {}));

      replay = true;
      btn.click();
      replay = false;
    } catch (error) {
      replay = false;
      alert(`Не удалось синхронизировать меню iiko:\n${error?.message || error}`);
    }
  }

  document.addEventListener('click', syncFromD1, true);
})();
