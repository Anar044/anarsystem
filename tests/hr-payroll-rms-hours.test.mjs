import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {independentRestaurantAttendance} from '../functions/api/hr/_lib/restaurant-attendance.js';
import {summarizePayrollRmsHours} from '../functions/api/hr/_lib/payroll-rms-hours.js';

const scope={isChain:true,selectedDepartmentIds:['r1','r2'],selectedRestaurants:[
 {id:'r1',code:'1',name:'RMS 1'},{id:'r2',code:'2',name:'RMS 2'}
]};
const devices=[{device_id:'a',restaurant_id:'r1'},{device_id:'b',restaurant_id:'r2'}];
const employees=[{id:'farid',name:'Самедов Фарид'}];
const at=(device_id,local)=>({device_id,iiko_employee_id:'farid',event_time:new Date(local).toISOString()});
const atEnd=Date.parse('2026-10-09T06:00:00+04:00');
const ledger=marks=>independentRestaurantAttendance(marks,devices,employees,scope,{},atEnd);

test('Same employee appears once as a person but has independent payable hours at each RMS',()=>{
 const marks=[at('a','2026-10-08T08:00:00+04:00'),at('a','2026-10-08T12:00:00+04:00'),
   at('b','2026-10-08T13:00:00+04:00'),at('b','2026-10-08T18:00:00+04:00')];
 const result=summarizePayrollRmsHours(ledger(marks),scope);
 assert.equal(result.network.uniqueEmployees,1);
 assert.equal(result.employeeRows.length,2);
 assert.deepEqual(result.departments.map(r=>r.recordedMinutes),[240,300]);
 assert.equal(result.network.recordedMinutes,540);
 assert.equal(result.network.nonOverlappingMinutes,540);
 assert.equal(result.network.completeShifts,2);
 assert.equal(result.appliedToPayroll,false);
});
test('RMS1 forgotten checkout is an issue, RMS2 closed shift still counts five hours',()=>{
 const marks=[at('a','2026-10-08T08:00:00+04:00'),
   at('b','2026-10-08T13:00:00+04:00'),at('b','2026-10-08T18:00:00+04:00')];
 const result=summarizePayrollRmsHours(ledger(marks),scope);
 assert.equal(result.departments[0].incompleteShifts,1);
 assert.equal(result.departments[0].nonOverlappingMinutes,0);
 assert.equal(result.departments[1].recordedMinutes,300);
 assert.equal(result.network.uniqueEmployees,1);
 assert.equal(result.network.recordedMinutes,300);
});
test('Simultaneous completed sessions at two RMS are flagged and withheld from non-overlap total',()=>{
 const marks=[at('a','2026-10-08T08:00:00+04:00'),at('a','2026-10-08T14:00:00+04:00'),
   at('b','2026-10-08T12:00:00+04:00'),at('b','2026-10-08T18:00:00+04:00')];
 const result=summarizePayrollRmsHours(ledger(marks),scope);
 assert.equal(result.network.recordedMinutes,720);
 assert.equal(result.network.nonOverlappingMinutes,0);
 assert.equal(result.network.overlapShifts,2);
 assert.equal(result.network.uniqueEmployees,1);
});
test('Restricted restaurant view includes only its local marks and one employee',()=>{
 const restricted={...scope,selectedDepartmentIds:['r2'],selectedRestaurants:[scope.selectedRestaurants[1]],membershipRestricted:true};
 const marks=[at('a','2026-10-08T08:00:00+04:00'),at('a','2026-10-08T12:00:00+04:00'),
   at('b','2026-10-08T13:00:00+04:00'),at('b','2026-10-08T18:00:00+04:00')];
 const l=independentRestaurantAttendance(marks,devices,employees,restricted,{},atEnd);
 const result=summarizePayrollRmsHours(l,restricted);
 assert.equal(result.departments.length,1);
 assert.equal(result.departments[0].restaurantId,'r2');
 assert.equal(result.network.recordedMinutes,300);
 assert.equal(result.network.uniqueEmployees,1);
});
test('Payroll shows RMS hours, explicitly blocks claims of allocated money',()=>{
 const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
 const api=read('functions/api/hr/payroll.js'),html=read('hr-payroll.html'),ui=read('hr-payroll.js');
 assert.match(api,/summarizePayrollRmsHours\(ledger,scope\)/);
 assert.match(api,/rmsHours,/);
 assert.match(html,/hrpRmsHours/);
 assert.match(ui,/renderRmsHours/);
 assert.match(api,/Старые суммы Payroll не являются окончательными/);
 const lib=read('functions/api/hr/_lib/payroll-rms-hours.js');
 assert.doesNotMatch(lib,/syncOvertimeAccrualPosting|INSERT INTO hr_overtime|UPDATE hr_/);
});
