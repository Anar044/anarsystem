import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSummary } from '../functions/api/mobile/v1/summary.js';

test('normalizes financial aggregates without assuming unavailable values are zero', () => {
  const actual = normalizeSummary({
    success: true, from: '2026-10-01', to: '2026-10-02',
    departmentIds: ['restaurant-1'],
    fields: [
      { name: 'OpenDate.Typed', title: 'Date' },
      { name: 'DishDiscountSumInt', title: 'Revenue' },
      { name: 'UniqOrderId', title: 'Checks' }
    ],
    revenueField: 'DishDiscountSumInt',
    orderField: 'UniqOrderId',
    profitField: null,
    reports: { daily: { success: true, request: {
      groupByRowFields: ['OpenDate.Typed']
    }, report: { data: [
      { 'OpenDate.Typed': '2026-10-01', DishDiscountSumInt: 120, UniqOrderId: 4 },
      { 'OpenDate.Typed': '2026-10-02', DishDiscountSumInt: 80, UniqOrderId: 2 }
    ] } } },
    meta: { departmentScopeApplied: true }
  });
  assert.equal(actual.metrics.revenue, 200);
  assert.equal(actual.metrics.checks, 6);
  assert.equal(actual.metrics.grossProfit, null);
  assert.equal(actual.daily.length, 2);
  assert.equal(actual.scope.departmentScopeApplied, true);
});
