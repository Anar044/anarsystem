import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSummary, ownerSummarySourceError } from '../functions/api/mobile/v1/summary.js';

test('normalizes financial aggregates without assuming unavailable values are zero', () => {
  const actual = normalizeSummary({
    success: true, from: '2026-10-01', to: '2026-10-02',
    departmentIds: ['restaurant-1'],
    fields: [
      { name: 'OpenDate.Typed', title: 'Date' },
      { name: 'DishDiscountSumInt', title: 'Revenue' },
      { name: 'UniqOrderId', title: 'Checks' },
      { name: 'DiscountSumInt', title: 'Discounts' },
      { name: 'IncreaseSumInt', title: 'Surcharges' },
      { name: 'ProductCostBase.Cost', title: 'Cost of goods' }
    ],
    revenueField: 'DishDiscountSumInt',
    orderField: 'UniqOrderId',
    profitField: null,
    discountField: 'DiscountSumInt',
    surchargeField: 'IncreaseSumInt',
    costField: 'ProductCostBase.Cost',
    reports: {
      daily: { success: true, request: {
        groupByRowFields: ['OpenDate.Typed']
      }, report: { data: [
        { 'OpenDate.Typed': '2026-10-01', DishDiscountSumInt: 120, UniqOrderId: 4, DiscountSumInt: 0.5, IncreaseSumInt: 0, 'ProductCostBase.Cost': 42 },
        { 'OpenDate.Typed': '2026-10-02', DishDiscountSumInt: 80, UniqOrderId: 2, DiscountSumInt: 0.4, IncreaseSumInt: 0, 'ProductCostBase.Cost': 28 }
      ] } },
      discountReport: {success:true,report:{data:[
        {DiscountSumInt:8},{DiscountSumInt:2}
      ]}},
      surchargeReport: {success:true,report:{data:[
        {IncreaseSumInt:3},{IncreaseSumInt:1}
      ]}}
    },
    meta: { departmentScopeApplied: true }
  });
  assert.equal(actual.metrics.revenue, 200);
  assert.equal(actual.metrics.checks, 6);
  assert.equal(actual.metrics.grossProfit, null);
  assert.equal(actual.metrics.discounts, 10);
  assert.equal(actual.metrics.surcharges, 4);
  assert.equal(actual.metrics.costOfGoods, null);
  assert.equal(actual.costOfGoodsSource,"UNAVAILABLE");
  assert.equal(actual.daily.length, 2);
  assert.deepEqual(actual.daily.map(row=>row.date),["2026-10-02","2026-10-01"]);
  assert.equal(actual.scope.departmentScopeApplied, true);
});

test('dashboard never substitutes date-grouped discount for missing type/register report',()=>{
  const obj={
    success:true,from:'2026-10-01',to:'2026-10-01',departmentIds:['r1'],
    fields:[{name:'OpenDate.Typed',title:'Date'},
      {name:'DiscountSumInt',title:'Discounts'},
      {name:'DishDiscountSumInt',title:'Revenue'}],
    revenueField:'DishDiscountSumInt',discountField:'DiscountSumInt',
    reports:{daily:{success:true,request:{groupByRowFields:['OpenDate.Typed']},
      report:{data:[{'OpenDate.Typed':'2026-10-01',
        DiscountSumInt:0.95,DishDiscountSumInt:100}]}}},
    meta:{departmentScopeApplied:true}
  };
  const value=normalizeSummary(obj);
  assert.equal(value.metrics.discounts,null);
  assert.equal(value.metrics.revenue,100);
});

test('Owner reports an actual exhausted licensed REST session without leaking upstream text',()=>{
  for(const payload of [
    {success:false,message:'License enhancement is required: no connections available for module REST_API(2000)'},
    {success:true,reports:{daily:{success:false,error:'iiko OLAP HTTP 403: License enhancement is required: no connections available for module REST_API(2000)'}}}
  ]) {
    const err=ownerSummarySourceError(payload);
    assert.equal(err?.code,'IIKO_LICENSE_SEATS_UNAVAILABLE');
    assert.equal(err?.status,503);
    assert.equal(err?.message.includes('REST_API'),false);
    assert.equal(err?.message.includes('HTTP'),false);
  }
  assert.equal(ownerSummarySourceError({success:false,message:'Cloudflare temporary failure'}),null);
  assert.equal(ownerSummarySourceError({success:true,reports:{daily:{success:false,error:'Permission denied'}}}),null);
  assert.equal(ownerSummarySourceError(null),null);
});
