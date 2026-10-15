import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeShifts, loadScopedCashHistory } from '../functions/api/mobile/v1/shifts.js';

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

test('history requests each restaurant with a scoped OPEN and CLOSED range',async()=>{
 const previous=globalThis.fetch,queries=[];
 globalThis.fetch=async input=>{
   const url=new URL(String(input));
   if(url.pathname==='/resto/api/auth')return new Response('test-token');
   const dept=url.searchParams.get('departmentId');
   const status=url.searchParams.get('status');
   queries.push(dept+'|'+status);
   assert.equal(url.searchParams.get('openDateFrom'),'2026-10-12');
   assert.equal(url.searchParams.get('openDateTo'),'2026-10-15');
   const items=dept==='A'&&status==='OPEN'?[{
     id:'s-open',openDate:'2026-10-14T22:00:00',
     sessionStatus:'UNACCEPTED',pointOfSale:'POS A'
   }]:dept==='A'&&status==='CLOSED'?[{
     id:'s-closed',openDate:'2026-10-14T08:00:00',
     closeDate:'2026-10-14T18:00:00',sessionStatus:'ACCEPTED'
   }]:[];
   return Response.json(items);
 };
 try {
   const rows=await loadScopedCashHistory({
     ip:'127.0.0.1',port:'9998',login:'history',password:'test'
   },['A','B'],'2026-10-12','2026-10-15',{operational:true});
   assert.deepEqual(new Set(rows.map(r=>r.id)),new Set(['s-open','s-closed']));
   assert.equal(rows[0].departmentId,'A');
   const mapped=normalizeShifts({success:true,shifts:rows,errors:[]},['A','B']);
   assert.deepEqual(new Set(mapped.map(x=>x.status)),new Set(['OPEN','CLOSED']));
   assert.equal(mapped.find(x=>x.id==='s-open').cashRegisterName,'POS A');
   assert.equal(queries.length,4);
 }finally{globalThis.fetch=previous;}
});
