(() => {
  const root = document.getElementById('order-history');
  if (!root) return;

  const originalFetch = window.fetch.bind(window);
  const clean = value => String(value ?? '').trim();
  const compact = value => clean(value).toLowerCase().replace(/[\s_-]/g, '');
  const isSet = value => value !== undefined && value !== null && value !== '';

  const pick = (obj, keys) => {
    for (const key of keys) {
      const value = obj?.[key];
      if (isSet(value)) return value;
    }
    return null;
  };

  const numberValue = value => {
    if (!isSet(value)) return null;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    const n = Number(String(value).replace(/\s/g, '').replace(',', '.').replace(/[^0-9+\-.]/g, ''));
    return Number.isFinite(n) ? n : null;
  };

  function eventTitle(event) {
    const type = compact(pick(event, ['pluginEventType','eventType','type','Type']));
    const d = event?.data ?? event?.Data ?? {};
    const blob = JSON.stringify(d).toLowerCase();
    const name = clean(pick(d, ['name','Name','productName','ProductName','itemName','ItemName','orderItemName','OrderItemName','dishName','DishName','discountName','DiscountName','surchargeName','SurchargeName']));

    if (type === 'neworder' || type === 'ordercreated') return 'Заказ создан';
    if (type === 'orderupdated' || type === 'orderupdate') return 'Заказ обновлён';
    if (type === 'orderguestsbill' || type === 'guestbill' || type === 'orderbill') return 'Выставлен счёт';
    if (type === 'closingorder' || type === 'closedorder' || type === 'orderclosed') return 'Заказ закрыт';
    if (type === 'payment' || type === 'paymentadded' || type === 'orderpayment') return 'Оплата заказа';
    if (type === 'cancelguestbill' || type === 'cancellationofguestbill') return 'Счёт отменён';
    if (type === 'ordercancelled' || type === 'cancelorder') return 'Заказ отменён';

    // Deletions are checked before generic add/discount/surcharge rules.
    if (type === 'deletionofprinteditem' || type === 'deleteprinteditem' || type === 'deletedprinteditem') {
      if (/discount|скид/.test(blob) || /скид/.test(name.toLowerCase())) return 'Удалена скидка';
      if (/surcharge|increase|надбав/.test(blob) || /надбав/.test(name.toLowerCase())) return 'Удалена надбавка';
      return 'Удалено блюдо';
    }

    if (type === 'adddiscountsurchargeitem' || type === 'adddiscountsurcharge') {
      const isDiscount = pick(d, ['isDiscount','IsDiscount','discount','Discount']);
      if (isDiscount === true || /discount|скид/.test(blob) || /скид/.test(name.toLowerCase())) return 'Применена скидка';
      return 'Применена надбавка';
    }

    if (type === 'addingdiscount' || type === 'discount' || type === 'orderdiscount') return 'Применена скидка';
    if (type === 'addingsurcharge' || type === 'increase' || type === 'surcharge' || type === 'ordersurcharge') return 'Применена надбавка';
    if (type === 'removediscount' || type === 'deletingdiscount' || type === 'removingdiscount') return 'Удалена скидка';
    if (type === 'removesurcharge' || type === 'deletingsurcharge' || type === 'removingsurcharge') return 'Удалена надбавка';
    if (type === 'additem' || type === 'addorderitem' || type === 'addeditem') return 'Добавлено блюдо';
    if (type === 'removeitem' || type === 'removeorderitem' || type === 'deleteditem') return 'Удалено блюдо';
    if (type === 'tablechanged' || type === 'ordertablechanged') return 'Изменён стол';
    if (type === 'waiterchanged' || type === 'orderwaiterchanged') return 'Изменён официант';
    if (type === 'cashregisterstart' || type === 'opencashregistershift') return 'Кассовая смена открыта';
    if (type === 'cashregistershutdown' || type === 'closecashregistershift') return 'Кассовая смена закрыта';

    return null;
  }

  function enrichEvent(event) {
    const source = event?.data ?? event?.Data ?? {};
    const d = { ...source };
    const title = eventTitle(event);
    const type = compact(pick(event, ['pluginEventType','eventType','type','Type']));
    const name = pick(d, [
      'name','Name','productName','ProductName','itemName','ItemName','orderItemName','OrderItemName',
      'dishName','DishName','item','Item','product','Product','discountName','DiscountName','surchargeName','SurchargeName',
      'printedItemName','PrintedItemName'
    ]);
    const quantity = pick(d, ['quantity','Quantity','qty','Qty','count','Count','itemQuantity','ItemQuantity','value','Value']);
    const price = pick(d, ['price','Price','unitPrice','UnitPrice','itemPrice','ItemPrice']);
    const itemSum = pick(d, ['sum','Sum','itemSum','ItemSum','resultSum','ResultSum','result','Result','cost','Cost','amount','Amount']);
    const orderRevenue = pick(d, ['revenue','Revenue','orderRevenue','OrderRevenue']);

    // Normalize the different payload shapes used by order operations so the existing
    // history renderer can always show the affected object, quantity and amount.
    if (!isSet(d.name) && isSet(name)) d.name = name;
    if (!isSet(d.value) && isSet(quantity)) d.value = quantity;
    if (!isSet(d.price) && isSet(price)) d.price = price;
    if (!isSet(d.sum) && isSet(itemSum)) d.sum = itemSum;

    const itemOperation = /delete|remove|additem|addeditem|itemadd|itemremove|printeditem|addingdiscount|addingsurcharge|discount|surcharge|increase/.test(type);
    if (itemOperation && !isSet(d.revenue) && isSet(itemSum)) d.revenue = itemSum;

    // Keep a human-readable operation payload available for future renderers too.
    d.__history = {
      title: title || clean(pick(event, ['pluginEventType','eventType','type','Type'])) || 'Событие',
      itemName: clean(name),
      quantity: numberValue(quantity),
      price: numberValue(price),
      sum: numberValue(itemSum),
      orderRevenue: numberValue(orderRevenue),
      waiter: clean(pick(d, ['waiter','Waiter'])),
      cashier: clean(pick(d, ['cashier','Cashier'])),
      table: clean(pick(d, ['orderTables','OrderTables','table','Table','tables','Tables'])),
      floor: clean(pick(d, ['floor','Floor','restaurantSectionName','RestaurantSectionName'])),
      status: clean(pick(d, ['orderStatus','OrderStatus','status','Status']))
    };

    return { ...event, pluginEventType: title || event?.pluginEventType, data: d };
  }

  if (!window.__cashHistoryTranslatorInstalled) {
    window.__cashHistoryTranslatorInstalled = true;
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      try {
        const input = args[0];
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        if (!url.pathname.includes('/api/plugin/order-history')) return response;

        const payload = await response.clone().json();
        const events = payload?.events ?? payload?.data?.events ?? payload?.history ?? payload?.data;
        if (!Array.isArray(events)) return response;

        const translated = events.map(enrichEvent);
        const out = structuredClone(payload);
        if (Array.isArray(out.events)) out.events = translated;
        else if (out?.data && Array.isArray(out.data.events)) out.data.events = translated;
        else if (Array.isArray(out.history)) out.history = translated;
        else if (Array.isArray(out.data)) out.data = translated;

        return new Response(JSON.stringify(out), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers
        });
      } catch {
        return response;
      }
    };
  }

  const observer = new MutationObserver(() => {});
  observer.observe(root, { childList: true, subtree: true });
})();
