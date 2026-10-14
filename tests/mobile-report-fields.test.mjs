import test from 'node:test';
import assert from 'node:assert/strict';
import { findOlapField } from '../functions/api/mobile/v1/report.js';

test('matches discount and cost fields by exact technical code', () => {
  assert.equal(findOlapField([
    { name:'DiscountSumInt',title:'Сумма скидки'},
    { name:'DishDiscountSumInt',title:'Сумма со скидкой'}
  ], ['DiscountSumInt']), 'DiscountSumInt');
});
test('can use an exact OLAP display title when field has another code', () => {
  const fields=[{name:'DiscountCardType.Name', title:'Название скидки'}];
  assert.equal(findOlapField(fields,['Название скидки']), 'DiscountCardType.Name');
});
test('never guesses a discount measure from net sales, or cost from profit', () => {
  assert.equal(findOlapField([
    {name:'DishDiscountSumInt', title:'Сумма со скидкой'},
    {name:'ProductCostBase.Profit',title:'Валовая прибыль'}
  ],['DiscountSumInt','DiscountAmount','ProductCostBase.Cost']),null);
});
