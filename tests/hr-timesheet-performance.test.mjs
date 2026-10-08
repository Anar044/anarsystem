import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateFreeAttendance, indexApprovedLeaves } from '../functions/api/hr/timesheet.js';

test('approved leave is indexed by employee, contour and date, preserving first matching leave',()=>{
  const leaves=[
    {iiko_employee_id:'a',contour:'FACTUAL',date_from:'2026-10-07',date_to:'2026-10-10',status:'APPROVED',leave_id:'first'},
    {iiko_employee_id:'a',contour:'FACTUAL',date_from:'2026-10-08',date_to:'2026-10-11',status:'APPROVED',leave_id:'overlap'},
    {iiko_employee_id:'a',contour:'OFFICIAL',date_from:'2026-10-08',date_to:'2026-10-08',status:'APPROVED',leave_id:'official'},
    {iiko_employee_id:'b',contour:'FACTUAL',date_from:'2026-10-08',date_to:'2026-10-08',status:'APPROVED',leave_id:'other'},
    {iiko_employee_id:'a',contour:'FACTUAL',date_from:'2026-10-09',date_to:'2026-10-09',status:'DRAFT',leave_id:'draft'},
    {iiko_employee_id:'a',contour:'FACTUAL',date_from:'2026-09-01',date_to:'2026-09-30',status:'APPROVED',leave_id:'outside'}
  ];
  const days=indexApprovedLeaves(leaves,'2026-10-01','2026-10-31');
  assert.equal(days.get('a|FACTUAL|2026-10-08')?.leave_id,'first');
  assert.equal(days.get('a|FACTUAL|2026-10-11')?.leave_id,'overlap');
  assert.equal(days.get('a|OFFICIAL|2026-10-08')?.leave_id,'official');
  assert.equal(days.get('b|FACTUAL|2026-10-08')?.leave_id,'other');
  assert.equal(days.has('a|FACTUAL|2026-10-12'),false);
  assert.equal(days.has('a|FACTUAL|2026-09-30'),false);
});

test('day shift before dawn belongs to the previous Baku business date',()=>{
  const employee={id:'1',code:'A',name:'Test',roleName:'Server'};
  const events=[
    {event_id:'1',event_time:'2026-10-08T17:24:00+04:00',device_id:'d'},
    {event_id:'2',event_time:'2026-10-09T04:10:00+04:00',device_id:'d'}
  ];
  const out=aggregateFreeAttendance(events,employee,'Asia/Baku','2026-10-08','2026-10-09',{shift_type:'DAY',daily_norm_minutes:600},null,Date.parse('2026-10-09T06:00:00+04:00'));
  assert.equal(out.days.get('2026-10-08')?.status,'OK');
  assert.equal(out.days.get('2026-10-08')?.workedMinutes,646);
  assert.equal(out.days.has('2026-10-09'),false);
  assert.equal(out.intervals.length,1);
});

test('316 employees can aggregate Face ID data without one Intl object per punch',()=>{
  const original=Intl.DateTimeFormat;let constructed=0;
  const eachEmployee=(n)=>({id:String(n),code:String(n),name:'Employee '+n,roleName:'Cashier'});
  const events=[];
  for(let day=1;day<=8;day++){
    const d=String(day).padStart(2,'0');
    events.push({event_id:d+'-in',event_time:'2026-10-'+d+'T14:13:00+04:00',device_id:'d'});
    events.push({event_id:d+'-out',event_time:'2026-10-'+d+'T16:25:00+04:00',device_id:'d'});
  }
  let aggregateMinutes=0,dayCount=0;
  const started=performance.now();
  try{
    Intl.DateTimeFormat=function(...args){constructed++;return new original(...args)};
    for(let i=0;i<316;i++){
      const r=aggregateFreeAttendance(events,eachEmployee(i),'Asia/Baku','2026-10-01','2026-10-31',{shift_type:'DAY',daily_norm_minutes:600},null,Date.parse('2026-10-09T08:00:00+04:00'));
      assert.equal(r.days.size,8);
      assert.equal(r.issues.length,0);
      for(const d of r.days.values()){assert.equal(d.status,'OK');aggregateMinutes+=d.workedMinutes;dayCount++}
    }
  }finally{
    Intl.DateTimeFormat=original;
  }
  assert.equal(dayCount,316*8);
  assert.equal(aggregateMinutes,316*8*132);
  assert.ok(constructed<20,'Unexpected repeated Intl.DateTimeFormat construction: '+constructed);
  console.log('Attendance CPU regression: '+dayCount+' days, '+(performance.now()-started).toFixed(0)+' ms, Intl objects: '+constructed);
});
