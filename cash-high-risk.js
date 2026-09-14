(() => {
  'use strict';

  const esc = v => String(v ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');

  const unwrap = v => {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return v; }
  };

  const scalar = v => {
    if (v == null || v === '') return null;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) {
      for (const item of v) { const result = scalar(item); if (result) return result; }
      return null;
    }
    if (typeof v === 'object') {
      for (const key of ['name','Name','fullName','FullName','displayName','DisplayName','title','Title','value','Value','text','Text']) {
        const result = scalar(v[key]);
        if (result) return result;
      }
    }
    return null;
  };

  const deep = (obj, names, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 8) return null;
    const wanted = names.map(name => String(name).toLowerCase());
    for (const [key, value] of Object.entries(obj)) {
      if (wanted.includes(key.toLowerCase())) {
        const result = scalar(value);
        if (result) return result;
      }
    }
    for (const value of Object.values(obj)) {
      const result = deep(value, names, depth + 1);
      if (result) return result;
    }
    return null;
  };

  const dt = value => {
    if (!value) return 'Время не указано';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString('ru-RU', {
      day:'2-digit', month:'2-digit', year:'numeric',
      hour:'2-digit', minute:'2-digit', second:'2-digit'
    });
  };

  const money = value => {
    if (value == null || value === '') return null;
    const number = Number(String(value).replace(/\s/g,'').replace(',','.').replace(/[^0-9+\-.]/g,''));
    return Number.isFinite(number)
      ? number.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' ₼'
      : String(value);
  };

  function installStyle() {
    if (document.getElementById('cash-high-risk-style')) return;
    const style = document.createElement('style');
    style.id = 'cash-high-risk-style';
    style.textContent = `.cash-risk-btn{border:1px solid rgba(239,116,116,.24);background:rgba(239,116,116,.07);color:#f0a0a0;border-radius:8px;padding:7px 10px;font-size:10px;font-weight:600;cursor:pointer;white-space:nowrap}.cash-risk-btn:hover{background:rgba(239,116,116,.13);border-color:rgba(239,116,116,.4);color:#ffb4b4}#cash-risk-modal{position:fixed;inset:0;z-index:10001;display:none;align-items:center;justify-content:center;padding:20px}#cash-risk-modal.open{display:flex}.crm-backdrop{position:absolute;inset:0;background:rgba(3,7,11,.76);backdrop-filter:blur(6px)}.crm-dialog{position:relative;width:min(1080px,96vw);max-height:90vh;overflow:auto;border:1px solid rgba(255,255,255,.1);border-radius:18px;background:#111923;box-shadow:0 25px 80px rgba(0,0,0,.55)}.crm-head{display:flex;justify-content:space-between;gap:15px;padding:20px 22px;border-bottom:1px solid rgba(255,255,255,.07)}.crm-kicker{color:#ef8d8d;font-size:9px;letter-spacing:.12em}.crm-head h2{margin:5px 0 3px;font-size:20px}.crm-head p{margin:0;color:#7d8998;font-size:11px}.crm-close{width:34px;height:34px;border:0;border-radius:9px;background:#1a2531;color:#d9e1e9;font-size:20px;cursor:pointer}.crm-body{padding:18px 22px}.crm-summary{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px}.crm-pill{padding:7px 10px;border-radius:8px;background:#0d151e;color:#8795a4;font-size:10px}.crm-pill b{color:#eef3f7}.crm-list{display:grid;gap:8px}.crm-item{display:grid;grid-template-columns:145px 1fr;gap:14px;padding:13px;border:1px solid rgba(255,255,255,.055);border-radius:11px;background:#0d151e}.crm-time{color:#8b98a7;font-size:10px;font-variant-numeric:tabular-nums}.crm-main strong{display:block;color:#edf2f6;font-size:11px}.crm-meta{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px}.crm-meta span{padding:4px 7px;border-radius:6px;background:#151f29;color:#8d9baa;font-size:9px}.crm-meta b{color:#d9e1e8}.crm-details{display:flex;flex-wrap:wrap;gap:5px;margin-top:6px}.crm-detail{padding:4px 7px;border-radius:6px;background:#151f29;color:#a1adba;font-size:9px}.crm-empty{padding:22px;border-radius:10px;background:#0d151e;color:#718092;font-size:10px;text-align:center}@media(max-width:650px){.crm-item{grid-template-columns:1fr;gap:7px}.crm-body{padding:15px}.crm-head{padding:16px}}`;
    document.head.appendChild(style);
  }

  function ensureModal() {
    if (document.getElementById('cash-risk-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'cash-risk-modal';
    modal.setAttribute('aria-hidden','true');
    modal.innerHTML = `<div class="crm-backdrop"></div><section class="crm-dialog" role="dialog" aria-modal="true" aria-labelledby="crm-title"><header class="crm-head"><div><span class="crm-kicker">КОНТРОЛЬ КАССЫ</span><h2 id="crm-title">Опасные операции</h2><p id="crm-subtitle">Загрузка…</p></div><button class="crm-close" type="button" aria-label="Закрыть">×</button></header><div class="crm-body"><div id="crm-summary" class="crm-summary"></div><div id="crm-list" class="crm-list"></div></div></section>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', event => {
      if (event.target.closest('.crm-close') || event.target.classList.contains('crm-backdrop')) closeModal();
    });
  }

  function closeModal() {
    const modal = document.getElementById('cash-risk-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
  }

  function operationType(item) {
    return String(deep(item,['operationName','operationTypeName','operationType','highRiskOperation','eventName','eventType','type','Type','name','Name']) || 'Опасная операция');
  }

  function operationActor(item) {
    return deep(item,[
      'employeeName','employeeFullName','employee','employeeInfo',
      'userName','userFullName','user','operatorName','operatorFullName','operator',
      'cashierName','cashierFullName','cashier','waiterName','waiterFullName','waiter',
      'authorName','authorFullName','author','createdBy','performedBy','changedBy','modifiedBy'
    ]);
  }

  function operationOrder(item) {
    return deep(item,['orderNumber','orderNum','number','OrderNumber','OrderNum']);
  }

  function operationTime(item) {
    return item?.receivedAt ?? item?.createdAt ?? item?.timestamp ?? item?.time ?? item?.dateTime ?? item?.eventAt ?? item?.createdDate;
  }

  function details(item) {
    const output = [];
    const data = item?.data && typeof item.data === 'object' ? item.data : item;
    const product = deep(data,['itemName','productName','dishName','menuItemName']);
    const qty = deep(data,['quantity','amount','itemAmount','count']);
    const sum = deep(data,['resultSum','itemSum','sum','total','revenue','amountSum']);
    const table = deep(data,['tableName','table','orderTables']);
    const floor = deep(data,['floorName','floor','restaurantSection','hall']);
    const payment = deep(data,['paymentTypeName','paymentName','paymentMethod','paymentType']);
    const reason = deep(data,['reason','reasonName','comment','description','details']);
    if (product) output.push(`Блюдо: ${product}`);
    if (qty) output.push(`Количество: ${qty}`);
    if (sum) output.push(`Сумма: ${money(sum)}`);
    if (table) output.push(`Стол: ${scalar(table) ?? table}`);
    if (floor) output.push(`Зал: ${scalar(floor) ?? floor}`);
    if (payment) output.push(`Оплата: ${scalar(payment) ?? payment}`);
    if (reason) output.push(`Причина: ${scalar(reason) ?? reason}`);
    return output;
  }

  function findOperations(payload) {
    const root = unwrap(payload);
    const candidates = [];
    const keys = ['highRiskOperations','HighRiskOperations','operations','Operations','events','Events','items','Items','history','History'];
    const visit = (value, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 5) return;
      if (Array.isArray(value)) {
        if (value.length && value.some(item => item && typeof item === 'object')) candidates.push(value);
        return;
      }
      for (const key of keys) if (Array.isArray(value[key])) candidates.push(value[key]);
      for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child, depth + 1);
    };
    visit(root);
    return candidates.sort((a,b) => b.length - a.length)[0] || [];
  }

  function renderOperations(plugin, payload) {
    const operations = findOperations(payload);
    document.getElementById('crm-title').textContent = 'Опасные операции';
    document.getElementById('crm-subtitle').textContent = `${plugin?.pluginName || 'Касса'} · ${plugin?.groupName || 'Без группы'}`;
    document.getElementById('crm-summary').innerHTML = `<span class="crm-pill">Найдено: <b>${operations.length}</b></span><span class="crm-pill">Касса: <b>${esc(plugin?.pluginName || '—')}</b></span>`;
    const list = document.getElementById('crm-list');
    if (!operations.length) {
      list.innerHTML = '<div class="crm-empty">Опасных операций не найдено.</div>';
      return;
    }

    const ordered = operations.slice().sort((a,b) => {
      const ta = new Date(operationTime(a) || 0).getTime();
      const tb = new Date(operationTime(b) || 0).getTime();
      return (Number.isFinite(tb) ? tb : 0) - (Number.isFinite(ta) ? ta : 0);
    });

    list.innerHTML = ordered.map(item => {
      const who = operationActor(item) || 'не указан в событии';
      const order = operationOrder(item);
      const extra = details(item);
      return `<article class="crm-item"><div class="crm-time">${esc(dt(operationTime(item)))}</div><div class="crm-main"><strong>${esc(operationType(item))}</strong><div class="crm-meta"><span><b>Сотрудник:</b> ${esc(who)}</span>${order ? `<span><b>Заказ:</b> #${esc(order)}</span>` : ''}</div>${extra.length ? `<div class="crm-details">${extra.map(value => `<span class="crm-detail">${esc(value)}</span>`).join('')}</div>` : ''}</div></article>`;
    }).join('');
  }

  async function openRisk(pluginId) {
    ensureModal();
    const modal = document.getElementById('cash-risk-modal');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
    document.getElementById('crm-subtitle').textContent = 'Загрузка кассы…';
    document.getElementById('crm-summary').innerHTML = '';
    document.getElementById('crm-list').innerHTML = '<div class="crm-empty">Запрашиваем список операций…</div>';

    try {
      if (!window.SH_CashContext?.getPlugin || !window.SH_CashContext?.pluginRequest) {
        throw new Error('Контекст кассы не загружен');
      }
      const plugin = await window.SH_CashContext.getPlugin(pluginId) || { pluginId: String(pluginId) };
      const payload = await window.SH_CashContext.pluginRequest({
        action: 'HighRiskOperations',
        pluginId: String(pluginId),
        departmentIds: plugin.departmentId ? [String(plugin.departmentId)] : undefined,
        groupId: plugin.groupId || undefined,
        groupName: plugin.groupName || undefined
      });
      renderOperations(plugin, payload);
    } catch (error) {
      document.getElementById('crm-list').innerHTML = `<div class="crm-empty">Не удалось получить список опасных операций: ${esc(error?.message || error)}</div>`;
    }
  }

  function addButtons() {
    document.querySelectorAll('.cash-modern-card[data-modern-card]').forEach(card => {
      if (card.querySelector('.cash-risk-btn')) return;
      const pluginId = card.getAttribute('data-modern-card');
      const title = card.querySelector('.cash-modern-card-head .cash-modern-card-title');
      if (!pluginId || !title) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cash-risk-btn';
      button.textContent = '⚠ Опасные операции';
      button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        openRisk(pluginId);
      });
      title.appendChild(button);
    });
  }

  function init() {
    installStyle();
    ensureModal();
    addButtons();
    const observer = new MutationObserver(addButtons);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
