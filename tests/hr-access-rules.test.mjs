import test from 'node:test';
import assert from 'node:assert/strict';
import { hrAccessRule } from '../functions/api/hr/_middleware.js';

const check=(path,method,action,expected)=>assert.equal(hrAccessRule('/api/hr/'+path,method,action),expected);
test('HR profile and schedule read/write permissions',()=>{
  check('employee-profile','GET','', 'hr.employees.view');
  check('employee-profile','POST','', 'hr.employees.manage');
  check('employee-leaves','GET','', 'hr.timesheet.view');
  check('employee-leaves','POST','', 'hr.timesheet.manage');
  check('employee-schedule','POST','', 'hr.schedules.manage');
});
test('Manager and HR approvals have distinct permission checks',()=>{
  check('timesheet-approval','GET','', 'hr.timesheet.view');
  check('timesheet-approval','POST','MANAGER_APPROVE','hr.timesheet.manager_approve');
  check('timesheet-approval','POST','HR_APPROVE','hr.timesheet.hr_approve');
  check('timesheet-adjustments','POST','SAVE_CORRECTION','hr.timesheet.manage');
  check('timesheet-adjustments','POST','SUBMIT_OVERTIME','hr.timesheet.manager_approve');
  check('timesheet-adjustments','POST','HR_APPROVE_OVERTIME','hr.timesheet.hr_approve');
  check('timesheet-adjustments','POST','HR_REJECT_OVERTIME','hr.timesheet.hr_approve');
  check('timesheet-adjustments','POST','SAVE_OVERTIME_RULE','hr.timesheet.hr_approve');
});
test('Payroll accounting and payments cannot be mutated with viewer rights',()=>{
  check('overtime-settlements','GET','', 'hr.payroll.view');
  check('overtime-settlements','POST','', 'hr.payroll.pay');
  check('payroll-accounting-settings','GET','', 'hr.payroll.view');
  check('payroll-accounting-settings','POST','', 'hr.payroll.calculate');
  check('payroll-tax-settings','GET','', 'hr.payroll.view');
  check('payroll-tax-settings','POST','', 'hr.tax_settings.manage');
});
test('device ingestion remains exempt from session permissions',()=>{
  assert.equal(hrAccessRule('/api/hr/device-ingest','POST',''),null);
});
