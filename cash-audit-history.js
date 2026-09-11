(() => {
  'use strict';

  const esc = v => String(v ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;');
  const unwrap = v => { if (typeof v === 'string') { try { return JSON.parse(v); } catch (_) {} } return v; };

  function first(obj, names) {
    if (!obj || typeof obj !== 'object') return null;
    const wanted = names.map(x => String(x).toLowerCase());
    for (const [k, v] of Object.entries(obj)) {
      if (wanted.includes(k.toLowerCase()) && v !== null && v !== undefined && v !== '') return v;
    }
    return null;
  }

  function deep(obj, names, depth = 0) {
    if (!obj || typeof obj !== 'object' || depth > 10) return null;
    const direct = first(obj, names);
    if (direct !== null) return direct;
    for (const value of Object.values(obj)) {
      const found = deep(value, names, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }

  function scalar(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
    if (Array.isArray(v)) return v.length ? scalar(v[0]) : null;
    if (typeof v === 'object') return first(v, ['name','Name','fullName','FullName','title','Title','value','Value','text','Text']);
    return null;
  }

  function dateTime(v) {
    if (!v) return 'Время не указано';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return String(v);
    return d.toLocaleString('ru-RU', {
      day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', second:'2-digit'
    });
  }

  function typeOf(e) {
    return String(e?.pluginEventType ?? e?.eventType ?? e?.type ?? e?.Type ?? '').trim();
  }

  function title(e) {
    const s = typeOf(e).toLowerCase();
    if (/neworder|ordercreated/.test(s)) return 'Заказ создан';
    if (/closingorder|closedorder|orderclosed/.test(s)) return 'Заказ закрыт';
    if (/orderguestbill|guestbill|precheck|bill/.test(s)) return 'Гостевой счёт';
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
  }

  function actor(e) {
    const data = e?.data ?? e;
    const value = deep(data, [
      'employeeName','employeeFullName','employee','userName','userFullName','user',
      'operatorName','operatorFullName','operator','cashierName','cashierFullName','cashier',
      'waiterName','waiterFullName','waiter','authorName','authorFullName','author','createdBy','performedBy'
    ]);
    const s = scalar(value) ?? scalar(first(e, ['employeeName','userName','operatorName','cashierName','waiterName','authorName']));
    return s ? String(s) : 'не указан в событии';
  }

  function money(v) {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/\s/g,'').replace(',','.').replace(/[^0-9+\-.]/g,''));
    return Number.isFinite(n) ? n.toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}) + ' ₼' : String(v);
  }

  function details(e) {
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
    if (payment != null && payment !== '') out.push(`Оплата: ${scalar(payment) ?? payment}`);
    if (oldValue != null && newValue != null) out.push(`Было: ${scalar(oldValue) ?? oldValue} → Стало: ${scalar(newValue) ?? newValue}`);
    return out;
  }

  function eventIcon(e) {
    const s = typeOf(e).toLowerCase();
    if (/payment|guestbill|bill/.test(s)) return '₼';
    if (/close/.test(s)) return '✓';
    if (/cancel|void|storno|delete|remove/.test(s)) return '−';
    if (/add|neworder|created/.test(s)) return '+';
    return '•';
  }

  function render(events) {
    const host = document.getElementById('cm-history');
    if (!host) return;
    const list = Array.isArray(events) ? events.slice().sort((a,b) => {
      const ta = new Date(a?.receivedAt ?? a?.createdAt ?? a?.timestamp ?? a?.time ?? 0).getTime();
      const tb = new Date(b?.receivedAt ?? b?.createdAt ?? b?.timestamp ?? b?.time ?? 0).getTime();
      return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
    }) : [];

    if (!list.length) {
      host.innerHTML = '<div class="cm-empty">История событий не найдена.</div>';
      return;
    }

    host.innerHTML = list.map((e, index) => {
      const data = e?.data ?? {};
      const eventTime = e?.receivedAt ?? e?.createdAt ?? e?.timestamp ?? e?.time;
      const actorName = actor(e);
      const extra = details(e);
      const rawType = typeOf(e);
      return `<div class="cm-audit-event">
        <div class="cm-audit-dot">${esc(eventIcon(e))}</div>
        <div class="cm-audit-main">
          <div class="cm-audit-top">
            <strong>${esc(title(e))}</strong>
            <time>${esc(dateTime(eventTime))}</time>
          </div>
          <div class="cm-audit-meta"><span>Сотрудник: <b>${esc(actorName)}</b></span>${rawType ? `<span>Событие: ${esc(rawType)}</span>` : ''}</div>
          ${extra.length ? `<div class="cm-audit-details">${extra.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : ''}
        </div>
      </div>`;
    }).join('');
  }

  function install() {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async function(input, init) {
      const response = await originalFetch(input, init);
      try {
        const url = typeof input === 'string' ? input : input?.url || '';
        if (url.includes('/api/plugin/order-history')) {
          const clone = response.clone();
          clone.text().then(text => {
            try {
              const payload = unwrap(text);
              const x = unwrap(payload);
              const events = x?.events ?? x?.data?.events ?? x?.history ?? x?.data;
              if (Array.isArray(events)) render(events);
            } catch (_) {}
          }).catch(() => {});
        }
      } catch (_) {}
      return response;
    };
  }

  install();
})();
