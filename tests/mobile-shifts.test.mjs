import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeShifts } from '../functions/api/mobile/v1/shifts.js';

const payload = {
  success: true, shifts: [
    { id: 'a', departmentId: 'rest-A', sessionNumber: 7, status: 'OPEN',
      cashierName: 'Demo Cashier', openDate: '2026-10-12T09:00:00' },
    { id: 'b', departmentId: 'rest-B', sessionNumber: 8, status: 'CLOSED' }
  ], errors: []
};
test('returns only verified selected restaurant sessions', () => {
  const items = normalizeShifts({ ...payload, shifts: [payload.shifts[0]] }, ['rest-A']);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'a');
  assert.equal(items[0].status, 'OPEN');
  assert.equal(items[0].departmentId, 'rest-A');
});
test('fails closed on any unexpected restaurant', () => {
  assert.throws(() => normalizeShifts(payload, ['rest-A']), /принадлежность/);
});
test('fails closed when upstream has unknown department', () => {
  assert.throws(() => normalizeShifts({ ...payload,
    shifts: [{ id: 'b', status: 'CLOSED' }] }, ['rest-A']), /подразделение/);
});
test('fails closed when the upstream returned partial days', () => {
  assert.throws(() => normalizeShifts({ ...payload, errors: [{ status: 502 }] },
    ['rest-A', 'rest-B']), /неполные/);
});
test('never invents financial totals not returned by server', () => {
  const items = normalizeShifts({ ...payload, shifts: [payload.shifts[0]] }, ['rest-A']);
  assert.equal(items[0].revenue, null);
  assert.equal(items[0].checks, null);
});
