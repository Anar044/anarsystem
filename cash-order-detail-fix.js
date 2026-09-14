(() => {
  'use strict';

  const historyByOrder = new Map();
  let currentKey = '';

  const esc = v => String(v ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
    .replaceAll('"','&quot;').replaceAll("'",'&#039;');

  const scalar = value => {
    if (value == null || value === '') return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) {
      for (const item of value) { const result = scalar(item); if (result) return result; }
      return null;
    }
    if (typeof value === 'object') {
      for (const key of ['name','Name','fullName','FullName','displayName','DisplayName','title','Title','value','Value','text','Text']) {
        const result = scalar(value[key]);
        if (result) return result;
      }
    }
    return null;
  };

  const deep = (obj, names, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 10) return null;
    const wanted = names.map(key => String(key).toLowerCase());
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

  function eventType(event) {
    return String(event?.pluginEventType ?? event?.eventType ?? event?.type ?? event?.Type ?? '').trim();
  }

  function eventTitle(event) {
    const type = eventType(event).toLowerCase();
    if (/neworder|ordercreated/.test(type)) return 'Заказ создан';
    if (/closingorder|closedorder|orderclosed/.test(type)) return 'Заказ закрыт';
    if (/orderguestbill|guestbill/.test(type)) return 'Гостевой счёт выставлен';
    if (/payment|orderpayment/.test(type)) return 'Оплата заказа';
    if (/cancel|void|storno/.test(type)) return 'Заказ отменён';
    if (/delete.*item|deletionofprinteditem|remove.*item|removeditem/.test(type)) return 'Удалено блюдо';
    if (/additem|addeditem/.test(type)) return 'Добавлено блюдо';
    if (/discount/.test(type)) return 'Изменена скидка';
    if (/surcharge|increase/.test(type)) return 'Изменена надбавка';
    if (/table/.test(type)) return 'Изменён стол';
    if (/waiter/.test(type)) return 'Изменён официант';
    if (/print/.test(type)) return 'Печать';
    return eventType(event) || 'Событие';
  }

  function actor(event) {
    const data = event?.data ?? event;
    return deep(data, [
      'employeeName','employeeFullName','employee','employeeInfo',
      'userName','userFullName','user','operatorName','operatorFullName','operator',
      'cashierName','cashierFullName','cashier','waiterName','waiterFullName','waiter',
      'authorName','authorFullName','author','createdBy','performedBy','changedBy','modifiedBy'
    ]);
  }

  function detailParts(event) {
    const data = event?.data ?? {};
    const parts = [];
    const item = deep(data, ['itemName','ItemName','productName','ProductName','dishName','DishName','menuItemName','MenuItemName']);
    const qty = deep(data, ['quantity','Quantity','amount','Amount','itemAmount','ItemAmount','count','Count']);
    const sum = deep(data, ['resultSum','ResultSum','itemSum','ItemSum','sum','Sum','total','Total','revenue','Revenue']);
    const table = deep(data, ['tableName','TableName','table','Table','orderTables','OrderTables']);
    const floor = deep(data, ['floorName','FloorName','floor','Floor','restaurantSection','RestaurantSection','hall','Hall']);
    const payment = deep(data, ['paymentTypeName','PaymentTypeName','paymentName','PaymentName','paymentMethod','PaymentMethod','paymentType','PaymentType']);
    const oldValue = deep(data, ['oldValue','OldValue','previousValue','PreviousValue','before','Before']);
    const newValue = deep(data, ['newValue','NewValue','currentValue','CurrentValue','after','After']);
    if (item) parts.push(`Блюдо: ${item}`);
    if (qty != null && qty !== '') parts.push(`Количество: ${qty}`);
    if (sum != null && sum !== '') parts.push(`Сумма: ${money(sum)}`);
    if (table != null && table !== '') parts.push(`Стол: ${scalar(table) ?? table}`);
    if (floor != null && floor !== '') parts.push(`Зал: ${scalar(floor) ?? floor}`);
    if (payment != null && payment !== '') parts.push(`Способ оплаты: ${scalar(payment) ?? payment}`);
    if (oldValue != null && newValue != null) parts.push(`Было: ${scalar(oldValue) ?? oldValue} → Стало: ${scalar(newValue) ?? newValue}`);
    return parts;
  }

  function icon(event) {
    const type = eventType(event).toLowerCase();
    if (/payment|guestbill/.test(type)) return '₼';
    if (/close/.test(type)) return '✓';
    if (/cancel|void|storno|delete|remove/.test(type)) return '−';
    if (/add|neworder|created/.test(type)) return '+';
    if (/discount|surcharge|increase/.test(type)) return '%';
    return '•';
  }

  function extractEvents(payload) {
    const events = payload?.events ?? payload?.data?.events ?? payload?.history ?? payload?.data;
    return Array.isArray(events) ? events : [];
  }

  function installAuditStyle() {
    if (document.getElementById('cm-audit-style')) return;
    const style = document.createElement('style');
    style.id = 'cm-audit-style';
    style.textContent = `.cm-history{display:grid;gap:8px}.cm-event-rich{position:relative;display:grid;grid-template-columns:30px 1fr;gap:10px;padding:12px 13px;border:1px solid rgba(255,255,255,.055);border-radius:11px;background:linear-gradient(180deg,#0f1821,#0d151e)}.cm-event-rich:before{content:"";position:absolute;left:27px;top:39px;bottom:-9px;width:1px;background:rgba(255,255,255,.07)}.cm-event-rich:last-child:before{display:none}.cm-audit-icon{width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#17232e;border:1px solid rgba(255,255,255,.08);color:#8ee3ba;font-weight:700;font-size:11px;z-index:1}.cm-event-main{min-width:0}.cm-audit-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.cm-event-main strong{display:block;color:#e7edf3;font-size:11px;font-weight:700}.cm-event-time{display:block;margin-top:3px;color:#8492a2;font-size:9px;font-variant-numeric:tabular-nums}.cm-event-meta{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.cm-event-meta span{padding:4px 7px;border-radius:6px;background:#151f29;color:#8d9baa;font-size:9px}.cm-event-meta b{color:#d6dee6;font-weight:600}.cm-audit-details{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}.cm-audit-detail{padding:4px 7px;border-radius:6px;background:#151f29;color:#8d9baa;font-size:9px}`;
    document.head.appendChild(style);
  }

  function renderHistory(events) {
    const host = document.getElementById('cm-history');
    if (!host || !Array.isArray(events)) return;
    installAuditStyle();
    if (!events.length) {
      host.innerHTML = '<div class="cm-empty">История событий не найдена.</div>';
      return;
    }

    const ordered = events.slice().sort((a,b) => {
      const ta = new Date(a?.receivedAt ?? a?.createdAt ?? a?.timestamp ?? a?.time ?? 0).getTime();
      const tb = new Date(b?.receivedAt ?? b?.createdAt ?? b?.timestamp ?? b?.time ?? 0).getTime();
      return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
    });

    host.innerHTML = ordered.map(event => {
      const when = event?.receivedAt ?? event?.createdAt ?? event?.timestamp ?? event?.time;
      const who = actor(event) || 'не указан в событии';
      const extra = detailParts(event);
      const raw = eventType(event);
      return `<div class="cm-event cm-event-rich"><div class="cm-audit-icon">${esc(icon(event))}</div><div class="cm-event-main"><div class="cm-audit-top"><strong>${esc(eventTitle(event))}</strong><time class="cm-event-time">${esc(dt(when))}</time></div><div class="cm-event-meta"><span><b>Сотрудник:</b> ${esc(who)}</span>${raw ? `<span><b>Событие:</b> ${esc(raw)}</span>` : ''}</div>${extra.length ? `<div class="cm-audit-details">${extra.map(value => `<span class="cm-audit-detail">${esc(value)}</span>`).join('')}</div>` : ''}</div></div>`;
    }).join('');
  }

  async function loadHistory(pluginId, orderNum) {
    if (!window.SH_CashContext?.orderHistory) return;
    const key = `${pluginId}:${orderNum}`;
    currentKey = key;
    try {
      const payload = await window.SH_CashContext.orderHistory(pluginId, orderNum);
      const events = extractEvents(payload);
      historyByOrder.set(key, events);
      if (currentKey === key) renderHistory(events);
    } catch (error) {
      console.warn('[cash-order-detail] history unavailable', error);
    }
  }

  document.addEventListener('click', event => {
    const row = event.target.closest('.cash-modern-card[data-modern-card] .order-row[data-order]');
    if (!row) return;
    const card = row.closest('.cash-modern-card[data-modern-card]');
    const pluginId = card?.getAttribute('data-modern-card') || '';
    const orderNum = row.getAttribute('data-order') || '';
    if (!pluginId || !orderNum) return;
    setTimeout(() => loadHistory(pluginId, orderNum), 0);
  });

  const observer = new MutationObserver(() => {
    const events = historyByOrder.get(currentKey);
    const host = document.getElementById('cm-history');
    if (!events?.length || !host || host.querySelector('.cm-event-rich')) return;
    renderHistory(events);
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
