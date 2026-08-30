/* QR Menu safety fixes
   Keeps iiko/OLAP logic untouched.
   Makes Design + Save Design reliable even if the inline page handler fails.
*/
(function () {
  'use strict';
  const KEY = 'horeca_qr_menu_v1';

  function readState() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; }
    catch (e) { console.error('QR Menu state read error:', e); return {}; }
  }

  function byId(id) { return document.getElementById(id); }
  function value(id) { const el = byId(id); return el ? String(el.value || '') : ''; }
  function checked(id) { const el = byId(id); return !!(el && el.checked); }

  function findSaveButton() {
    return byId('saveDesign') || byId('saveDesignBtn') ||
      [...document.querySelectorAll('button')].find(b =>
        b.textContent.trim().toLowerCase().includes('сохранить дизайн'));
  }

  function saveDesignDirectly() {
    const state = readState();
    state.design = Object.assign({}, state.design || {});

    state.design.name = value('dName').trim() || 'Мой ресторан';
    state.design.tagline = value('dTagline').trim() || 'QR Menu';
    state.design.about = value('dAbout').trim();
    state.design.theme = value('dTheme') || 'light';
    state.design.font = value('dFont') || 'Inter';
    state.design.radius = value('dRadius') || '16px';
    state.design.phone = value('dPhone').trim();
    state.design.address = value('dAddress').trim();
    state.design.hours = value('dHours').trim();
    state.design.social = value('dSocial').trim();
    state.design.wifi = value('dWifi').trim();
    state.design.showPrices = checked('dShowPrices');
    state.design.showDescriptions = checked('dShowDescriptions');
    state.design.showComposition = checked('dShowComposition');
    state.design.showAbout = checked('dShowAbout');
    state.design.showContacts = checked('dShowContacts');

    ['accent', 'text', 'bg', 'surface'].forEach(key => {
      const cap = key.charAt(0).toUpperCase() + key.slice(1);
      const color = byId('d' + cap);
      const text = value('d' + cap + 'Text').trim();
      if (/^#[0-9a-fA-F]{6}$/.test(text)) state.design[key] = text;
      else if (color && /^#[0-9a-fA-F]{6}$/.test(color.value)) state.design[key] = color.value;
    });

    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      localStorage.setItem('horeca_qr_design_v1', JSON.stringify(state.design));
    } catch (e) {
      alert('Не удалось сохранить дизайн: ' + (e.message || e));
      return;
    }

    // Keep the existing page preview in sync immediately.
    const name = byId('previewName');
    const tagline = byId('previewTagline');
    const top = byId('phoneTop');
    const screen = byId('phoneScreen');
    const body = byId('previewBody');
    if (name) name.textContent = state.design.name;
    if (tagline) tagline.textContent = state.design.tagline;
    if (top) top.style.background = state.design.theme === 'dark' ? '#111' : (state.design.accent || '#17231e');
    if (screen) {
      screen.style.fontFamily = state.design.font === 'system' ? 'system-ui' : state.design.font + ',Georgia,serif';
      if (state.design.surface) screen.style.background = state.design.surface;
      if (state.design.text) screen.style.color = state.design.text;
      if (state.design.radius) screen.style.borderRadius = state.design.radius;
    }
    if (body && state.design.bg) body.style.background = state.design.bg;

    const status = byId('saveStatus');
    if (status) status.textContent = '● Дизайн сохранён локально';

    const modal = byId('settingsModal');
    if (modal) {
      modal.classList.remove('show');
      modal.style.display = '';
    }
    alert('Дизайн сохранён. Нажмите «Опубликовать меню», чтобы применить изменения в публичном QR Menu.');
  }

  function bindSave() {
    const save = findSaveButton();
    if (!save || save.dataset.qrSaveFix === '1') return;
    save.dataset.qrSaveFix = '1';
    save.addEventListener('click', function (event) {
      event.preventDefault();
      event.stopImmediatePropagation();
      saveDesignDirectly();
    }, true);
  }

  function initQrMenuFix() {
    const btn = byId('designBtn');
    const modal = byId('settingsModal');
    const close = byId('closeSettings');
    if (!modal) return;

    if (btn) btn.onclick = function (event) {
      event.preventDefault(); event.stopPropagation();
      try { if (typeof window.fillDesignForm === 'function') window.fillDesignForm(); }
      catch (e) { console.error('QR Menu design form error:', e); }
      modal.classList.add('show'); modal.style.display = 'flex';
      setTimeout(bindSave, 0);
    };

    if (close) close.onclick = function (event) {
      event.preventDefault(); event.stopPropagation();
      modal.classList.remove('show'); modal.style.display = '';
    };

    modal.onclick = function (event) {
      if (event.target === modal) { modal.classList.remove('show'); modal.style.display = ''; }
    };

    bindSave();
    setTimeout(bindSave, 250);
    setTimeout(bindSave, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initQrMenuFix, { once: true });
  else initQrMenuFix();
})();
