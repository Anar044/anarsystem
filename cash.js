(() => {
  const $ = id => document.getElementById(id);

  const state = {
    plugins: [],
    pluginId: '',
    orders: [],
    selectedFilter: 'all',
    search: '',
    timer: null,
    busy: false,
    detailCache: new Map(),
    paymentLoading: new Set()
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
    for (const key of ['name', 'Name', 'title', 'Title', 'value', 'Value', 'number', 'Number', 'code', 'Code', 'id', 'Id']) {
      if (value[key] != null && value[key] !== '') return value[key];
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
    return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
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
        let list = Array.isArray(data) ? data : (data?.plugins || data?.data || data?.items || []);
        if (!Array.isArray(list)) list = [];

        state.plugins = list.map(item => item?.data ? { ...item, ...item.data } : item).filter(Boolean);
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
    try { data = JSON.parse(text); }
    catch { throw new Error(`Плагин вернул не JSON (HTTP ${response.status})`); }

    if (!response.ok || (data?.success === false && data?.error)) {
      throw new Error(data?.error || `HTTP ${response.status}`);
    }
    return unwrap(data);
  }

  function extractListOrders(payload) {
    const root = unwrap(payload)?.data ?? unwrap(payload) ?? {};
    const groups = Array.isArray(root.terminalsGroups) ? root.terminalsGroups : [];
    const result = [];

    for (const group of groups) {
      const sections = Array.isArray(group?.restaurantSections) ? group.restaurantSections : [];
      for (const section of sections) {
        const sectionName = section?.restaurantSectionName || '';
        for (const row of Array.isArray(section?.orders) ? section.orders : []) {
          result.push({ ...row, __sectionName: sectionName, __source: 'order' });
        }
        for (const row of Array.isArray(section?.deliveries) ? section.deliveries : []) {
          result.push({ ...row, __sectionName: sectionName, __source: 'delivery' });
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
    if (['closed', 'paid', 'закрыт', 'закрыто'].includes(status)) return 'closed';
    if (['new', 'bill', 'open', 'opened', 'открыт', 'открыто', 'новый'].includes(status)) return 'open';
    if (row?.orderCloseTime || row?.closeTime) return 'closed';
    return 'other';
  }

  function orderNumber(row, index = 0) {
    return row?.orderNum ?? row?.number ?? index + 1;
  }

  function orderAmount(row) {
    return number(row?.orderExpectedRevenue ?? row?.revenue ?? row?.resultSum ?? row?.orderSum);
  }

  function tableText(row) { return row?.orderTables ?? row?.tables ?? '—'; }
  function floorText(row) { return row?.floor ?? row?.restaurantSectionName ?? row?.__sectionName ?? '—'; }
  function waiterText(row) { return row?.waiter ?? '—'; }
  function cashierText(row) { return row?.cashier ?? '—'; }
  function openTime(row) { return row?.orderOpenDate ?? row?.openTime ?? row?.deliveryOpenTime ?? null; }
  function billTime(row) { return row?.orderBillTime ?? row?.billTime ?? null; }
  function closeTime(row) { return row?.orderCloseTime ?? row?.closeTime ?? row?.deliveryDeliveryCloseTime ?? null; }

  function statusLabel(row) {
    const stateName = orderState(row);
    if (stateName === 'closed') return 'Закрыт';
    if (stateName === 'open') return 'Открыт';
    return rawStatus(row) || 'Другой';
  }

  function paymentArray(row) {
    if (!row || typeof row !== 'object') return [];
    const candidates = [
      row.payments, row.Payments,
      row.paymentItems, row.PaymentItems,
      row.__detail?.payments, row.__detail?.Payments,
      row.__detail?.paymentItems, row.__detail?.PaymentItems
    ];
    for (const value of candidates) if (Array.isArray(value)) return value;
    return [];
  }

  function paymentParts(row) {
    return paymentArray(row).map(payment => {
      const name = payment?.name ?? payment?.Name ?? payment?.typeName ?? payment?.TypeName ?? payment?.type ?? payment?.Type ?? '';
      const amount = number(payment?.value ?? payment?.Value ?? payment?.sum ?? payment?.Sum ?? payment?.amount ?? payment?.Amount);
      return { name: String(name || 'Оплата'), amount };
    }).filter(item => item.name);
  }

  function paymentText(row) {
    const parts = paymentParts(row);
    return parts.length ? parts.map(item => item.name).join(', ') : '—';
  }

  function detailRoot(payload) {
    const root = unwrap(payload);
    return root?.data ?? root?.orderDetails ?? root?.order ?? root;
  }

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
        root.orderNum != null || root.OrderNum != null || root.revenue != null || root.Revenue != null || root.items || root.Items || root.payments || root.Payments
      )) return result;
    } catch (_) {}

    return request('Order', { params });
  }

  async function enrichClosedPayments() {
    const candidates = state.orders.filter(item => orderState(item.row) === 'closed' && !paymentParts(item.row).length);
    const queue = candidates.filter(item => !state.paymentLoading.has(item.num) && !state.detailCache.has(item.num));
    if (!queue.length) return;

    queue.forEach(item => state.paymentLoading.add(item.num));
    let cursor = 0;

    const worker = async () => {
      while (cursor < queue.length) {
        const item = queue[cursor++];
        try {
          const payload = await requestOrderDetail(item.num);
          const detail = detailRoot(payload);
          if (detail && typeof detail === 'object') {
            state.detailCache.set(item.num, detail);
            item.row.__detail = detail;
            renderPayments();
            renderOrders();
          }
        } catch (_) {
          state.detailCache.set(item.num, null);
        } finally {
          state.paymentLoading.delete(item.num);
        }
      }
    };

    await Promise.all([worker(), worker(), worker()]);
    renderPayments();
    renderOrders();
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

      state.orders = rows.map((row, index) => ({
        row: state.detailCache.has(String(orderNumber(row, index))) && state.detailCache.get(String(orderNumber(row, index)))
          ? { ...row, __detail: state.detailCache.get(String(orderNumber(row, index))) }
          : row,
        index,
        num: String(orderNumber(row, index))
      })).filter(item => {
        if (seen.has(item.num)) return false;
        seen.add(item.num);
        return true;
      });

      $('cash-updated').textContent = `Обновлено ${new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
      $('technical-output').textContent = JSON.stringify(payload, null, 2);
      render();
      enrichClosedPayments();
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
      return [item.num, rawStatus(row), tableText(row), floorText(row), waiterText(row), cashierText(row), paymentText(row)]
        .join(' ').toLowerCase().includes(query);
    });
  }

  function plural(n, one, few, many) {
    const x = Math.abs(n) % 100, y = x % 10;
    if (x > 10 && x < 20) return many;
    if (y === 1) return one;
    if (y >= 2 && y <= 4) return few;
    return many;
  }

  function renderKpis() {
    let closedSum = 0, openSum = 0, closedCount = 0, openCount = 0, otherCount = 0;
    for (const item of state.orders) {
      const type = orderState(item.row), amount = orderAmount(item.row);
      if (type === 'closed') { closedCount++; if (Number.isFinite(amount)) closedSum += amount; }
      else if (type === 'open') { openCount++; if (Number.isFinite(amount)) openSum += amount; }
      else otherCount++;
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
        if (Number.isFinite(payment.amount)) { entry.amount += payment.amount; total += payment.amount; }
        entry.count++;
      }
    }

    if (!map.size) {
      $('payments').innerHTML = '<div class="empty-state">Получаем способы оплаты из детализации закрытых заказов…</div>';
      $('payments-total').textContent = '0,00';
      return;
    }

    const list = [...map.values()].sort((a, b) => b.amount - a.amount);
    const max = Math.max(...list.map(item => item.amount), 1);
    $('payments-total').textContent = money(total);
    $('payments').innerHTML = list.slice(0, 8).map(item => `
      <div class="payment-row">
        <div class="payment-name">${escape(item.name)}<span class="payment-meta">${item.count} ${plural(item.count, 'заказ', 'заказа', 'заказов')} · ${total ? ((item.amount / total) * 100).toFixed(1) : '0.0'}%</span></div>
        <div class="payment-track"><div class="payment-fill" style="width:${Math.max(2, (item.amount / max) * 100)}%"></div></div>
        <div class="payment-value">${escape(money(item.amount))}</div>
      </div>`).join('');
  }

  function renderStatuses(stats) {
    const total = state.orders.length || 1;
    const items = [['Закрытые', 'closed', stats.closedCount], ['Открытые', 'open', stats.openCount], ['Другие', 'other', stats.otherCount]];
    $('status-chart').innerHTML = items.map(([name, cls, count]) => `
      <div class="status-row"><div class="status-label">${name}</div><div class="status-track"><div class="status-fill ${cls}" style="width:${count ? Math.max(2, (count / total) * 100) : 0}%"></div></div><div class="status-value">${count} · ${((count / total) * 100).toFixed(0)}%</div></div>`).join('');
  }

  function renderOrders() {
    const rows = filteredOrders();
    $('orders').innerHTML = rows.length ? rows.map(item => {
      const row = item.row, type = orderState(row);
      const payment = paymentText(row);
      const paymentPending = type === 'closed' && payment === '—' && !state.detailCache.has(item.num);
      return `
        <tr data-num="${escape(item.num)}">
          <td><span class="order-num">#${escape(item.num)}</span></td>
          <td><span class="order-status ${type}">${escape(statusLabel(row))}</span></td>
          <td>${escape(tableText(row))}</td>
          <td>${escape(floorText(row))}</td>
          <td>${escape(waiterText(row))}</td>
          <td class="order-amount">${escape(money(orderAmount(row)))}</td>
          <td>${escape(date(openTime(row)))}</td>
          <td>${escape(date(closeTime(row)))}</td>
          <td class="order-payment">${paymentPending ? '<span class="payment-loading">Загрузка…</span>' : escape(payment)}</td>
          <td><span class="open-order">Открыть ↗</span></td>
        </tr>`;
    }).join('') : '<tr><td colspan="10" class="empty-cell">Заказы по выбранному фильтру не найдены.</td></tr>';

    $('orders-footer').textContent = `Показано ${rows.length} из ${state.orders.length} заказов · нажмите строку для подробностей`;
    $('orders').querySelectorAll('tr[data-num]').forEach(tr => tr.addEventListener('click', () => openOrder(tr.dataset.num)));
  }

  function render() {
    const stats = renderKpis();
    renderPayments();
    renderStatuses(stats);
    renderOrders();
  }

  function findItems(row) {
    if (!row || typeof row !== 'object') return [];
    return Array.isArray(row.items) ? row.items : Array.isArray(row.Items) ? row.Items : Array.isArray(row.orderItems) ? row.orderItems : [];
  }

  function renderOrderDetails(row) {
    const status = statusLabel(row);
    const amount = row?.revenue ?? row?.Revenue ?? row?.orderExpectedRevenue ?? row?.resultSum;
    $('order-modal-subtitle').textContent = `${status} · ${money(amount)}`;

    const payments = paymentParts(row);
    const paymentValue = payments.length
      ? payments.map(item => `${item.name}${Number.isFinite(item.amount) ? ` · ${money(item.amount)}` : ''}`).join(', ')
      : '—';

    const fields = [
      ['Статус', status],
      ['Сумма', money(amount)],
      ['Стол', row?.tables ?? row?.Tables ?? row?.orderTables ?? '—'],
      ['Зал', row?.floor ?? row?.Floor ?? row?.restaurantSectionName ?? row?.__sectionName ?? '—'],
      ['Официант', row?.waiter ?? row?.Waiter ?? '—'],
      ['Кассир', row?.cashier ?? row?.Cashier ?? '—'],
      ['Открыт', date(row?.openTime ?? row?.OpenTime ?? row?.orderOpenDate)],
      ['Пречек', date(row?.billTime ?? row?.BillTime ?? row?.orderBillTime)],
      ['Закрыт', date(row?.closeTime ?? row?.CloseTime ?? row?.orderCloseTime)],
      ['Оплата', paymentValue],
      ['Гости', row?.guestCount ?? row?.GuestCount ?? row?.numberOfGuests ?? row?.guestsCount ?? '—'],
      ['Доставка', row?.isDelivery ?? row?.IsDelivery ? 'Да' : 'Нет']
    ];

    if (row?.deliveryServiceType ?? row?.DeliveryServiceType) fields.push(['Тип доставки', row.deliveryServiceType ?? row.DeliveryServiceType]);
    if (row?.deliveryAddress ?? row?.DeliveryAddress) fields.push(['Адрес', row.deliveryAddress ?? row.DeliveryAddress]);
    if (row?.deliveryClient ?? row?.DeliveryClient) fields.push(['Клиент', row.deliveryClient ?? row.DeliveryClient]);
    if (row?.deliveryPhone ?? row?.DeliveryPhone) fields.push(['Телефон', row.deliveryPhone ?? row.DeliveryPhone]);
    if (row?.reserveClientName ?? row?.ReserveClientName) fields.push(['Резерв', row.reserveClientName ?? row.ReserveClientName]);

    $('order-details').innerHTML = fields.map(([key, value]) => `<div class="detail"><span>${escape(key)}</span><strong>${escape(value)}</strong></div>`).join('');
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
      const modifierList = item?.modifiers ?? item?.Modifiers;
      const modifiers = Array.isArray(modifierList) ? modifierList.map(modifier => {
        const modifierName = first(modifier?.name ?? modifier?.Name) || 'Дополнение';
        const modifierAmount = first(modifier?.amount ?? modifier?.Amount);
        const modifierSum = number(modifier?.resultSum ?? modifier?.ResultSum);
        return `${modifierName}${modifierAmount != null ? ` × ${modifierAmount}` : ''}${Number.isFinite(modifierSum) ? ` · ${money(modifierSum)}` : ''}`;
      }).join(', ') : '';

      return `<tr><td><strong>${escape(name)}</strong>${size ? `<small>${escape(size)}</small>` : ''}${modifiers ? `<small>${escape(modifiers)}</small>` : ''}</td><td>${escape(qty)}</td><td>${escape(money(price))}</td><td>${escape(money(sum))}</td><td>${escape(status || '—')}</td></tr>`;
    }).join('');

    $('order-items').innerHTML = `<div class="table-wrap"><table class="items-table"><thead><tr><th>Позиция</th><th>Кол-во</th><th>Цена</th><th>Сумма</th><th>Статус</th></tr></thead><tbody>${rows}</tbody></table></div>`;
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

  function eventData(event) {
    return event?.data ?? event?.Data ?? event?.payload ?? event?.Payload ?? {};
  }

  function eventTimestamp(event) {
    return first(event?.receivedAt ?? event?.ReceivedAt ?? event?.timestamp ?? event?.eventTimestamp ?? event?.createdAt ?? event?.time ?? event?.date ?? event?.eventAt);
  }

  function eventType(event) {
    return String(event?.pluginEventType ?? event?.PluginEventType ?? event?.eventType ?? event?.EventType ?? event?.type ?? event?.name ?? event?.action ?? event?.operation ?? '').trim();
  }

  function readableEventTitle(type, data) {
    const key = type.toLowerCase().replace(/\s+/g, '');
    const map = {
      neworder: 'Заказ создан',
      ordercreated: 'Заказ создан',
      createorder: 'Заказ создан',
      updateorder: 'Заказ обновлён',
      orderupdated: 'Заказ обновлён',
      orderopen: 'Заказ открыт',
      orderopened: 'Заказ открыт',
      orderbill: 'Выставлен пречек',
      bill: 'Выставлен пречек',
      orderclosed: 'Заказ закрыт',
      closeorder: 'Заказ закрыт',
      payment: 'Оплата заказа',
      orderpayment: 'Оплата заказа',
      orderdeleted: 'Заказ удалён',
      deleteorder: 'Заказ удалён'
    };
    if (map[key]) return map[key];

    const fallback = type || first(data?.name ?? data?.Name) || 'Событие';
    return String(fallback)
      .replace(/([a-zа-я])([A-ZА-Я])/g, '$1 $2')
      .replace(/[_-]+/g, ' ')
      .replace(/^./, char => char.toUpperCase());
  }

  function eventFields(event) {
    const data = eventData(event);
    const fields = [];
    const add = (label, value, format = String) => {
      if (value == null || value === '') return;
      fields.push([label, format(value)]);
    };

    add('Стол', data.tables ?? data.Tables ?? data.table ?? data.Table ?? data.orderTables ?? data.OrderTables);
    add('Официант', data.waiter ?? data.Waiter ?? data.waiterName ?? data.WaiterName);
    add('Кассир', data.cashier ?? data.Cashier ?? data.cashierName ?? data.CashierName);
    add('Сумма', data.revenue ?? data.Revenue ?? data.orderExpectedRevenue ?? data.OrderExpectedRevenue, money);
    add('Статус', data.orderStatus ?? data.OrderStatus ?? data.status ?? data.Status);
    add('Позиция', data.name ?? data.Name ?? data.productName ?? data.ProductName);
    add('Значение', data.value ?? data.Value, value => Number.isFinite(number(value)) ? money(value) : String(value));
    add('Зал', data.floor ?? data.Floor ?? data.restaurantSectionName ?? data.RestaurantSectionName);

    return fields.slice(0, 8);
  }

  function renderHistory(payload) {
    const rows = historyRows(payload);
    if (!rows.length) {
      $('order-history').innerHTML = '<div class="modal-empty">Для этого заказа событий пока нет.</div>';
      return;
    }

    rows.sort((a, b) => timeValue(eventTimestamp(a)) - timeValue(eventTimestamp(b)));
    $('order-history').innerHTML = `<div class="timeline">${rows.map((event, index) => {
      const type = eventType(event);
      const data = eventData(event);
      const timestamp = eventTimestamp(event);
      const title = readableEventTitle(type, data);
      const fields = eventFields(event);
      const note = fields.length ? '' : 'Подробных пользовательских данных для этого события нет.';
      return `<article class="timeline-item">
        <div class="timeline-top"><span class="timeline-index">Событие ${index + 1}</span><span class="timeline-time">${escape(date(timestamp))}</span></div>
        <div class="timeline-title">${escape(title)}</div>
        ${fields.length ? `<div class="timeline-grid">${fields.map(([label, value]) => `<div class="timeline-field"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`).join('')}</div>` : ''}
        ${note ? `<div class="timeline-note">${escape(note)}</div>` : ''}
      </article>`;
    }).join('')}</div>`;
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
      state.detailCache.set(String(num), order);
      const item = state.orders.find(entry => entry.num === String(num));
      if (item) item.row.__detail = order;
      $('technical-output').textContent = JSON.stringify(detailPayload, null, 2);
      renderOrderDetails(order);
      renderItems(order);
      renderPayments();
      renderOrders();
    } catch (error) {
      renderItems(base);
      $('order-modal-subtitle').textContent = `Детализация недоступна · ${error.message || 'ошибка запроса'}`;
    }

    try {
      const url = `/api/plugin/order-history?orderNum=${encodeURIComponent(num)}${state.pluginId ? `&pluginId=${encodeURIComponent(state.pluginId)}` : ''}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      renderHistory(await response.json());
    } catch (_) {
      $('order-history').innerHTML = '<div class="modal-empty">История событий недоступна.</div>';
    }
  }

  function closeModal() {
    $('order-modal').classList.add('hidden');
    $('order-modal').setAttribute('aria-hidden', 'true');
  }

  $('refresh').addEventListener('click', loadOrders);
  $('search').addEventListener('input', event => { state.search = event.target.value; renderOrders(); });
  $('filters').addEventListener('click', event => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    state.selectedFilter = button.dataset.filter;
    $('filters').querySelectorAll('.filter').forEach(item => item.classList.toggle('active', item === button));
    renderOrders();
  });
  document.querySelectorAll('[data-close-modal]').forEach(item => item.addEventListener('click', closeModal));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') closeModal(); });

  loadOrders();
  state.timer = setInterval(loadOrders, 10000);
})();
