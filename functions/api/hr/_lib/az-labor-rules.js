function clean(v){return String(v??'').trim()}
function int(v,min,max,fallback=0){const n=Number.parseInt(String(v??''),10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback}
function timeMinutes(v){const m=/^([01]\d|2[0-3]):([0-5]\d)$/.exec(clean(v));return m?Number(m[1])*60+Number(m[2]):null}

export function shiftNetMinutes(start,end,breakMinutes=0){
  const a=timeMinutes(start),b=timeMinutes(end);if(a===null||b===null)return null;
  let span=b-a;if(span<=0)span+=1440;
  const pause=int(breakMinutes,0,600,0);const net=span-pause;
  return net>0?net:null;
}

function previousWeekday(day){return day===1?7:day-1}

export function validateWeeklySchedule(dayRules){
  const rules=(Array.isArray(dayRules)?dayRules:[]).map(r=>({
    weekday:int(r.weekday,1,7,0),shiftStart:clean(r.shiftStart),shiftEnd:clean(r.shiftEnd),breakMinutes:int(r.breakMinutes,0,600,0)
  })).filter(r=>r.weekday);
  const unique=new Map();for(const r of rules)unique.set(r.weekday,r);
  const list=[...unique.values()].sort((a,b)=>a.weekday-b.weekday);
  if(!list.length)return{ok:false,message:'Выберите хотя бы один рабочий день.'};
  if(list.length===7)return{ok:false,message:'Недельный график должен содержать хотя бы один еженедельный день отдыха.'};

  let weeklyMinutes=0;const normalized=[];
  for(const r of list){
    const net=shiftNetMinutes(r.shiftStart,r.shiftEnd,r.breakMinutes);
    if(net===null)return{ok:false,message:`Некорректное время смены для дня ${r.weekday}.`};
    normalized.push({...r,netMinutes:net});weeklyMinutes+=net;
  }

  if(list.length===6){
    for(const r of normalized){if(r.netMinutes>420)return{ok:false,message:'Для 40-часовой шестидневной рабочей недели продолжительность рабочего дня не может превышать 7 часов.'};}
    const working=new Set(normalized.map(r=>r.weekday));const offDay=[1,2,3,4,5,6,7].find(d=>!working.has(d));const beforeRest=previousWeekday(offDay);
    const before=normalized.find(r=>r.weekday===beforeRest);
    if(before&&before.netMinutes>360)return{ok:false,message:'В шестидневной рабочей неделе рабочий день непосредственно перед еженедельным выходным не может превышать 6 часов.'};
    if(weeklyMinutes>2400)return{ok:false,message:'Недельная продолжительность нормального рабочего времени не может превышать 40 часов.'};
    return{ok:true,accountingMode:'NORMAL_6_DAY',weeklyMinutes,dayRules:normalized,legalProfile:'AZ_LABOR_CODE'};
  }

  for(const r of normalized){if(r.netMinutes>480)return{ok:false,message:'При нормальном рабочем времени продолжительность рабочего дня не может превышать 8 часов.'};}
  if(weeklyMinutes>2400)return{ok:false,message:'Недельная продолжительность нормального рабочего времени не может превышать 40 часов.'};
  return{ok:true,accountingMode:'NORMAL_WEEKLY',weeklyMinutes,dayRules:normalized,legalProfile:'AZ_LABOR_CODE'};
}

export function validateCycleSchedule({shiftStart,shiftEnd,breakMinutes,workDays,offDays,accountingPeriodMonths}){
  const net=shiftNetMinutes(shiftStart,shiftEnd,breakMinutes);if(net===null)return{ok:false,message:'Укажите корректное время смены и перерыва.'};
  if(net>720)return{ok:false,message:'При суммированном учёте продолжительность ежедневной работы (смены) не может превышать 12 часов.'};
  const work=int(workDays,1,14,0),off=int(offDays,1,14,0);if(!work||!off)return{ok:false,message:'Укажите количество рабочих и выходных дней цикла.'};
  const months=int(accountingPeriodMonths,1,12,1);const avgWeekly=net*work/(work+off)*7;
  if(avgWeekly>2400+0.01)return{ok:false,message:'Этот циклический график в среднем превышает 40 часов в неделю. Увеличьте количество выходных, сократите смену или настройте дополнительные дни отдыха в учётном периоде.'};
  return{ok:true,accountingMode:'SUMMARIZED',accountingPeriodMonths:months,shiftNetMinutes:net,averageWeeklyMinutes:Math.round(avgWeekly),legalProfile:'AZ_LABOR_CODE'};
}

export const AZ_LABOR_RULES={
  jurisdiction:'AZ',
  normalDailyMaxMinutes:480,
  normalWeeklyMaxMinutes:2400,
  sixDayDailyMaxMinutes:420,
  sixDayBeforeRestMaxMinutes:360,
  summarizedShiftMaxMinutes:720,
  summarizedAccountingPeriodMaxMonths:12,
  nightStart:'22:00',
  nightEnd:'06:00',
  legalProfile:'AZ_LABOR_CODE'
};
