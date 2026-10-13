import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canStartEmployeeImport,employeeImportScope,targetEmployeeDepartment } from '../functions/api/hr/_lib/employee-sync-scope.js';
import { hrAccessRule } from '../functions/api/hr/_middleware.js';

test('HR member with manage permission can explicitly sync; view-only cannot',()=>{
  const member=p=>({allowed:true,isOwner:false,permissions:p});
  assert.equal(canStartEmployeeImport(member(['hr.employees.view'])),false);
  assert.equal(canStartEmployeeImport(member(['hr.employees.manage'])),true);
  assert.equal(canStartEmployeeImport(member(['*'])),true);
  assert.equal(canStartEmployeeImport({allowed:false,isOwner:true}),false);
  assert.equal(hrAccessRule('/api/hr/employees','GET'),'hr.employees.view');
  assert.equal(hrAccessRule('/api/hr/employees','POST'),'hr.employees.manage');
});

test('limited department imports never overwrite employees assigned to other restaurants',()=>{
  const scope={isChain:true,membershipRestricted:true,selectedDepartmentCodes:['RMS_A'],selectedDepartmentIds:['a'],allowedDepartmentIds:['a','b']};
  const result=employeeImportScope(scope);
  assert.equal(result.limited,true);
  assert.deepEqual(result.allowedCodes,['RMS_A']);
  const emp={preferredDepartmentCode:'RMS_A',departmentCodes:['RMS_A']};
  assert.deepEqual(targetEmployeeDepartment(emp,'RMS_B',result.allowedCodes),{allowed:false,reason:'EXISTING_OUTSIDE_SCOPE'});
  assert.deepEqual(targetEmployeeDepartment(emp,'RMS_A',result.allowedCodes),{allowed:true,departmentCode:'RMS_A'});
  assert.deepEqual(targetEmployeeDepartment(emp,'',result.allowedCodes),{allowed:true,departmentCode:'RMS_A'});
});

test('employee with unclear department is not silently imported into HR',()=>{
  assert.equal(targetEmployeeDepartment({departmentCodes:[],preferredDepartmentCode:''},'',['A']).allowed,false);
  assert.equal(targetEmployeeDepartment({departmentCodes:['A','B'],preferredDepartmentCode:'B'},'', ['A']).departmentCode,'A');
  assert.equal(targetEmployeeDepartment({departmentCodes:['A'],preferredDepartmentCode:''},'',['B']).allowed,false);
});

test('owner selected full CHAIN may run full import; selected subset is restricted',()=>{
  const full={isChain:true,selectedDepartmentIds:['a','b'],allowedDepartmentIds:['a','b'],selectedDepartmentCodes:['A','B']};
  assert.equal(employeeImportScope(full).limited,false);
  assert.equal(employeeImportScope({...full,selectedDepartmentIds:['a']}).limited,true);
  assert.equal(employeeImportScope({...full,membershipRestricted:true}).limited,true);
});

test('GET displays cache only while POST executes explicit server import',()=>{
  const api=readFileSync(new URL('../functions/api/hr/employees.js',import.meta.url),'utf8');
  const get=api.slice(api.indexOf('export async function onRequestGet('),api.indexOf('export async function onRequestPost('));
  const post=api.slice(api.indexOf('export async function onRequestPost('));
  assert.doesNotMatch(get,/syncEmployees\(|iikoText\(/);
  assert.match(post,/canStartEmployeeImport\(state.access\)/);
  assert.match(post,/importScope\.allowedCodes/);
  assert.match(post,/\/resto\/api\/employees\/byDepartment/);
  assert.match(post,/if\(!employees\.length\)throw httpError\(409/);
  assert.match(post,/syncEmployees\(env.DB,userId,employees,roleMap,importScope\)/);
  const ui=readFileSync(new URL('../hr-employees.js',import.meta.url),'utf8');
  assert.match(ui,/method:doImport\?'POST':'GET'/);
  assert.match(ui,/JSON\.stringify\(\{action:'SYNC'\}\)/);
});
