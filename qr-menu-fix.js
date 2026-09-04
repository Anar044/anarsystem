/* QR Menu UI safety fix
   Restores the QR Menu page styles after app-shell removes legacy page styles.
   Does not change iiko/OLAP data logic or menu functionality.
*/
(function () {
  'use strict';
  const KEY = 'horeca_qr_menu_v1';

  function injectQrStyles() {
    if (document.getElementById('qr-menu-runtime-style')) return;
    const style = document.createElement('style');
    style.id = 'qr-menu-runtime-style';
    style.textContent = `
      .qr-page{padding:28px 30px 50px;max-width:1600px;margin:auto;color:#f5f7fa}
      .qr-head{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:22px}
      .qr-head h1{margin:0;font-size:30px}.qr-head p{margin:7px 0 0;color:#8994a3;font-size:13px}
      .qr-actions{display:flex;gap:9px;flex-wrap:wrap}
      .qbtn{border:1px solid #293442;background:#151d27;color:#fff;border-radius:11px;padding:10px 14px;font-weight:650;cursor:pointer}
      .qbtn.primary{background:#42d392;border-color:#42d392;color:#07110c}.qbtn:disabled{opacity:.55;cursor:not-allowed}
      .q-layout{display:grid;grid-template-columns:270px minmax(420px,1fr) 360px;gap:16px}
      .q-card{background:linear-gradient(145deg,#121922,#10161e);border:1px solid #222c38;border-radius:18px;padding:16px}.q-card h3{margin:0 0 14px;font-size:14px}
      .cat-list{display:grid;gap:7px}.cat{display:flex;align-items:center;justify-content:space-between;padding:11px 12px;border:1px solid transparent;border-radius:11px;color:#aeb7c4;cursor:pointer}.cat:hover{background:#151d27}.cat.active{background:#18251f;border-color:#244233;color:#fff}.cat span{font-size:11px;color:#718092}
      .add-cat{width:100%;margin-top:10px;border:1px dashed #334150;background:transparent;color:#8994a3;border-radius:10px;padding:10px;cursor:pointer}
      .menu-toolbar{display:flex;gap:8px;justify-content:space-between;align-items:center;margin-bottom:12px}.menu-toolbar input{flex:1;min-width:100px;background:#0e151d;border:1px solid #293442;border-radius:10px;padding:10px 12px;color:#fff;outline:none}
      .items{display:grid;gap:9px}.item{display:grid;grid-template-columns:70px 1fr auto;gap:12px;align-items:center;padding:10px;border:1px solid #222c38;border-radius:13px;background:#111821}
      .photo{width:70px;height:70px;border-radius:11px;background:#1a232d;display:grid;place-items:center;overflow:hidden;color:#657385;font-size:23px}.photo img{width:100%;height:100%;object-fit:cover}.item h4{margin:0 0 5px;font-size:13px}.item p{margin:0;color:#778496;font-size:11px;line-height:1.35}.price{font-weight:750;white-space:nowrap}
      .item-actions{display:flex;gap:5px;margin-top:7px;flex-wrap:wrap}.mini{border:1px solid #293442;background:#151d27;color:#aeb7c4;border-radius:8px;padding:5px 8px;font-size:11px;cursor:pointer}
      .source-badge{display:inline-block;margin-left:6px;padding:2px 5px;border-radius:5px;background:#173025;color:#42d392;font-size:9px}
      .preview{position:sticky;top:94px}.phone{width:100%;max-width:310px;margin:auto;background:#f5f7fa;color:#17202a;border-radius:28px;padding:9px;box-shadow:0 15px 40px #0008}.phone-screen{background:#fff;border-radius:21px;overflow:hidden;min-height:550px}
      .phone-top{position:relative;padding:0 0 16px;text-align:center;background:#17231e;color:#fff;overflow:hidden}.phone-hero{height:110px;background-size:cover;background-position:center;position:relative}.phone-hero:after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,#0002,#0008)}
      .phone-logo{position:relative;margin:-27px auto 7px;width:54px;height:54px;border-radius:50%;border:3px solid #fff;background:#fff;display:grid;place-items:center;overflow:hidden;z-index:2;color:#17231e;font-weight:900}.phone-logo img{width:100%;height:100%;object-fit:cover}.phone-top h2{position:relative;margin:0;font-size:20px;z-index:2}.phone-top small{position:relative;opacity:.7;z-index:2}.phone-body{padding:14px}
      .p-cat{font-weight:750;font-size:14px;margin:12px 0 8px}.p-item{display:flex;gap:9px;padding:9px 0;border-bottom:1px solid #e8ebee}.p-photo{width:54px;height:54px;border-radius:9px;background:#edf0f2;overflow:hidden;flex:none;display:grid;place-items:center}.p-photo img{width:100%;height:100%;object-fit:cover}.p-item b{font-size:12px}.p-item span{display:block;font-size:10px;color:#78818b;margin-top:3px}.p-price{margin-left:auto;font-weight:750;font-size:11px;white-space:nowrap}
      .settings{display:grid;gap:10px}.field label{display:block;color:#8994a3;font-size:11px;margin-bottom:5px}.field input,.field textarea,.field select{width:100%;background:#0e151d;border:1px solid #293442;border-radius:10px;color:#fff;padding:10px;outline:none}.field textarea{min-height:75px;resize:vertical}.hint{color:#718092;font-size:10px;line-height:1.4}
      .qrbox{margin:14px auto 4px;width:150px;height:150px;background:#fff;border-radius:12px;display:grid;place-items:center;color:#111;font-weight:800}.status{padding:9px 11px;border-radius:10px;background:#17231e;color:#42d392;font-size:11px}.empty{padding:35px 10px;text-align:center;color:#718092;border:1px dashed #293442;border-radius:12px}
      .settings-modal{position:fixed;inset:0;background:#000b;display:none;z-index:120;padding:22px}.settings-modal.show{display:flex;align-items:stretch;justify-content:flex-end}.settings-panel{width:min(520px,100%);height:100%;overflow:auto;background:#0d141b;border:1px solid #26313d;border-radius:20px;padding:22px;box-shadow:-20px 0 60px #0008}
      .settings-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:18px}.settings-head h2{margin:0;font-size:20px}.close{border:0;background:transparent;color:#9aa5b1;font-size:26px;cursor:pointer}.setting-section{border-top:1px solid #26313d;padding-top:18px;margin-top:18px}.setting-section:first-of-type{border-top:0;padding-top:0;margin-top:0}.setting-section h4{margin:0 0 12px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#9aa5b1}
      .color-row{display:grid;grid-template-columns:1fr 105px;gap:8px}.color-row input[type=color]{height:40px;padding:3px;cursor:pointer}.swatches{display:flex;gap:8px;flex-wrap:wrap}.swatch{width:34px;height:34px;border-radius:10px;border:1px solid #43505d;cursor:pointer}.switch-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:9px 0;color:#dce2e8;font-size:12px}.switch-row input{width:18px;height:18px;accent-color:#42d392}.upload-box{border:1px dashed #3a4652;border-radius:12px;padding:12px;background:#111a23}.settings-actions{display:flex;gap:8px;position:sticky;bottom:-22px;padding:14px 0 0;background:#0d141b}.preview-banner{display:flex;align-items:center;gap:10px;padding:10px;border-radius:12px;background:#17231e;color:#fff;margin-top:12px}.preview-banner strong{color:#42d392}.info-preview{margin-top:10px;padding:11px;border-radius:12px;background:#111821;border:1px solid #293442;color:#aeb7c4;font-size:11px;line-height:1.5}
      @media(max-width:1200px){.q-layout{grid-template-columns:240px 1fr}.preview{grid-column:1/-1;position:static}.phone{max-width:360px}}
      @media(max-width:800px){.qr-page{padding:20px 16px}.qr-head{align-items:flex-start;flex-direction:column}.q-layout{grid-template-columns:1fr}.q-card.preview{grid-column:auto}.settings-modal{padding:0}.settings-panel{border-radius:0;width:100%}}
    `;
    document.head.appendChild(style);
  }

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
    } catch (e) { alert('Не удалось сохранить дизайн: ' + (e.message || e)); return; }
    const name = byId('previewName'), tagline = byId('previewTagline'), top = byId('phoneTop'), screen = byId('phoneScreen'), body = byId('previewBody');
    if (name) name.textContent = state.design.name;
    if (tagline) tagline.textContent = state.design.tagline;
    if (top) top.style.background = state.design.theme === 'dark' ? '#111' : (state.design.accent || '#17231e');
    if (screen) { screen.style.fontFamily = state.design.font === 'system' ? 'system-ui' : state.design.font + ',Georgia,serif'; if (state.design.surface) screen.style.background = state.design.surface; if (state.design.text) screen.style.color = state.design.text; if (state.design.radius) screen.style.borderRadius = state.design.radius; }
    if (body && state.design.bg) body.style.background = state.design.bg;
    const status = byId('saveStatus'); if (status) status.textContent = '● Дизайн сохранён локально';
    const modal = byId('settingsModal'); if (modal) { modal.classList.remove('show'); modal.style.display = ''; }
    alert('Дизайн сохранён. Нажмите «Опубликовать меню», чтобы применить изменения в публичном QR Menu.');
  }

  function bindSave() {
    const save = findSaveButton();
    if (!save || save.dataset.qrSaveFix === '1') return;
    save.dataset.qrSaveFix = '1';
    save.addEventListener('click', function (event) { event.preventDefault(); event.stopImmediatePropagation(); saveDesignDirectly(); }, true);
  }

  function initQrMenuFix() {
    injectQrStyles();
    const btn = byId('designBtn'), modal = byId('settingsModal'), close = byId('closeSettings');
    if (!modal) return;
    if (btn) btn.onclick = function (event) { event.preventDefault(); event.stopPropagation(); try { if (typeof window.fillDesignForm === 'function') window.fillDesignForm(); } catch (e) { console.error('QR Menu design form error:', e); } modal.classList.add('show'); modal.style.display = 'flex'; setTimeout(bindSave, 0); };
    if (close) close.onclick = function (event) { event.preventDefault(); event.stopPropagation(); modal.classList.remove('show'); modal.style.display = ''; };
    modal.onclick = function (event) { if (event.target === modal) { modal.classList.remove('show'); modal.style.display = ''; } };
    bindSave(); setTimeout(bindSave, 250); setTimeout(bindSave, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initQrMenuFix, { once: true });
  else initQrMenuFix();
})();
