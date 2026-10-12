(()=>{
  'use strict';
  // UI language only: does not translate restaurant data, product names,
  // user-entered content, API payloads, invoices or financial documents.
  const STORAGE_KEY='shUiLanguage';
  const LANGUAGES=['az','ru','en'];
  // Russian is the existing production UI. Each pair is [AZ, EN].
  const LABELS=Object.freeze({
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
  function apply(){document.documentElement.lang=language;applyExplicit();applySidebar()}
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
    if(document.body?.classList.contains('sh-workspace-page')){
      const sidebar=document.querySelector('.sidebar');
      if(sidebar&&!observer){
        observer=new MutationObserver(()=>schedule());
        observer.observe(sidebar,{childList:true,subtree:true});
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
  document.addEventListener('sh-access-ready',schedule);
  window.addEventListener('sh:access-visibility-ready',schedule);
  window.SH_I18N=Object.freeze({getLanguage:()=>language,setLanguage:update,t:value,apply:schedule,available:LANGUAGES.slice()});
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
