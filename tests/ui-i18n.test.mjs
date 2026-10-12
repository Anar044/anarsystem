import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const script=readFileSync(resolve(root,'sh-i18n.js'),'utf8');

function createI18n(initial){
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
  runInNewContext(script,{
    window,document,localStorage:storage,location:{origin:'https://preview.smarthoreca.pages.dev'},
    requestAnimationFrame:fn=>fn(),CustomEvent:class{constructor(name,opts){this.name=name;this.detail=opts.detail}}
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
    assert.notEqual(api.t(item,'en'),item,'EN missing: '+item);
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
