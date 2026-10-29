(() => {
  'use strict';

  let publishing = false;
  const scriptLoads = new Map();

  function readMenuState() {
    const state = window.SH_QRMenuEditor?.getState?.();
    return state && Array.isArray(state.categories) && Array.isArray(state.dishes) ? state : null;
  }

  function saveMenuState(state) {
    const editor = window.SH_QRMenuEditor;
    if (!editor?.setPublishedInfo) throw new Error('QR Menu ещё не загружено.');
    editor.setPublishedInfo({ publicUrl: state.publicUrl, organizationId: state.organizationId });
  }

  function confirmCurrentRestaurant(binding) {
    const editor = window.SH_QRMenuEditor;
    const scope = editor?.getScope?.();
    if (!scope || !scope.restaurantId) throw new Error('Контекст QR Menu ещё не загружен. Откройте раздел повторно.');
    const mode = String(binding?.identity?.mode || binding?.connection?.connectionType || 'RMS').toUpperCase();
    const ids = [...new Set((binding?.departmentIds || []).map(String).filter(Boolean))].sort();
    if (mode === 'CHAIN' && ids.length !== 1) throw new Error('Для публикации QR Menu выберите ровно один ресторан.');
    const restaurantId = ids[0] || String(binding?.identity?.organizationId || binding?.connection?.organizationId || '').trim();
    if (scope.mode !== mode || String(scope.restaurantId) !== restaurantId ||
        (mode === 'CHAIN' && scope.departmentIds.slice().sort().join(',') !== ids.join(','))) {
      throw new Error('Выбор ресторана изменился. Обновите QR Menu перед публикацией.');
    }
    return editor;
  }

  function loadScript(src, id) {
    if (id && document.getElementById(id)) return Promise.resolve();
    if (scriptLoads.has(src)) return scriptLoads.get(src);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      if (id) script.id = id;
      script.src = src;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Не удалось загрузить ${src}`));
      document.head.appendChild(script);
    }).finally(() => scriptLoads.delete(src));
    scriptLoads.set(src, promise);
    return promise;
  }

  async function ensureSyncController() {
    if (window.SH_QRMenuSyncContextLoaded) return;
    try {
      await loadScript('/qr-menu-sync-context.js?v=20261029-scoped-state1', 'qr-menu-sync-context-loader');
    } catch (error) {
      console.warn('QR Menu sync controller failed to load', error);
    }
  }

  async function ensureQrLibrary() {
    if (window.QRCode) return true;
    try {
      await loadScript('https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js', 'qr-code-library');
      return Boolean(window.QRCode);
    } catch (error) {
      console.warn('QR library failed to load', error);
      return false;
    }
  }

  function ensureStyles() {
    if (document.getElementById('qr-publish-result-style')) return;
    const style = document.createElement('style');
    style.id = 'qr-publish-result-style';
    style.textContent = `
      .qr-publish-result{margin:12px auto 4px;max-width:310px;padding:12px;border:1px solid #2d3946;border-radius:12px;background:#0f171f;color:#dfe6ed}
      .qr-publish-title{font-size:11px;font-weight:800;color:#42d392;margin-bottom:7px;text-transform:uppercase;letter-spacing:.05em}
      .qr-publish-link{display:block;width:100%;padding:9px 10px;border:1px solid #334150;border-radius:9px;background:#0b1219;color:#cbd5df;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .qr-publish-actions{display:flex;gap:7px;margin-top:8px}
      .qr-publish-actions button,.qr-publish-actions a{flex:1;display:inline-flex;align-items:center;justify-content:center;min-height:34px;padding:7px 9px;border:1px solid #334150;border-radius:9px;background:#17212b;color:#e9eff5;text-decoration:none;font:700 11px/1 inherit;cursor:pointer}
      .qr-publish-actions button.primary{background:#42d392;border-color:#42d392;color:#07110c}
      #qrbox canvas,#qrbox img{max-width:100%;height:auto!important;border-radius:8px}
    `;
    document.head.appendChild(style);
  }

  function ensureResultPanel() {
    let panel = document.getElementById('qrPublishResult');
    if (panel) return panel;
    const qrbox = document.getElementById('qrbox');
    if (!qrbox) return null;
    panel = document.createElement('div');
    panel.id = 'qrPublishResult';
    panel.className = 'qr-publish-result';
    qrbox.insertAdjacentElement('afterend', panel);
    return panel;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.focus();
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) {}
      area.remove();
      return ok;
    }
  }

  async function renderPublished(url) {
    url = String(url || '').trim();
    if (!url) return;

    ensureStyles();
    const qrbox = document.getElementById('qrbox');
    const panel = ensureResultPanel();
    if (!qrbox || !panel) return;

    qrbox.innerHTML = '';
    const qrReady = await ensureQrLibrary();
    if (qrReady) {
      try {
        new window.QRCode(qrbox, {
          text: url,
          width: 150,
          height: 150,
          colorDark: '#111111',
          colorLight: '#ffffff',
          correctLevel: window.QRCode.CorrectLevel?.M
        });
      } catch (error) {
        qrbox.textContent = 'QR';
        console.warn('QR generation failed', error);
      }
    } else {
      qrbox.textContent = 'QR';
    }

    const safeUrl = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    panel.innerHTML = `
      <div class="qr-publish-title">Меню опубликовано</div>
      <input class="qr-publish-link" type="text" readonly value="${safeUrl}">
      <div class="qr-publish-actions">
        <button type="button" class="primary" data-copy-public-link>Копировать ссылку</button>
        <a href="${safeUrl}" target="_blank" rel="noopener">Открыть меню</a>
      </div>`;

    const input = panel.querySelector('.qr-publish-link');
    input?.addEventListener('click', () => input.select());

    const copyButton = panel.querySelector('[data-copy-public-link]');
    copyButton?.addEventListener('click', async () => {
      const ok = await copyText(url);
      const old = copyButton.textContent;
      copyButton.textContent = ok ? '✓ Скопировано' : 'Не удалось скопировать';
      setTimeout(() => { copyButton.textContent = old; }, 1600);
    });

    const status = document.getElementById('saveStatus');
    if (status) status.textContent = '● Меню опубликовано';
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
      if (!window.SH_IikoContext?.getBinding) throw new Error('Единое подключение SH Server не готово. Обновите страницу.');
      const binding = await window.SH_IikoContext.getBinding(true);
      if (!binding?.connection) throw new Error('Подключение SH Server не настроено. Откройте «Настройки».');
      const editor = confirmCurrentRestaurant(binding);

      const state = readMenuState();
      if (!state || !Array.isArray(state.categories) || !Array.isArray(state.dishes)) {
        throw new Error('Данные QR Menu не найдены. Обновите страницу и попробуйте снова.');
      }

      // Recheck before publishing so an outdated editor cannot publish a
      // menu for a different selected CHAIN restaurant.
      if (window.SH_QRMenuEditor !== editor) throw new Error('QR Menu переключено на другой ресторан.');
      const latestBinding = await window.SH_IikoContext.getBinding(true);
      confirmCurrentRestaurant(latestBinding);

      const token = await accessToken();
      const response = await (window.SH_IikoContext?.fetchWithTimeout||fetch)('/api/qr-menu/publish', {
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
      }, 90000);

      const data = await response.json().catch(() => ({ success: false, message: 'Некорректный ответ API' }));
      if (!response.ok || !data.success) throw new Error(data.message || `HTTP ${response.status}`);
      if (window.SH_QRMenuEditor !== editor) {
        throw new Error('QR Menu переключено на другой ресторан. Ссылка публикации не сохранена локально.');
      }
      confirmCurrentRestaurant(await window.SH_IikoContext.getBinding(true));

      state.publicUrl = data.publicUrl;
      state.organizationId = data.organizationId;
      saveMenuState(state);
      await renderPublished(data.publicUrl);
    } catch (error) {
      alert(`Ошибка публикации:\n${error?.message || error}`);
    } finally {
      publishing = false;
      button.disabled = false;
      button.textContent = oldText;
    }
  }

  function restorePublishedResult() {
    const state = readMenuState();
    if (state?.publicUrl) renderPublished(state.publicUrl).catch(error => console.warn('Published QR restore failed', error));
  }

  ensureSyncController();

  // Editor initializes asynchronously after restaurant binding is known.
  // Restore only from the active restaurant state, never from the global key.
  window.addEventListener('sh:qr-menu-editor-ready', restorePublishedResult);
  if (window.SH_QRMenuEditor) restorePublishedResult();

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#publishBtn');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    publish(button);
  }, true);
})();
