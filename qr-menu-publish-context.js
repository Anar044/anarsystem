(() => {
  'use strict';

  const MENU_KEY = 'horeca_qr_menu_v1';
  let publishing = false;

  function readMenuState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MENU_KEY) || 'null');
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveMenuState(state) {
    try { localStorage.setItem(MENU_KEY, JSON.stringify(state)); } catch (_) {}
  }

  async function accessToken() {
    if (!window.SHAuth?.createClient) throw new Error('SH Auth не готов');
    const client = await window.SHAuth.createClient();
    if (!client) throw new Error('Supabase Auth не настроен');
    const { data, error } = await client.auth.getSession();
    const token = data?.session?.access_token;
    if (error || !token) throw new Error('Сессия пользователя не найдена');
    return token;
  }

  async function publish(button) {
    if (publishing) return;
    publishing = true;
    const oldText = button.textContent;
    button.disabled = true;
    button.textContent = 'Публикация...';

    try {
      if (!window.SH_IikoContext?.getBinding) {
        throw new Error('Единое подключение SH Server не готово. Обновите страницу.');
      }
      const binding = await window.SH_IikoContext.getBinding(true);
      if (!binding?.connection) {
        throw new Error('Подключение SH Server не настроено. Откройте «Настройки».');
      }

      const state = readMenuState();
      if (!state || !Array.isArray(state.categories) || !Array.isArray(state.dishes)) {
        throw new Error('Данные QR Menu не найдены. Обновите страницу и попробуйте снова.');
      }

      const token = await accessToken();
      const response = await fetch('/api/qr-menu/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          departmentIds: binding.departmentIds || [],
          restaurantName: state.design?.name || binding.identity?.restaurantName || binding.identity?.displayName || 'Мой ресторан',
          menu: {
            categories: state.categories,
            dishes: state.dishes,
            design: state.design || {}
          }
        })
      });

      const data = await response.json().catch(() => ({ success: false, message: 'Некорректный ответ API' }));
      if (!response.ok || !data.success) throw new Error(data.message || `HTTP ${response.status}`);

      state.publicUrl = data.publicUrl;
      state.organizationId = data.organizationId;
      saveMenuState(state);
      alert(`Меню опубликовано!\n${data.publicUrl || ''}`);
    } catch (error) {
      alert(`Ошибка публикации:\n${error?.message || error}`);
    } finally {
      publishing = false;
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  // Capture phase intentionally runs before the legacy QR Menu click handler.
  // This is an explicit controller for one action, not a fetch/DOM monkey patch.
  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#publishBtn');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    publish(button);
  }, true);
})();
