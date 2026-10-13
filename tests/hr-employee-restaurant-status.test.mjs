import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {employeeRestaurantStatus,employeeDepartmentSummary} from '../functions/api/hr/_lib/employee-restaurant-status.js';

const scope={isChain:true,selectedDepartmentIds:['id-a','id-b'],selectedRestaurants:[
  {id:'id-a',name:'Restaurant A',code:'1'},
  {id:'id-b',name:'Restaurant B',code:'2'}
]};
test('CHAIN resolves restaurant code 1 as a proper restaurant with display name',()=>{
  assert.deepEqual(employeeRestaurantStatus({department_code:'1'},scope),{
    status:'ASSIGNED',departmentCode:'1',restaurantId:'id-a',restaurantName:'Restaurant A',ready:true
  });
});
test('No department is visible but not implicitly assigned to a restaurant',()=>{
  assert.equal(employeeRestaurantStatus({department_code:''},scope).status,'UNASSIGNED');
  assert.equal(employeeRestaurantStatus({department_code:''},scope).ready,false);
});
test('Unknown department cannot silently become a network restaurant',()=>{
  assert.equal(employeeRestaurantStatus({department_code:'3'},scope).status,'UNKNOWN_DEPARTMENT');
});
test('Selected restaurant context never matches a restaurant from another scope',()=>{
  const onlyA={...scope,selectedDepartmentIds:['id-a'],selectedRestaurants:[scope.selectedRestaurants[0]]};
  assert.equal(employeeRestaurantStatus({department_code:'2'},onlyA).status,'UNKNOWN_DEPARTMENT');
  assert.equal(employeeRestaurantStatus({department_code:'1'},onlyA).restaurantName,'Restaurant A');
});
test('Ambiguous directory codes are flagged rather than guessed',()=>{
  const bad={...scope,selectedRestaurants:scope.selectedRestaurants.map(r=>({...r,code:'1'}))};
  assert.equal(employeeRestaurantStatus({department_code:'1'},bad).status,'AMBIGUOUS_DEPARTMENT');
});
test('Summary counts only unambiguously mapped employees',()=>{
  assert.deepEqual(employeeDepartmentSummary([
    {department_code:'1'},{department_code:'2'},{department_code:''},{department_code:'wrong'}
  ],scope),{assigned:2,unassigned:1,unknown:1,ambiguous:0});
});
test('RMS does not reject historic employees lacking department codes',()=>{
  assert.equal(employeeRestaurantStatus({department_code:''},{isChain:false}).ready,true);
});
test('UI and API expose staff readiness only; never delete technical-looking names',()=>{
  const api=readFileSync(new URL('../functions/api/hr/employees.js',import.meta.url),'utf8');
  const ui=readFileSync(new URL('../hr-employees.js',import.meta.url),'utf8');
  assert.match(api,/employeeRestaurantStatus\(r,scope\)/);
  assert.match(api,/departmentSummary:cache.departmentSummary/);
  assert.match(ui,/hrEmployeeScopeFilter/);
  assert.match(ui,/Нужна привязка/);
  assert.doesNotMatch(api,/Пользователь API импорта|TEST HR/);
});
