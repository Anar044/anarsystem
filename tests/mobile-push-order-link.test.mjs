import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerFcmPayload } from '../functions/api/mobile/_lib/fcm.js';

test('discount FCM data routes only to the precise plugin and order', () => {
  const message = ownerFcmPayload('token', {
    kind: 'DISCOUNT_APPLIED',
    title: 'Применена скидка',
    body: 'RMS 2 · заказ №45',
    departmentId: '123e4567-e89b-12d3-a456-426614174000',
    pluginId: 'b557baad-f85c-4f40-a247-12f8855951ee',
    orderNum: '45',
  });
  assert.deepEqual(message.message.data, {
    kind: 'DISCOUNT_APPLIED',
    departmentId: '123e4567-e89b-12d3-a456-426614174000',
    pluginId: 'b557baad-f85c-4f40-a247-12f8855951ee',
    orderNum: '45',
  });
  assert.equal(message.message.android.priority, 'HIGH');
});
