import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const script=readFileSync(resolve(root,'sh-i18n.js'),'utf8');
const catalogSrc=readFileSync(resolve(root,'sh-i18n-catalog.js'),'utf8');

function createI18n(initial,loadCatalog=false){
  const listeners={};
  const saved=new Map(initial?[['shUiLanguage',initial]]:[]);
  const document={
    readyState:'loading',
    documentElement:{lang:'ru'},
    body:{classList:{contains:()=>false}},
    addEventListener(name,fn){listeners['document:'+name]=fn},
    querySelector(){return null},
    querySelectorAll(){return []}
  };
  const window={
    parent:null,
    addEventListener(name,fn){listeners['window:'+name]=fn},
    dispatchEvent(){}
  };
  window.parent=window;
  const storage={getItem:key=>saved.get(key)||null,setItem:(key,v)=>saved.set(key,v)};
  if(loadCatalog)runInNewContext(catalogSrc,{window});
  runInNewContext(script,{
    window,document,localStorage:storage,location:{origin:'https://preview.smarthoreca.pages.dev'},
    requestAnimationFrame:fn=>fn(),MutationObserver:class{observe(){} disconnect(){}},
    CustomEvent:class{constructor(name,opts){this.name=name;this.detail=opts.detail}}
  });
  listeners['document:DOMContentLoaded']();
  return{api:window.SH_I18N,document,window,saved,listeners};
}
test('Russian existing interface remains the default with AZ/RU/EN available',()=>{
  const {api,document}=createI18n();
  assert.equal(api.getLanguage(),'ru');
  assert.equal(document.documentElement.lang,'ru');
  assert.deepEqual(Array.from(api.available),['az','ru','en']);
  assert.equal(api.t('Внешние закупки'),'Внешние закупки');
});
test('language selection translates UI text and persists for next page',()=>{
  const {api,document,saved}=createI18n();
  assert.equal(api.setLanguage('az'),true);
  assert.equal(document.documentElement.lang,'az');
  assert.equal(saved.get('shUiLanguage'),'az');
  assert.equal(api.t('Внешние закупки'),'Xarici satınalmalar');
  assert.equal(api.t('Приёмка'),'Qəbul');
  assert.equal(api.setLanguage('en'),true);
  assert.equal(api.t('Внутренние заказы'),'Internal orders');
  assert.equal(api.t('Сотрудники'),'Employees');
  assert.equal(api.t('Dashboard'),'Dashboard');
  assert.equal(api.setLanguage('xx'),false);
  assert.equal(api.getLanguage(),'en');
});
test('existing saved language is restored and storage updates propagate',()=>{
  const ctx=createI18n('az');
  assert.equal(ctx.api.getLanguage(),'az');
  ctx.saved.set('shUiLanguage','en');
  ctx.listeners['window:storage']({key:'shUiLanguage'});
  assert.equal(ctx.api.getLanguage(),'en');
  assert.equal(ctx.document.documentElement.lang,'en');
});
test('unknown business/user text remains unchanged even when a locale is selected',()=>{
  const {api}=createI18n('en');
  for(const value of ['Pomidor 5kg','Jelly Metropark','123.40 AZN','Supplier Inv. 302','User Name']){
    assert.equal(api.t(value),value);
  }
});
test('sidebar menu translations cover all main user navigation categories',()=>{
  const {api}=createI18n('ru');
  const navLabels=[
    'ОСНОВНОЕ','Кассы','Кассовые смены','Внешние закупки','Заказать товары',
    'Заявки PR','Согласование','RFQ и цены','Поставщики','Заказы PO','Приёмка',
    'Аналитика','Нормы запаса','Настройки закупок','Внутренние заказы',
    'Мои заявки','Входящие заказы','Комплектация','Отгрузки','Все заказы',
    'Настройки','Склад и справочники','Номенклатура','Остатки на складах',
    'Движение товара','Инвентарь и основные средства','AI Документы',
    'Приходные накладные','Расходные накладные','Акты списания','Внутренние перемещения',
    'Финансы','Отчёты','OLAP Отчёты','ABC / XYZ анализ',
    'Матрица BCG / Меню-инжиниринг','Рейтинг официантов / Средний чек',
    'Баланс по поставщикам','Фудкост и отклонения','Лаборкост и производительность',
    'Прибыли и убытки','Сотрудники','Справочник сотрудников',
    'Доступ к Smart Horeca','Должности и нормы','Условия оплаты','Авансы и корректировки',
    'Расчёт зарплаты','Бухгалтерия Payroll','Учёт времени / Face ID','Табель',
    'QR Menu','Журнал действий'
  ];
  for(const item of navLabels){
    assert.notEqual(api.t(item,'az'),item,'AZ missing: '+item);
    if(item!=='QR Menu')assert.notEqual(api.t(item,'en'),item,'EN missing: '+item);
  }
});
test('language switch is limited to the shell and never changes route/permission identifiers',()=>{
  const parent=readFileSync(resolve(root,'persistent-workspace.html'),'utf8');
  assert.match(parent,/sh-i18n\.js\?v=20261012-ui-i18n-v1/);
  assert.match(parent,/\.sh-language-picker/);
  assert.match(parent,/sh-sidebar-collapsed \.sidebar \.sh-language-select/);
  assert.match(script,/\.unified-main-nav a\[href\]/);
  assert.match(script,/\.documents-nav-toggle/);
  assert.match(script,/\.sh-sidebar-collapse-btn/);
  assert.doesNotMatch(script,/\.setAttribute\(['"]data-permission|\.href\s*=|\.hidden\s*=/);
  assert.doesNotMatch(script,/fetch\s*\(|XMLHttpRequest|localStorage\.clear\s*\(/);
});
test('annotated module UI loads same language but excludes user names and mutable live status',()=>{
  for(const path of ['dashboard.html','procurement.html','internal-orders.html']){
    const html=readFileSync(resolve(root,path),'utf8');
    assert.match(html,/sh-i18n\.js\?v=20261012-ui-i18n-v1/);
    assert.match(html,/data-sh-i18n=/);
    assert.doesNotMatch(html,/<[^>]*data-auth-name[^>]*data-sh-i18n=/);
    assert.doesNotMatch(html,/<[^>]*data-sh-i18n=[^>]*data-auth-name/);
  }
  const dash=readFileSync(resolve(root,'dashboard.html'),'utf8');
  assert.doesNotMatch(dash,/<[^>]*id="dashStatus"[^>]*data-sh-i18n/);
  const procurement=readFileSync(resolve(root,'procurement.html'),'utf8');
  assert.doesNotMatch(procurement,/<[^>]*id="proc-status"[^>]*data-sh-i18n/);
  const orders=readFileSync(resolve(root,'internal-orders.html'),'utf8');
  assert.doesNotMatch(orders,/<[^>]*id="io-message"[^>]*data-sh-i18n/);
});

test('late-rendered equipment labels and restaurant controls have exact AZ/EN translations',()=>{
  const {api}=createI18n();
  const labels=[
    'Оборудование','ТО · гарантия · ремонты · замена','Открыть план →',
    'В эксплуатации','ТО ≤ 30 дней','Гарантия ≤ 60 дней',
    'Проверить замену','Ремонты 12 мес.','По оборудованию нет срочных задач.',
    'Рестораны','Показать в отчётах','Выбрать все','Снять все','Применить',
    'Все рестораны','Уведомления по оборудованию'
  ];
  for(const label of labels){
    assert.notEqual(api.t(label,'az'),label,'AZ missing: '+label);
    assert.notEqual(api.t(label,'en'),label,'EN missing: '+label);
  }
  assert.equal(api.t('Pomidor 5kg','az'),'Pomidor 5kg');
});
test('dynamic translation touches only UI labels, never restaurant data or selected checkboxes',()=>{
  const js=readFileSync(resolve(root,'sh-i18n.js'),'utf8');
  const from=js.indexOf('  const DYNAMIC_UI_TEXT=');
  const to=js.indexOf('  function apply(){',from);
  const section=js.slice(from,to);
  assert.ok(section.includes("'#assetDashCard .asset-dash-metric > span'"));
  assert.ok(section.includes("'#sh-global-restaurant-filter .sh-rf-label'"));
  assert.ok(section.includes("querySelectorAll('.sh-rf-list input[type"));
  assert.ok(section.includes("input.checked"));
  assert.ok(!section.includes('.sh-rf-list label span'));
  assert.ok(!section.includes('.asset-dash-alert b'));
  assert.ok(!/\.checked\s*=/.test(section));
  assert.ok(!/\.value\s*=/.test(section));
  assert.ok(!/fetch\s*\(/.test(section));
  assert.ok(!section.includes('window.location'));
});
test('language selector stays accessible at bottom of scrolling navigation',()=>{
  const page=readFileSync(resolve(root,'persistent-workspace.html'),'utf8');
  assert.match(page,/\.sidebar \.sh-language-picker\{[\s\S]*?position:sticky;bottom:0;z-index:20/);
});

test('Dashboard hides developer-only OLAP request counts but keeps loading and errors visible',()=>{
  const src=readFileSync(resolve(root,'dashboard-optimized.js'),'utf8');
  assert.ok(!src.includes('1 API запрос вместо 5'));
  assert.ok(!src.includes('ресторанов выбрано •'));
  assert.ok(src.includes('dashboardNotice()'));
  assert.ok(src.includes('dashboardNotice("Загружаем данные…")'));
  assert.ok(src.includes('dashboardNotice("🔴 OLAP: "+e.message,true)'));
  assert.ok(src.includes('showDisconnected(false)'));
  assert.ok(src.includes('dashboardNotice("Нет подключения к SH OLAP",true)'));
});
test('Dashboard status helper hides success and preserves localized errors',()=>{
  const src=readFileSync(resolve(root,'dashboard-optimized.js'),'utf8');
  const from=src.indexOf('function dashboardNotice(');
  const to=src.indexOf('const money=',from);
  assert.ok(from>=0&&to>from);
  const element={textContent:'',hidden:false,role:null,setAttribute(k,v){this[k]=v}};
  const context={
    document:{getElementById:id=>id==='dashStatus'?element:null},
    window:{SH_I18N:{t:x=>x==='Загружаем данные…'?'Loading data…':x}}
  };
  const helper=new Function('document','window',
    'const $=id=>document.getElementById(id);'+src.slice(from,to)+'\nreturn dashboardNotice;'
  )(context.document,context.window);
  helper('Загружаем данные…');
  assert.equal(element.hidden,false);
  assert.equal(element.textContent,'Loading data…');
  assert.equal(element.role,'status');
  helper();
  assert.equal(element.hidden,true);
  assert.equal(element.textContent,'');
  helper('🔴 OLAP: connection lost',true);
  assert.equal(element.hidden,false);
  assert.equal(element.role,'alert');
  assert.equal(element.textContent,'🔴 OLAP: connection lost');
});

test('shared module catalog supplies AZ and EN labels for operations and HR',()=>{
  const {api}=createI18n('ru',true);
  const cases=[
    ['Кассовые смены','Kassa növbələri','Cashier shifts'],
    ['Список документов','Sənədlərin siyahısı','Document list'],
    ['План счетов','Hesablar planı','Chart of accounts'],
    ['Поставщик','Təchizatçı','Supplier'],
    ['Табель сотрудников','İşçilərin iş vaxtı cədvəli','Employee timesheet'],
    ['Настройки налогов','Vergi ayarları','Tax settings'],
    ['Сохранить операцию','Əməliyyatı saxla','Save transaction'],
    ['Опубликовать меню','Menyunu dərc et','Publish menu'],
    ['Добавить банк','Bank əlavə et','Add bank'],
    ['Остаток на конец','Son qalıq','Closing balance']
  ];
  for(const [source,az,en] of cases){
    assert.equal(api.t(source,'az'),az,source+' AZ');
    assert.equal(api.t(source,'en'),en,source+' EN');
    assert.equal(api.t(source,'ru'),source,source+' RU');
  }
  for(const businessText of ['Tomato premium grade','RMS Gelato Park','65.00 ₼']){
    assert.equal(api.t(businessText,'az'),businessText);
    assert.equal(api.t(businessText,'en'),businessText);
  }
});
test('every main protected module imports catalog before locale engine',()=>{
  const paths=[
    'persistent-workspace.html','dashboard.html','procurement.html','internal-orders.html',
    'cash-shifts.html','cash/index.html','finance.html','reports.html',
    'nomenclature.html','stock-balances.html','stock-movements.html',
    'ai-assistant.html','ai-documents.html','site-users.html','hr-employees.html',
    'hr-payroll.html','qr-menu.html','audit-log.html','abc-xyz.html',
    'food-cost.html','labor-cost.html','menu-engineering.html','waiter-performance.html',
    'supplier-balances.html','pnl.html','hr-employee.html','hr-payroll-adjustments.html',
    'hr-payroll-accounting.html','hr-payroll-tax-settings.html','hr-timesheet.html',
    'hr-timeclock.html','hr-compensation.html','hr-role-schedules.html',
    'hr-calendar.html','rashodnye-nakladnye.html','nakladnye.html',
    'akty-spisaniya.html','vnutrennie-peremescheniya.html','assets-plan/assets.html',
    'assets.html','documents.html','events.html','plugin-events.html'
  ];
  for(const page of paths){
    const html=readFileSync(resolve(root,page),'utf8');
    const catalog=html.indexOf('/sh-i18n-catalog.js');
    const locale=html.indexOf('/sh-i18n.js');
    assert.ok(catalog>=0&&locale>catalog,page+' must load dictionary before engine');
  }
  for(const publicPage of ['login.html','register.html','menu.html','rfq-response.html']){
    const html=readFileSync(resolve(root,publicPage),'utf8');
    assert.ok(!html.includes('/sh-i18n-catalog.js'),publicPage+' has a separate access/user flow');
  }
});
test('module UI localization changes text nodes only, not DOM children, routes, IDs or data',()=>{
  const js=readFileSync(resolve(root,'sh-i18n.js'),'utf8');
  const start=js.indexOf('  const UI_LABEL_SELECTORS='),end=js.indexOf('  function apply(){',start);
  const snippet=js.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.ok(snippet.includes("const NODE_SOURCES=new WeakMap()"));
  assert.ok(snippet.includes("node.nodeValue=leading+next+trailing"));
  assert.ok(snippet.includes("tbody,[contenteditable]"));
  assert.ok(snippet.includes("translateUiAttribute(input,'placeholder')"));
  assert.ok(!snippet.includes('element.innerHTML='));
  assert.ok(!snippet.includes('element.textContent='));
  assert.ok(!/\.checked\s*=/.test(snippet));
  assert.ok(!/\.value\s*=/.test(snippet));
  assert.ok(!snippet.includes("fetch("));
});

test('dynamic module label translation preserves nested icons and row data',()=>{
  const labels=[];
  function nodeContainer(text,inBusinessTable=false,systemStatus=false,safeEmpty=false){
    const el={
      nodeType:1,tagName:'H2',childNodes:[],attributes:{},
      closest(sel){
        if(sel.includes('#stock-modal-title,#mov-modal-title,#fc-modal-title,#fin-modal-title')&&el.id==='fin-modal-title')return el;
        if(sel.startsWith('tbody')&&inBusinessTable)return {tagName:'TBODY'};
        if(sel.startsWith('tbody'))return null;
        if(sel.startsWith('main,.app-shell,.sh-workspace-page'))return{tagName:'MAIN'};
        return null;
      },
      matches(selector){return (systemStatus&&selector.includes('.proc-status-badge'))||(safeEmpty&&selector.includes('.sh-i18n-empty-state'))}
    };
    const node={nodeType:3,nodeValue:text,parentElement:el};
    const icon={nodeType:1,tagName:'SVG',parentElement:el};
    el.childNodes=[node,icon];
    labels.push(el);
    return{el,node,icon};
  }
  const title=nodeContainer('Расход');
  const data=nodeContainer('Аванс',true);
  const dashboardEmpty=nodeContainer('Нет данных по времени');
  const aiEmpty=nodeContainer('Диалогов пока нет.');
  const cashEmpty=nodeContainer('Для выбранных ресторанов сейчас нет онлайн-касс.');
  const shiftsEmpty=nodeContainer('За выбранный период кассовые смены не найдены.');
  const prEmpty=nodeContainer('Нет заявок, ожидающих согласования.');
  const systemStatus=nodeContainer('Выполнен',true,true);
  const untouchedProduct=nodeContainer('Помидор',true,false);
  const prSummary=nodeContainer('Завершённые и закрытые · 2');
  const olapSummary=nodeContainer('0 ₼ по данным OLAP.');
  const supplierTitle=nodeContainer('Поставщик · Best for Bar MMC');
  supplierTitle.el.id='proc-modal-title';
  const contractsCount=nodeContainer('Договоры · 3');
  const stockCounter=nodeContainer('12 из 40 позиций');stockCounter.el.id='stock-result-meta';
  const movementCounter=nodeContainer('5 из 17 строк');movementCounter.el.id='mov-result-meta';
  const foodCounter=nodeContainer('3 из 8 ингредиентов');foodCounter.el.id='fc-result-meta';
  const stockStatus=nodeContainer('Готово · 40 реальных строк');stockStatus.el.id='stock-status';
  const emptyReport=nodeContainer('По выбранным фильтрам данных нет.',true,false,true);
  const accountName=nodeContainer('Расход',false);accountName.el.id='fin-modal-title';
  // A mock exclusion is implemented by closest('#...') for account headings.

  const listeners={};
  const body={
    hasAttribute:key=>key==='data-protected',
    classList:{contains:()=>false}
  };
  const document={
    readyState:'loading',body,documentElement:{lang:'ru'},
    addEventListener:(key,fn)=>{listeners['doc:'+key]=fn},
    querySelector(){return null},
    querySelectorAll(selector){
      if(selector.startsWith('h1,h2'))return labels;
      return [];
    }
  };
  const window={parent:null,addEventListener(){},dispatchEvent(){}};
  window.parent=window;
  runInNewContext(catalogSrc,{window});
  runInNewContext(script,{
    window,document,location:{origin:'https://test.smarthoreca.pages.dev'},
    localStorage:{getItem:()=>null,setItem(){}},
    requestAnimationFrame:fn=>fn(),
    MutationObserver:class{observe(){}},
    CustomEvent:class{constructor(type,data){this.type=type;this.data=data}}
  });
  listeners['doc:DOMContentLoaded']();
  assert.equal(window.SH_I18N.setLanguage('en'),true);
  assert.equal(title.node.nodeValue,'Outgoing');
  assert.equal(dashboardEmpty.node.nodeValue,'No hourly data');
  assert.equal(aiEmpty.node.nodeValue,'No conversations yet.');
  assert.equal(cashEmpty.node.nodeValue,'There are currently no online registers for the selected restaurants.');
  assert.equal(shiftsEmpty.node.nodeValue,'No cashier shifts were found for the selected period.');
  assert.equal(prEmpty.node.nodeValue,'No requests are awaiting approval.');
  assert.equal(systemStatus.node.nodeValue,'Completed');
  assert.equal(untouchedProduct.node.nodeValue,'Помидор');
  assert.equal(prSummary.node.nodeValue,'Completed and closed · 2');
  assert.equal(olapSummary.node.nodeValue,'0 ₼ based on OLAP data.');
  assert.equal(supplierTitle.node.nodeValue,'Supplier · Best for Bar MMC');
  assert.equal(contractsCount.node.nodeValue,'Contracts · 3');
  assert.equal(stockCounter.node.nodeValue,'12 of 40 items');
  assert.equal(movementCounter.node.nodeValue,'5 of 17 rows');
  assert.equal(foodCounter.node.nodeValue,'3 of 8 ingredients');
  assert.equal(stockStatus.node.nodeValue,'Ready · 40 actual rows');
  assert.equal(emptyReport.node.nodeValue,'No data matches the selected filters.');
  assert.equal(accountName.node.nodeValue,'Расход','account name must remain untouched');

  assert.equal(title.el.childNodes[1],title.icon,'icon child identity remains stable');
  assert.equal(data.node.nodeValue,'Аванс','user data in table body is never translated');
  assert.equal(window.SH_I18N.setLanguage('az'),true);
  assert.equal(title.node.nodeValue,'Məxaric');
  assert.equal(dashboardEmpty.node.nodeValue,'Saatlar üzrə məlumat yoxdur');
  assert.equal(aiEmpty.node.nodeValue,'Hələ söhbət yoxdur.');
  assert.equal(cashEmpty.node.nodeValue,'Seçilmiş restoranlarda hazırda onlayn kassa yoxdur.');
  assert.equal(prEmpty.node.nodeValue,'Təsdiq gözləyən tələb yoxdur.');
  assert.equal(systemStatus.node.nodeValue,'Tamamlanıb');
  assert.equal(untouchedProduct.node.nodeValue,'Помидор');
  assert.equal(prSummary.node.nodeValue,'Tamamlanmış və bağlanmış · 2');
  assert.equal(olapSummary.node.nodeValue,'0 ₼ OLAP məlumatlarına əsasən.');
  assert.equal(supplierTitle.node.nodeValue,'Təchizatçı · Best for Bar MMC');
  assert.equal(contractsCount.node.nodeValue,'Müqavilələr · 3');
  assert.equal(stockCounter.node.nodeValue,'12 / 40 mövqe');
  assert.equal(movementCounter.node.nodeValue,'5 / 17 sətir');
  assert.equal(foodCounter.node.nodeValue,'3 / 8 inqrediyent');
  assert.equal(stockStatus.node.nodeValue,'Hazırdır · 40 faktiki sətir');
  assert.equal(emptyReport.node.nodeValue,'Seçilmiş filtrlər üzrə məlumat yoxdur.');
  assert.equal(accountName.node.nodeValue,'Расход','account heading is business data');

  assert.equal(window.SH_I18N.setLanguage('ru'),true);
  assert.equal(title.node.nodeValue,'Расход');
  assert.equal(dashboardEmpty.node.nodeValue,'Нет данных по времени');
  assert.equal(aiEmpty.node.nodeValue,'Диалогов пока нет.');
  assert.equal(cashEmpty.node.nodeValue,'Для выбранных ресторанов сейчас нет онлайн-касс.');
  assert.equal(prEmpty.node.nodeValue,'Нет заявок, ожидающих согласования.');
  assert.equal(systemStatus.node.nodeValue,'Выполнен');
  assert.equal(untouchedProduct.node.nodeValue,'Помидор');
  assert.equal(prSummary.node.nodeValue,'Завершённые и закрытые · 2');
  assert.equal(olapSummary.node.nodeValue,'0 ₼ по данным OLAP.');
  assert.equal(supplierTitle.node.nodeValue,'Поставщик · Best for Bar MMC');
  assert.equal(contractsCount.node.nodeValue,'Договоры · 3');
  assert.equal(stockCounter.node.nodeValue,'12 из 40 позиций');
  assert.equal(movementCounter.node.nodeValue,'5 из 17 строк');
  assert.equal(foodCounter.node.nodeValue,'3 из 8 ингредиентов');
  assert.equal(stockStatus.node.nodeValue,'Готово · 40 реальных строк');
  assert.equal(emptyReport.node.nodeValue,'По выбранным фильтрам данных нет.');
  assert.equal(accountName.node.nodeValue,'Расход');

});
test('late-created dynamic messages use approved selectors and do not translate chat answers',()=>{
  const js=readFileSync(resolve(root,'sh-i18n.js'),'utf8');
  for(const selector of ['.dash-empty','.sha-empty','.sha-hint',
    '.cash-modern-empty','.cs-empty','.cs-status','.proc-empty',
    '.proc-history-block summary','.proc-list-section-title']){
    assert.ok(js.includes(selector),'missing dynamic UI selector '+selector);
  }
  assert.ok(js.includes('.sha-messages,.sha-conversation-list'));
  assert.ok(js.includes("element.closest?.('tbody')&&!emptyOlAPCell(element)"));
  const shifts=readFileSync(resolve(root,'cash-shifts-optimized.js'),'utf8');
  assert.ok(!shifts.includes('Смен не найдено. Запросов к Smart Horeca:'));
});

test('new AI suggested prompts use chosen language without changing stored user messages',()=>{
  const {api}=createI18n('ru',true);
  const key='Покажи продажи за текущий месяц по кассам и блюдам: сумма со скидкой и количество блюд.';
  assert.match(api.t(key,'az'),/Cari ay/);
  assert.match(api.t(key,'en'),/Show sales/);
  assert.equal(api.t(key,'ru'),key);
  const script=readFileSync(resolve(root,'ai-assistant.js'),'utf8');
  assert.ok(script.includes('window.SH_I18N?.t(b.dataset.example||b.textContent)'));
  assert.ok(script.includes('message:text'));
  assert.ok(!script.includes('window.SH_I18N?.t(message.content)'));
});
test('table translation is bounded to approved system badge classes',()=>{
  const js=readFileSync(resolve(root,'sh-i18n.js'),'utf8');
  assert.ok(js.includes("const TABLE_UI_BADGES="));
  assert.ok(js.includes('.proc-status-badge,.io-pill,.status-pill,.status-badge'));
  assert.ok(js.includes('.hrp-status,.hrp-source'));
  assert.ok(js.includes("element.matches?.(TABLE_UI_BADGES)"));
  assert.ok(js.includes('tableUiRoots.push(node)'));
  assert.ok(js.includes('translateUiLabels(node)'));
  assert.ok(js.includes("UI_EXCLUDE='tbody,[contenteditable]"));
  assert.ok(!js.includes("querySelectorAll('tbody td')"));
});

test('AZ/RU/EN supplier, GRN and internal-order modal labels are consistent',()=>{
  const {api}=createI18n('ru',true);
  const labels=[
    ['КАРТОЧКА ПОСТАВЩИКА','TƏCHİZATÇI KARTI','SUPPLIER PROFILE'],
    ['Номер договора','Müqavilə nömrəsi','Contract number'],
    ['Сохранить договор','Müqaviləni saxla','Save contract'],
    ['Новая заявка на закупку','Yeni satınalma tələbi','New purchase request'],
    ['Фактическая приёмка GRN','Faktiki qəbul GRN','Physical receipt GRN'],
    ['Связать и сверить','Əlaqələndir və tutuşdur','Link and reconcile'],
    ['Сохранить и провести','Saxla və uçota al','Save and post'],
    ['Откуда — RMS-отправитель','Haradan — göndərən RMS','From — sending RMS'],
    ['Склад получателя','Qəbul edənin anbarı','Receiver warehouse'],
    ['Название фасовки','Qablaşdırmanın adı','Packaging name']
  ];
  for(const [source,az,en] of labels){
    assert.equal(api.t(source,'az'),az,source+' AZ');
    assert.equal(api.t(source,'en'),en,source+' EN');
    assert.equal(api.t(source,'ru'),source,source+' RU');
  }
  for(const original of ['Restoran Merkez', 'invoice-00029','Pomidor 4 kg','BR-2026-001']){
    assert.equal(api.t(original,'az'),original,'record data unchanged');
  }
});
test('detached modals are localized only through known UI container roots',()=>{
  const engine=readFileSync(resolve(root,'sh-i18n.js'),'utf8');
  assert.match(engine,/\.proc-modal,\.io-modal-dialog,\.modal-back \.modal,\.ts-drawer-panel/);
  assert.ok(engine.includes("['proc-modal','io-modal','tsDrawer'"));
  assert.ok(engine.includes("node.matches?.('.modal-back')"));
  assert.ok(engine.includes('observer.observe(node,{childList:true,subtree:true})'));
  assert.ok(engine.includes('translateUiLabels(node)'));
  assert.ok(engine.includes("observer.observe(document.body,{childList:true})"));
  assert.ok(!engine.includes("observer.observe(document.body,{childList:true,subtree:true})"));
  assert.ok(engine.includes('tbody,[contenteditable]'));
  assert.ok(!engine.includes("element.innerHTML=next"));
  const supplier=readFileSync(resolve(root,'procurement.html'),'utf8');
  assert.ok(supplier.includes('id="proc-modal-body"'));
  const internal=readFileSync(resolve(root,'internal-orders.html'),'utf8');
  assert.ok(internal.includes('id="io-modal"'));
  const nomenclature=readFileSync(resolve(root,'nomenclature.js'),'utf8');
  assert.ok(nomenclature.includes("back.className='modal-back'"));
});

test('report empty states are marked explicitly; business rows, products, names and amounts are not',()=>{
  for(const path of ['stock-balances.js','stock-movements.js','food-cost.js','labor-cost.js']){
    const src=readFileSync(resolve(root,path),'utf8');
    assert.ok(src.includes('class="sh-i18n-empty-state"'),path+' missing safe empty-row marker');
    assert.ok(src.includes('tbody'),path+' should keep table business data structure');
  }
  const i18n=readFileSync(resolve(root,'sh-i18n.js'),'utf8');
  assert.ok(i18n.includes('.fin-empty,.sh-i18n-empty-state'));
  assert.ok(i18n.includes('#stock-modal-title,#mov-modal-title,#fc-modal-title,#fin-modal-title'));
  for(const rootId of ['stock-modal','mov-modal','fc-modal','fin-account-modal'])
    assert.ok(i18n.includes("'"+rootId+"'"),'missing modal observer '+rootId);
  assert.ok(i18n.includes('.stock-modal .modal-item > span'));
  assert.ok(i18n.includes('.mov-modal .modal-item > span'));
  assert.ok(i18n.includes('.fc-modal .modal-item > span'));
  assert.ok(!i18n.includes('.modal-item > strong'));
});
test('food, finance, labor and warehouse reporting labels have reviewed AZ and EN terms',()=>{
  const {api}=createI18n('ru',true);
  for(const [source,az,en] of [
    ['КАРТОЧКА ОСТАТКА','QALIQ KARTI','STOCK BALANCE DETAILS'],
    ['СКЛАДСКАЯ ОПЕРАЦИЯ','ANBAR ƏMƏLİYYATI','WAREHOUSE OPERATION'],
    ['РАСЧЁТ ИНГРЕДИЕНТА','İNQREDİYENT HESABLAMASI','INGREDIENT CALCULATION'],
    ['За выбранный период проводок по этому счёту нет.','Seçilmiş dövr üçün bu hesab üzrə mühasibat yazılışı yoxdur.','No accounting entries for this account in the selected period.'],
    ['Получаем остатки и номенклатуру из iiko…','iiko-dan qalıqlar və nomenklatura alınır…','Loading stock balances and catalog from iiko…'],
    ['Собираем складские документы iiko…','iiko anbar sənədləri toplanır…','Retrieving iiko stock documents…']
  ]){
    assert.equal(api.t(source,'az'),az);
    assert.equal(api.t(source,'en'),en);
  }
});
