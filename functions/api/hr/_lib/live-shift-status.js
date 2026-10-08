// Azerbaijan uses UTC+04:00 year-round; HR free-shift windows are expressed in Baku local time.
// DAY: 05:00–04:59 next day; NIGHT: 12:00–11:59 next day.
// End is exclusive: at the next day's start the previous shift is already closed.
export function isShiftWindowOpen(workDate,shiftType,nowMs=Date.now()){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(workDate||'')))return false;
  const start=String(shiftType||'DAY').toUpperCase()==='NIGHT'?'12:00':'05:00';
  const date=new Date(workDate+'T00:00:00.000Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==workDate)return false;
  date.setUTCDate(date.getUTCDate()+1);
  const nextDate=date.toISOString().slice(0,10);
  const startsAt=Date.parse(workDate+'T'+start+':00+04:00');
  const endsAt=Date.parse(nextDate+'T'+start+':00+04:00');
  const now=Number(nowMs);
  return Number.isFinite(now)&&now>=startsAt&&now<endsAt;
}

export function singlePunchStatus(workDate,shiftType,nowMs=Date.now()){
  return isShiftWindowOpen(workDate,shiftType,nowMs)?'SHIFT_IN_PROGRESS':'INCOMPLETE';
}
