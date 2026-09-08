(() => {
  const $ = id => document.getElementById(id);
  const state = {
    plugins: [],
    pluginId: '',
    orders: [],
    selectedFilter: 'all',
    search: '',
    timer: null,
    busy: false
  };

  const escape = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const first = value => {
    if (value == null || value === '') return null;
    if (typeof value !== 'object') return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = first(item);
        if (result !== null && result !== '') return result;
      }
      return null;
    }
    for (const key of ['name', 'title', 'value', 'number', 'code', 'id']) {
      const result = first(value[key]);
      if (result !== null && result !== '') return result;
    }
    return null;
  };

  const number = value => {
    const raw = first(value);
    if (raw == null || raw === '') return NaN;
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN;
    const normalized = String(raw)
      .replace(/\s/g, '')
      .replace(',', '.')
      .replace(/[^0-9+\-.]/g, '');
    const result = Number(normalized);
    return Number.isFinite(result) ? result : NaN;
  };

  const money = value => {
    const n = number(value);
    return Number.isFinite(n)
      ? n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '—';
  };

  const date = value => {
    if (!value) return '—';
    const d = new Date(value);
    return Number.isNaN(d.getTime())
      ? String(value)
      : d.toLocaleString('ru-RU', {
          day: '2-digit', month: '2-digit', year: 'numeric',
          hour: '2-digit', minute: '2-digit'
        });
  };

  const timeValue = value => {
    if (!value) return 0;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 0 : d.getTime();
  };

  function unwrap(data) {
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch { return data; }
    }
    return data;
  }

  function getPlugins() {
    return fetch('/api/plugin/data', { cache: 'no-store' })
      .then(async response => {
        if (!response.ok) throw new Error(`Ошибка подключения: HTTP ${response.status}`);
        return unwrap(await response.json());
      })
      .then(data => {
        let list = Array.isArray(data)
          ? data
          : (data?.plugins || data?.data || data?.items || []);
        if (!Array.isArray(list)) list = [];

        state.plugins = list
          .map(item => item?.data ? { ...item, ...item.data } : item)
          .filter(Boolean);

        const selected = state.plugins.find(item => item?.pluginId) || state.plugins[0];
        state.pluginId = selected?.pluginId || '';

        $('cash-name').textContent = selected?.pluginName || selected?.groupName || 'Касса';
        $('cash-subtitle').textContent = selected
          ? `Касса ${selected.pluginName || selected.pluginId || ''} · данные непосредственно от подключённого плагина.`
          : 'Подключённая касса не найдена.';
        $('connection').className = `cash-connection ${selected ? 'online' : 'offline'}`;
        $('connection').textContent = selected ? '● Касса подключена' : '● Нет подключения';

        return selected;
      });
  }

  async function request(action, extra = {}) {
    const body = {
      action,
      ...(state.pluginId ? { pluginId: state.pluginId } : {}),
      ...extra
    };

    const response = await fetch('/api/plugin/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store'
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Плагин вернул не JSON (HTTP ${response.status})`);
    }

    if (!response.ok || data?.success === false && data?.error) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }

    return unwrap(data);
  }

  /*
   * The plugin's CurrentShiftOrdersList response has a strict structure:
   * data.terminalsGroups[].restaurantSections[].orders[]
   * data.terminalsGroups[].restaurantSections[].deliveries[]
   * data.terminalsGroups[].restaurantSections[].reserves[].ReserveOrder
   *
   * Do not recursively scan arbitrary arrays here: that can accidentally
   * turn order items or another nested array into the order list.
   */
  function extractListOrders(payload) {
    const root = unwrap(payload)?.data ?? unwrap(payload) ?? {};
    const groups = Array.isArray(root.terminalsGroups) ? root.terminalsGroups : [];
    const result = [];

    for (const group of groups) {
      const sections = Array.isArray(group?.restaurantSections)
        ? group.restaurantSections
        : [];

      for (const section of sections) {
        const sectionName = section?.restaurantSectionName || '';

        for (const row of Array.isArray(section?.orders) ? section.orders : []) {
          result.push({
            ...row,
            __sectionName: sectionName,
            __source: 'order'
          });
        }

        for (const row of Array.isArray(section?.deliveries) ? section.deliveries : []) {
          result.push({
            ...row,
            __sectionName: sectionName,
            __source: 'delivery'
          });
        }

        for (const reserve of Array.isArray(section?.reserves) ? section.reserves : []) {
          if (reserve?.reserveOrder) {
            result.push({
              ...reserve.reserveOrder,
              __sectionName: sectionName,
              __source: 'reserve',
              __reserveStatus: reserve.reserveStatus,
              __reserveClientName: reserve.reserveClientName,
              __reserveClientPhone: reserve.reserveClientPhone
            });
          }
        }
      }
    }

    return result;
  }

  function rawStatus(row) {
    return String(row?.orderStatus ?? row?.deliveryOrderStatus ?? '').trim();
  }

  function orderState(row) {
    const status = rawStatus(row).toLowerCase();

    if (/(deleted|cancelled|canceled|отмен|удал)/.test(status)) return 'other';
    if (status === 'closed' || status === 'paid' || status === 'запрыт' || status === 'закрыт' || status === 'закрыто') return 'closed';
    if (status === 'new' || status === 'bill' || status === 'open' || status === 'opened' || status === 'открыт' || status === 'открыто' || status === 'новый') return 'open';

    if (row?.orderCloseTime || row?.closeTime) return 'closed';
    return 'other';
  }

  function orderNumber(row, index = 0) {
    return row?.orderNum ?? row?.number ?? index + 1;
  }

  function orderAmount(row) {
    return number(row?.orderExpectedRevenue ?? row?.revenue ?? row?.resultSum ?? row?.orderSum);
  }

  function tableText(row) {
    return row?.orderTables ?? row?.tables ?? '—';
  }

  function floorText(row) {
    return row?.floor ?? row?.restaurantSectionName ?? row?.__sectionName ?? '—';
  }

  function waiterText(row) {
    return row?.waiter ?? '—';
  }

  function cashierText(row) {
    return row?.cashier ?? '—';
  }

  function openTime(row) {
    return row?.orderOpenDate ?? row?.openTime ?? row?.deliveryOpenTime ?? null;
  }

  function billTime(row) {
    return row?.orderBillTime ?? row?.billTime ?? null;
  }

  function closeTime(row) {
    return row?.orderCloseTime ?? row?.closeTime ?? row?.deliveryDeliveryCloseTime ?? null;
  }

  function statusLabel(row) {
    const stateName = orderState(row);
    if (stateName === 'closed') return 'Закрыт';
    if (stateName === 'open') return 'Открыт';
    return rawStatus(row) || 'Другой';
  }

  function paymentParts(row) {
    const payments = row?.payments ?? row?.Payments;
    if (!Array.isArray(payments)) return [];

    return payments
      .map(payment => ({
        name: payment?.name || payment?.Name || payment?.type || 'Оплата',
        amount: number(payment?.value ?? payment?.Value ?? payment?.sum ?? payment?.amount),
        type: payment?.type || payment?.Type || ''
      }))
      .filter(payment => payment.name);
  }

  function paymentText(row) {
    const parts = paymentParts(row);
    return parts.length ? parts.map(item => item.name).join(', ') : '—';
  }

  async function loadOrders() {
    if (state.busy) return;
    state.busy = true;

    try {
      await getPlugins();

      if (!state.pluginId) {
        state.orders = [];
        render();
        return;
      }

      const payload = await request('get_orders');
      const rows = extractListOrders(payload);
      const seen = new Set();

      state.orders = rows
        .map((row, index) => ({
          row,
          index,
          num: String(orderNumber(row, index))
        }))
        .filter(item => {
          if (seen.has(item.num)) return false;
          seen.add(item.num);
          return true;
        });

      $('cash-updated').textContent = `Обновлено ${new Date().toLocaleTimeString('ru-RU', {
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      })}`;

      $('technical-output').textContent = JSON.stringify(payload, null, 2);
      render();
    } catch (error) {
      $('connection').className = 'cash-connection offline';
      $('connection').textContent = '● Ошибка получения данных';
      $('orders').innerHTML = `<tr><td colspan="10" class="error-cell">${escape(error.message || error)}</td></tr>`;
      $('orders-footer').textContent = 'Не удалось получить данные от кассы.';
    } finally {
      state.busy = false;
    }
  }

  function filteredOrders() {
    const query = state.search.trim().toLowerCase();

    return state.orders.filter(item => {
      const row = item.row;
      const stateName = orderState(row);

      if (state.selectedFilter === 'open' && stateName !== 'open') return false;
      if (state.selectedFilter === 'closed' && stateName !== 'closed') return false;
      if (state.selectedFilter === 'other' && stateName !== 'other') return false;
      if (!query) return true;

      const haystack = [
        item.num,
        rawStatus(row),
        tableText(row),
        floorText(row),
        waiterText(row),
        cashierText(row),
        paymentText(row)
      ].join(' ').toLowerCase();

      return haystack.includes(query);
    });
  }

  function plural(n, one, few, many) {
    const x = Math.abs(n) % 100;
    const y = x % 10;
    if (x > 10 && x < 20) return many;
    if (y === 1) return one;
    if (y >= 2 && y <= 4) return few;
    return many;
  }

  function renderKpis() {
    let closedSum = 0;
    let openSum = 0;
    let closedCount = 0;
    let openCount = 0;
    let otherCount = 0;

    for (const item of state.orders) {
      const row = item.row;
      const stateName = orderState(row);
      const amount = orderAmount(row);

      if (stateName === 'closed') {
        closedCount++;
        if (Number.isFinite(amount)) closedSum += amount;
      } else if (stateName === 'open') {
        openCount++;
        if (Number.isFinite(amount)) openSum += amount;
      } else {
        otherCount++;
      }
    }

    $('closed-sum').textContent = money(closedSum);
    $('open-sum').textContent = money(openSum);
    $('expected-sum').textContent = money(closedSum + openSum);
    $('orders-count').textContent = state.orders.length.toLocaleString('ru-RU');
    $('closed-count').textContent = `${closedCount} ${plural(closedCount, 'заказ', 'заказа', 'заказов')}`;
    $('open-count').textContent = `${openCount} ${plural(openCount, 'заказ', 'заказа', 'заказов')}`;
    $('status-counts').textContent = `${closedCount} закрытых · ${openCount} открытых · ${otherCount} других`;

    return { closedSum, openSum, closedCount, openCount, otherCount };
  }

  function renderPayments() {
    const map = new Map();
    let total = 0;

    for (const item of state.orders) {
      if (orderState(item.row) !== 'closed') continue;

      for (const payment of paymentParts(item.row)) {
        const key = payment.name.trim() || 'Не указан';
        if (!map.has(key)) map.set(key, { name: key, amount: 0, count: 0 });
        const entry = map.get(key);
        if (Number.isFinite(payment.amount)) {
          entry.amount += payment.amount;
          total += payment.amount;
        }
        entry.count++;
      }
    }

    if (!map.size) {
      $('payments').innerHTML = '<div class="empty-state">Способ оплаты передаётся при открытии конкретного заказа.</div>';
      $('payments-total').textContent = '0,00';
      return;
    }

    const list = [...map.values()].sort((a, b) => b.amount - a.amount);
    const max = Math.max(...list.map(item => item.amount), 1);

    $('payments-total').textContent = money(total);
    $('payments').innerHTML = list.slice(0, 8).map(item => `
      <div class="payment-row">
        <div class="payment-name">
          ${escape(item.name)}
          <span class="payment-meta">${item.count} ${plural(item.count, 'заказ', 'заказа', 'заказов')} · ${total ? ((item.amount / total) * 100).toFixed(1) : '0.0'}%</span>
        </div>
        <div class="payment-track"><div class="payment-fill" style="width:${Math.max(2, (item.amount / max) * 100)}%"></div></div>
        <div class="payment-value">${escape(money(item.amount))}</div>
      </div>
    `).join('');
  }

  function renderStatuses(stats) {
    const total = state.orders.length || 1;
    const items = [
      ['Закрытые', 'closed', stats.closedCount],
      ['Открытые', 'open', stats.openCount],
      ['Другие', 'other', stats.otherCount]
    ];

    $('status-chart').innerHTML = items.map(([name, cls, count]) => `
      <div class="status-row">
        <div class="status-label">${name}</div>
        <div class="status-track"><div class="status-fill ${cls}" style="width:${count ? Math.max(2, (count / total) * 100) : 0}%"></div></div>
        <div class="status-value">${count} · ${((count / total) * 100).toFixed(0)}%</div>
      </div>
    `).join('');
  }

  function renderOrders() {
    const rows = filteredOrders();

    $('orders').innerHTML = rows.length
      ? rows.map(item => {
          const row = item.row;
          const stateName = orderState(row);
          return `
            <tr data-num="${escape(item.num)}">
              <td><span class="order-num">#${escape(item.num)}</span></td>
              <td><span class="order-status ${stateName}">${escape(statusLabel(row))}</span></td>
              <td>${escape(tableText(row))}</td>
              <td>${escape(floorText(row))}</td>
              <td>${escape(waiterText(row))}</td>
              <td class="order-amount">${escape(money(orderAmount(row)))}</td>
              <td>${escape(date(openTime(row)))}</td>
              <td>${escape(date(closeTime(row)))}</td>
              <td class="order-payment">${escape(paymentText(row))}</td>
              <td><span class="open-order">Открыть ↗</span></td>
            </tr>
          `;
        }).join('')
      : '<tr><td colspan="10" class="empty-cell">Заказы по выбранному фильтру не найдены.</td></tr>';

    $('orders-footer').textContent = `Показано ${rows.length} из ${state.orders.length} заказов · нажмите строку для подробностей`;

    $('orders').querySelectorAll('tr[data-num]').forEach(tr => {
      tr.addEventListener('click', () => openOrder(tr.dataset.num));
    });
  }

  function render() {
    const stats = renderKpis();
    renderPayments();
    renderStatuses(stats);
    renderOrders();
  }

  function scalarEntries(obj) {
    const out = [];
    const walk = (value, path = '', depth = 0) => {
      if (value == null || depth > 3 || Array.isArray(value)) return;
      if (typeof value !== 'object') {
        out.push([path, value]);
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (['items', 'payments', 'tips', 'discounts', 'surcharges', 'modifiers', 'raw'].includes(key.toLowerCase())) continue;
        const next = path ? `${path}.${key}` : key;
        if (child == null || typeof child !== 'object') out.push([next, child]);
        else if (depth < 2) walk(child, next, depth + 1);
      }
    };
    walk(obj);
    return out;
  }

  function findItems(row) {
    if (!row || typeof row !== 'object') return [];
    if (Array.isArray(row.items)) return row.items;
    if (Array.isArray(row.Items)) return row.Items;
    if (Array.isArray(row.orderItems)) return row.orderItems;
    return [];
  }

  function detailRoot(payload) {
    const root = unwrap(payload);
    return root?.data ?? root?.orderDetails ?? root?.order ?? root;
  }

  /*
   * The plugin contract uses RequestType=Order and RequestDetail=<order number>.
   * The VPS request bridge exposes aliases. We send the order number inside params
   * as well as the legacy name so the bridge/plugin can populate RequestDetail.
   */
  async function requestOrderDetail(num) {
    const params = {
      orderNum: String(num),
      requestDetail: String(num),
      RequestDetail: String(num),
      orderNumber: String(num)
    };

    try {
      const result = await request('get_order', { params });
      const root = detailRoot(result);
      if (root && typeof root === 'object' && (
        root.orderNum != null || root.revenue != null || root.items || root.payments || root.waiter != null
      )) return result;
    } catch (_) {
      // Try the native enum name below.
    }

    const result = await request('Order', { params });
    return result;
  }

  async function openOrder(num) {
    const modal = $('order-modal');
    modal.classList.remove('hidden');
    modal.setAttribute('aria-hidden', 'false');

    $('order-modal-title').textContent = `Заказ #${num}`;
    $('order-modal-subtitle').textContent = 'Загрузка полной информации…';
    $('order-details').innerHTML = '<div class="modal-loading">Получаем данные заказа…</div>';
    $('order-items').innerHTML = '';
    $('order-history').innerHTML = '<div class="modal-loading">Получаем историю событий…</div>';

    const base = state.orders.find(item => item.num === String(num))?.row || {};
    renderOrderDetails(base);

    try {
      const detailPayload = await requestOrderDetail(num);
      const order = detailRoot(detailPayload);

      if (!order || typeof order !== 'object') throw new Error('Пустой ответ детализации');

      $('technical-output').textContent = JSON.stringify(detailPayload, null, 2);
      renderOrderDetails(order);
      renderItems(order);
    } catch (error) {
      renderItems(base);
      $('order-modal-subtitle').textContent = `Детализация недоступна · ${error.message || 'ошибка запроса'}`;
    }

    try {
      const url = `/api/plugin/order-history?orderNum=${encodeURIComponent(num)}${state.pluginId ? `&pluginId=${encodeURIComponent(state.pluginId)}` : ''}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const history = unwrap(await response.json());
      renderHistory(history);
    } catch (_) {
      $('order-history').innerHTML = '<div class="modal-empty">История событий недоступна.</div>';
    }
  }

  function renderOrderDetails(row) {
    const stateName = orderState(row);
    const status = statusLabel(row);
    const amount = row?.revenue ?? row?.orderExpectedRevenue ?? row?.resultSum;

    $('order-modal-subtitle').textContent = `${status} · ${money(amount)}`;

    const payments = paymentParts(row);
    const paymentValue = payments.length
      ? payments.map(item => `${item.name}${Number.isFinite(item.amount) ? ` · ${money(item.amount)}` : ''}`).join(', ')
      : '—';

    const fields = [
      ['Статус', status],
      ['Сумма', money(amount)],
      ['Стол', row?.tables ?? row?.orderTables ?? '—'],
      ['Зал', row?.floor ?? row?.restaurantSectionName ?? row?.__sectionName ?? '—'],
      ['Официант', row?.waiter ?? '—'],
      ['Кассир', row?.cashier ?? '—'],
      ['Открыт', date(row?.openTime ?? row?.orderOpenDate)],
      ['Пречек', date(row?.billTime ?? row?.orderBillTime)],
      ['Закрыт', date(row?.closeTime ?? row?.orderCloseTime)],
      ['Оплата', paymentValue],
      ['Гости', row?.guestCount ?? row?.numberOfGuests ?? row?.guestsCount ?? '—'],
      ['Доставка', row?.isDelivery ? 'Да' : 'Нет']
    ];

    if (row?.deliveryServiceType) fields.push(['Тип доставки', row.deliveryServiceType]);
    if (row?.deliveryAddress) fields.push(['Адрес', row.deliveryAddress]);
    if (row?.deliveryClient) fields.push(['Клиент', row.deliveryClient]);
    if (row?.deliveryPhone) fields.push(['Телефон', row.deliveryPhone]);
    if (row?.reserveClientName) fields.push(['Резерв', row.reserveClientName]);

    $('order-details').innerHTML = fields.map(([key, value]) => `
      <div class="detail">
        <span>${escape(key)}</span>
        <strong>${escape(value)}</strong>
      </div>
    `).join('');
  }

  function renderItems(row) {
    const items = findItems(row);

    if (!items.length) {
      $('order-items').innerHTML = '<div class="modal-empty">Состав заказа не передан в ответе.</div>';
      return;
    }

    const rows = items.map((item, index) => {
      const name = first(item?.name ?? item?.Name ?? item?.productName ?? item?.itemName) || `Позиция ${index + 1}`;
      const qty = first(item?.amount ?? item?.Amount ?? item?.quantity ?? item?.Quantity) ?? '—';
      const price = number(item?.price ?? item?.Price);
      const sum = number(item?.resultSum ?? item?.ResultSum ?? item?.sum ?? item?.Sum);
      const size = first(item?.size ?? item?.Size);
      const status = first(item?.status ?? item?.Status);

      const modifiers = Array.isArray(item?.modifiers ?? item?.Modifiers)
        ? (item.modifiers ?? item.Modifiers).map(modifier => {
            const modifierName = first(modifier?.name ?? modifier?.Name) || 'Дополнение';
            const modifierAmount = first(modifier?.amount ?? modifier?.Amount);
            const modifierSum = number(modifier?.resultSum ?? modifier?.ResultSum);
            return `${modifierName}${modifierAmount != null ? ` × ${modifierAmount}` : ''}${Number.isFinite(modifierSum) ? ` · ${money(modifierSum)}` : ''}`;
          }).join(', ')
        : '';

      return `
        <tr>
          <td>
            <strong>${escape(name)}</strong>
            ${size ? `<small>${escape(size)}</small>` : ''}
            ${modifiers ? `<small>${escape(modifiers)}</small>` : ''}
          </td>
          <td>${escape(qty)}</td>
          <td>${escape(money(price))}</td>
          <td>${escape(money(sum))}</td>
          <td>${escape(status || '—')}</td>
        </tr>
      `;
    }).join('');

    $('order-items').innerHTML = `
      <div class="table-wrap">
        <table class="items-table">
          <thead>
            <tr><th>Позиция</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th>Статус</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  function historyRows(payload) {
    const root = unwrap(payload);
    if (Array.isArray(root)) return root;
    if (!root || typeof root !== 'object') return [];

    for (const key of ['events', 'history', 'items', 'data', 'result']) {
      if (root[key] !== undefined) {
        const rows = historyRows(root[key]);
        if (rows.length) return rows;
      }
    }

    return [];
  }

  function renderHistory(payload) {
    const rows = historyRows(payload);

    if (!rows.length) {
      $('order-history').innerHTML = '<div class="modal-empty">Для этого заказа событий пока нет.</div>';
      return;
    }

    rows.sort((a, b) => {
      const at = first(a?.timestamp ?? a?.eventTimestamp ?? a?.createdAt ?? a?.time ?? a?.date ?? a?.eventAt);
      const bt = first(b?.timestamp ?? b?.eventTimestamp ?? b?.createdAt ?? b?.time ?? b?.date ?? b?.eventAt);
      return timeValue(at) - timeValue(bt);
    });

    $('order-history').innerHTML = `
      <div class="timeline">
        ${rows.map((event, index) => {
          const timestamp = first(event?.timestamp ?? event?.eventTimestamp ?? event?.createdAt ?? event?.time ?? event?.date ?? event?.eventAt);
          const title = first(event?.eventName ?? event?.eventType ?? event?.type ?? event?.name ?? event?.action ?? event?.operation) || `Событие ${index + 1}`;
          const actor = first(event?.userName ?? event?.employeeName ?? event?.waiterName ?? event?.cashierName ?? event?.user ?? event?.employee);
          const scalars = scalarEntries(event).slice(0, 14);

          return `
            <article class="timeline-item">
              <div class="timeline-time">${escape(date(timestamp))}</div>
              <div class="timeline-title">${escape(title)}</div>
              ${actor ? `<div class="timeline-time">Исполнитель: ${escape(actor)}</div>` : ''}
              ${scalars.length ? `<div class="timeline-data">${escape(scalars.map(([key, value]) => `${key}: ${value}`).join('\n'))}</div>` : ''}
            </article>
          `;
        }).join('')}
      </div>
    `;
  }

  function closeModal() {
    $('order-modal').classList.add('hidden');
    $('order-modal').setAttribute('aria-hidden', 'true');
  }

  $('refresh').addEventListener('click', loadOrders);
  $('search').addEventListener('input', event => {
    state.search = event.target.value;
    renderOrders();
  });

  $('filters').addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    state.selectedFilter = button.dataset.filter;
    $('filters').querySelectorAll('.filter').forEach(item => {
      item.classList.toggle('active', item === button);
    });
    renderOrders();
  });

  document.querySelectorAll('[data-close-modal]').forEach(item => {
    item.addEventListener('click', closeModal);
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeModal();
  });

  loadOrders();
  state.timer = setInterval(loadOrders, 10000);
})();
