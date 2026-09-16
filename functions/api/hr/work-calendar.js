import { getUser } from '../iiko/_lib/user-state.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function pad(n){return String(n).padStart(2,'0')}
function isoDate(y,m,d){return `${y}-${pad(m)}-${pad(d)}`}

const YEAR=2026;
const MONTHS_RU=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];

const SPECIAL_DAYS={
  '2026-01-01':{type:'HOLIDAY',name:'Новый год'},
  '2026-01-02':{type:'HOLIDAY',name:'Новый год'},
  '2026-01-20':{type:'MOURNING',name:'День всенародной скорби'},
  '2026-03-08':{type:'HOLIDAY',name:'Международный женский день'},
  '2026-03-20':{type:'HOLIDAY',name:'Новруз / Рамазан'},
  '2026-03-21':{type:'HOLIDAY',name:'Новруз / Рамазан'},
  '2026-03-22':{type:'HOLIDAY',name:'Новруз'},
  '2026-03-23':{type:'HOLIDAY',name:'Новруз'},
  '2026-03-24':{type:'HOLIDAY',name:'Новруз'},
  '2026-05-09':{type:'HOLIDAY',name:'День Победы над фашизмом'},
  '2026-05-27':{type:'HOLIDAY',name:'Гурбан байрамы'},
  '2026-05-28':{type:'HOLIDAY',name:'Гурбан байрамы / День независимости'},
  '2026-06-15':{type:'HOLIDAY',name:'День национального спасения'},
  '2026-06-26':{type:'HOLIDAY',name:'День Вооружённых сил'},
  '2026-11-08':{type:'HOLIDAY',name:'День Победы'},
  '2026-11-09':{type:'HOLIDAY',name:'День Государственного флага'},
  '2026-12-31':{type:'HOLIDAY',name:'День солидарности азербайджанцев мира'},
  '2026-03-09':{type:'TRANSFERRED_REST',name:'Перенесённый выходной'},
  '2026-03-25':{type:'TRANSFERRED_REST',name:'Перенесённый выходной'},
  '2026-03-26':{type:'TRANSFERRED_REST',name:'Перенесённый выходной'},
  '2026-03-27':{type:'TRANSFERRED_REST',name:'Перенесённый выходной'},
  '2026-03-30':{type:'TRANSFERRED_REST',name:'Перенесённый выходной'},
  '2026-05-11':{type:'TRANSFERRED_REST',name:'Перенесённый выходной'},
  '2026-05-29':{type:'TRANSFERRED_REST',name:'Перенесённый выходной'},
  '2026-11-10':{type:'TRANSFERRED_REST',name:'Перенесённый выходной'}
};

const SHORT_DAYS={
  '2026-01-19':'Перед Днём всенародной скорби',
  '2026-03-19':'Предпраздничный день',
  '2026-05-08':'Предпраздничный день',
  '2026-05-26':'Предпраздничный день',
  '2026-06-25':'Предпраздничный день',
  '2026-12-30':'Предпраздничный день'
};

function buildCalendar(){
  const months=[];const days=[];let yearWorkDays=0,yearHours=0,yearShortDays=0;
  for(let month=1;month<=12;month++){
    const last=new Date(Date.UTC(YEAR,month,0)).getUTCDate();
    let workDays=0,hours=0,shortDays=0,nonWorkingDays=0;
    for(let day=1;day<=last;day++){
      const key=isoDate(YEAR,month,day);const dt=new Date(`${key}T00:00:00Z`);const dow=dt.getUTCDay();const weekend=dow===0||dow===6;const special=SPECIAL_DAYS[key];
      let type='WORKDAY',name='Рабочий день',workHours=8;
      if(special){type=special.type;name=special.name;workHours=0;nonWorkingDays++}
      else if(weekend){type='WEEKEND';name='Выходной';workHours=0;nonWorkingDays++}
      else if(SHORT_DAYS[key]){type='SHORT_WORKDAY';name=SHORT_DAYS[key];workHours=7;workDays++;shortDays++;hours+=7}
      else{workDays++;hours+=8}
      days.push({date:key,month,day,dayOfWeek:dow,type,name,workHours});
    }
    months.push({month,name:MONTHS_RU[month-1],calendarDays:last,workDays,nonWorkingDays,shortDays,hours});
    yearWorkDays+=workDays;yearHours+=hours;yearShortDays+=shortDays;
  }
  return{months,days,summary:{calendarDays:365,workDays:yearWorkDays,nonWorkingDays:365-yearWorkDays,shortDays:yearShortDays,hours:yearHours,weeklyHours:40,normalDailyHours:8,maxSummarizedShiftHours:12,maxAccountingPeriodMonths:12}};
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{
    const auth=await getUser(request,env);if(!auth)return json({success:false,message:'Требуется авторизация'},401);
    const url=new URL(request.url);const year=Number(url.searchParams.get('year')||YEAR);
    if(year!==YEAR)return json({success:false,message:'В Preview пока подключён официальный производственный календарь только на 2026 год.'},400);
    const calendar=buildCalendar();
    return json({
      success:true,
      country:'AZ',year:YEAR,timezone:'Asia/Baku',weekType:'FIVE_DAY_40_HOURS',
      official:true,
      source:{title:'Министерство труда и социальной защиты населения Азербайджанской Республики — производственный календарь 2026',url:'https://sosial.gov.az/az/faydali/istehsalat-teqvimi/2026-ci-ilin-istehsalat-teqvimi',decisionDate:'2025-12-11',decisionNo:'3-17/3-5-31/2025'},
      legalNotes:[
        'Нормальная продолжительность рабочего дня — не более 8 часов.',
        'Нормальная продолжительность рабочей недели — не более 40 часов.',
        'При суммированном учёте учётный период не может превышать один год, а продолжительность смены — 12 часов.',
        'Предпраздничные рабочие дни и рабочий день перед Днём всенародной скорби сокращаются на один час.'
      ],
      ...calendar
    });
  }catch(e){console.error('[HR-WORK-CALENDAR]',e);return json({success:false,message:e?.message||String(e)},500)}
}
