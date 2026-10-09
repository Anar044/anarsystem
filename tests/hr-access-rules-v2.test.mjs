import test from 'node:test';
import assert from 'node:assert/strict';
import { hrAccessRule } from '../functions/api/hr/_middleware.js';
import { hrAccessForUser, requireCapability } from '../functions/api/hr/_lib/timesheet-adjustments.js';
import { filterEmployeesByScope, isHrSubsetScope } from '../functions/api/hr/_lib/restaurant-scope.js';
import { PERMISSION_SET, ROLE_TEMPLATES } from '../functions/api/access/_lib/access-control.js';

const rule=(route,method,action='')=>hrAccessRule('/api/hr/'+route,method,action);
const access=permissions=>({allowed:true,isOwner:false,displayName:'Test Employee',permissions});
const member={app_metadata:{hr_role:'OWNER',app_role:'ADMIN'}};

test('all built-in approval rules are registered and assigned to the correct template',()=>{
  for(const perm of ['hr.timesheet.manager_approve','hr.timesheet.hr_approve']) assert.ok(PERMISSION_SET.has(perm));
  const manager=ROLE_TEMPLATES.find(x=>x.code==='RESTAURANT_MANAGER');
  const hr=ROLE_TEMPLATES.find(x=>x.code==='HR_MANAGER');
  const payroll=ROLE_TEMPLATES.find(x=>x.code==='PAYROLL');
  assert.ok(manager.permissions.includes('hr.timesheet.manager_approve'));
  assert.ok(!manager.permissions.includes('hr.timesheet.hr_approve'));
  assert.ok(hr.permissions.includes('hr.timesheet.hr_approve'));
  assert.ok(!hr.permissions.includes('hr.timesheet.manager_approve'));
  assert.ok(!payroll.permissions.includes('hr.timesheet.hr_approve'));
  assert.ok(!payroll.permissions.includes('hr.timesheet.manager_approve'));
});
test('client-provided legacy owner/admin role metadata must not grant approval rights',()=>{
  const denied=hrAccessForUser(member,access(['hr.timesheet.view']));
  assert.equal(denied.canManagerApprove,false);
  assert.equal(denied.canHrApprove,false);
  assert.equal(denied.canCorrect,false);
  assert.equal(hrAccessForUser(member).canManagerApprove,false);
  assert.throws(()=>requireCapability(member,'canHrApprove',access(['hr.timesheet.view'])),e=>e.status===403);
});
test('Manager, HR and Payroll capabilities are distinct',()=>{
  const manager=hrAccessForUser(member,access(['hr.timesheet.view','hr.timesheet.manage','hr.timesheet.manager_approve']));
  const hr=hrAccessForUser(member,access(['hr.timesheet.view','hr.timesheet.manage','hr.timesheet.hr_approve']));
  const payroll=hrAccessForUser(member,access(['hr.payroll.view','hr.payroll.calculate']));
  assert.equal(manager.canManagerApprove,true);
  assert.equal(manager.canHrApprove,false);
  assert.equal(hr.canManagerApprove,false);
  assert.equal(hr.canHrApprove,true);
  assert.equal(payroll.canManagerApprove,false);
  assert.equal(payroll.canHrApprove,false);
});
test('POST manager and HR actions have separate server requirements',()=>{
  assert.equal(rule('timesheet','GET'),'hr.timesheet.view');
  assert.equal(rule('timesheet-adjustments','GET'),'hr.timesheet.view');
  assert.equal(rule('timesheet-approval','GET'),'hr.timesheet.view');
  assert.equal(rule('timesheet-approval','POST','MANAGER_APPROVE'),'hr.timesheet.manager_approve');
  assert.equal(rule('timesheet-approval','POST','HR_APPROVE'),'hr.timesheet.hr_approve');
  assert.equal(rule('timesheet-approval','POST','REOPEN'),'hr.timesheet.manage');
  assert.equal(rule('timesheet-adjustments','POST','SUBMIT_OVERTIME'),'hr.timesheet.manager_approve');
  assert.equal(rule('timesheet-adjustments','POST','HR_APPROVE_OVERTIME'),'hr.timesheet.hr_approve');
  assert.equal(rule('timesheet-adjustments','POST','HR_REJECT_OVERTIME'),'hr.timesheet.hr_approve');
  assert.equal(rule('timesheet-adjustments','POST','SAVE_OVERTIME_RULE'),'hr.timesheet.hr_approve');
  assert.equal(rule('timesheet-adjustments','POST','SAVE_CORRECTION'),'hr.timesheet.manage');
  assert.equal(rule('employee-profile','POST'),'hr.employees.manage');
  assert.equal(rule('employee-profile','GET'),'hr.employees.view');
  assert.equal(rule('overtime-settlements','POST'),'hr.payroll.pay');
  assert.equal(rule('payroll-accounting-settings','POST'),'hr.payroll.calculate');
  assert.equal(rule('payroll-tax-settings','GET'),'hr.payroll.view');
  assert.equal(rule('device-ingest','POST'),null);
});
test('selected workspace restaurants filter employees even without a CHAIN owner scope',()=>{
  const rows=[{iiko_employee_id:'e1',department_code:'A'},{iiko_employee_id:'e2',department_code:'B'},{iiko_employee_id:'e3',department_code:'C'}];
  const limited={isChain:false,membershipRestricted:true,selectedDepartmentCodes:['A','C'],selectedDepartmentIds:[]};
  assert.equal(isHrSubsetScope(limited),false);
  assert.deepEqual(filterEmployeesByScope(rows,limited).map(x=>x.iiko_employee_id),['e1','e3']);
  assert.deepEqual(filterEmployeesByScope(rows,{...limited,selectedDepartmentCodes:[]}),[]);
  assert.equal(filterEmployeesByScope(rows,null).length,3);
});
