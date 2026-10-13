import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterAttendanceEventsByRestaurant } from '../functions/api/hr/_lib/restaurant-scope.js';

const fullChain={
  isChain:true,
  selectedDepartmentIds:['id-a','id-b'],
  selectedRestaurants:[
    {id:'id-a',code:'REST_A',name:'Restaurant A'},
    {id:'id-b',code:'REST_B',name:'Restaurant B'}
  ]
};
const devices=[
  {device_id:'face-a',restaurant_id:'id-a'},
  {device_id:'face-b',restaurant_id:'id-b'},
  {device_id:'face-unassigned',restaurant_id:''},
  {device_id:'face-other',restaurant_id:'id-c'}
];
const employees=[
  {iiko_employee_id:'emp-a',department_code:'REST_A'},
  {iiko_employee_id:'emp-b',department_code:'REST_B'}
];
const events=[
  {event_id:'a-at-a',device_id:'face-a',iiko_employee_id:'emp-a'},
  {event_id:'a-at-b',device_id:'face-b',iiko_employee_id:'emp-a'},
  {event_id:'b-at-b',device_id:'face-b',iiko_employee_id:'emp-b'},
  {event_id:'b-at-a',device_id:'face-a',iiko_employee_id:'emp-b'},
  {event_id:'a-at-unknown',device_id:'missing-device',iiko_employee_id:'emp-a'},
  {event_id:'a-at-unassigned',device_id:'face-unassigned',iiko_employee_id:'emp-a'},
  {event_id:'b-at-c',device_id:'face-other',iiko_employee_id:'emp-b'}
];

test('CHAIN counts marks only from the employee own restaurant',()=>{
  const result=filterAttendanceEventsByRestaurant(events,devices,employees,fullChain);
  assert.deepEqual(result.map(e=>e.event_id),['a-at-a','b-at-b']);
});
test('A restaurant-scoped manager cannot use B employee or B device marks',()=>{
  const scope={...fullChain,selectedDepartmentIds:['id-a'],selectedRestaurants:[fullChain.selectedRestaurants[0]],membershipRestricted:true};
  const result=filterAttendanceEventsByRestaurant(events,devices,employees,scope);
  assert.deepEqual(result.map(e=>e.event_id),['a-at-a']);
});
test('CHAIN without a mapped device or restaurant fails closed',()=>{
  assert.deepEqual(filterAttendanceEventsByRestaurant(events,devices,employees,{isChain:true,selectedDepartmentIds:[],selectedRestaurants:[]}),[]);
});
test('Non-CHAIN RMS retains its established attendance behavior',()=>{
  assert.equal(filterAttendanceEventsByRestaurant(events,devices,employees,{isChain:false}),events);
});
test('Role schedules, meals and payroll accounting use workspace membership',()=>{
  const file=(path)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const roles=file('functions/api/hr/role-schedules.js');
  assert.match(roles,/const userId=state\.storageUserId\|\|state\.user\.id/);
  assert.match(roles,/resolveHrRestaurantScope\(request,env,userId,state\.access\)/);
  assert.match(roles,/scope\?\.membershipRestricted\|\|isHrSubsetScope\(scope\)/);
  assert.match(roles,/canEditSharedRules/);
  const meals=file('functions/api/hr/meal-transactions-v2.js');
  assert.match(meals,/const userId=state\.storageUserId\|\|state\.user\.id/);
  assert.match(meals,/resolveHrRestaurantScope\(request,env,userId,state\.access\)/);
  assert.match(meals,/if\(scope\?\.isChain&&restricted\)/);
  assert.match(meals,/if\(!restricted&&unmatched\.length<25\)/);
  const accounting=file('functions/api/hr/payroll-accounting-settings.js');
  assert.match(accounting,/requireCapability\(state\.user,"canViewPayroll",state\.access\)/);
  assert.match(accounting,/requireCapability\(state\.user,"canConfigurePayrollAccounting",state\.access\)/);
  const timesheet=file('functions/api/hr/timesheet.js');
  const payroll=file('functions/api/hr/payroll.js');
  assert.match(timesheet,/filterAttendanceEventsByRestaurant\(eventRows\.results\|\|\[\],devices,employees,scope\)/);
  assert.match(payroll,/filterAttendanceEventsByRestaurant\(/);
});
