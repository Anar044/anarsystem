import test from 'node:test';
import assert from 'node:assert/strict';
import { approvalDepartments,approvalTarget,approvalMonthClosed } from '../functions/api/hr/_lib/department-approvals.js';

const restaurants=[
  {id:'dep-A',code:'A',name:'Restaurant A'},
  {id:'dep-B',code:'B',name:'Restaurant B'},
  {id:'dep-C',code:'C',name:'Restaurant C'}
];
const scope=(ids)=>({isChain:true,mode:'CHAIN',selectedDepartmentIds:ids,selectedRestaurants:restaurants.filter(r=>ids.includes(r.id))});
test('Each CHAIN restaurant has its own immutable document key',()=>{
  assert.deepEqual(approvalDepartments(scope(['dep-A','dep-B'])).map(x=>x.id),['dep-A','dep-B']);
  assert.equal(approvalTarget(scope(['dep-A'])).key,'dep-A');
  assert.equal(approvalTarget(scope(['dep-B'])).key,'dep-B');
  assert.equal(approvalTarget(scope(['dep-C'])).key,'dep-C');
});
test('Central HR sees three restaurants but must choose one before signing',()=>{
  const all=scope(['dep-A','dep-B','dep-C']);
  assert.equal(approvalTarget(all).key,'');
  assert.equal(approvalTarget(all).available.length,3);
  assert.equal(approvalTarget(all,'dep-B').key,'dep-B');
  assert.throws(()=>approvalTarget(all,'dep-X'),e=>e.status===403);
});
test('Restaurant A manager cannot approve restaurant B or use a different ID',()=>{
  const a=scope(['dep-A']);
  assert.equal(approvalTarget(a,'dep-A').key,'dep-A');
  assert.throws(()=>approvalTarget(a,'dep-B'),e=>e.status===403);
  assert.throws(()=>approvalTarget(a,'dep-A,dep-B'),e=>e.status===403);
});
test('CHAIN empty accessible departments never fall back to ACCOUNT',()=>{
  assert.equal(approvalTarget(scope([])).key,'');
  assert.throws(()=>approvalTarget(scope([]),'dep-A'),e=>e.status===403);
});
test('RMS still uses the legacy ACCOUNT approval key',()=>{
  assert.equal(approvalTarget({mode:'RMS',isChain:false,selectedDepartmentIds:[]}).key,'ACCOUNT');
});
test('Monthly approvals cannot be signed during the current or future Baku month',()=>{
  const current=new Date('2026-10-09T08:00:00Z');
  assert.equal(approvalMonthClosed('2026-09',current),true);
  assert.equal(approvalMonthClosed('2026-10',current),false);
  assert.equal(approvalMonthClosed('2026-11',current),false);
  assert.equal(approvalMonthClosed('bad',current),false);
  assert.equal(approvalMonthClosed('2026-10',new Date('2026-10-31T20:00:00Z')),true);
});
