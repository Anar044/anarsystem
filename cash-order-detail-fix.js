(() => {
  'use strict';

  const originalFetch = window.fetch.bind(window);

  // Normalize order-detail request parameters for the Plugin.
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

  const historyByOrder = new Map();
  const esc = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const scalar = value => {
    if (value == null || value === '') return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) { for (const x of value) { const s = scalar(x); if (s) return s; } return null; }
    if (typeof value === 'object') {
      for (const k of ['name','Name','fullName','FullName','displayName','DisplayName','title','Title','value','Value','text','Text']) {
        const s = scalar(value[k]); if (s) return s;
      }
    }
    return null;
  };
  const deep = (obj, names, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 10) return null;
    const wanted = names.map(k => String(k).toLowerCase());
    for (const [k,v] of Object.entries(obj)) {
      if (wanted.includes(k.toLowerCase())) { const s = scalar(v); if (s) return s; }
    }
    for (const v of Object.values(obj)) { const s = deep(v, names, depth + 1); if (s) return s; }
    return null;
  };
  const dt = v => {
    if (!v) return 'Время не указано';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString('ru-RU', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  };
  const money = v => {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/\s/g,'').replace(',','.').replace(/[^0-9+\-.]/g,''));
    return Number.isFinite(n) ? n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' ₼' : String(v);
  };

  function eventType(e) { return String(e?.pluginEventType ?? e?.eventType ?? e?.type ?? e?.Type ?? '').trim(); }
  function eventTitle(e) {
    const s = eventType(e).toLowerCase();
    if (/neworder|ordercreated/.test(s)) return 'Заказ создан';
    if (/closingorder|closedorder|orderclosed/.test(s)) return 'Заказ закрыт';
    if (/orderguestbill|guestbill/.test(s)) return 'Гостевой счёт выставлен';
    if (/payment|orderpayment/.test(s)) return 'Оплата заказа';
    if (/cancel|void|storno/.test(s)) return 'Заказ отменён';
    if (/delete.*item|deletionofprinteditem|remove.*item|removeditem/.test(s)) return 'Удалено блюдо';
    if (/additem|addeditem/.test(s)) return 'Добавлено блюдо';
    if (/discount/.test(s)) return 'Изменена скидка';
    if (/surcharge|increase/.test(s)) return 'Изменена надбавка';
    if (/table/.test(s)) return 'Изменён стол';
    if (/waiter/.test(s)) return 'Изменён официант';
    if (/print/.test(s)) return 'Печать';
    return eventType(e) || 'Событие';
  }
  function actor(e) {
    const d = e?.data ?? e;
    return deep(d, ['employeeName','employeeFullName','employee','employeeInfo','userName','userFullName','user','operatorName','operatorFullName','operator','cashierName','cashierFullName','cashier','waiterName','waiterFullName','waiter','authorName','authorFullName','author','createdBy','performedBy','changedBy','modifiedBy']);
  }
  function detailParts(e) {
    const d = e?.data ?? {}, parts = [];
    const item = deep(d, ['itemName','ItemName','productName','ProductName','dishName','DishName','menuItemName','MenuItemName']);
    const qty = deep(d, ['quantity','Quantity','amount','Amount','itemAmount','ItemAmount','count','Count']);
    const sum = deep(d, ['resultSum','ResultSum','itemSum','ItemSum','sum','Sum','total','Total','revenue','Revenue']);
    const table = deep(d, ['tableName','TableName','table','Table','orderTables','OrderTables']);
    const floor = deep(d, ['floorName','FloorName','floor','Floor','restaurantSection','RestaurantSection','hall','Hall']);
    const payment = deep(d, ['paymentTypeName','PaymentTypeName','paymentName','PaymentName','paymentMethod','PaymentMethod','paymentType','PaymentType']);
    const oldValue = deep(d, ['oldValue','OldValue','previousValue','PreviousValue','before','Before']);
    const newValue = deep(d, ['newValue','NewValue','currentValue','CurrentValue','after','After']);
    if (item) parts.push(`Блюдо: ${item}`);
    if (qty != null && qty !== '') parts.push(`Количество: ${qty}`);
    if (sum != null && sum !== '') parts.push(`Сумма: ${money(sum)}`);
    if (table != null && table !== '') parts.push(`Стол: ${scalar(table) ?? table}`);
    if (floor != null && floor !== '') parts.push(`Зал: ${scalar(floor) ?? floor}`);
    if (payment != null && payment !== '') parts.push(`Способ оплаты: ${scalar(payment) ?? payment}`);
    if (oldValue != null && newValue != null) parts.push(`Было: ${scalar(oldValue) ?? oldValue} → Стало: ${scalar(newValue) ?? newValue}`);
    return parts;
  }
  function icon(e) {
    const s = eventType(e).toLowerCase();
    if (/payment|guestbill/.test(s)) return '₼';
    if (/close/.test(s)) return '✓';
    if (/cancel|void|storno|delete|remove/.test(s)) return '−';
    if (/add|neworder|created/.test(s)) return '+';
    if (/discount|surcharge|increase/.test(s)) return '%';
    return '•';
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
    if (!events.length) { host.innerHTML='<div class="cm-empty">История событий не найдена.</div>'; return; }
    const ordered = events.slice().sort((a,b) => {
      const ta = new Date(a?.receivedAt ?? a?.createdAt ?? a?.timestamp ?? a?.time ?? 0).getTime();
      const tb = new Date(b?.receivedAt ?? b?.createdAt ?? b?.timestamp ?? b?.time ?? 0).getTime();
      return (Number.isFinite(ta)?ta:0) - (Number.isFinite(tb)?tb:0);
    });
    host.dataset.auditRendered='1';
    host.innerHTML = ordered.map(e => {
      const when = e?.receivedAt ?? e?.createdAt ?? e?.timestamp ?? e?.time;
      const who = actor(e) || 'не указан в событии';
      const extra = detailParts(e), raw = eventType(e);
      return `<div class="cm-event cm-event-rich"><div class="cm-audit-icon">${esc(icon(e))}</div><div class="cm-event-main"><div class="cm-audit-top"><strong>${esc(eventTitle(e))}</strong><time class="cm-event-time">${esc(dt(when))}</time></div><div class="cm-event-meta"><span><b>Сотрудник:</b> ${esc(who)}</span>${raw?`<span><b>Событие:</b> ${esc(raw)}</span>`:''}</div>${extra.length?`<div class="cm-audit-details">${extra.map(x=>`<span class="cm-audit-detail">${esc(x)}</span>`).join('')}</div>`:''}</div></div>`;
    }).join('');
  }

  function closeModal() {
    const modal = document.getElementById('cash-modern-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
  }
  document.addEventListener('click', e => {
    if (e.target.closest('.cm-close') || e.target.closest('.cm-backdrop')) closeModal();
  }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

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

  // cash-groups.js also renders this container. Re-apply the audit view if that
  // renderer replaces it, while avoiding an observer/render loop.
  const observer = new MutationObserver(() => {
    const host = document.getElementById('cm-history');
    if (!host || host.dataset.auditRendering === '1') return;
    if (host.querySelector('.cm-event-rich')) return;
    for (const events of historyByOrder.values()) {
      if (Array.isArray(events) && events.length) {
        host.dataset.auditRendering='1';
        renderHistory(events);
        host.dataset.auditRendering='0';
        break;
      }
    }
  });
  observer.observe(document.documentElement, { childList:true, subtree:true });
})();
