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

  function renderPublished(url) {
    url = String(url || '').trim();
    if (!url) return;

    ensureStyles();
    const qrbox = document.getElementById('qrbox');
    const panel = ensureResultPanel();
    if (!qrbox || !panel) return;

    qrbox.innerHTML = '';
    if (window.QRCode) {
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

    panel.innerHTML = `
      <div class="qr-publish-title">Меню опубликовано</div>
      <input class="qr-publish-link" type="text" readonly value="${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">
      <div class="qr-publish-actions">
        <button type="button" class="primary" data-copy-public-link>Копировать ссылку</button>
        <a href="${url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" target="_blank" rel="noopener">Открыть меню</a>
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
      renderPublished(data.publicUrl);
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
    if (state?.publicUrl) renderPublished(state.publicUrl);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', restorePublishedResult, { once: true });
  } else {
    restorePublishedResult();
  }

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('#publishBtn');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    publish(button);
  }, true);
})();
