import test from 'node:test';
import assert from 'node:assert/strict';
import { mobilePeriod } from '../functions/api/mobile/_lib/query-helpers.js';

function query(from, to) {
  return new Request(`https://owner.preview/api/mobile/v1/movements?from=${from}&to=${to}`);
}
test('allows a 30-day calendar selection for reports', () => {
  assert.deepEqual(mobilePeriod(query('2026-10-01','2026-10-30'),32),
    {from:'2026-10-01',to:'2026-10-30'});
});
test('blocks an excessive report period for resource safety', () => {
  assert.throws(() => mobilePeriod(query('2026-09-01','2026-10-14'),32),
    /слишком длинный/i);
});
test('rejects invalid calendar dates and reversed date range', () => {
  assert.throws(() => mobilePeriod(query('2026-02-30','2026-03-01'),32));
  assert.throws(() => mobilePeriod(query('2026-10-09','2026-10-01'),32));
});
