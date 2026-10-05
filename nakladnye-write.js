(function () {
  'use strict';

  var refs = { loaded: false, suppliers: [], warehouses: [], products: [], productLabelToId: new Map(), productIdToLabel: new Map() };
  var current = null;
  var loadingRefs = null;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  async function boundedFetch(url, options, timeoutMs) {
    var timeout = Number(timeoutMs || 90000);
    if (window.SH_IikoContext && typeof window.SH_IikoContext.fetchWithTimeout === 'function') {
      return window.SH_IikoContext.fetchWithTimeout(url, options || {}, timeout);
    }
    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, timeout);
    try {
      return await fetch(url, Object.assign({}, options || {}, { signal: controller.signal }));
    } catch (error) {
      if (error && error.name === 'AbortError') {
        throw new Error('Smart Horeca API не ответил за ' + Math.ceil(timeout / 1000) + ' секунд. Повторите запрос.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function autoDocumentNumber() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return 'SH-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  async function getConn() {
    if (!window.SH_IikoContext || !window.SH_IikoContext.get) throw new Error('Контекст iiko не загружен.');
    var state = await window.SH_IikoContext.get();
    var c = state && state.connection;
    if (!c || !c.ip || !c.port || !c.login || !c.password) throw new Error('Нет подключения к iiko Server. Откройте «Настройки».');
    return c;
  }

  function setEditorStatus(text, kind) {
    var el = $('inc-entry-status');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'inc-entry-status ' + (kind || '');
  }

  function addStyles() {
    if ($('incoming-entry-v2-style')) return;
    var style = document.createElement('style');
    style.id = 'incoming-entry-v2-style';
    style.textContent =
      '.inc-editor{position:fixed;inset:0;z-index:9999;background:rgba(3,7,11,.72);backdrop-filter:blur(8px);display:grid;place-items:center;padding:18px}' +
      '.inc-editor[hidden]{display:none}.inc-dialog{width:min(1180px,97vw);max-height:94vh;overflow:auto;background:#111923;border:1px solid rgba(255,255,255,.1);border-radius:18px;box-shadow:0 30px 90px rgba(0,0,0,.5);color:#e8edf2}' +
      '.inc-head{display:flex;justify-content:space-between;align-items:center;padding:16px 18px;border-bottom:1px solid rgba(255,255,255,.08);position:sticky;top:0;background:#111923;z-index:2}.inc-head strong{font-size:16px}.inc-head button{font-size:20px}' +
      '.inc-body{padding:18px}.inc-entry-status{min-height:18px;margin-bottom:12px;color:#91a0af;font-size:12px}.inc-entry-status.loading{color:#e7c86f}.inc-entry-status.error{color:#ff8a8a}.inc-entry-status.success{color:#61dda0}' +
      '.inc-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.inc-body label{display:flex;flex-direction:column;gap:6px;color:#8995a5;font-size:11px;font-weight:700}' +
      '.inc-body input,.inc-body select,.inc-body textarea{box-sizing:border-box;width:100%;border:1px solid rgba(255,255,255,.11);border-radius:9px;background:#0c131c;color:#e8edf2;padding:10px;outline:0;font:inherit}.inc-body select{min-height:40px}.inc-body textarea{min-height:70px;resize:vertical}' +
      '.inc-items-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px}.inc-items-head strong{font-size:13px}.inc-total{font-size:13px;color:#aab6c3}.inc-total b{color:#fff;font-size:16px}' +
      '.inc-item{display:grid;grid-template-columns:minmax(260px,1.8fr) 120px 130px 130px auto;gap:8px;align-items:end;margin-top:8px;padding:10px;border:1px solid rgba(255,255,255,.07);border-radius:11px;background:#0e161f}' +
      '.inc-btn{border:1px solid rgba(255,255,255,.11);border-radius:9px;padding:10px 13px;background:#1a2430;color:#dfe7ee;font-weight:750;cursor:pointer}.inc-btn:hover{filter:brightness(1.08)}.inc-btn:disabled{opacity:.5;cursor:not-allowed}' +
      '.inc-primary{background:#42d392;color:#06110b;border-color:#42d392}.inc-danger{background:#3a1e25;color:#ffb7c2}.inc-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}.inc-note{margin-top:12px;padding:10px 12px;border-radius:9px;background:#13211b;color:#9fbaae;font-size:11px}' +
      '@media(max-width:850px){.inc-grid{grid-template-columns:1fr 1fr}.inc-item{grid-template-columns:1fr 1fr}.inc-item .inc-remove-wrap{grid-column:1/-1}}@media(max-width:520px){.inc-grid{grid-template-columns:1fr}.inc-item{grid-template-columns:1fr}}';
    document.head.appendChild(style);
  }

  function ensureEditor() {
    addStyles();
    if ($('inc-editor')) return;
    var wrap = document.createElement('div');
    wrap.id = 'inc-editor';
    wrap.className = 'inc-editor';
    wrap.hidden = true;
    wrap.innerHTML =
      '<div class="inc-dialog">' +
        '<div class="inc-head"><strong id="inc-title">Новая приходная накладная</strong><button id="inc-close" class="inc-btn" type="button">×</button></div>' +
        '<div class="inc-body">' +
          '<div id="inc-entry-status" class="inc-entry-status"></div>' +
          '<input id="inc-id" type="hidden">' +
          '<div class="inc-grid">' +
            '<label>Номер документа<input id="inc-doc-number" placeholder="Создастся автоматически"></label>' +
            '<label>Дата<input id="inc-date" type="date"></label>' +
            '<label>Поставщик<select id="inc-supplier"><option value="">Загрузка…</option></select></label>' +
            '<label>Счёт-фактура<input id="inc-invoice"></label>' +
            '<label>Входящий номер<input id="inc-incoming-number"></label>' +
            '<label>Срок оплаты<input id="inc-due" type="date"></label>' +
            '<label>Склад<select id="inc-store"><option value="">Загрузка…</option></select></label>' +
            '<label>ТТН<input id="inc-transport"></label>' +
          '</div>' +
          '<label style="margin-top:12px">Комментарий<textarea id="inc-comment"></textarea></label>' +
          '<div class="inc-items-head"><strong>Позиции накладной</strong><span class="inc-total">Итого: <b id="inc-total">0,00</b> ₼</span></div>' +
          '<div id="inc-items"></div>' +
          '<button id="inc-add" class="inc-btn" type="button" style="margin-top:10px">＋ Добавить позицию</button>' +
          '<datalist id="inc-product-options"></datalist>' +
          '<div class="inc-note">«Сохранить» создаёт/обновляет накладную без проведения. «Сохранить и провести» сразу проводит документ по складу в iiko.</div>' +
          '<div class="inc-actions"><button id="inc-cancel" class="inc-btn" type="button">Отмена</button><button id="inc-save" class="inc-btn" type="button">Сохранить</button><button id="inc-save-process" class="inc-btn inc-primary" type="button">Сохранить и провести</button></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);
    $('inc-close').onclick = closeEditor;
    $('inc-cancel').onclick = closeEditor;
    $('inc-add').onclick = function () { addItem({}); };
    $('inc-save').onclick = function () { save(false); };
    $('inc-save-process').onclick = function () { save(true); };
  }

  function closeEditor() {
    if ($('inc-editor')) $('inc-editor').hidden = true;
  }

  function optionHtml(rows, placeholder) {
    return '<option value="">' + esc(placeholder) + '</option>' +
      rows.map(function (x) { return '<option value="' + esc(x.id) + '">' + esc(x.name) + '</option>'; }).join('');
  }

  function buildProductMaps() {
    refs.productLabelToId = new Map();
    refs.productIdToLabel = new Map();
    var options = [];
    refs.products.forEach(function (p) {
      var shortId = String(p.id || '').slice(0, 8);
      var label = p.name + (shortId ? ' · ' + shortId : '');
      refs.productLabelToId.set(label, p.id);
      refs.productIdToLabel.set(String(p.id).toLowerCase(), label);
      options.push('<option value="' + esc(label) + '"></option>');
    });
    if ($('inc-product-options')) $('inc-product-options').innerHTML = options.join('');
  }

  async function loadReferences(force) {
    if (refs.loaded && !force) return refs;
    if (loadingRefs && !force) return loadingRefs;
    loadingRefs = (async function () {
      var c = await getConn();
      setEditorStatus('Загружаем поставщиков, склады и номенклатуру из iiko…', 'loading');
      var response = await boundedFetch('/api/iiko/invoice-reference-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ connection: c }),
        cache: 'no-store'
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok || data.success === false) throw new Error(data.message || ('HTTP ' + response.status));
      refs.suppliers = Array.isArray(data.suppliers) ? data.suppliers : [];
      refs.warehouses = Array.isArray(data.warehouses) ? data.warehouses : [];
      refs.products = Array.isArray(data.products) ? data.products : [];
      refs.loaded = true;
      $('inc-supplier').innerHTML = optionHtml(refs.suppliers, 'Выберите поставщика');
      $('inc-store').innerHTML = optionHtml(refs.warehouses, 'Выберите склад');
      buildProductMaps();
      setEditorStatus('Справочники загружены: ' + refs.suppliers.length + ' поставщиков · ' + refs.warehouses.length + ' складов · ' + refs.products.length + ' товаров', 'success');
      return refs;
    })().finally(function () { loadingRefs = null; });
    return loadingRefs;
  }

  function productLabel(id, name) {
    var key = String(id || '').toLowerCase();
    if (key && refs.productIdToLabel.has(key)) return refs.productIdToLabel.get(key);
    if (name) {
      var found = refs.products.find(function (x) { return String(x.name || '').toLowerCase() === String(name).toLowerCase(); });
      if (found) return refs.productIdToLabel.get(String(found.id).toLowerCase()) || found.name;
    }
    return id || name || '';
  }

  function resolveProductId(value) {
    var v = String(value || '').trim();
    if (!v) return '';
    if (refs.productLabelToId.has(v)) return refs.productLabelToId.get(v);
    var byId = refs.products.find(function (x) { return String(x.id).toLowerCase() === v.toLowerCase(); });
    if (byId) return byId.id;
    var exactName = refs.products.filter(function (x) { return String(x.name || '').toLowerCase() === v.toLowerCase(); });
    if (exactName.length === 1) return exactName[0].id;
    return '';
  }

  function addItem(item) {
    item = item || {};
    var row = document.createElement('div');
    row.className = 'inc-item';
    row.innerHTML =
      '<label>Товар<input data-f="product" list="inc-product-options" autocomplete="off" placeholder="Начните вводить название" value="' + esc(productLabel(item.productId || item.product, item.productName)) + '"></label>' +
      '<label>Количество<input data-f="amount" type="number" min="0.001" step="0.001" value="' + esc(item.actualAmount != null ? item.actualAmount : (item.amount != null ? item.amount : 1)) + '"></label>' +
      '<label>Цена<input data-f="price" type="number" min="0" step="0.01" value="' + esc(item.price != null ? item.price : 0) + '"></label>' +
      '<label>Сумма<input data-f="sum" type="number" min="0" step="0.01" value="' + esc(item.sum != null ? item.sum : 0) + '"></label>' +
      '<div class="inc-remove-wrap"><button class="inc-btn inc-danger" type="button">Удалить</button></div>';
    row.querySelector('.inc-danger').onclick = function () { row.remove(); recalc(); };
    ['amount', 'price'].forEach(function (name) {
      row.querySelector('[data-f="' + name + '"]').addEventListener('input', function () {
        var amount = Number(row.querySelector('[data-f="amount"]').value || 0);
        var price = Number(row.querySelector('[data-f="price"]').value || 0);
        row.querySelector('[data-f="sum"]').value = (amount * price).toFixed(2);
        recalc();
      });
    });
    row.querySelector('[data-f="sum"]').addEventListener('input', recalc);
    $('inc-items').appendChild(row);
    if (item.sum == null) {
      var amount = Number(row.querySelector('[data-f="amount"]').value || 0);
      var price = Number(row.querySelector('[data-f="price"]').value || 0);
      row.querySelector('[data-f="sum"]').value = (amount * price).toFixed(2);
    }
    recalc();
  }

  function recalc() {
    var total = Array.from(document.querySelectorAll('#inc-items .inc-item')).reduce(function (sum, row) {
      return sum + Number(row.querySelector('[data-f="sum"]').value || 0);
    }, 0);
    if ($('inc-total')) $('inc-total').textContent = total.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  async function openEditor(doc) {
    ensureEditor();
    current = doc || null;
    $('inc-editor').hidden = false;
    $('inc-title').textContent = doc ? 'Редактирование приходной накладной' : 'Новая приходная накладная';
    $('inc-save').disabled = true;
    $('inc-save-process').disabled = true;
    try {
      await loadReferences(false);
      $('inc-id').value = doc && doc.id ? doc.id : '';
      $('inc-doc-number').value = doc && doc.documentNumber ? doc.documentNumber : '';
      $('inc-date').value = doc && doc.dateIncoming ? String(doc.dateIncoming).slice(0, 10) : today();
      $('inc-supplier').value = doc && doc.supplierId ? String(doc.supplierId).replace(/[{}]/g, '').toLowerCase() : '';
      $('inc-invoice').value = doc && doc.invoice ? doc.invoice : '';
      $('inc-incoming-number').value = doc && doc.incomingDocumentNumber ? doc.incomingDocumentNumber : '';
      $('inc-due').value = doc && doc.dueDate ? String(doc.dueDate).slice(0, 10) : '';
      var storeId = doc ? (doc.defaultStore || doc.defaultStoreId || doc.storeId || '') : '';
      $('inc-store').value = String(storeId).replace(/[{}]/g, '').toLowerCase();
      $('inc-transport').value = doc && doc.transportInvoiceNumber ? doc.transportInvoiceNumber : '';
      $('inc-comment').value = doc && doc.comment ? doc.comment : '';
      $('inc-items').innerHTML = '';
      var items = doc && Array.isArray(doc.items) && doc.items.length ? doc.items : [{}];
      items.forEach(addItem);
      $('inc-save').disabled = false;
      $('inc-save-process').disabled = false;
    } catch (error) {
      setEditorStatus(error.message || 'Не удалось загрузить справочники iiko', 'error');
    }
  }

  async function save(processAfterSave) {
    var button = processAfterSave ? $('inc-save-process') : $('inc-save');
    var otherButton = processAfterSave ? $('inc-save') : $('inc-save-process');
    try {
      button.disabled = true;
      otherButton.disabled = true;
      setEditorStatus('Проверяем накладную…', 'loading');
      var c = await getConn();
      var supplierId = $('inc-supplier').value;
      var storeId = $('inc-store').value;
      if (!supplierId) throw new Error('Выберите поставщика.');
      if (!storeId) throw new Error('Выберите склад.');

      var items = Array.from(document.querySelectorAll('#inc-items .inc-item')).map(function (row, index) {
        var productText = row.querySelector('[data-f="product"]').value;
        var productId = resolveProductId(productText);
        var amount = Number(row.querySelector('[data-f="amount"]').value || 0);
        var price = Number(row.querySelector('[data-f="price"]').value || 0);
        var sum = Number(row.querySelector('[data-f="sum"]').value || 0);
        if (!productId) throw new Error('Строка ' + (index + 1) + ': выберите товар из списка iiko.');
        if (!(amount > 0)) throw new Error('Строка ' + (index + 1) + ': количество должно быть больше 0.');
        if (!(price >= 0)) throw new Error('Строка ' + (index + 1) + ': цена не может быть отрицательной.');
        return { num: index + 1, productId: productId, amount: amount, actualAmount: amount, price: price, sum: sum };
      });
      if (!items.length) throw new Error('Добавьте хотя бы одну позицию.');

      var documentData = {
        id: $('inc-id').value || undefined,
        documentNumber: ($('inc-doc-number').value || '').trim() || autoDocumentNumber(),
        dateIncoming: $('inc-date').value + 'T00:00:00',
        supplierId: supplierId,
        invoice: $('inc-invoice').value,
        incomingDocumentNumber: $('inc-incoming-number').value,
        dueDate: $('inc-due').value,
        defaultStore: storeId,
        transportInvoiceNumber: $('inc-transport').value,
        comment: $('inc-comment').value,
        items: items
      };

      setEditorStatus(processAfterSave ? 'Сохраняем и проводим накладную в iiko BackOffice…' : 'Сохраняем накладную в iiko BackOffice…', 'loading');
      var response = await boundedFetch('/api/iiko/document-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ connection: c, type: 'incoming', action: processAfterSave ? 'save-and-process' : 'save', document: documentData, auditBefore: current || null }),
        cache: 'no-store'
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok || data.success === false) {
        var detail = data.validation && (data.validation.errorMessage || data.validation.additionalInfo);
        var raw = String(data.rawResponse || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        var serverDetail = raw && raw.length <= 700 ? raw : (raw ? raw.slice(0, 700) + '…' : '');
        throw new Error(detail || serverDetail || data.message || ('HTTP ' + response.status));
      }

      var number = data.validation && (data.validation.documentNumber || data.validation.otherSuggestedNumber);
      setEditorStatus((data.message || 'Накладная создана в iiko BackOffice') + (number ? ' · № ' + number : ''), 'success');
      setTimeout(function () { location.reload(); }, 700);
    } catch (error) {
      setEditorStatus(error.message || 'Ошибка сохранения накладной', 'error');
      button.disabled = false;
      otherButton.disabled = false;
    }
  }

  async function loadDocumentByNumber(number) {
    var c = await getConn();
    var response = await boundedFetch('/api/iiko/document-by-number', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ connection: c, type: 'incoming', number: number, currentYear: false, from: '2000-01-01', to: today() }),
      cache: 'no-store'
    });
    var data = await response.json().catch(function () { return {}; });
    if (!response.ok || data.success === false || !data.document) throw new Error(data.message || 'Документ не найден');
    return { connection: c, document: data.document };
  }

  function selectedDocument() {
    return window.SHIncomingInvoices && typeof window.SHIncomingInvoices.getSelected === 'function'
      ? window.SHIncomingInvoices.getSelected()
      : (window.SHIncomingInvoices && window.SHIncomingInvoices.selected) || null;
  }

  function selectedNumber() {
    var selected = selectedDocument();
    if (selected && selected.documentNumber) return String(selected.documentNumber).trim();
    var title = $('invoice-details-title') ? $('invoice-details-title').textContent : '';
    var match = title.match(/№\s*(.+)$/);
    return match ? match[1].trim() : '';
  }

  function actionError(data, response) {
    var detail = data && data.validation && (data.validation.errorMessage || data.validation.additionalInfo);
    var raw = String(data && data.rawResponse || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return detail || (raw ? raw.slice(0, 700) : '') || (data && data.message) || ('HTTP ' + response.status);
  }

  async function openByNumber(number) {
    try {
      setEditorStatus('Загружаем документ из iiko…', 'loading');
      var loaded = await loadDocumentByNumber(number);
      await openEditor(loaded.document);
    } catch (error) {
      alert(error.message || 'Ошибка загрузки документа');
    }
  }

  async function processSelected() {
    try {
      var number = selectedNumber();
      if (!number) throw new Error('Не найден номер документа.');
      if (!confirm('Провести накладную №' + number + '?')) return;
      var loaded = await loadDocumentByNumber(number);
      var response = await boundedFetch('/api/iiko/document-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ connection: loaded.connection, type: 'incoming', action: 'process', document: loaded.document, auditBefore: loaded.document }),
        cache: 'no-store'
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok || data.success === false) throw new Error(actionError(data, response));
      location.reload();
    } catch (error) {
      alert(error.message || 'Ошибка проведения');
    }
  }

  async function unprocess() {
    try {
      var number = selectedNumber();
      if (!number) throw new Error('Не найден номер документа.');
      if (!confirm('Распровести накладную №' + number + '?')) return;
      var loaded = await loadDocumentByNumber(number);
      var response = await boundedFetch('/api/iiko/document-action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ connection: loaded.connection, type: 'incoming', action: 'unprocess', document: loaded.document, auditBefore: loaded.document }),
        cache: 'no-store'
      });
      var data = await response.json().catch(function () { return {}; });
      if (!response.ok || data.success === false) throw new Error(actionError(data, response));
      location.reload();
    } catch (error) {
      alert(error.message || 'Ошибка распроведения');
    }
  }

  function bindNewButton() {
    var button = $('inc-new-btn');
    if (!button) {
      var host = document.querySelector('.invoices-toolbar-actions');
      if (!host) return;
      button = document.createElement('button');
      button.id = 'inc-new-btn';
      button.className = 'invoice-primary';
      button.type = 'button';
      button.textContent = '＋ Новая приходная';
      host.appendChild(button);
    }
    if (button.dataset.invoiceEntryBound === '1') return;
    button.dataset.invoiceEntryBound = '1';
    button.onclick = function () { openEditor(null); };
  }

  function refreshDetailActions() {
    var selected = selectedDocument();
    var status = String(selected && selected.status || '').toUpperCase();
    var edit = $('inc-edit-btn');
    var processButton = $('inc-process-btn');
    var unprocessButton = $('inc-unprocess-btn');
    if (edit) edit.hidden = status === 'PROCESSED';
    if (processButton) processButton.hidden = status !== 'NEW';
    if (unprocessButton) unprocessButton.hidden = status !== 'PROCESSED';
  }

  function bindDetailActions() {
    var details = $('invoice-details');
    if (!details) return;
    var actions = details.querySelector('.invoice-details-actions');
    if (!actions) return;
    if (!$('inc-edit-btn')) {
      var edit = document.createElement('button');
      edit.id = 'inc-edit-btn';
      edit.type = 'button';
      edit.textContent = 'Редактировать';
      edit.onclick = function () {
        var number = selectedNumber();
        if (!number) return alert('Не найден номер документа');
        openByNumber(number);
      };
      actions.insertBefore(edit, actions.firstChild);
    }
    if (!$('inc-process-btn')) {
      var processButton = document.createElement('button');
      processButton.id = 'inc-process-btn';
      processButton.type = 'button';
      processButton.textContent = 'Провести';
      processButton.onclick = processSelected;
      actions.insertBefore(processButton, actions.firstChild);
    }
    if (!$('inc-unprocess-btn')) {
      var unprocessButton = document.createElement('button');
      unprocessButton.id = 'inc-unprocess-btn';
      unprocessButton.type = 'button';
      unprocessButton.textContent = 'Распровести';
      unprocessButton.onclick = unprocess;
      actions.insertBefore(unprocessButton, actions.firstChild);
    }
    refreshDetailActions();
  }

  function init() {
    ensureEditor();
    bindNewButton();
    bindDetailActions();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();

  window.addEventListener('sh:incoming-invoice-selected', function () {
    bindDetailActions();
    refreshDetailActions();
  });

  var observerFrame = 0;
  var observer = new MutationObserver(function () {
    if (observerFrame) return;
    observerFrame = requestAnimationFrame(function () {
      observerFrame = 0;
      bindNewButton();
      bindDetailActions();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();