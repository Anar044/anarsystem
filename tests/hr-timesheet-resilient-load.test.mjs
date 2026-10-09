import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';

const source=readFileSync(new URL('../hr-timesheet.js',import.meta.url),'utf8');
const start=source.indexOf('  function timesheetParts(');
const end=source.indexOf('  async function api(){',start);
assert.ok(start>=0&&end>start,'resilient loader functions must be present');
const logic=source.slice(start,end);
const statuses=[];
const cryptoDigest=async value=>createHash('sha256').update(String(value)).digest('hex');
const context={URLSearchParams,Date,console,Map,Set,String,Number,Math,JSON,Array,Object,Error,
  pad:n=>String(n).padStart(2,'0'),digestText:cryptoDigest,setStatus:(s)=>statuses.push(s)};
runInNewContext(logic+"\n globalThis.testApi={timesheetParts,hashRows,requestTimesheetPart,aggregateTimesheetSegments,fetchTimesheetResilient};",context);
const {fetchTimesheetResilient,hashRows,timesheetParts}=context.testApi;

const month={year:2026,month:10,days:31,from:'2026-10-01',to:'2026-10-31'};
function fixture(from,to,personCount=316){
  const employees=Array.from({length:personCount},(_,i)=>({id:'e'+i,name:'Worker '+i}));
  const dates=[];
  for(let d=1;d<=31;d++){
    const ymd='2026-10-'+String(d).padStart(2,'0');
    if(ymd>=from&&ymd<=to)dates.push(ymd);
  }
  const factualDays=employees.flatMap(e=>dates.map(d=>({
    employeeId:e.id,workDate:d,status:d==='2026-10-09'?'SHIFT_IN_PROGRESS':'WORK',
    workedMinutes:d==='2026-10-09'?0:132,plannedMinutes:600,issueCount:0,
    leaveId:'',scheduleName:'Свободный график · Дневная',scheduleSource:'ROLE',
    firstIn:'2026-10-08T10:00:00Z',lastOut:'2026-10-08T12:12:00Z',roleNormMinutes:600
  })));
  const officialDays=employees.flatMap(e=>dates.map(d=>({
    employeeId:e.id,workDate:d,status:'WORK',plannedMinutes:480,leaveId:'',
    scheduleName:'Производственный календарь',scheduleSource:'CALENDAR',calendarType:'WORKDAY'
  })));
  return{success:true,employees,factualDays,officialDays,devices:[],intervals:[],issues:[],
    restaurantScope:{mode:'ALL',departmentIds:[],departmentCodes:[]},
    summary:{factual:{rows:factualDays.length,workedDays:factualDays.filter(d=>d.workedMinutes>0).length},
             official:{rows:officialDays.length},raw:{intervals:0,issues:0}},
    snapshotHashes:{FACTUAL:'unused-per-segment',OFFICIAL:'unused-per-segment'}
  };
}
function reply(body,status=200,headers={}){
  return new Response(typeof body==='string'?body:JSON.stringify(body),{status,headers});
}
test('31 calendar days are split into 8 non-overlapping requests, including last day',()=>{
  const parts=timesheetParts(month);
  assert.equal(parts.length,8);assert.equal(parts[0].from,'2026-10-01');
  assert.equal(parts[0].to,'2026-10-04');assert.equal(parts.at(-1).from,'2026-10-29');
  assert.equal(parts.at(-1).to,'2026-10-31');
});
test('HTTP 503 recovers a 316-employee whole-month timesheet without changing approval hashes',async()=>{
  let calls=0;
  const fetcher=async url=>{
    calls++;const p=new URL(url,'https://localhost').searchParams;
    const from=p.get('from'),to=p.get('to');
    if(from===month.from&&to===month.to)return reply('<h1>over CPU</h1>',503,{'cf-ray':'test-ray-503'});
    return reply(fixture(from,to));
  };
  const result=await fetchTimesheetResilient(month,'demo-token',fetcher);
  const entire=fixture(month.from,month.to);
  assert.equal(calls,9);
  assert.equal(result.loadStrategy,'SEGMENT_FALLBACK');
  assert.equal(result.loadSegments,8);
  assert.equal(result.factualDays.length,316*31);
  assert.equal(result.officialDays.length,316*31);
  assert.equal(result.summary.factual.rows,316*31);
  assert.equal(result.factualDays[0].workDate,'2026-10-01');
  assert.equal(result.factualDays[30].workDate,'2026-10-31');
  assert.equal(result.factualDays[31].employeeId,'e1');
  assert.equal(result.factualDays[31].workDate,'2026-10-01');
  assert.equal(result.snapshotHashes.FACTUAL,await cryptoDigest(JSON.stringify(hashRows(entire.factualDays,'FACTUAL'))));
  assert.equal(result.snapshotHashes.OFFICIAL,await cryptoDigest(JSON.stringify(hashRows(entire.officialDays,'OFFICIAL'))));
  assert.ok(statuses.some(s=>s.includes('Загружаем табель частями')));
});
test('successful full-month load does not create additional requests',async()=>{
  let calls=0;
  const fetcher=async()=>{calls++;return reply(fixture(month.from,month.to,3))};
  const result=await fetchTimesheetResilient(month,'demo-token',fetcher);
  assert.equal(calls,1);
  assert.equal(result.factualDays.length,93);
  assert.equal(result.loadStrategy,undefined);
});
test('401 unauthorized and 403 forbidden never trigger segmented requests',async()=>{
  for(const status of [401,403]){
    let calls=0;
    const fetcher=async()=>{calls++;return reply({success:false,message:'Denied'},status)};
    await assert.rejects(()=>fetchTimesheetResilient(month,'demo-token',fetcher),e=>e.httpStatus===status);
    assert.equal(calls,1);
  }
});
test('segment 503 preserves date and CF ray information for diagnostics',async()=>{
  let calls=0;
  const fetcher=async(url)=>{
    calls++;const p=new URL(url,'https://localhost').searchParams;
    if(p.get('from')===month.from&&p.get('to')===month.to)return reply('not available',503);
    return reply('busy again',503,{'cf-ray':'ray-partial-42'});
  };
  await assert.rejects(()=>fetchTimesheetResilient(month,'demo-token',fetcher),
    error=>error.message.includes('2026-10-01 — 2026-10-04')&&error.message.includes('ray-partial-42'));
  assert.equal(calls,2);
});
