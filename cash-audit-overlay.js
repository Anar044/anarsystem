(() => {
  'use strict';

  const esc = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const unwrap = v => { if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) {} } return v; };

  const scalar = v => {
    if (v == null || v === '') return null;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v);
    if (Array.isArray(v)) { for (const x of v) { const s = scalar(x); if (s) return s; } return null; }
    if (typeof v === 'object') {
      for (const k of ['name','Name','fullName','FullName','displayName','DisplayName','title','Title','value','Value','text','Text']) {
        const s = scalar(v[k]); if (s) return s;
      }
    }
    return null;
  };

  const deep = (obj, names, depth = 0) => {
    if (!obj || typeof obj !== 'object' || depth > 12) return null;
    const wanted = names.map(x => String(x).toLowerCase());
    for (const [k,v] of Object.entries(obj)) {
      if (wanted.includes(k.toLowerCase())) {
        const s = scalar(v);
        if (s) return s;
      }
    }
    for (const v of Object.values(obj)) {
      const s = deep(v, names, depth + 1);
      if (s) return s;
    }
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

  const typeOf = e => String(e?.pluginEventType ?? e?.eventType ?? e?.type ?? e?.Type ?? '').trim();

  const title = e => {
    const s = typeOf(e).toLowerCase();
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
    return typeOf(e) || 'Событие';
  };

  const actor = e => {
    const d = e?.data ?? e;
    return deep(d, [
      'employeeName','employeeFullName','employee','employeeInfo',
      'userName','userFullName','user','operatorName','operatorFullName','operator',
      'cashierName','cashierFullName','cashier','waiterName','waiterFullName','waiter',
      'authorName','authorFullName','author','createdBy','performedBy','changedBy','modifiedBy'
    ]);
  };

  const details = e => {
    const d = e?.data ?? {};
    const out = [];
    const item = deep(d, ['itemName','ItemName','productName','ProductName','dishName','DishName','menuItemName','MenuItemName']);
    const qty = deep(d, ['quantity','Quantity','amount','Amount','itemAmount','ItemAmount','count','Count']);
    const sum = deep(d, ['resultSum','ResultSum','itemSum','ItemSum','sum','Sum','total','Total','revenue','Revenue']);
    const table = deep(d, ['tableName','TableName','table','Table','orderTables','OrderTables']);
    const floor = deep(d, ['floorName','FloorName','floor','Floor','restaurantSection','RestaurantSection','hall','Hall']);
    const payment = deep(d, ['paymentTypeName','PaymentTypeName','paymentName','PaymentName','paymentMethod','PaymentMethod','paymentType','PaymentType']);
    const oldValue = deep(d, ['oldValue','OldValue','previousValue','PreviousValue','before','Before']);
    const newValue = deep(d, ['newValue','NewValue','currentValue','CurrentValue','after','After']);
    if (item) out.push(`Блюдо: ${item}`);
    if (qty != null && qty !== '') out.push(`Количество: ${qty}`);
    if (sum != null && sum !== '') out.push(`Сумма: ${money(sum)}`);
    if (table != null && table !== '') out.push(`Стол: ${scalar(table) ?? table}`);
    if (floor != null && floor !== '') out.push(`Зал: ${scalar(floor) ?? floor}`);
    if (payment != null && payment !== '') out.push(`Способ оплаты: ${scalar(payment) ?? payment}`);
    if (oldValue != null && newValue != null) out.push(`Было: ${scalar(oldValue) ?? oldValue} → Стало: ${scalar(newValue) ?? newValue}`);
    return out;
  };

  const icon = e => {
    const s = typeOf(e).toLowerCase();
    if (/payment|guestbill/.test(s)) return '₼';
    if (/close/.test(s)) return '✓';
    if (/cancel|void|storno|delete|remove/.test(s)) return '−';
    if (/add|neworder|created/.test(s)) return '+';
    if (/discount|surcharge|increase/.test(s)) return '%';
    return '•';
  };

  function style() {
    if (document.getElementById('cash-audit-overlay-style')) return;
    const s = document.createElement('style');
    s.id = 'cash-audit-overlay-style';
    s.textContent = `
      .cm-history{display:grid!important;gap:9px!important}
      .cm-audit-event{position:relative;display:grid;grid-template-columns:30px 1fr;gap:10px;padding:13px 14px;border:1px solid rgba(255,255,255,.065);border-radius:11px;background:linear-gradient(180deg,#101a24,#0d151e)}
      .cm-audit-event:before{content:"";position:absolute;left:28px;top:39px;bottom:-10px;width:1px;background:rgba(255,255,255,.07)}
      .cm-audit-event:last-child:before{display:none}
      .cm-audit-icon{width:27px;height:27px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:#17242f;border:1px solid rgba(255,255,255,.09);color:#72dfac;font-size:12px;font-weight:800;z-index:1}
      .cm-audit-main{min-width:0}.cm-audit-top{display:flex;align-items:baseline;justify-content:space-between;gap:12px}.cm-audit-top strong{color:#e8eef4;font-size:11px}.cm-audit-top time{color:#8795a5;font-size:9px;white-space:nowrap;font-variant-numeric:tabular-nums}.cm-audit-meta{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.cm-audit-meta span,.cm-audit-detail{padding:4px 7px;border-radius:6px;background:#151f29;color:#8f9dab;font-size:9px}.cm-audit-meta b{color:#d9e1e8}.cm-audit-details{display:flex;flex-wrap:wrap;gap:5px;margin-top:5px}
    `;
    document.head.appendChild(s);
  }

  function render(events) {
    const host = document.getElementById('cm-history');
    if (!host || !Array.isArray(events)) return;
    style();
    if (!events.length) { host.innerHTML='<div class="cm-empty">История событий не найдена.</div>'; return; }
    const list = events.slice().sort((a,b) => {
      const ta = new Date(a?.receivedAt ?? a?.createdAt ?? a?.timestamp ?? a?.time ?? 0).getTime();
      const tb = new Date(b?.receivedAt ?? b?.createdAt ?? b?.timestamp ?? b?.time ?? 0).getTime();
      return (Number.isFinite(ta)?ta:0) - (Number.isFinite(tb)?tb:0);
    });
    host.innerHTML = list.map(e => {
      const who = actor(e) || 'не указан в событии';
      const when = e?.receivedAt ?? e?.createdAt ?? e?.timestamp ?? e?.time;
      const raw = typeOf(e);
      const extra = details(e);
      return `<div class="cm-audit-event"><div class="cm-audit-icon">${esc(icon(e))}</div><div class="cm-audit-main"><div class="cm-audit-top"><strong>${esc(title(e))}</strong><time>${esc(dt(when))}</time></div><div class="cm-audit-meta"><span><b>Сотрудник:</b> ${esc(who)}</span>${raw?`<span><b>Событие:</b> ${esc(raw)}</span>`:''}</div>${extra.length?`<div class="cm-audit-details">${extra.map(x=>`<span class="cm-audit-detail">${esc(x)}</span>`).join('')}</div>`:''}</div></div>`;
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

  const originalFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    const response = await originalFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      if (url.includes('/api/plugin/order-history')) {
        response.clone().json().then(payload => {
          const x = unwrap(payload);
          const events = x?.events ?? x?.data?.events ?? x?.history ?? x?.data;
          if (Array.isArray(events)) render(events);
        }).catch(() => {});
      }
    } catch (_) {}
    return response;
  };
})();
