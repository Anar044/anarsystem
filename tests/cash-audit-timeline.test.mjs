import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const cash=fs.readFileSync(new URL('../cash.js',import.meta.url),'utf8');
const start=cash.indexOf('  function eventType(ev){');
const end=cash.indexOf('  function renderHistory(events){',start);
assert.ok(start>0&&end>start,'audit label/summary functions exist');
const helper=cash.slice(start,end);
const context={
  esc:(v)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;'),
  num:(v)=>v==null||v===''?NaN:Number(v),
  money:(v)=>String(v)
};
const {historyText,historySummary}=vm.runInNewContext(
  '(function(){'+helper+';return {historyText,historySummary};})()',context);

test('legacy POS exact event labels in browser',()=>{
  const names=[
    ['deletionOfNotPrintedItem','Удалено нераспечатанное блюдо'],
    ['deletionOfPrintedItem','Удалено распечатанное блюдо'],
    ['orderGuestBill','Распечатан пречек'],
    ['cancellationOfGuestBill','Отменён пречек'],
    ['orderInTheStatusOfTheBillForALongTime',
      'Заказ долго находится в статусе «Пречек»'],
    ['addingDiscount','Добавлена скидка'],
    ['addingSurcharge','Добавлена надбавка'],
    ['voidReceipt','Чек сторнирован (возврат)'],
    ['closingOrder','Заказ закрыт'],
    ['paymentTypeChanged','Изменён тип оплаты'],
    ['unexpectedEnglishWireEvent','Другое событие заказа']
  ];
  for(const [pluginEventType,label] of names)
    assert.equal(historyText({pluginEventType}),label,pluginEventType);
});
test('printed item writeoff reason and discount names are not rendered as dishes',()=>{
  const printed=historySummary({pluginEventType:'deletionOfPrintedItem',
    data:{orderNum:45,productName:'Плов',reasonWriteOff:'Порча',
      reasonComment:'Передержан'}});
  assert.match(printed,/Со списанием/);
  assert.match(printed,/Порча/);
  assert.match(printed,/Передержан/);
  assert.match(printed,/Плов/);
  const without=historySummary({pluginEventType:'deletionOfPrintedItem',
    data:{productName:'Чай',isWriteOff:false}});
  assert.match(without,/Касса не передала тип списания|Без списания/);
  const discount=historySummary({pluginEventType:'addingDiscount',
    data:{name:'Endirim 10%',valuePercent:10}});
  assert.match(discount,/Скидка/);
  assert.match(discount,/Endirim 10%/);
  assert.doesNotMatch(discount,/Блюдо/);
});
test('browser audit cache is keyed by cash and order, not by current payment status',()=>{
  assert.match(cash,/historyCache: new Map/);
  assert.match(cash,/const cacheKey=pluginId\+':'\+orderId/);
  assert.match(cash,/if\(events\.length\)/);
  assert.match(cash,/Сервер временно вернул пустую историю/);
  assert.match(cash,/state\.plugins\.find\(x=>String\(x\?\.pluginId\|\|''\)===String\(state\.pluginId\)\)/);
});
