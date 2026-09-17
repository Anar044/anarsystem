import test from 'node:test';
import assert from 'node:assert/strict';
import {buildInitialOptions,localTimestampToIso,parseAttLog,parseRegistryPayload,statusToDirection} from '../src/adms.js';

test('converts Azerbaijan local terminal time to UTC ISO',()=>{
  assert.equal(localTimestampToIso('2026-09-17 09:03:14',240),'2026-09-17T05:03:14.000Z');
});

test('maps standard IN and OUT statuses',()=>{
  assert.equal(statusToDirection('0'),'IN');
  assert.equal(statusToDirection('1'),'OUT');
  assert.equal(statusToDirection('2'),'UNKNOWN');
});

test('parses ATTLOG records',()=>{
  const body='17\t2026-09-17 09:03:14\t0\t15\t0\n17\t2026-09-17 18:12:43\t1\t15\t0\n';
  const result=parseAttLog(body,{serial:'SF3A001',utcOffsetMinutes:240});
  assert.equal(result.invalid.length,0);
  assert.equal(result.events.length,2);
  assert.equal(result.events[0].externalEmployeeId,'17');
  assert.equal(result.events[0].type,'IN');
  assert.equal(result.events[1].type,'OUT');
  assert.match(result.events[0].sourceId,/SF3A001\|17\|2026-09-17 09:03:14/);
});

test('parses registry key-value payload',()=>{
  const result=parseRegistryPayload('DeviceType=acc,~DeviceName=SenseFace 3A,FirmVer=1.0.0,IPAddress=192.168.1.50');
  assert.equal(result.DeviceType,'acc');
  assert.equal(result.DeviceName,'SenseFace 3A');
  assert.equal(result.IPAddress,'192.168.1.50');
});

test('initial ADMS response requests realtime attendance',()=>{
  const text=buildInitialOptions('ABC123',{timezone:4});
  assert.match(text,/GET OPTION FROM: ABC123/);
  assert.match(text,/Realtime=1/);
  assert.match(text,/TimeZone=4/);
});
