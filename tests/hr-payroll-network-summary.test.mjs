import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildPayrollDepartmentSummary } from '../functions/api/hr/_lib/payroll-department-summary.js';

const scope={
  isChain:true,selectedDepartmentIds:['dep-a','dep-b'],
  selectedRestaurants:[{id:'dep-a',code:'REST_A',name:'Restaurant A'},{id:'dep-b',code:'REST_B',name:'Restaurant B'}]
};
const accrual=(factual,official,extra)=>({factualBaseGross:factual,officialAccruedGross:official,additionalAccruedGross:factual-official,extraDayPay:extra,totalFactualGross:factual+extra});
const rows=[
  {employeeId:'a1',departmentCode:'REST_A',term:{},status:'READY',accrual:accrual(1000,600,100)},
  {employeeId:'a2',departmentCode:'REST_A',term:{},status:'REVIEW',accrual:accrual(400,300,0)},
  {employeeId:'b1',departmentCode:'REST_B',term:{},status:'READY',accrual:accrual(900,600,75)}
];
test('NETWORK summary reconciles with each restaurant and never duplicates employees',()=>{
  const r=buildPayrollDepartmentSummary(rows,scope,[{id:'dep-a',status:'HR_APPROVED',approved:true},{id:'dep-b',status:'MANAGER_APPROVED',approved:false}]);
  assert.equal(r.mode,'NETWORK');
  assert.equal(r.reconciled,true);
  assert.equal(r.network.employees,3);
  assert.equal(r.network.factualBaseGross,2300);
  assert.equal(r.network.officialGross,1500);
  assert.equal(r.network.extraDayPay,175);
  assert.equal(r.departments[0].totals.employees,2);
  assert.equal(r.departments[1].totals.employees,1);
  assert.equal(r.departments[0].totals.factualBaseGross+r.departments[1].totals.factualBaseGross,r.network.factualBaseGross);
  assert.equal(r.allApproved,false);
  assert.equal(r.departments[0].approved,true);
  assert.equal(r.departments[1].approved,false);
});
test('Unmapped staff never silently attributed to another restaurant',()=>{
  const r=buildPayrollDepartmentSummary([...rows,{employeeId:'x',departmentCode:'',term:{},status:'READY',accrual:accrual(300,200,0)}],scope);
  assert.equal(r.network.employees,4);
  assert.equal(r.departments.reduce((a,d)=>a+d.totals.employees,0),3);
  assert.equal(r.unattributed.employees,1);
  assert.equal(r.unattributed.factualBaseGross,300);
  assert.equal(r.reconciled,false);
});
test('Restaurant-only scope exposes its own subtotal but not outside CHAIN restaurants',()=>{
  const selected={...scope,selectedDepartmentIds:['dep-a'],selectedRestaurants:[scope.selectedRestaurants[0]]};
  const result=buildPayrollDepartmentSummary(rows.slice(0,2),selected);
  assert.equal(result.mode,'RESTAURANT');
  assert.equal(result.network.employees,2);
  assert.equal(result.departments.length,1);
  assert.equal(result.departments[0].totals.factualBaseGross,1400);
});
test('Non-CHAIN RMS returns no CHAIN breakdown',()=>{
  assert.equal(buildPayrollDepartmentSummary(rows,{isChain:false}),null);
});
test('CHAIN network view protects postings and separates restaurant subtotals',()=>{
  const file=(name)=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
  const api=file('functions/api/hr/payroll.js'),ui=file('hr-payroll.js');
  assert.match(api,/postingAllowed:!aggregateView&&payrollTimesheetApproved/);
  assert.match(api,/departmentPayroll/);
  assert.match(ui,/payrollView==='NETWORK_SUMMARY'/);
  assert.match(ui,/renderDepartmentPayroll/);
  assert.match(ui,/hrpDepartmentFilter/);
});
