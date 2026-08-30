/* QR Menu safety fixes
   Keeps iiko/OLAP logic untouched.
   Makes Design + Save Design reliable even if the inline page handler fails.
*/
(function () {
  const KEY = 'horeca_qr_menu_v1';

  function readState() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || 'null') || null;
    } catch (e) {
      console.error('QR Menu state read error:', e);
      return null;
    }
  }

  function saveDesignDirectly() {
    const state = readState();
    if (!state) {
      alert('Не удалось прочитать настройки QR Menu. Обновите страницу и попробуйте снова.');
      return;
    }

    state.design = Object.assign({}, state.design || {});

    const value = id => {
      const el = document.getElementById(id);
      return el ? el.value : '';
    };
    const checked = id => {
      const el = document.getElementById(id);
      return !!(el && el.checked);
    };

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
      const text = value('d' + key.charAt(0).toUpperCase() + key.slice(1) + 'Text').trim();
      const color = document.getElementById('d' + key.charAt(0).toUpperCase() + key.slice(1));
      if (/^#[0-9a-fA-F]{6}$/.test(text)) {
        state.design[key] = text;
        if (color) color.value = text;
      } else if (color && /^#[0-9a-fA-F]{6}$/.test(color.value)) {
        state.design[key] = color.value;
      }
    });

    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      alert('Не удалось сохранить дизайн: ' + (e.message || e));
      return;
    }

    const modal = document.getElementById('settingsModal');
    if (modal) {
      modal.classList.remove('show');
      modal.style.display = '';
    }

    // Update the visible preview immediately without touching iiko/OLAP code.
    const name = document.getElementById('previewName');
    const tagline = document.getElementById('previewTagline');
    const top = document.getElementById('phoneTop');
    const screen = document.getElementById('phoneScreen');
    const body = document.getElementById('previewBody');
    if (name) name.textContent = state.design.name;
    if (tagline) tagline.textContent = state.design.tagline;
    if (top) top.style.background = state.design.theme === 'dark' ? '#111' : state.design.accent;
    if (screen) {
      screen.style.fontFamily = state.design.font === 'system' ? 'system-ui' : state.design.font + ',Georgia,serif';
      screen.style.background = state.design.surface;
      screen.style.color = state.design.text;
      screen.style.borderRadius = state.design.radius;
    }
    if (body) body.style.background = state.design.bg;

    alert('Дизайн сохранён. Нажмите «Опубликовать меню», чтобы применить изменения в публичном QR Menu.');
  }

  function initQrMenuFix() {
    const btn = document.getElementById('designBtn');
    const modal = document.getElementById('settingsModal');
    const close = document.getElementById('closeSettings');
    const save = document.getElementById('saveDesign');

    if (!btn || !modal) return;

    btn.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();
      try {
        if (typeof window.fillDesignForm === 'function') window.fillDesignForm();
      } catch (error) {
        console.error('QR Menu design form error:', error);
      }
      modal.classList.add('show');
      modal.style.display = 'flex';
    };

    if (save) {
      save.onclick = function (event) {
        event.preventDefault();
        event.stopPropagation();
        saveDesignDirectly();
      };
    }

    if (close) {
      close.onclick = function (event) {
        event.preventDefault();
        event.stopPropagation();
        modal.classList.remove('show');
        modal.style.display = '';
      };
    }

    modal.onclick = function (event) {
      if (event.target === modal) {
        modal.classList.remove('show');
        modal.style.display = '';
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initQrMenuFix, { once: true });
  } else {
    initQrMenuFix();
  }
})();
