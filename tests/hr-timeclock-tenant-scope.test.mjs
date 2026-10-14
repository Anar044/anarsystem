import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isTimeclockScopeRestricted,deviceAllowedForScope,employeeAllowedForScope} from '../functions/api/hr/timeclock.js';

const d=(id,code)=>({id,code,name:code});
const scope=(ids,codes,restricted=true)=>({
  isChain:true,mode:'CHAIN',membershipRestricted:restricted,
  selectedDepartmentIds:ids,allowedDepartmentIds:ids,
  selectedDepartmentCodes:codes,selectedRestaurants:ids.map((id,i)=>d(id,codes[i])),
});
test('Manager RMS 1 cannot see devices of RMS 2 or unassigned devices',()=>{
  const a=scope(['A'],['RMS1']);
  assert.equal(isTimeclockScopeRestricted(a),true);
  assert.equal(deviceAllowedForScope({restaurant_id:'A'},a),true);
  assert.equal(deviceAllowedForScope({restaurant_id:'B'},a),false);
  assert.equal(deviceAllowedForScope({restaurant_id:''},a),false);
  assert.equal(deviceAllowedForScope(null,a),false);
});
test('Central HR with RMS 1/2 sees only those departments, not RMS 3',()=>{
  const access=scope(['A','B'],['RMS1','RMS2']);
  assert.equal(deviceAllowedForScope({restaurant_id:'A'},access),true);
  assert.equal(deviceAllowedForScope({restaurant_id:'B'},access),true);
  assert.equal(deviceAllowedForScope({restaurant_id:'C'},access),false);
  assert.equal(employeeAllowedForScope({department_code:'RMS1'},access,{restaurant_id:'A'}),true);
  assert.equal(employeeAllowedForScope({department_code:'RMS2'},access,{restaurant_id:'B'}),true);
  assert.equal(employeeAllowedForScope({department_code:'RMS3'},access,{restaurant_id:'A'}),false);
});
test('Cannot link RMS 2 employee to a Face ID device belonging to RMS 1',()=>{
  const all=scope(['A','B'],['RMS1','RMS2']);
  assert.equal(employeeAllowedForScope({department_code:'RMS2'},all,{restaurant_id:'A'}),false);
  assert.equal(employeeAllowedForScope({department_code:'RMS1'},all,{restaurant_id:'B'}),false);
  assert.equal(employeeAllowedForScope({department_code:'RMS1'},all,{restaurant_id:'A'}),true);
});
test('Missing restaurant mappings deny device access to restricted managers',()=>{
  const a=scope(['A'],['RMS1']);
  assert.equal(employeeAllowedForScope({department_code:''},a,{restaurant_id:'A'}),false);
  assert.equal(employeeAllowedForScope(null,a,{restaurant_id:'A'}),false);
  const rms={isChain:false};
  assert.equal(deviceAllowedForScope({restaurant_id:''},rms),true);
});
test('Server-side HR timeclock honors workspace owner and filters all data collections',()=>{
  const source=readFileSync(new URL('../functions/api/hr/timeclock.js',import.meta.url),'utf8');
  assert.match(source,/loadRequestIikoState\(request,env\)/);
  assert.match(source,/const userId=a\.storageUserId/);
  assert.match(source,/resolveHrRestaurantScope\(request,env,userId,a\.access\)/);
  assert.match(source,/const subset=isTimeclockScopeRestricted\(scope\)/);
  assert.match(source,/selectedDeviceIds\.has\(String\(x\.device_id\)\)\&\&employeeIds\.has/);
  assert.match(source,/selectedDeviceIds\.has\(String\(x\.device_id\)\)\&\&\(!x\.iiko_employee_id/);
  assert.match(source,/employeeAllowedForScope\(memberEmployee,scope,d\)/);
  assert.match(source,/\.filter\(x=>employeeAllowedForScope\(x,scope,d\)\)/);
  assert.doesNotMatch(source,/const userId=a\.user\.id/);
});

test('TEST HR in three RMS can bind to Face ID at each registered restaurant',()=>{
  const three=scope(['A','B','C'],['RMS1','RMS2','RMS3']);
  const staff={iiko_employee_id:'test-hr',department_code:'RMS1',departmentCodes:['RMS1','RMS2','RMS3']};
  for(const restaurantId of ['A','B','C']){
    assert.equal(employeeAllowedForScope(staff,three,{restaurant_id:restaurantId}),true);
  }
  assert.equal(employeeAllowedForScope(staff,three,{restaurant_id:'D'}),false);
});
test('Limited RMS2 HR may bind multi-restaurant staff to RMS2 device only',()=>{
  const limited=scope(['B'],['RMS2']);
  const staff={iiko_employee_id:'test-hr',department_code:'RMS1',departmentCodes:['RMS1','RMS2','RMS3']};
  assert.equal(employeeAllowedForScope(staff,limited,{restaurant_id:'B'}),true);
  assert.equal(employeeAllowedForScope(staff,limited,{restaurant_id:'A'}),false);
  assert.equal(employeeAllowedForScope({department_code:'RMS1',departmentCodes:['RMS1']},limited,{restaurant_id:'B'}),false);
});
test('Face ID code hydrates membership from HR D1 before binding or import',()=>{
  const source=readFileSync(new URL('../functions/api/hr/timeclock.js',import.meta.url),'utf8');
  assert.match(source,/CREATE TABLE IF NOT EXISTS hr_employee_departments/);
  assert.match(source,/loadEmployeeMemberships\(env\.DB,userId\)/);
  assert.match(source,/attachEmployeeMemberships\(bindings\.results\|\|\[\],memberships\)/);
  assert.match(source,/employeeWithinMembershipScope\(e,scope\)/);
});

test('Face ID selector narrows employees to chosen restaurant on the device',()=>{
  const source=readFileSync(new URL('../hr-timeclock.js',import.meta.url),'utf8');
  assert.match(source,/function employeesForDevice\(deviceId\)/);
  assert.match(source,/x\.departmentCodes\|\|\[x\.departmentCode\]/);
  assert.match(source,/\$\('bindingDevice'\)\.onchange=renderEmployeeSelector/);
  const page=readFileSync(new URL('../hr-timeclock.html',import.meta.url),'utf8');
  assert.match(page,/zk-edit-serial-v1/);
});
