import test from 'node:test';
import assert from 'node:assert/strict';
import { isShiftWindowOpen, singlePunchStatus } from '../functions/api/hr/_lib/live-shift-status.js';
import { aggregateFreeAttendance } from '../functions/api/hr/timesheet.js';

const at=value=>Date.parse(value);
const emp={id:'emp-1',code:'001',name:'Test Worker',roleName:'Cashier'};
const event=(t,n=1)=>({event_id:'event-'+n,device_id:'device-1',event_time:new Date(t).toISOString()});
const attendance=(times,shift,now,workDate='2026-10-08')=>aggregateFreeAttendance(
  times.map((t,i)=>event(t,i+1)),emp,'Asia/Baku','2026-10-07','2026-10-10',
  {shift_type:shift,daily_norm_minutes:600},null,at(now)
).days.get(workDate);
const result=(times,shift,now)=>aggregateFreeAttendance(
  times.map((t,i)=>event(t,i+1)),emp,'Asia/Baku','2026-10-07','2026-10-10',
  {shift_type:shift,daily_norm_minutes:600},null,at(now)
);

test('day shift remains open from 05:00 to before 05:00 the following day',()=>{
  assert.equal(isShiftWindowOpen('2026-10-08','DAY',at('2026-10-08T04:59:59+04:00')),false);
  assert.equal(isShiftWindowOpen('2026-10-08','DAY',at('2026-10-08T05:00:00+04:00')),true);
  assert.equal(isShiftWindowOpen('2026-10-08','DAY',at('2026-10-09T04:59:59+04:00')),true);
  assert.equal(isShiftWindowOpen('2026-10-08','DAY',at('2026-10-09T05:00:00+04:00')),false);
});
test('night shift remains open until 12:00 following day',()=>{
  assert.equal(isShiftWindowOpen('2026-10-08','NIGHT',at('2026-10-08T11:59:59+04:00')),false);
  assert.equal(isShiftWindowOpen('2026-10-08','NIGHT',at('2026-10-08T12:00:00+04:00')),true);
  assert.equal(isShiftWindowOpen('2026-10-08','NIGHT',at('2026-10-09T11:59:59+04:00')),true);
  assert.equal(isShiftWindowOpen('2026-10-08','NIGHT',at('2026-10-09T12:00:00+04:00')),false);
  assert.equal(singlePunchStatus('2026-10-08','NIGHT',at('2026-10-09T11:59:59+04:00')),'SHIFT_IN_PROGRESS');
  assert.equal(singlePunchStatus('2026-10-08','NIGHT',at('2026-10-09T12:00:00+04:00')),'INCOMPLETE');
});
test('one day punch is yellow during shift, no hours and no premature missing pair',()=>{
  const t='2026-10-08T17:24:00+04:00',now='2026-10-08T18:00:00+04:00';
  const r=result([t],'DAY',now),d=r.days.get('2026-10-08');
  assert.equal(d.status,'SHIFT_IN_PROGRESS');
  assert.equal(d.workedMinutes,0);
  assert.equal(d.issueCount,0);
  assert.equal(d.firstIn,new Date(t).toISOString());
  assert.equal(d.lastOut,'');
  assert.equal(r.issues.filter(x=>x.code==='MISSING_PAIR').length,0);
});
test('single punch changes to red only after day window closes',()=>{
  const r=result(['2026-10-08T17:24:00+04:00'],'DAY','2026-10-09T05:00:00+04:00');
  assert.equal(r.days.get('2026-10-08').status,'INCOMPLETE');
  assert.equal(r.days.get('2026-10-08').workedMinutes,0);
  assert.equal(r.days.get('2026-10-08').issueCount,1);
  assert.equal(r.issues.filter(x=>x.code==='MISSING_PAIR').length,1);
});
test('night single punch after midnight stays yellow until noon',()=>{
  const r=result(['2026-10-09T03:00:00+04:00'],'NIGHT','2026-10-09T11:59:00+04:00');
  assert.equal(r.days.get('2026-10-08').status,'SHIFT_IN_PROGRESS');
  assert.equal(r.issues.filter(x=>x.code==='MISSING_PAIR').length,0);
});
test('two marks are work with first/last and no incomplete error, even before window ends',()=>{
  const r=result(['2026-10-08T14:13:00+04:00','2026-10-08T16:25:00+04:00'],'DAY','2026-10-08T17:00:00+04:00');
  const d=r.days.get('2026-10-08');
  assert.equal(d.status,'OK');
  assert.equal(d.workedMinutes,132);
  assert.equal(d.markCount,2);
  assert.equal(d.issueCount,0);
  assert.equal(r.intervals.length,1);
  assert.equal(r.issues.length,0);
});
test('duplicate punches within 10 seconds do not close the shift',()=>{
  const r=result(['2026-10-08T17:24:00+04:00','2026-10-08T17:24:05+04:00'],'DAY','2026-10-08T18:00:00+04:00');
  assert.equal(r.days.get('2026-10-08').status,'SHIFT_IN_PROGRESS');
  assert.equal(r.days.get('2026-10-08').workedMinutes,0);
  assert.equal(r.issues.filter(x=>x.code==='DUPLICATE_MARK').length,1);
});
test('invalid date is not an active shift',()=>{
  assert.equal(isShiftWindowOpen('2026-02-30','DAY',at('2026-02-28T06:00:00+04:00')),false);
  assert.equal(isShiftWindowOpen('bad','DAY',Date.now()),false);
});
