import test from 'node:test';
import assert from 'node:assert/strict';
import {accessDepartmentDirectory,normalizeWorkspaceMemberScope} from '../functions/api/access/_lib/member-departments.js';

const state={identity:{mode:'CHAIN',departments:[
  {id:'dept-1',name:'RMS 1',code:'1'},
  {id:'dept-2',name:'RMS 2',code:'2'},
  {id:'dept-3',name:'RMS 3',code:'3'},
  {id:'dept-central',name:'Mərkəzi Anbar',code:'5'}
],organizations:[]},connection:{connectionType:'CHAIN'}};
const directory=accessDepartmentDirectory(state);
test('Connected CHAIN department selector comes from saved server structure, not HR employees',()=>{
  assert.equal(directory.length,4);
  assert.deepEqual(directory.map(x=>x.name).sort(),['Mərkəzi Anbar','RMS 1','RMS 2','RMS 3'].sort());
  assert.equal(accessDepartmentDirectory({identity:{departments:state.identity.departments},connection:{}}).length,4);
});
test('Restaurant A manager is scoped to only RMS 1 by ID and code',()=>{
  assert.deepEqual(normalizeWorkspaceMemberScope({mode:'SELECTED',departmentIds:['dept-1'],departmentCodes:['1']},directory),{
    mode:'SELECTED',departmentIds:['dept-1'],departmentCodes:['1'],warehouseIds:[]
  });
});
test('Central HR can receive all chosen departments explicitly or unrestricted ALL',()=>{
  const chosen=normalizeWorkspaceMemberScope({mode:'SELECTED',departmentIds:['dept-1','dept-2','dept-3']},directory);
  assert.deepEqual(chosen.departmentCodes,['1','2','3']);
  assert.deepEqual(normalizeWorkspaceMemberScope({mode:'ALL',departmentIds:['dept-1'],departmentCodes:['5']},directory),{
    mode:'ALL',departmentIds:[],departmentCodes:[],warehouseIds:[]
  });
});
test('No empty SELECTED scope can be saved as accidental unrestricted access',()=>{
  assert.throws(()=>normalizeWorkspaceMemberScope({mode:'SELECTED',departmentIds:[],departmentCodes:[]},directory),e=>e.status===400);
  assert.throws(()=>normalizeWorkspaceMemberScope({mode:'SELECTED',departmentCodes:['not-in-chain']},directory),e=>e.status===403);
});
test('Reject non-CHAIN or injected department IDs and code changes',()=>{
  assert.throws(()=>normalizeWorkspaceMemberScope({mode:'SELECTED',departmentIds:['fake-id']},directory),e=>e.status===403);
  assert.throws(()=>normalizeWorkspaceMemberScope({mode:'SELECTED',departmentIds:['dept-1'],departmentCodes:['7']},directory),e=>e.status===403);
  assert.throws(()=>normalizeWorkspaceMemberScope({mode:'SELECTED',departmentIds:['dept-1']},[]),e=>e.status===403);
});
test('Support legacy member scope that contains only known department codes',()=>{
  assert.deepEqual(normalizeWorkspaceMemberScope({mode:'SELECTED',departmentCodes:['2','3']},directory),{
    mode:'SELECTED',departmentIds:['dept-2','dept-3'],departmentCodes:['2','3'],warehouseIds:[]
  });
});
