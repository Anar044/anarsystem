(() => {
  const root = document.getElementById('order-history');
  if (!root) return;

  // Translate the real event coming from the plugin before cash.js renders it.
  // This keeps the UI semantic instead of guessing from the already formatted text.
  const originalFetch = window.fetch.bind(window);

  const clean = value => String(value ?? '').trim();
  const compact = value => clean(value).toLowerCase().replace(/[\s_-]/g, '');

  function eventTitle(event) {
    const type = compact(event?.pluginEventType ?? event?.eventType ?? event?.type ?? event?.Type);
    const d = event?.data ?? event?.Data ?? {};
    const blob = JSON.stringify(d).toLowerCase();
    const product = clean(d.productName ?? d.name ?? d.Name ?? d.discountName ?? d.surchargeName);
    const productText = product.toLowerCase();

    if (type === 'neworder' || type === 'ordercreated') return 'Заказ создан';
    if (type === 'orderupdated' || type === 'orderupdate') return 'Заказ обновлён';
    if (type === 'orderguestsbill' || type === 'guestbill' || type === 'orderbill') return 'Выставлен счёт';
    if (type === 'closingorder') return 'Заказ закрыт';
    if (type === 'closedorder' || type === 'orderclosed') return 'Заказ закрыт';
    if (type === 'payment' || type === 'paymentadded' || type === 'orderpayment') return 'Оплата заказа';

    // The plugin uses one event for adding a discount/surcharge item.
    if (type === 'adddiscountsurchargeitem' || type === 'adddiscountsurcharge') {
      const isDiscount = d.isDiscount ?? d.IsDiscount ?? d.discount ?? d.Discount;
      if (isDiscount === true || /discount|скид/.test(blob) || /скид/.test(productText)) return 'Применена скидка';
      return 'Применена надбавка';
    }

    // Printed-item deletion can be either a normal dish, a discount or a surcharge.
    if (type === 'deletionofprinteditem' || type === 'deleteprinteditem' || type === 'deletedprinteditem') {
      if (/discount|скид/.test(blob) || /скид/.test(productText)) return 'Удалена скидка';
      if (/surcharge|increase|надбав/.test(blob) || /надбав/.test(productText)) return 'Удалена надбавка';
      return 'Удалено блюдо';
    }

    if (type === 'discount' || type === 'orderdiscount') return 'Применена скидка';
    if (type === 'increase' || type === 'surcharge' || type === 'ordersurcharge') return 'Применена надбавка';
    if (type === 'removediscount') return 'Удалена скидка';
    if (type === 'removesurcharge') return 'Удалена надбавка';
    if (type === 'additem' || type === 'addorderitem' || type === 'addeditem') return 'Добавлено блюдо';
    if (type === 'removeitem' || type === 'removeorderitem' || type === 'deleteditem') return 'Удалено блюдо';
    if (type === 'cancelguestbill' || type === 'cancellationofguestbill') return 'Счёт отменён';
    if (type === 'ordercancelled' || type === 'cancelorder') return 'Заказ отменён';
    if (type === 'tablechanged' || type === 'ordertablechanged') return 'Изменён стол';
    if (type === 'waiterchanged' || type === 'orderwaiterchanged') return 'Изменён официант';
    if (type === 'cashregisterstart' || type === 'opencashregistershift') return 'Кассовая смена открыта';
    if (type === 'cashregistershutdown' || type === 'closecashregistershift') return 'Кассовая смена закрыта';

    return null;
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

        const translated = events.map(event => {
          const title = eventTitle(event);
          if (!title) return event;
          return { ...event, pluginEventType: title };
        });

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

  // Keep the visual polishing already applied by cash-history.css.
  const observer = new MutationObserver(() => {});
  observer.observe(root, { childList: true, subtree: true });
})();
