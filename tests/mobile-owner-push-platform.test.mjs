import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOwnerPushPayload} from '../functions/api/mobile/_lib/fcm.js';

test('FCM payload supports iOS APNs and Android notification delivery',()=>{
  const msg=buildOwnerPushPayload('device_token',{
    kind:'ITEM_REMOVED',title:'Удалено блюдо',
    body:'Restaurant · заказ №10',departmentId:'r1',orderNum:'10'
  }).message;
  assert.equal(msg.token,'device_token');
  assert.equal(msg.apns.headers['apns-push-type'],'alert');
  assert.equal(msg.apns.payload.aps.sound,'default');
  assert.equal(msg.android.priority,'HIGH');
  assert.equal(msg.android.notification.sound,'default');
  assert.equal(msg.android.notification.channel_id,undefined);
  assert.equal(msg.data.departmentId,'r1');
  assert.equal(msg.data.kind,'ITEM_REMOVED');
});
