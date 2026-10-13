import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {zktecoModelProfile,plannedDeviceRoster} from '../functions/api/hr/_lib/zkteco-network-roster.js';

const scope={isChain:true,selectedDepartmentIds:['a','b','c'],selectedRestaurants:[
  {id:'a',code:'1',name:'RMS 1'},{id:'b',code:'2',name:'RMS 2'},{id:'c',code:'3',name:'RMS 3'}
]};
const devices=[
  {device_id:'f18',name:'F18 вход',device_model:'F18',restaurant_id:'a'},
  {device_id:'2a',name:'SenseFace 2A',device_model:'SenseFace 2A',restaurant_id:'b'},
  {device_id:'3a',name:'SenseFace 3A',device_model:'SenseFace 3A',restaurant_id:'c'}
];
const employees=[
  {iiko_employee_id:'test-hr',employee_code:'3',display_name:'TEST HR',department_code:'1',departmentCodes:['1','2','3']},
  {iiko_employee_id:'waiter',employee_code:'1',display_name:'TEST OFISIANT',department_code:'1',departmentCodes:['1']},
  {iiko_employee_id:'manager',employee_code:'2',display_name:'TEST MENECER',department_code:'1',departmentCodes:['1']},
  {iiko_employee_id:'service',employee_code:'SH-ID-ABC',display_name:'API import',department_code:'',departmentCodes:[]},
  {iiko_employee_id:'fired',employee_code:'4',display_name:'Former',department_code:'1',departmentCodes:['1'],fire_date:'2026-01-01'}
];
test('Mixed models represent biometric methods accurately without promising template interoperability',()=>{
  assert.equal(zktecoModelProfile('F18').face,false);
  assert.equal(zktecoModelProfile('F18').fingerprint,true);
  assert.equal(zktecoModelProfile('F18').connection,'AC_PUSH_STANDARD_TA_PUSH_OPTIONAL');
  for(const model of ['SenseFace 2A','SenseFace 3A']){
    assert.equal(zktecoModelProfile(model).face,true);
    assert.equal(zktecoModelProfile(model).fingerprint,true);
    assert.equal(zktecoModelProfile(model).templateTransfer,'REQUIRES_FIRMWARE_AND_SDK_VERIFICATION');
  }
  assert.equal(zktecoModelProfile('unknown').fingerprint,false);
});
test('TEST HR is planned on F18, SenseFace 2A and 3A without duplicate identity',()=>{
  const previews=plannedDeviceRoster(devices,employees,scope);
  assert.deepEqual(previews.map(x=>x.eligibleCount),[3,1,1]);
  assert.ok(previews.every(x=>x.preview.some(e=>e.id==='test-hr')));
  assert.ok(previews.every(x=>x.preview.find(e=>e.id==='test-hr').suggestedId==='3'));
  assert.ok(previews.every(x=>!x.provisioningEnabled&&!x.biometricSyncEnabled));
});
test('Service accounts and fired employees are not staged for device distribution',()=>{
  const previews=plannedDeviceRoster(devices,employees,scope);
  assert.ok(previews.every(x=>x.preview.every(e=>e.id!=='service'&&e.id!=='fired')));
});
test('A device outside authorized CHAIN scope produces no roster entries',()=>{
  const rms1={...scope,selectedDepartmentIds:['a'],selectedRestaurants:[scope.selectedRestaurants[0]],membershipRestricted:true};
  const previews=plannedDeviceRoster(devices,employees,rms1);
  assert.equal(previews[0].eligibleCount,3);
  assert.equal(previews[1].eligibleCount,0);
  assert.equal(previews[1].rosterStatus,'RESTAURANT_NOT_IN_SCOPE');
  assert.equal(previews[2].eligibleCount,0);
});
test('PIN candidate never equals a generated internal code or duplicates another numeric code',()=>{
  const rows=[
    {iiko_employee_id:'x',employee_code:'44',departmentCodes:['1']},
    {iiko_employee_id:'y',employee_code:'44',departmentCodes:['1']},
    {iiko_employee_id:'z',employee_code:'SH-ID-Z',departmentCodes:['1']}
  ];
  const plan=plannedDeviceRoster([devices[0]],rows,scope)[0];
  assert.equal(plan.eligibleCount,3);
  assert.ok(plan.preview.every(x=>x.suggestedId===null));
});
test('Production ZKTeco provisioning and biometric transport remain disabled until firmware verified',()=>{
  const api=readFileSync(new URL('../functions/api/hr/timeclock.js',import.meta.url),'utf8');
  const page=readFileSync(new URL('../hr-timeclock.html',import.meta.url),'utf8');
  assert.match(api,/rosterPreview:roster/);
  assert.match(api,/device_model/);
  assert.match(page,/SenseFace 3A/);
  assert.match(page,/F18/);
  assert.match(page,/Только просмотр/);
  assert.doesNotMatch(page,/Отправить биометрические шаблоны/);
});
