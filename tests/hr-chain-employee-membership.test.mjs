import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {employeeMembershipCodes,mergeEmployeeMembership,visibleEmployeeMembership,employeeWithinMembershipScope} from '../functions/api/hr/_lib/employee-department-membership.js';
import {employeeRestaurantStatus,employeeDepartmentSummary} from '../functions/api/hr/_lib/employee-restaurant-status.js';

const chain={isChain:true,selectedDepartmentIds:['id1','id2','id3'],allowedDepartmentIds:['id1','id2','id3'],selectedRestaurants:[
  {id:'id1',code:'1',name:'RMS 1'},{id:'id2',code:'2',name:'RMS 2'},{id:'id3',code:'3',name:'RMS 3'}]};
test('TEST HR assigned to 3 RMS is one employee with 3 distinct memberships',()=>{
  const codes=employeeMembershipCodes({id:'staff-3',departmentCodes:['1','2','3','1'],preferredDepartmentCode:'1'});
  assert.deepEqual(codes,['1','2','3']);
  const s=employeeRestaurantStatus({id:'staff-3',departmentCode:'1',departmentCodes:codes},chain);
  assert.equal(s.status,'ASSIGNED_MULTIPLE');
  assert.equal(s.restaurants.length,3);
  assert.deepEqual(s.restaurants.map(r=>r.name),['RMS 1','RMS 2','RMS 3']);
  assert.equal(employeeDepartmentSummary([{departmentCode:'1',departmentCodes:codes}],chain).assigned,1);
  assert.equal(employeeDepartmentSummary([{departmentCode:'1',departmentCodes:codes}],chain).multiple,1);
});
test('TEST MENECER and TEST OFISIANT retain their own single assignment',()=>{
  for(const e of [{departmentCodes:['1'],preferredDepartmentCode:'1'},{departmentCodes:['1']}])
    assert.equal(employeeRestaurantStatus({departmentCode:'1',departmentCodes:employeeMembershipCodes(e)},chain).status,'ASSIGNED');
});
test('restricted department manager sees only their restaurant membership',()=>{
  const selected={...chain,membershipRestricted:true,selectedDepartmentIds:['id2'],selectedDepartmentCodes:['2'],selectedRestaurants:[chain.selectedRestaurants[1]]};
  assert.deepEqual(visibleEmployeeMembership(['1','2','3'],selected),['2']);
  assert.equal(employeeWithinMembershipScope({department_code:'1',departmentCodes:['1','2','3']},selected),true);
  assert.equal(employeeWithinMembershipScope({department_code:'1',departmentCodes:['1']},selected),false);
  const s=employeeRestaurantStatus({departmentCode:'2',departmentCodes:visibleEmployeeMembership(['1','2','3'],selected)},selected);
  assert.equal(s.restaurants.length,1);
  assert.equal(s.restaurantName,'RMS 2');
});
test('existing primary department is preserved and missing membership may fall back to primary',()=>{
  assert.deepEqual(mergeEmployeeMembership(['1','2'],'1'),['1','2']);
  assert.deepEqual(mergeEmployeeMembership([], '1'),['1']);
  assert.deepEqual(visibleEmployeeMembership(['1','2'],{isChain:false}),['1','2']);
});
test('department membership is persisted without changing payroll primary department schema',()=>{
  const api=readFileSync(new URL('../functions/api/hr/employees.js',import.meta.url),'utf8');
  assert.match(api,/CREATE TABLE IF NOT EXISTS hr_employee_departments/);
  assert.match(api,/employeeMembershipCodes\(e\)/);
  assert.match(api,/membershipStatements/);
  assert.match(api,/employeeWithinMembershipScope\(r,scope\)/);
  assert.match(api,/visibleEmployeeMembership\(r.departmentCodes,scope\)/);
  assert.match(api,/departmentCodes/);
  assert.match(api,/targetDepartment/);
  const payroll=readFileSync(new URL('../functions/api/hr/payroll.js',import.meta.url),'utf8');
  assert.doesNotMatch(payroll,/hr_employee_departments/);
});
