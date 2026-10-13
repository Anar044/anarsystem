import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { independentRestaurantAttendance } from '../functions/api/hr/_lib/restaurant-attendance.js';

const scope={isChain:true,selectedDepartmentIds:['rms1','rms2'],selectedRestaurants:[
  {id:'rms1',code:'1',name:'RMS 1'},{id:'rms2',code:'2',name:'RMS 2'}]};
const devices=[
  {device_id:'face-1',restaurant_id:'rms1'},{device_id:'face-1b',restaurant_id:'rms1'},
  {device_id:'face-2',restaurant_id:'rms2'},{device_id:'face-outside',restaurant_id:'rms3'}];
const staff=[{id:'TEST-HR',name:'TEST HR'},{id:'WAITER',name:'TEST OFISIANT'}];
const mark=(deviceId,time,id='TEST-HR')=>({
  event_id:deviceId+time,device_id:deviceId,iiko_employee_id:id,
  event_time:new Date(time).toISOString()
});
const endOfDay=Date.parse('2026-10-09T06:00:00+04:00');
test('RMS1 missing checkout cannot be repaired by IN/OUT at RMS2',()=>{
  const events=[
    mark('face-1','2026-10-08T08:00:00+04:00'),
    mark('face-2','2026-10-08T13:00:00+04:00'),
    mark('face-2','2026-10-08T18:00:00+04:00')
  ];
  const output=independentRestaurantAttendance(events,devices,staff,scope,{},endOfDay);
  assert.equal(output.length,2);
  const one=output.find(x=>x.restaurantId==='rms1'),two=output.find(x=>x.restaurantId==='rms2');
  assert.equal(one.status,'INCOMPLETE');
  assert.equal(one.lastOut,'');
  assert.equal(one.workedMinutes,0);
  assert.equal(two.status,'WORK');
  assert.equal(two.workedMinutes,300);
  assert.equal(two.firstIn,new Date('2026-10-08T13:00:00+04:00').toISOString());
  assert.equal(one.employeeId,two.employeeId);
});
test('Two completed restaurant visits produce two separate RMS shifts',()=>{
  const events=[
    mark('face-1','2026-10-08T08:00:00+04:00'),
    mark('face-1b','2026-10-08T12:00:00+04:00'),
    mark('face-2','2026-10-08T13:00:00+04:00'),
    mark('face-2','2026-10-08T18:00:00+04:00')
  ];
  const result=independentRestaurantAttendance(events,devices,staff,scope,{},endOfDay);
  assert.deepEqual(result.map(x=>[x.restaurantId,x.workedMinutes]),[['rms1',240],['rms2',300]]);
  assert.equal(result.reduce((a,x)=>a+x.workedMinutes,0),540);
});
test('Only a mark on the same RMS can close a prior RMS punch',()=>{
  const output=independentRestaurantAttendance([
    mark('face-1','2026-10-08T08:00:00+04:00'),
    mark('face-2','2026-10-08T10:00:00+04:00'),
    mark('face-1b','2026-10-08T12:00:00+04:00')
  ],devices,staff,scope,{},endOfDay);
  assert.equal(output.find(x=>x.restaurantId==='rms1').workedMinutes,240);
  assert.equal(output.find(x=>x.restaurantId==='rms2').status,'INCOMPLETE');
});
test('Single punch stays in progress during its own shift window',()=>{
  const result=independentRestaurantAttendance([
    mark('face-1','2026-10-08T08:00:00+04:00'),
    mark('face-2','2026-10-08T13:00:00+04:00')
  ],devices,staff,scope,{},Date.parse('2026-10-08T18:00:00+04:00'));
  assert.ok(result.every(x=>x.status==='SHIFT_IN_PROGRESS'));
});
test('Night shift crosses midnight independently for each RMS',()=>{
  const result=independentRestaurantAttendance([
    mark('face-1','2026-10-08T23:30:00+04:00'),
    mark('face-1','2026-10-09T02:30:00+04:00'),
    mark('face-2','2026-10-09T03:00:00+04:00')
  ],devices,staff,scope,{'TEST-HR':'NIGHT'},Date.parse('2026-10-09T13:00:00+04:00'));
  assert.equal(result.length,2);
  assert.equal(result.find(x=>x.restaurantId==='rms1').workedMinutes,180);
  assert.equal(result.find(x=>x.restaurantId==='rms2').status,'INCOMPLETE');
  assert.ok(result.every(x=>x.workDate==='2026-10-08'));
});
test('Marks on an unselected restaurant or unregistered device are hidden',()=>{
  const limited={...scope,selectedDepartmentIds:['rms1'],selectedRestaurants:[scope.selectedRestaurants[0]]};
  const output=independentRestaurantAttendance([
    mark('face-1','2026-10-08T08:00:00+04:00'),
    mark('face-2','2026-10-08T13:00:00+04:00'),
    mark('face-outside','2026-10-08T13:01:00+04:00'),
    mark('unknown-device','2026-10-08T13:02:00+04:00')
  ],devices,staff,limited,{},endOfDay);
  assert.equal(output.length,1);
  assert.equal(output[0].restaurantId,'rms1');
  assert.equal(output[0].status,'INCOMPLETE');
});
test('Duplicate marks within 10 seconds are not treated as a pair',()=>{
  const result=independentRestaurantAttendance([
    mark('face-1','2026-10-08T08:00:00+04:00'),
    mark('face-1','2026-10-08T08:00:04+04:00')
  ],devices,staff,scope,{},endOfDay);
  assert.equal(result[0].markCount,1);
  assert.equal(result[0].status,'INCOMPLETE');
});
test('Read-only RMS preview never modifies Payroll or approves a timesheet',()=>{
  const api=readFileSync(new URL('../functions/api/hr/timesheet.js',import.meta.url),'utf8');
  const client=readFileSync(new URL('../hr-timesheet.js',import.meta.url),'utf8');
  const page=readFileSync(new URL('../hr-timesheet.html',import.meta.url),'utf8');
  assert.match(api,/independentRestaurantAttendance\(extraEvents,devices,allPeople,scope/);
  assert.match(api,/appliedToPayroll:false/);
  assert.match(client,/renderRestaurantLedger/);
  assert.match(page,/tsRestaurantLedgerRows/);
});
