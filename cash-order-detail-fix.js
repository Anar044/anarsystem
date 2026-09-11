(() => {
  'use strict';

  // Normalize order-detail request parameters for the Plugin.
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function(input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/plugin/request') && init?.body && typeof init.body === 'string') {
        const body = JSON.parse(init.body);
        const action = String(body?.action || '').toLowerCase();
        if ((action === 'order' || action === 'get_order') && body?.params && typeof body.params === 'object') {
          const params = body.params;
          const orderNumber = params.RequestDetail ?? params.requestDetail ?? params.orderNum ?? params.orderNumber;
          if (orderNumber !== undefined && orderNumber !== null && orderNumber !== '') {
            body.RequestDetail = String(orderNumber);
            body.requestDetail = String(orderNumber);
            body.orderNum = String(orderNumber);
            body.orderNumber = String(orderNumber);
            delete body.params;
            init = { ...init, body: JSON.stringify(body) };
          }
        }
      }
    } catch (_) {}
    return originalFetch(input, init);
  };

  // Enrich the visible order history with the timestamp and actor/details
  // already stored by the VPS. We intentionally do not invent missing data.
  const historyByOrder = new Map();

  const esc = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const dt = v => {
    if (!v) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  };
  const scalar = value => {
    if (value == null || value === '') return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) { for (const x of value) { const s = scalar(x); if (s) return s; } return null; }
    if (typeof value === 'object') {
      for (const k of ['name','Name','fullName','FullName','title','Title','value','Value']) { const s = scalar(value[k]); if (s) return s; }
    }
    return null;
  };
  const deep = (obj, keys, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 8) return null;
    const wanted = keys.map(k => k.toLowerCase());
    for (const [k,v] of Object.entries(obj)) {
      if (wanted.includes(k.toLowerCase())) { const s = scalar(v); if (s) return s; }
    }
    for (const v of Object.values(obj)) { const s = deep(v, keys, depth + 1); if (s) return s; }
    return null;
  };
  const eventTitle = e => {
    const s = String(e?.pluginEventType ?? e?.eventType ?? e?.type ?? '').toLowerCase();
    if (/neworder|ordercreated/.test(s)) return 'Заказ создан';
    if (/closingorder|closedorder|orderclosed/.test(s)) return 'Заказ закрыт';
    if (/orderguestbill|payment|orderpayment/.test(s)) return 'Оплата заказа';
    if (/cancel/.test(s)) return 'Заказ отменён';
    if (/delete.*item|deletionofprinteditem|remove|removed/.test(s)) return 'Удалено блюдо';
    if (/additem|addeditem/.test(s)) return 'Добавлено блюдо';
    if (/discount/.test(s)) return 'Изменена скидка';
    if (/surcharge|increase/.test(s)) return 'Изменена надбавка';
    if (/table/.test(s)) return 'Изменён стол';
    if (/waiter/.test(s)) return 'Изменён официант';
    return e?.pluginEventType ?? e?.eventType ?? e?.type ?? 'Событие';
  };
  const actor = e => deep(e?.data ?? e, [
    'employeeName','employeeFullName','employee','operatorName','operatorFullName','operator',
    'userName','userFullName','user','cashierName','cashierFullName','cashier',
    'waiterName','waiterFullName','waiter','authorName','authorFullName','author'
  ]);
  const details = e => {
    const d = e?.data ?? {}, parts = [];
    const item = deep(d, ['itemName','productName','dishName','menuItemName']);
    const qty = deep(d, ['quantity','amount','count','itemAmount']);
    const table = deep(d, ['tableName','orderTables','table']);
    const sum = deep(d, ['resultSum','orderSum','revenue','total','sum']);
    const payment = deep(d, ['paymentTypeName','paymentMethod','paymentName','paymentType']);
    if (item) parts.push(`Блюдо: ${item}${qty ? ` · ${qty} шт.` : ''}`);
    else if (qty) parts.push(`Количество: ${qty}`);
    if (table) parts.push(`Стол: ${table}`);
    if (sum && !/neworder|ordercreated/i.test(String(e?.pluginEventType))) parts.push(`Сумма: ${sum}`);
    if (payment) parts.push(`Оплата: ${payment}`);
    return parts;
  };

  function renderHistory(events) {
    const host = document.getElementById('cm-history');
    if (!host || !Array.isArray(events)) return;
    if (!events.length) { host.innerHTML = '<div class="cm-empty">История событий не найдена.</div>'; return; }
    host.innerHTML = events.slice().sort((a,b) => {
      const ta = new Date(a?.receivedAt ?? a?.createdAt ?? a?.timestamp ?? a?.time ?? 0).getTime();
      const tb = new Date(b?.receivedAt ?? b?.createdAt ?? b?.timestamp ?? b?.time ?? 0).getTime();
      return ta - tb;
    }).map(e => {
      const when = e?.receivedAt ?? e?.createdAt ?? e?.timestamp ?? e?.time;
      const who = actor(e), extra = details(e);
      return `<div class="cm-event cm-event-rich">
        <div class="cm-event-main"><strong>${esc(eventTitle(e))}</strong><span class="cm-event-time">${esc(dt(when))}</span></div>
        <div class="cm-event-meta">${who ? `<span><b>Сотрудник:</b> ${esc(who)}</span>` : '<span><b>Сотрудник:</b> не указан в событии</span>'}${extra.map(x => `<span>${esc(x)}</span>`).join('')}</div>
      </div>`;
    }).join('');
  }

  // Wrap fetch a second time so the order-detail normalizer above remains intact.
  const fetchWithHistory = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    const response = await fetchWithHistory(input, init);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/plugin/order-history')) {
        response.clone().json().then(payload => {
          const u = new URL(url, location.href);
          const key = `${u.searchParams.get('pluginId') || ''}:${u.searchParams.get('orderNum') || ''}`;
          const events = payload?.events ?? payload?.data?.events ?? payload?.history ?? payload?.data;
          if (Array.isArray(events)) { historyByOrder.set(key, events); renderHistory(events); }
        }).catch(() => {});
      }
    } catch (_) {}
    return response;
  };

  const observer = new MutationObserver(() => {
    const host = document.getElementById('cm-history');
    if (!host || host.dataset.richHistory === '1') return;
    for (const events of historyByOrder.values()) {
      if (Array.isArray(events) && events.length) {
        host.dataset.richHistory = '1';
        renderHistory(events);
        break;
      }
    }
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
})();
