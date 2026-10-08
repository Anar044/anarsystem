import { filterEmployeesByScope } from './restaurant-scope.js';

const clean=value=>String(value??'').trim();
const nextDay=date=>{
  const d=new Date(date+'T00:00:00Z');
  if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==date)throw new Error('Некорректная рабочая дата.');
  d.setUTCDate(d.getUTCDate()+1);
  return d.toISOString().slice(0,10);
};
function parsePunch(value,date,next,start){
  const s=clean(value);
  if(!s)return'';
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s))throw new Error('Укажите дату и время пробивки с точностью до минуты.');
  const day=s.slice(0,10),d=new Date(day+'T00:00:00Z'),h=Number(s.slice(11,13)),m=Number(s.slice(14,16));
  if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==day||h>23||m>59)throw new Error('Некорректная дата/время пробивки.');
  if(s<date+'T'+start||s>=next+'T'+start)throw new Error('Отметка вне окна смены: '+date+' '+start+' — '+next+' '+start+'.');
  const t=new Date(s+':00+04:00');
  if(Number.isNaN(t.getTime()))throw new Error('Некорректная отметка.');
  return t.toISOString();
}
export async function calculateManualPunchCorrection(db,{userId,employeeId,workDate,scope,firstText,lastText}){
  const employee=await db.prepare('SELECT iiko_employee_id,role_code,department_code FROM hr_employees WHERE user_id=?1 AND iiko_employee_id=?2 AND is_deleted=0 LIMIT 1').bind(userId,employeeId).first();
  if(!employee)throw new Error('Сотрудник не найден.');
  if(!filterEmployeesByScope([employee],scope).length){const e=new Error('Сотрудник относится к другому ресторану.');e.status=403;throw e;}
  const [role,person]=await Promise.all([
    db.prepare('SELECT shift_type FROM hr_role_attendance_rules WHERE user_id=?1 AND role_code=?2').bind(userId,employee.role_code||'').first(),
    db.prepare('SELECT shift_type_override FROM hr_employee_attendance_rules WHERE user_id=?1 AND iiko_employee_id=?2').bind(userId,employeeId).first()
  ]);
  const shift=clean(person?.shift_type_override||role?.shift_type||'DAY').toUpperCase()==='NIGHT'?'NIGHT':'DAY';
  const start=shift==='NIGHT'?'12:00':'05:00',next=nextDay(workDate);
  const first=parsePunch(firstText,workDate,next,start),last=parsePunch(lastText,workDate,next,start);
  if(!first&&!last)return{firstInOverride:'',lastOutOverride:'',workedMinutesOverride:-1};
  const lower=new Date(workDate+'T'+start+':00+04:00').toISOString();
  const upper=new Date(next+'T'+start+':00+04:00').toISOString();
  const r=await db.prepare('SELECT event_time FROM hr_attendance_events WHERE user_id=?1 AND iiko_employee_id=?2 AND event_time>=?3 AND event_time<?4 ORDER BY event_time').bind(userId,employeeId,lower,upper).all();
  const unique=[];let prev=null;
  for(const event of r.results||[]){
    const ms=new Date(event.event_time).getTime();
    if(!Number.isFinite(ms)||(prev!==null&&ms-prev<10000))continue;
    unique.push(event.event_time);prev=ms;
  }
  const effectiveFirst=first||unique[0]||'';
  const effectiveLast=last||(unique.length>1?unique[unique.length-1]:'');
  if(!effectiveFirst||!effectiveLast)throw new Error('Для неполной явки укажите недостающие дату и время прихода/ухода.');
  const duration=new Date(effectiveLast).getTime()-new Date(effectiveFirst).getTime();
  if(!Number.isFinite(duration)||duration<=0||duration>24*3600000)throw new Error('Уход должен быть позже прихода и не более 24 часов после него.');
  return{firstInOverride:first,lastOutOverride:last,workedMinutesOverride:Math.round(duration/60000)};
}
