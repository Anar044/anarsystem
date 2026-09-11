(() => {
  'use strict';

  // The cash page sends order detail parameters inside `params`, while the
  // Plugin expects RequestDetail/requestDetail at the top level of the
  // server_to_plugin request. Normalize that request here without touching
  // the existing cash UI or order loading logic.
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
    } catch (_) {
      // Leave unrelated requests untouched.
    }

    return originalFetch(input, init);
  };
})();
