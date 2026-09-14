(function () {
  'use strict';

  // Incoming invoices are now enriched on the backend with supplierName,
  // storeName and productName using the shared D1/reference cache. Keep this
  // tiny compatibility marker because nakladnye.html still loads the historic
  // filename, but do not intercept fetch or issue duplicate reference calls.
  window.SHNakladnyeNames = {
    source: 'backend-enriched',
    active: false
  };
})();
