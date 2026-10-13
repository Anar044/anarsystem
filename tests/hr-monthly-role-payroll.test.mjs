import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseNorm,validMonth,MODES,calculateRestaurantGross,calculateOfficeGross,previewRmsRolePayroll} from '../functions/api/hr/_lib/monthly-role-payroll.js';
import {hrAccessRule} from '../functions/api/hr/_middleware.js';

test('October manually set 26 days x 10 hours and 220 real hours produces 22 equivalent days and 338.46 AZN',()=>{
 const result=calculateRestaurantGross({monthlyOfficialGross:400,actualMinutes:220*60,normDays:26,dailyNormMinutes:600});
 assert.equal(result.plannedMinutes,260*60);
 assert.equal(result.actualMinutes,220*60);
 assert.equal(result.equivalentDays,22);
 assert.equal(result.totalGross,338.46);
 assert.equal(result.postingAllowed,false);
});
test('November manually set 25 days x 10 hours and 210 hours produces 336 AZN',()=>{
 const result=calculateRestaurantGross({monthlyOfficialGross:400,actualMinutes:210*60,normDays:25,dailyNormMinutes:600});
 assert.equal(result.equivalentDays,21);
 assert.equal(result.totalGross,336);
});
test('Different lengths of workdays are summed in minutes without rounding daily days',()=>{
 const result=calculateRestaurantGross({monthlyOfficialGross:400,actualMinutes:(10+9+5)*60,normDays:26,dailyNormMinutes:600});
 assert.equal(result.actualMinutes,1440);
 assert.equal(result.equivalentDays,2.4);
 assert.equal(result.totalGross,36.92);
});
test('Salary gross official and additional amounts scale independently; office fixed ignores restaurant hours',()=>{
 const result=calculateRestaurantGross({monthlyOfficialGross:250,monthlyAdditionalGross:150,actualMinutes:13200,normDays:26,dailyNormMinutes:600});
 assert.equal(result.officialGross,211.54);
 assert.equal(result.additionalGross,126.92);
 assert.equal(result.totalGross,338.46);
 const office=calculateOfficeGross({monthlyOfficialGross:400,monthlyAdditionalGross:100});
 assert.equal(office.totalGross,500);
 assert.equal(office.payrollMode,'OFFICE_FIXED');
 assert.equal(office.postingAllowed,false);
});
test('Invalid monthly calendar values are rejected, never silently defaulted',()=>{
 assert.deepEqual(parseNorm({payrollMode:MODES.RESTAURANT,normDays:26,dailyNormMinutes:600}),
 {payrollMode:MODES.RESTAURANT,normDays:26,dailyNormMinutes:600,plannedMinutes:15600});
 for(const days of [0,32,26.5,-1]){
  assert.throws(()=>parseNorm({payrollMode:MODES.RESTAURANT,normDays:days,dailyNormMinutes:600}));
 }
 assert.throws(()=>parseNorm({payrollMode:MODES.RESTAURANT,normDays:26,dailyNormMinutes:1500}));
 assert.deepEqual(parseNorm({payrollMode:MODES.OFFICE}),{payrollMode:'OFFICE_FIXED',normDays:0,dailyNormMinutes:0,plannedMinutes:0});
 assert.equal(validMonth('2026-10'),true);
 assert.equal(validMonth('2026-13'),false);
});
const scope={isChain:true,selectedDepartmentIds:['r1','r2'],selectedRestaurants:[
 {id:'r1',code:'1',name:'RMS 1'},{id:'r2',code:'2',name:'RMS 2'}
]};
const staff=[
 {iiko_employee_id:'farid',display_name:'Самедов Фарид',role_code:'WAITER',is_deleted:0},
 {iiko_employee_id:'office',display_name:'Бухгалтер',role_code:'ACCOUNTANT',is_deleted:0}
];
const norm=(id,role,mode='RESTAURANT_HOURS',days=26,daily=600)=>({
 restaurant_id:id,role_code:role,payroll_mode:mode,norm_days:days,daily_norm_minutes:daily
});
const salary=(id,official,additional=0)=>({iiko_employee_id:id,effective_from:'2026-01-01',effective_to:'',is_active:1,official_gross:official,additional_amount:additional});
const hour=(id,rms,minutes)=>({employeeId:id,employeeName:'Самедов Фарид',restaurantId:rms,restaurantName:rms==='r1'?'RMS 1':'RMS 2',
  recordedMinutes:minutes,nonOverlappingMinutes:minutes,incompleteShifts:0,overlapShifts:0});

