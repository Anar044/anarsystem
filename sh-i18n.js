(()=>{
  'use strict';
  // UI language only: does not translate restaurant data, product names,
  // user-entered content, API payloads, invoices or financial documents.
  const STORAGE_KEY='shUiLanguage';
  const LANGUAGES=['az','ru','en'];
  // Russian is the existing production UI. Each pair is [AZ, EN].
  const LABELS=Object.freeze({
    ...(window.SH_I18N_CATALOG||{}),
    'ОСНОВНОЕ':['ƏSAS','MAIN'],
    'Restaurant Management':['Restoran idarəetməsi','Restaurant management'],
    'Управляй рестораном легко':['Restoranını asanlıqla idarə et','Manage your restaurant easily'],
    'Dashboard':['İdarə paneli','Dashboard'],
    'AI Smart Horeca Assistent':['AI Smart Horeca Assistant','AI Smart Horeca Assistant'],
    'Кассы':['Kassalar','Cash registers'],
    'Кассовые смены':['Kassa növbələri','Cashier shifts'],
    'Внешние закупки':['Xarici satınalmalar','External procurement'],
    'Заказать товары':['Məhsul sifariş et','Order products'],
    'Заявки PR':['Satınalma tələbləri PR','Purchase requests PR'],
    'Согласование':['Təsdiqləmə','Approvals'],
    'RFQ и цены':['RFQ və qiymətlər','RFQ and prices'],
    'Поставщики':['Təchizatçılar','Suppliers'],
    'Заказы PO':['Satınalma sifarişləri PO','Purchase orders PO'],
    'Приёмка':['Qəbul','Receiving'],
    'Аналитика':['Analitika','Analytics'],
    'Нормы запаса':['Ehtiyat normaları','Stock thresholds'],
    'Настройки закупок':['Satınalma ayarları','Procurement settings'],
    'Внутренние заказы':['Daxili sifarişlər','Internal orders'],
    'Мои заявки':['Mənim sorğularım','My requests'],
    'Входящие заказы':['Daxil olan sifarişlər','Incoming orders'],
    'Комплектация':['Komplektləşdirmə','Picking'],
    'Отгрузки':['Göndərişlər','Shipments'],
    'Все заказы':['Bütün sifarişlər','All orders'],
    'Настройки':['Ayarlar','Settings'],
    'Склад и справочники':['Anbar və kataloqlar','Warehouse and catalogs'],
    'Номенклатура':['Məhsul kataloqu','Product catalog'],
    'Остатки на складах':['Anbar qalıqları','Stock balances'],
    'Движение товара':['Məhsul hərəkəti','Stock movements'],
    'Инвентарь и основные средства':['İnventar və əsas vəsaitlər','Inventory and fixed assets'],
    'AI Документы':['AI Sənədlər','AI Documents'],
    'Приходные накладные':['Mədaxil qaimələri','Incoming invoices'],
    'Расходные накладные':['Məxaric qaimələri','Outgoing invoices'],
    'Акты списания':['Silinmə aktları','Write-off acts'],
    'Внутренние перемещения':['Daxili yerdəyişmələr','Internal transfers'],
    'Финансы':['Maliyyə','Finance'],
    'Отчёты':['Hesabatlar','Reports'],
    'OLAP Отчёты':['OLAP hesabatları','OLAP reports'],
    'ABC / XYZ анализ':['ABC / XYZ təhlili','ABC / XYZ analysis'],
    'Матрица BCG / Меню-инжиниринг':['BCG matrisi / Menyu mühəndisliyi','BCG matrix / Menu engineering'],
    'Рейтинг официантов / Средний чек':['Ofisiant reytinqi / Orta çek','Waiter ratings / Average check'],
    'Баланс по поставщикам':['Təchizatçı qalıqları','Supplier balances'],
    'Фудкост и отклонения':['Food cost və kənarlaşmalar','Food cost and variances'],
    'Лаборкост и производительность':['Əmək xərci və məhsuldarlıq','Labor cost and productivity'],
    'Прибыли и убытки':['Mənfəət və zərər','Profit and loss'],
    'Сотрудники':['İşçilər','Employees'],
    'Справочник сотрудников':['İşçi siyahısı','Employee directory'],
    'Доступ к Smart Horeca':['Smart Horeca-ya giriş','Smart Horeca access'],
    'Должности и нормы':['Vəzifələr və normalar','Roles and norms'],
    'Графики и должности':['Qrafiklər və vəzifələr','Schedules and positions'],
    'Условия оплаты':['Əməkhaqqı şərtləri','Pay conditions'],
    'Авансы и корректировки':['Avanslar və düzəlişlər','Advances and adjustments'],
    'Расчёт зарплаты':['Əməkhaqqı hesablanması','Payroll calculation'],
    'Бухгалтерия Payroll':['Əməkhaqqı mühasibatlığı','Payroll accounting'],
    'Учёт времени / Face ID':['İş vaxtı uçotu / Face ID','Time tracking / Face ID'],
    'Табель':['İş vaxtı cədvəli','Timesheet'],
    'Производственный календарь':['İstehsalat təqvimi','Work calendar'],
    'QR Menu':['QR Menyu','QR Menu'],
    'Журнал действий':['Əməliyyat jurnalı','Activity log'],
    'Язык':['Dil','Language'],
    'Свернуть меню':['Menyunu yığ','Collapse sidebar'],
    'Развернуть меню':['Menyunu aç','Expand sidebar'],
    'Выйти':['Çıxış','Sign out'],
    'Пользователь':['İstifadəçi','User'],
    'Текущий ресторан':['Cari restoran','Current restaurant'],
    'Обновить':['Yenilə','Refresh'],
    '↻ Обновить':['↻ Yenilə','↻ Refresh'],
    'Загрузка…':['Yüklənir…','Loading…'],
    'Загружаем данные…':['Məlumatlar yüklənir…','Loading data…'],
    'Обзор ресторана':['Restoran icmalı','Restaurant overview'],
    'Выбор периода':['Dövr seçimi','Choose period'],
    'Дата от':['Başlanğıc tarixi','Date from'],
    'Дата по':['Son tarix','Date to'],
    'Данные напрямую из SH OLAP, без кассового плагина.':['Məlumatlar kassa plaqini olmadan birbaşa SH OLAP-dan alınır.','Data comes directly from SH OLAP without a POS plugin.'],
    '⏳ Загружаем данные из SH OLAP...':['⏳ SH OLAP məlumatları yüklənir...','⏳ Loading data from SH OLAP...'],
    'Выручка':['Dövriyyə','Revenue'],
    'Количество чеков':['Çeklərin sayı','Number of checks'],
    'Средний чек':['Orta çek','Average check'],
    'Валовая прибыль':['Ümumi mənfəət','Gross profit'],
    'Ожидание OLAP':['OLAP gözlənilir','Waiting for OLAP'],
    'Выручка и продажи':['Dövriyyə və satışlar','Revenue and sales'],
    'Данные OLAP':['OLAP məlumatları','OLAP data'],
    'Продажи по категориям':['Kateqoriyalar üzrə satış','Sales by category'],
    'Доля выручки':['Dövriyyədə pay','Share of revenue'],
    'Продажи по часам':['Saatlar üzrə satış','Sales by hour'],
    'Время открытия':['Açılış vaxtı','Opening time'],
    'Способы оплаты':['Ödəniş üsulları','Payment methods'],
    'Автоанализ':['Avtomatik təhlil','Automatic analysis'],
    'По данным OLAP':['OLAP məlumatlarına əsasən','Based on OLAP data'],
    'Пиковое время':['Pik saatlar','Peak time'],
    'Определяется автоматически по выручке.':['Dövriyyəyə əsasən avtomatik müəyyən edilir.','Determined automatically from revenue.'],
    'Рассчитывается из реальных данных.':['Faktiki məlumatlardan hesablanır.','Calculated from actual data.'],
    'Источник':['Mənbə','Source'],
    'SH OLAP SALES. Кассовый плагин не используется.':['SH OLAP SALES. Kassa plaqini istifadə edilmir.','SH OLAP SALES. No POS plugin is used.'],
    'Популярные блюда':['Populyar yeməklər','Popular dishes'],
    'По количеству продаж':['Satış sayına görə','By number of sales'],
    'Блюдо':['Yemək','Dish'],
    'Категория':['Kateqoriya','Category'],
    'Продано':['Satılıb','Sold'],
    'Доля':['Pay','Share'],
    'Загрузка данных OLAP...':['OLAP məlumatları yüklənir...','Loading OLAP data...'],
    'Внешние закупки и заказы поставщикам':['Xarici satınalmalar və təchizatçı sifarişləri','External procurement and supplier orders'],
    'От потребности по остаткам до фактической приёмки и накладной в Smart Horeca Server.':['Ehtiyat ehtiyacından faktiki qəbula və Smart Horeca Server-də qaiməyə qədər.','From stock requirements to actual receipt and invoices in Smart Horeca Server.'],
    '＋ Новая заявка':['＋ Yeni tələb','＋ New request'],
    'Потребность':['Ehtiyac','Requirements'],
    'Остатки, min/max':['Qalıqlar, min/max','Balances, min/max'],
    'Заявка PR':['Satınalma tələbi PR','Purchase request PR'],
    'Что и куда купить':['Nə və hara alınmalıdır','What to buy and where'],
    'Лимиты и контроль':['Limitlər və nəzarət','Limits and controls'],
    'Цены и условия':['Qiymətlər və şərtlər','Prices and terms'],
    'Заказ PO':['Satınalma sifarişi PO','Purchase order PO'],
    'Подтверждение':['Təsdiq','Confirmation'],
    'Факт и расхождения':['Faktiki qəbul və fərqlər','Actual receipt and differences'],
    'Ниже минимального остатка':['Minimum qalıqdan aşağı','Below minimum stock'],
    'Ждут согласования':['Təsdiq gözləyir','Awaiting approval'],
    'Активные PO':['Aktiv PO','Active POs'],
    'Выполнено':['Tamamlanıb','Completed'],
    'Каталог закупки и потребность':['Satınalma kataloqu və ehtiyac','Procurement catalog and requirements'],
    'Выбрать всё':['Hamısını seç','Select all'],
    'Создать PR из выбранного':['Seçilənlərdən PR yarat','Create PR from selection'],
    'Склад заказа':['Sifariş anbarı','Order warehouse'],
    'Выберите склад':['Anbar seçin','Select warehouse'],
    'Все товары':['Bütün məhsullar','All products'],
    'Требуют закупки':['Satınalma tələb edir','Need purchasing'],
    'Отрицательный остаток':['Mənfi qalıq','Negative stock'],
    'Нулевой остаток':['Sıfır qalıq','Zero stock'],
    'Товар':['Məhsul','Product'],
    'Остатки по складам':['Anbarlar üzrə qalıqlar','Stock by warehouse'],
    'Всего':['Cəmi','Total'],
    'Рекомендация':['Tövsiyə','Recommendation'],
    'Последняя цена':['Son qiymət','Latest price'],
    'Нормы запаса Smart Horeca':['Smart Horeca ehtiyat normaları','Smart Horeca stock thresholds'],
    'Сохранить изменения':['Dəyişiklikləri saxla','Save changes'],
    'Все склады':['Bütün anbarlar','All warehouses'],
    'Все позиции':['Bütün mövqelər','All items'],
    'Только настроенные':['Yalnız sazlanmış','Configured only'],
    'Без нормы':['Normasız','Without threshold'],
    'Остаток':['Qalıq','Balance'],
    'Целевой остаток':['Hədəf qalıq','Target stock'],
    'Срок, дней':['Müddət, gün','Lead time, days'],
    'Авто':['Avto','Auto'],
    'Заявки на закупку (PR)':['Satınalma tələbləri (PR)','Purchase requests (PR)'],
    'Заказы поставщикам (PO)':['Təchizatçı sifarişləri (PO)','Supplier orders (PO)'],
    'Приходные накладные ↗':['Mədaxil qaimələri ↗','Incoming invoices ↗'],
    'Поставка товаров между RMS · без производства':['RMS-lər arasında təchizat · istehsalsız','Goods transfer between RMS · no production'],
    'Заказывайте товары у центрального склада или напрямую у другого ресторана сети. Производство — следующий этап.':['Məhsulları mərkəzi anbardan və ya şəbəkənin digər restoranından sifariş edin. İstehsal növbəti mərhələdir.','Order goods from the central warehouse or another restaurant in the network. Production comes later.'],
    '+ Новый заказ':['+ Yeni sifariş','+ New order'],
    'Загрузка заказов…':['Sifarişlər yüklənir…','Loading orders…'],
    'На согласовании':['Təsdiqdədir','Pending approval'],
    'Готовятся к отгрузке':['Göndərişə hazırlanır','Preparing for shipment'],
    'Всего заказов':['Sifarişlərin sayı','Total orders'],
    'Центральный склад можно указать в настройках':['Mərkəzi anbarı ayarlarda seçə bilərsiniz','You can select a central warehouse in settings'],
    'Сохранить':['Saxla','Save'],
    'Отмена':['Ləğv et','Cancel'],
    'Сохранить черновик':['Qaralamanı saxla','Save draft'],
    'Загрузка товаров…':['Məhsullar yüklənir…','Loading products…'],
    'Поиск по товару, группе…':['Məhsula və qrupa görə axtarış…','Search by product or group…'],
    'Номер, ресторан, товар…':['Nömrə, restoran, məhsul…','Number, restaurant, product…']
    ,'Оборудование':['Avadanlıq','Equipment']
    ,'ТО · гарантия · ремонты · замена':['Texniki xidmət · zəmanət · təmir · dəyişdirmə','Service · warranty · repairs · replacement']
    ,'Открыть план →':['Plana bax →','Open plan →']
    ,'В эксплуатации':['İstismardadır','In operation']
    ,'ТО ≤ 30 дней':['TX ≤ 30 gün','Service ≤ 30 days']
    ,'Гарантия ≤ 60 дней':['Zəmanət ≤ 60 gün','Warranty ≤ 60 days']
    ,'Проверить замену':['Dəyişdirməni yoxla','Check replacement']
    ,'Ремонты 12 мес.':['12 aylıq təmir','Repairs in 12 months']
    ,'По оборудованию нет срочных задач.':['Avadanlıq üzrə təcili tapşırıq yoxdur.','No urgent equipment tasks.']
    ,'Оборудование · уведомления':['Avadanlıq · bildirişlər','Equipment · notifications']
    ,'Все →':['Hamısı →','All →']
    ,'Срочных уведомлений нет.':['Təcili bildiriş yoxdur.','No urgent notifications.']
    ,'Уведомления по оборудованию':['Avadanlıq bildirişləri','Equipment notifications']
    ,'Рестораны':['Restoranlar','Restaurants']
    ,'Выбор ресторанов':['Restoran seçimi','Select restaurants']
    ,'Показать в отчётах':['Hesabatlarda göstər','Show in reports']
    ,'Выбрать все':['Hamısını seç','Select all']
    ,'Снять все':['Hamısını sil','Deselect all']
    ,'Применить':['Tətbiq et','Apply']
    ,'Все рестораны':['Bütün restoranlar','All restaurants']
    ,'Обзор сети':['Şəbəkə icmalı','Network overview']

  });
  let language='ru';
  function savedLanguage(){
    try{const value=localStorage.getItem(STORAGE_KEY);return LANGUAGES.includes(value)?value:'ru'}catch(_){return'ru'}
  }
  function value(source,lang=language){
    const entry=LABELS[source];
    return lang==='ru'||!entry?source:entry[lang==='az'?0:1]||source;
  }
  function translateNode(element,source){
    if(!element||!source||!Object.prototype.hasOwnProperty.call(LABELS,source))return;
    const translated=value(source);
    if(element.textContent!==translated)element.textContent=translated;
  }
  function applyExplicit(root=document){
    for(const element of root.querySelectorAll('[data-sh-i18n]')){
      translateNode(element,element.getAttribute('data-sh-i18n'));
    }
    for(const element of root.querySelectorAll('[data-sh-i18n-placeholder]')){
      const source=element.getAttribute('data-sh-i18n-placeholder');
      if(Object.prototype.hasOwnProperty.call(LABELS,source)&&element.getAttribute('placeholder')!==value(source))
        element.setAttribute('placeholder',value(source));
    }
    for(const element of root.querySelectorAll('[data-sh-i18n-aria]')){
      const source=element.getAttribute('data-sh-i18n-aria');
      if(Object.prototype.hasOwnProperty.call(LABELS,source))
        element.setAttribute('aria-label',value(source));
    }
  }
  function sidebarLabel(element){
    if(!element)return;
    const source=element.getAttribute('data-sh-i18n-source')||element.textContent.trim().replace(/\s+/g,' ');
    if(!Object.prototype.hasOwnProperty.call(LABELS,source))return;
    element.setAttribute('data-sh-i18n-source',source);
    translateNode(element,source);
  }
  function applySidebar(){
    const sidebar=document.querySelector('body.sh-workspace-page .sidebar');
    if(!sidebar)return;
    for(const element of sidebar.querySelectorAll('.nav-title, .sh-exact-brand-copy small, .sh-brand-copy small, .brand-copy small'))
      sidebarLabel(element);
    for(const link of sidebar.querySelectorAll('.unified-main-nav a[href]')){
      // Only the text label, never the icon, link href, permission or state.
      const label=Array.from(link.children).find(element=>element.tagName==='SPAN'&&!element.classList.contains('side-icon'));
      sidebarLabel(label);
      const source=label?.getAttribute('data-sh-i18n-source');
      if(source&&Object.prototype.hasOwnProperty.call(LABELS,source)){
        link.title=value(source);
        if(link.hasAttribute('aria-label'))link.setAttribute('aria-label',value(source));
      }
    }
    for(const btn of sidebar.querySelectorAll('.documents-nav-toggle')){
      const label=btn.querySelector('.documents-nav-toggle-left > span:last-child');
      sidebarLabel(label);
      const source=label?.getAttribute('data-sh-i18n-source');
      if(source&&Object.prototype.hasOwnProperty.call(LABELS,source)){
        btn.title=value(source);
        if(btn.hasAttribute('aria-label'))btn.setAttribute('aria-label',value(source));
      }
    }
    const collapse=sidebar.querySelector('.sh-sidebar-collapse-btn');
    if(collapse){
      const source=document.body.classList.contains('sh-sidebar-collapsed')?'Развернуть меню':'Свернуть меню';
      collapse.title=value(source);
      collapse.setAttribute('aria-label',value(source));
    }
  }
  // Safe selectors for labels created asynchronously by existing modules.
  // Never inspect/translate product rows, restaurant names, user-entered
  // values, currencies, status payloads or document content.
  const DYNAMIC_UI_TEXT=[
    '#assetDashCard .asset-dash-title h3',
    '#assetDashCard .asset-dash-title .ctitle > span',
    '#assetDashCard .asset-dash-title > a',
    '#assetDashCard .asset-dash-metric > span',
    '#assetDashCard .asset-dash-empty',
    '#assetNotifyMenu .asset-notify-head b',
    '#assetNotifyMenu .asset-notify-head a',
    '#assetNotifyMenu .asset-notify-empty',
    '#sh-global-restaurant-filter .sh-rf-label',
    '#sh-global-restaurant-filter .sh-rf-title',
    '#sh-global-restaurant-filter [data-rf-all]',
    '#sh-global-restaurant-filter [data-rf-none]',
    '#sh-global-restaurant-filter [data-rf-cancel]',
    '#sh-global-restaurant-filter [data-rf-apply]'
  ];
  function translateSafeDynamic(){
    for(const element of document.querySelectorAll(DYNAMIC_UI_TEXT.join(',')))
      sidebarLabel(element);
    const bell=document.querySelector('#assetNotifyWrap .asset-notify-btn');
    if(bell&&bell.getAttribute('aria-label')!==value('Уведомления по оборудованию'))
      bell.setAttribute('aria-label',value('Уведомления по оборудованию'));
    const restaurantFilter=document.querySelector('#sh-global-restaurant-filter');
    if(!restaurantFilter)return;
    const inputs=restaurantFilter.querySelectorAll('.sh-rf-list input[type="checkbox"]');
    if(!inputs.length)return;
    const total=inputs.length;
    const chosen=Array.from(inputs).filter(input=>input.checked).length;
    const count=restaurantFilter.querySelector('.sh-rf-count');
    const state=restaurantFilter.querySelector('.sh-rf-status');
    // Derive display numbers from live checkboxes, not translated strings.
    // No changes to the actual restaurant selection or any API parameters.
    const all=chosen===total;
    const countText=all
      ?(language==='az'?'hamısı':language==='en'?'all':'все')+' ('+chosen+')'
      :language==='az'?total+'-dən '+chosen+'-si':
        language==='en'?chosen+' of '+total:chosen+' из '+total;
    const stateText=all?value('Все рестораны'):
      language==='az'?chosen+' seçilib':
      language==='en'?chosen+' selected':chosen+' выбрано';
    if(count&&count.textContent!==countText)count.textContent=countText;
    if(state&&state.textContent!==stateText)state.textContent=stateText;
    const menu=restaurantFilter.querySelector('.sh-rf-menu');
    if(menu&&menu.getAttribute('aria-label')!==value('Выбор ресторанов'))
      menu.setAttribute('aria-label',value('Выбор ресторанов'));
  }
  // Extend localization to all protected Smart Horeca modules. Only exact
  // UI labels are translated; no general machine translation or data fields.
  // Preserve existing text nodes/children so buttons keep their click handlers.
  const UI_LABEL_SELECTORS=[
    'h1','h2','h3','h4','h5','h6','button','label','legend','summary',
    'th','option','p','span','small','strong','b',
    '.dash-empty','.insights .insight p',
    '.sha-empty','.sha-hint','.sha-chat-head p','.sha-chats-head span',
    '.cash-modern-empty','.cs-empty','.cs-status',
    '.proc-empty','.proc-history-block summary','.proc-list-section-title',
    '.proc-status','.proc-list-head p','.proc-section-head p',
    '.proc-history-note',
    // Stable modal UI zones generated by procurement, internal orders and HR.
    '.proc-modal .proc-field','.proc-modal .proc-edit-head',
    '.proc-modal .proc-grn-explain','.proc-modal .proc-modal-summary',
    '.proc-modal .proc-receipt-choice','.proc-modal .eyebrow',
    '.io-modal-dialog .io-form-grid label','.io-modal-dialog .io-muted',
    '.io-modal-dialog .io-form h3','.io-modal-dialog .io-form button',
    '.modal-back .form-grid label','.modal-back .modal-head h2',
    '.modal-back .modal-foot button',
    '.ts-drawer-panel .ts-kicker','.ts-drawer-panel .ts-detail-note',
    '.ts-drawer-panel footer a',
    // Financial/stock analytics: status text and safe report labels only.
    '.sh-i18n-empty-state','.fin-empty','.source-title',
    '.result-meta','.limit-note','.stock-message','.mov-message',
    '.fc-message','.lc-warning','.coverage-warning',
    '.stock-modal .modal-item > span','.mov-modal .modal-item > span',
    '.fc-modal .modal-item > span',
    '.stock-modal .modal-foot',
    '.stock-modal .eyebrow','.mov-modal .eyebrow','.fc-modal .eyebrow',
    '.fin-modal-card .fin-section-kicker','.fin-modal-card label',
    '.fin-modal-card button',
    '#stock-status','#mov-status','#fc-status','#lc-status',
    '#mov-period','#fc-period','#lc-period','#stock-source',
    '#fin-status','#fin-modal-status',
    // HR/Payroll approval, calculation and timekeeping system text.
    '#tsApprovalTitle','#tsApprovalMeta','#tsApprovalBadge',
    '#tsManagerMeta','#tsHrMeta','#tsApprovalDepartmentHint',
    '#tsMatrixTitle','#tsMatrixSub','#tsMatrixCount','#tsAccessBadge',
    '#hrpTableTitle','#hrpTableSub','#hrpCount','#hrpSettlementCount',
    '#hrpTaxProfile','#hrpAttendance','#hrpOvertime',
    '#hcpRoleCount','#hcpRowCount','#pvTaxNote',
    '#bindingCount','#eventCount','#admsRequestCount','#rawAdmsCount',
    '.hr-summary-card > span','.hr-summary-card > small',
    '.hr-card-title','.hr-card-sub','.hep-pay-empty',
    '.ts-approval-badge','.hr-status',
    // P&L metadata, excluding data-backed category names and rows.
    '.revenue-category-head strong','.revenue-category-head span',
    '#pnl-status','#message',



    '.proc-status-badge','.io-pill','.status-pill','.status-badge',
    '.cs-badge','.cs-payment-empty','.hrp-status','.hrp-source',
    '.ts-ot-badge','.hr-badge','.order-status','.hr-empty',
    '.topbar-title','.topbar-sub','.crumb','.title','.subtitle',
    '.muted','.hint','.description','.section-title','.section-sub',
    '.stat-label','.khead','.ksub','.ctitle','.tab','.chip',
    '.toolbar-title','.panel-title','.field-label'
  ].join(',');
  const UI_EXCLUDE='tbody,[contenteditable],.sh-rf-list,.asset-notify-item,'+
    '.sha-messages,.sha-conversation-list,.cm-history,.cash-order-items,'+
    '.monaco-editor,.cm-editor,.ag-root,[data-business-value],'+
    '[data-auth-name],[data-auth-email],[data-auth-avatar],[data-sh-i18n],'+
    // Headings containing inventory product names or account names are data.
    '#stock-modal-title,#mov-modal-title,#fc-modal-title,#fin-modal-title,'+
    '.revenue-category-name,.hep-name,.hr-name';
  const NODE_SOURCES=new WeakMap(),ATTRIBUTE_SOURCES=new WeakMap();
  // Only known system-state badges or empty-message cells are eligible
  // inside data tables. Product, employee, supplier and document cells stay untouched.
  const TABLE_UI_BADGES='.proc-status-badge,.io-pill,.status-pill,.status-badge,'+
    '.cs-badge,.cs-payment-empty,.hrp-status,.hrp-source,'+
    '.ts-ot-badge,.hr-badge,.order-status,.proc-empty,.hr-empty,.dash-empty,'+
    '.fin-empty,.sh-i18n-empty-state';
  function safeTableUiElement(element){
    return Boolean(element?.closest?.('tbody')&&element.matches?.(TABLE_UI_BADGES));
  }
  // A single known OLAP no-data cell is UI, not a product record.
  function emptyOlAPCell(element){
    return Boolean(element?.matches?.('.dash-empty')&&element.closest?.('#dashDishBody'));
  }
  function uiSafe(element){
    if(!element)return false;
    if(element.closest?.(UI_EXCLUDE)&&!emptyOlAPCell(element)&&!safeTableUiElement(element))return false;
    return Boolean(element.closest?.('main,.app-shell,.sh-workspace-page,.proc-modal,.io-modal-dialog,.modal-back .modal,.ts-drawer-panel,.stock-modal,.mov-modal,.fc-modal,.fin-modal-card'));
  }
  const NUMBERED_UI_PATTERNS=[
    {
      match:/^Завершённые и закрытые\s*·\s*(\d+)$/,
      target:['Tamamlanmış və bağlanmış · ','Completed and closed · ']
    },
    {
      match:/^([\d\s.,]+₼) по данным OLAP\.$/,
      target:[' OLAP məlumatlarına əsasən.',' based on OLAP data.']
    },
    {
      match:/^Договоры\s*·\s*(\d+)$/,
      target:['Müqavilələr · ','Contracts · ']
    }
  ];
  function dynamicUiText(source,element){
    // A modal title combines a fixed UI prefix with a supplier/document
    // identifier. Translate only the prefix, retaining the identifier bytes.
    if(element?.id==='proc-modal-title'){
      if(language==='ru')return source;
      const prefixes=[
        ['Поставщик · ','Təchizatçı · ','Supplier · '],
        ['Договор · ','Müqavilə · ','Contract · '],
        ['Новый договор · ','Yeni müqavilə · ','New contract · '],
        ['Новый RFQ · ','Yeni RFQ · ','New RFQ · '],
        ['Предложение поставщика · ','Təchizatçı təklifi · ','Supplier quotation · '],
        ['Фактическая приёмка · ','Faktiki qəbul · ','Physical receipt · '],
        ['Изменить заявку ','Tələbi dəyişdir ','Edit request ']
      ];
      for(const group of prefixes)if(source.startsWith(group[0]))
        return group[language==='az'?1:2]+source.slice(group[0].length);
    }
    // Scope HR counters to known control IDs; never match data cells.
    const hrId=element?.id||'';
    const hrLocale=language==='az'?0:1;
    if(language!=='ru'){
      const hrCounters={
        tsMatrixCount:[/^(\d+) сотрудников$/, [' işçi',' employees']],
        hrpCount:[/^(\d+) сотрудников$/, [' işçi',' employees']],
        hcpRowCount:[/^(\d+) сотрудников$/, [' işçi',' employees']],
        hcpRoleCount:[/^(\d+) должностей$/, [' vəzifə',' positions']],
        hrpSettlementCount:[/^(\d+) сотрудников с движением$/, [' əməliyyatlı işçi',' employees with activity']],
        bindingCount:[/^(\d+) связей$/, [' əlaqə',' links']],
        eventCount:[/^(\d+) последних событий$/, [' son hadisə',' recent events']],
        admsRequestCount:[/^(\d+) запросов$/, [' sorğu',' requests']],
        rawAdmsCount:[/^(\d+) записей$/, [' qeyd',' records']]
      };
      const spec=hrCounters[hrId],found=spec?.[0].exec(source);
      if(found)return found[1]+spec[1][hrLocale];
      if(hrId==='hrpAttendance'){
        const face=/^Face ID · устройств: (\d+)$/.exec(source);
        if(face)return 'Face ID · '+(language==='az'?'cihazlar: ':'devices: ')+face[1];
      }
      if(hrId==='hrpTaxProfile'){
        const tax=/^(Ручной|Системный)(?: · с (\d{4}-\d{2}-\d{2}))?$/.exec(source);
        if(tax)return (tax[1]==='Ручной'
          ?(language==='az'?'Əl ilə':'Manual')
          :(language==='az'?'Sistem':'System'))+
          (tax[2]?(language==='az'?' · tarixdən: ':' · effective: ')+tax[2]:'');
      }
      if(hrId==='tsAccessBadge'){
        const role=/^Роль: (.+)$/.exec(source);
        if(role)return (language==='az'?'Rol: ':'Role: ')+value(role[1]);
      }
      if(hrId==='tsMatrixSub'){
        const months={
          'Январь':['Yanvar','January'],'Февраль':['Fevral','February'],
          'Март':['Mart','March'],'Апрель':['Aprel','April'],
          'Май':['May','May'],'Июнь':['İyun','June'],
          'Июль':['İyul','July'],'Август':['Avqust','August'],
          'Сентябрь':['Sentyabr','September'],'Октябрь':['Oktyabr','October'],
          'Ноябрь':['Noyabr','November'],'Декабрь':['Dekabr','December']
        };
        const month=/^([^ ]+) (\d{4}) · клик по ячейке открывает детали дня$/.exec(source);
        if(month&&months[month[1]])return months[month[1]][hrLocale]+' '+month[2]+
          (language==='az'?' · günün təfərrüatı üçün xanaya basın':' · click a cell for day details');
      }
      if(element?.matches?.('.hr-summary-card > small')){
        const configured=/^С условиями: (\d+) · без: (\d+)$/.exec(source);
        if(configured)return language==='az'
          ?'Şərtləri olan: '+configured[1]+' · olmayan: '+configured[2]
          :'Configured: '+configured[1]+' · without: '+configured[2];
      }
    }
    // Preserve the original counts and periods. Never parse or rewrite
    // prices, document numbers or user-entered values.
    const id=element?.id||'';
    if(language!=='ru'){
      const locale=language==='az'?0:1;
      const counters={
        'stock-result-meta':{re:/^(\d+) из (\d+) позиций$/,suffix:[' mövqedən ',' of '],tail:[' mövqe',' items']},
        'mov-result-meta':{re:/^(\d+) из (\d+) строк$/,suffix:[' sətirdən ',' of '],tail:[' sətir',' rows']},
        'fc-result-meta':{re:/^(\d+) из (\d+) ингредиентов$/,suffix:[' inqrediyentdən ',' of '],tail:[' inqrediyent',' ingredients']},
        'lc-day-meta':{re:/^(\d+) дней$/,simple:[' gün',' days']},
        'lc-employee-meta':{re:/^(\d+) сотрудников$/,simple:[' işçi',' employees']}
      };
      const counter=counters[id],match=counter?.re.exec(source);
      if(counter?.simple&&match)return match[1]+counter.simple[locale];
      if(match)return language==='az'
        ?match[1]+' / '+match[2]+counter.tail[0]
        :match[1]+counter.suffix[1]+match[2]+counter.tail[1];
      const statuses={
        'stock-status':{re:/^Готово · (\d+) реальных строк$/,units:[' faktiki sətir',' actual rows']},
        'mov-status':{re:/^Готово · (\d+) движений$/,units:[' əməliyyat',' movements']},
        'fc-status':{re:/^Готово · (\d+) ингредиентов$/,units:[' inqrediyent',' ingredients']},
        'lc-status':{re:/^Готово · (\d+) сотрудников$/,units:[' işçi',' employees']}
      };
      const status=statuses[id],m=status?.re.exec(source);
      if(m)return (language==='az'?'Hazırdır · ':'Ready · ')+m[1]+status.units[locale];
      if(id==='stock-source'&&source.startsWith('Источник: '))
        return (language==='az'?'Mənbə: ':'Source: ')+source.slice('Источник: '.length);
      if(['mov-period','lc-period','fc-period'].includes(id)&&
          /^Период: \d{4}-\d{2}-\d{2} — \d{4}-\d{2}-\d{2}/.test(source)){
        const core=source.replace(/^Период: /,language==='az'?'Dövr: ':'Period: ');
        return id==='fc-period'?core
          .replace(' · источник теории: ',language==='az'?' · nəzəri məlumat mənbəyi: ':' · theoretical source: ')
          .replace('SALES OLAP себестоимость',language==='az'?'SALES OLAP maya dəyəri':'SALES OLAP cost')
          .replace('оценка по техкартам',language==='az'?'texnoloji kart üzrə qiymətləndirmə':'recipe-based estimate')
          :core;
      }
    }
    for(const rule of NUMBERED_UI_PATTERNS){
      const match=source.match(rule.match);
      if(!match)continue;
      if(language==='ru')return source;
      const part=rule.target[language==='az'?0:1];
      return (rule===NUMBERED_UI_PATTERNS[0]||rule===NUMBERED_UI_PATTERNS[2])
        ?part+match[1]:match[1]+part;
    }
    return null;
  }
  function translateUiNode(node){
    if(node.nodeType!==3)return;
    const element=node.parentElement;
    if(!uiSafe(element))return;
    const literal=node.nodeValue||'';
    const source=NODE_SOURCES.get(node)||literal.trim();
    const hasExact=Object.prototype.hasOwnProperty.call(LABELS,source);
    // Previously translated dynamic labels must restore their original RU source.
    const dynamic=!hasExact?(language==='ru'&&NODE_SOURCES.has(node)?source:dynamicUiText(source,element)):null;
    if(!hasExact&&dynamic===null)return;
    NODE_SOURCES.set(node,source);
    const next=hasExact?value(source):dynamic;
    if(literal.trim()===next)return;
    const leading=literal.match(/^\s*/)?.[0]||'';
    const trailing=literal.match(/\s*$/)?.[0]||'';
    node.nodeValue=leading+next+trailing;
  }
  function translateUiAttribute(element,attribute){
    const current=element.getAttribute(attribute);
    if(!current)return;
    let sources=ATTRIBUTE_SOURCES.get(element);
    const source=sources?.get(attribute)||current;
    if(!Object.prototype.hasOwnProperty.call(LABELS,source))return;
    if(!sources){sources=new Map();ATTRIBUTE_SOURCES.set(element,sources)}
    sources.set(attribute,source);
    const next=value(source);
    if(current!==next)element.setAttribute(attribute,next);
  }
  function translateUiLabels(root=document){
    if(!document.body?.hasAttribute?.('data-protected'))return;
    const candidates=[];
    if(root.nodeType===1&&root.matches?.(UI_LABEL_SELECTORS))candidates.push(root);
    for(const element of root.querySelectorAll?.(UI_LABEL_SELECTORS)||[])candidates.push(element);
    for(const element of candidates){
      if(!uiSafe(element))continue;
      if(element.closest?.('tbody')&&!emptyOlAPCell(element)&&!safeTableUiElement(element))continue;
      for(const node of element.childNodes||[])translateUiNode(node);
      if(element.matches?.('button,option,label'))translateUiAttribute(element,'title');
      if(element.matches?.('button,input,select,textarea'))translateUiAttribute(element,'aria-label');
      if(element.matches?.('input,textarea'))translateUiAttribute(element,'placeholder');
    }
    // Input placeholders are not included among the text-label selectors.
    for(const input of root.querySelectorAll?.('input[placeholder],textarea[placeholder]')||[]){
      if(uiSafe(input))translateUiAttribute(input,'placeholder');
    }
  }
  function apply(){document.documentElement.lang=language;createSwitcher();applyExplicit();applySidebar();translateSafeDynamic();translateUiLabels()}
  let scheduled=false;
  function schedule(){
    if(scheduled)return;
    scheduled=true;
    requestAnimationFrame(()=>{scheduled=false;apply()});
  }
  function update(next,{save=true}={}){
    if(!LANGUAGES.includes(next))return false;
    const changed=language!==next;
    language=next;
    document.documentElement.lang=language;
    if(save){try{localStorage.setItem(STORAGE_KEY,language)}catch(_){}}
    schedule();
    const select=document.querySelector('#sh-language-select');
    if(select&&select.value!==language)select.value=language;
    if(changed){
      window.dispatchEvent(new CustomEvent('sh:language-change',{detail:{language}}));
      if(document.body?.classList.contains('sh-workspace-page')){
        for(const frame of document.querySelectorAll('iframe[data-sh-persistent-workspace]')){
          try{frame.contentWindow.postMessage({type:'sh:language-change',language},location.origin)}catch(_){}
        }
      }
    }
    return true;
  }
  function createSwitcher(){
    if(!document.body?.classList.contains('sh-workspace-page'))return;
    const sidebar=document.querySelector('.sidebar');
    if(!sidebar||sidebar.querySelector('#sh-language-select'))return;
    const wrap=document.createElement('div');
    wrap.className='sh-language-picker';
    const label=document.createElement('label');
    label.className='sh-language-label';
    label.htmlFor='sh-language-select';
    label.textContent='🌐';
    const select=document.createElement('select');
    select.id='sh-language-select';
    select.className='sh-language-select';
    select.setAttribute('aria-label','Language / Dil / Язык');
    select.title='Language / Dil / Язык';
    for(const code of LANGUAGES){
      const option=document.createElement('option');option.value=code;option.textContent=code.toUpperCase();select.appendChild(option);
    }
    select.value=language;
    select.addEventListener('change',()=>update(select.value));
    wrap.append(label,select);
    sidebar.appendChild(wrap);
  }
  let observer=null;
  function start(){
    language=savedLanguage();
    document.documentElement.lang=language;
    createSwitcher();
    apply();
    if(document.body&&!observer){
      // Observe only the active visible module or persistent sidebar.
      // Skip table-body mutations to avoid rescanning large datasets.
      const zone=document.body.classList.contains('sh-workspace-page')
        ?document.querySelector('.sidebar')
        :(document.querySelector('main.main')||document.querySelector('main')||document.body);
      if(zone){
        observer=new MutationObserver(changes=>{
          let changedUi=false;
          const tableUiRoots=[];
          for(const change of changes){
            const additions=Array.from(change.addedNodes||[]);
            if(!additions.length)continue;
            if(change.target===document.body){
              // Only known dialogs can be observed outside the application.
              for(const node of additions){
                if(node.nodeType===1&&node.matches?.('.modal-back')){
                  observer.observe(node,{childList:true,subtree:true});
                  translateUiLabels(node);
                }
              }
              continue;
            }
            if(change.target?.closest?.('tbody')){
              // A newly rendered table row may contain system badges.
              // Inspect only those rows, never translate record values.
              for(const node of additions){
                if(node.nodeType===1&&
                    (node.matches?.(TABLE_UI_BADGES)||node.querySelector?.(TABLE_UI_BADGES)))
                  tableUiRoots.push(node);
              }
            }else if(!change.target?.closest?.('.ag-root,.sh-rf-list,.data-grid')){
              changedUi=true;
            }
          }
          if(changedUi)schedule();
          if(tableUiRoots.length)requestAnimationFrame(()=>{
            for(const node of tableUiRoots)if(node.isConnected!==false)translateUiLabels(node);
          });
        });
        observer.observe(zone,{childList:true,subtree:true});
        // Procurement/internal-order modal roots are siblings of .app-shell.
        // They must be watched separately to localize freshly opened dialogs.
        for(const id of ['proc-modal','io-modal','tsDrawer','stock-modal','mov-modal','fc-modal','fin-account-modal']){
          const root=document.getElementById?.(id);
          if(root&&root!==zone&&!zone.contains?.(root))
            observer.observe(root,{childList:true,subtree:true});
        }
        // Nomenclature creates modal-back elements dynamically as direct body
        // children. Watch only direct additions; do not scan the whole body.
        if(zone!==document.body){
          observer.observe(document.body,{childList:true});
        }
      }
    }
  }
  window.addEventListener('storage',event=>{
    if(event.key===STORAGE_KEY)update(savedLanguage(),{save:false});
  });
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||event.source!==window.parent)return;
    if(event.data?.type==='sh:language-change')update(event.data.language,{save:false});
  });
  document.addEventListener('click',event=>{
    if(event.target?.closest?.('.sh-sidebar-collapse-btn'))schedule();
  });
  document.addEventListener('sh-access-ready',schedule);
  window.addEventListener('sh:access-visibility-ready',schedule);
  window.SH_I18N=Object.freeze({getLanguage:()=>language,setLanguage:update,t:value,apply:schedule,applyNow:apply,available:LANGUAGES.slice()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
