import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
const src=readFileSync(new URL('../hr-timesheet.js',import.meta.url),'utf8');
const start=src.indexOf('  async function approvalSnapshot(){');
const end=src.indexOf('  async function approvalApi(',start);
assert.ok(start>0&&end>start);
const code=src.slice(start,end);
function snapshot(employees,rows,department='A'){
  const ctx={
    data:{employees,factualDays:rows,officialDays:[]},
    mode:'FACTUAL',approvalDepartmentId:department,approvalDepartments:[
      {id:'A',code:'A',name:'Restaurant A'},{id:'B',code:'B',name:'Restaurant B'}],
    $:()=>({value:'2026-09'}),
    digestText:async v=>createHash('sha256').update(v).digest('hex'),
    Set,JSON,String,Number,Array,Map
  };
  runInNewContext(code+'; globalThis.resolve=approvalSnapshot',ctx);
  return ctx.resolve();
}
const day=(emp,date,minutes)=>({
  employeeId:emp,workDate:date,status:'WORK',workedMinutes:minutes,plannedMinutes:600,
  firstIn:'2026-09-10T12:00:00.000Z',lastOut:'2026-09-10T13:00:00.000Z',
  markCount:2,issueCount:0,roleNormMinutes:600,
  overtimeStatus:'NONE',approvedOvertimeMinutes:0
});
const empA={id:'eA',departmentCode:'A'};
const empB={id:'eB',departmentCode:'B'};
test('Restaurant A hash is the same for A manager and network-wide HR',async()=>{
  const a=await snapshot([empA],[day('eA','2026-09-10',60)]);
  const network=await snapshot([empA,empB],[day('eA','2026-09-10',60),day('eB','2026-09-10',600)]);
  assert.equal(a,network);
});
test('Changing B attendance cannot invalidate A signature',async()=>{
  const base=await snapshot([empA,empB],[day('eA','2026-09-10',60),day('eB','2026-09-10',600)]);
  const changed=await snapshot([empA,empB],[day('eA','2026-09-10',60),day('eB','2026-09-10',45)]);
  assert.equal(base,changed);
});
test('Changing A attendance changes A approval document hash',async()=>{
  const base=await snapshot([empA],[day('eA','2026-09-10',60)]);
  const changed=await snapshot([empA],[day('eA','2026-09-10',70)]);
  assert.notEqual(base,changed);
});
test('A corrected Face ID punch invalidates previous approval version',async()=>{
  const row=day('eA','2026-09-10',60);
  const base=await snapshot([empA],[row]);
  assert.notEqual(base,await snapshot([empA],[{...row,correction:{updatedAt:'2026-09-11T12:00:00Z'}}]));
});