test('Farid has one network identity but separate salaries by RMS and no duplicated full-month wage',()=>{
 const preview=previewRmsRolePayroll({
  hourRows:[hour('farid','r1',100*60),hour('farid','r2',120*60)],
  employees:staff,norms:[norm('r1','WAITER'),norm('r2','WAITER')],
  employeeTerms:[salary('farid',400)],roleTerms:[],month:'2026-10',scope
 });
 assert.equal(preview.rows.length,2);
 assert.equal(preview.network.uniqueEmployees,1);
 assert.equal(preview.network.employeeRestaurantRows,2);
 assert.equal(preview.departments[0].previewGross,153.85);
 assert.equal(preview.departments[1].previewGross,184.62);
 assert.equal(preview.network.previewGross,338.47);
 assert.equal(preview.postingAllowed,false);
});
test('Missing norm or incomplete arrival never becomes an approved payable entry',()=>{
 const result=previewRmsRolePayroll({
  hourRows:[{...hour('farid','r1',300*60),incompleteShifts:1},
    hour('farid','r2',200*60)],
  employees:staff,norms:[norm('r1','WAITER')],
  employeeTerms:[salary('farid',400)],roleTerms:[],month:'2026-10',scope
 });
 assert.equal(result.rows[0].status,'REVIEW_REQUIRED');
 assert.equal(result.rows[1].status,'NORM_NOT_CONFIGURED');
 assert.equal(result.missingNorms,1);
 assert.ok(result.rows.every(x=>x.postingAllowed===false));
});
test('Office role keeps fixed full salary and is not charged again to restaurant RMS',()=>{
 const result=previewRmsRolePayroll({
  hourRows:[hour('office','r1',160*60)],employees:staff,
  norms:[norm('NETWORK_OFFICE','ACCOUNTANT','OFFICE_FIXED',0,0)],
  employeeTerms:[salary('office',400)],roleTerms:[],month:'2026-10',scope
 });
 assert.equal(result.rows.length,0);
 assert.equal(result.officeRows.length,1);
 assert.equal(result.network.officeGross,400);
 assert.equal(result.network.uniqueEmployees,1);
});
test('Monthly norm endpoint is protected, and UI exposes manual calendar by restaurant and role',()=>{
 assert.equal(hrAccessRule('/api/hr/monthly-role-norms','GET'),'hr.schedules.view');
 assert.equal(hrAccessRule('/api/hr/monthly-role-norms','POST'),'hr.schedules.manage');
 const endpoint=readFileSync(new URL('../functions/api/hr/monthly-role-norms.js',import.meta.url),'utf8');
 const page=readFileSync(new URL('../hr-role-schedules.html',import.meta.url),'utf8');
 const payroll=readFileSync(new URL('../functions/api/hr/payroll.js',import.meta.url),'utf8');
 assert.match(endpoint,/hr_role_monthly_payroll_norms/);
 assert.match(endpoint,/ON CONFLICT\(user_id,month,restaurant_id,role_code\)/);
 assert.match(endpoint,/allowedRestaurants\(scope\)/);
 assert.match(page,/rsPayrollDays/);
 assert.match(page,/rsPayrollHours/);
 assert.match(page,/rsPayrollMonth/);
 assert.match(payroll,/previewRmsRolePayroll\(/);
 assert.match(payroll,/monthlyRolePreview/);
});
