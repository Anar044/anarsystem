import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeShiftDetail, verifyScopedShiftMembership } from '../functions/api/mobile/v1/shift.js';

const payload = {
  success: true,
  sessionId: "test-id",
  shift: { departmentId: 'restaurant-a', sessionNumber: 1, revenue: 340 },
  paymentsLoaded: true,
  payments: [
    { id: 'pay-a', group: "CARD", sum: 50 },
    { id: 'pay-b', group: "PAYOUT", actualSum: 30 }
  ]
};
test('owners receive an isolated, read-only shift detail projection', () => {
  const result = normalizeShiftDetail(payload, ['restaurant-a']);
  assert.equal(result.revenue, 340);
  assert.equal(result.operations.length, 2);
  assert.equal(result.operations[1].group, "PAYOUT");
  assert.equal('shift' in result, false);
  assert.equal('connection' in result, false);
});
test('details never leak from another selected restaurant', () => {
  assert.throws(() => normalizeShiftDetail(payload, ['restaurant-b']), /Нет доступа/);
});
test('details without department must never be displayed', () => {
  assert.throws(() => normalizeShiftDetail({
    ...payload, shift: { id: 'test-id', revenue: 100 }
  }, ['restaurant-a']), /не вернул ресторан/);
});
test('do not fabricate payments when upstream payments unavailable', () => {
  const result = normalizeShiftDetail({
    ...payload, paymentsLoaded: false
  }, ['restaurant-a']);
  assert.equal(result.operations.length, 0);
  assert.equal(result.paymentsLoaded, false);
});

test('membership must come from matching restaurant-scoped shift listing',()=>{
 const scoped=[{ok:true,shifts:[{
   _sessionId:'test-id',_dateKey:'2026-10-14',
   departmentId:'restaurant-a',_scopedDepartmentId:'restaurant-a'
 }]},{ok:true,shifts:[]}];
 assert.equal(verifyScopedShiftMembership(scoped,'test-id',
   'restaurant-a','2026-10-14').departmentId,'restaurant-a');
 assert.throws(()=>verifyScopedShiftMembership(scoped,'test-id',
   'restaurant-b','2026-10-14'),e=>e.code==='SHIFT_NOT_IN_RESTAURANT');
 assert.throws(()=>verifyScopedShiftMembership(scoped,'test-id',
   'restaurant-a','2026-10-15'),e=>e.code==='SHIFT_NOT_IN_RESTAURANT');
 assert.throws(()=>verifyScopedShiftMembership([{
   ok:true,shifts:[{_sessionId:'test-id',_dateKey:'2026-10-14',
     departmentId:'restaurant-a'}]
 }],'test-id','restaurant-a','2026-10-14'),
 e=>e.code==='SHIFT_NOT_IN_RESTAURANT');
});
