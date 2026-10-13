import {independentRestaurantAttendance} from './restaurant-attendance.js';
import {summarizePayrollRmsHours} from './payroll-rms-hours.js';
import {previewRmsRolePayroll,OFFICE_RESTAURANT_ID} from './monthly-role-payroll.js';

const clean=v=>String(v??'').trim();
const cents=v=>Math.round(Number(v||0)*100)/100;
const byKey=(a,b)=>String(a).localeCompare(String(b));
export function normalizeRmsCorrections(ledger,corrections,employees,restaurants){
  const known=new Set((employees||[]).filter(e=>!Number(e.is_deleted)).map(e=>clean(e.iiko_employee_id??e.id)));
  const restaurantsById=new Map((restaurants||[]).map(r=>[clean(r.id),r]));
  const unique=new Map((ledger||[]).map(x=>[clean(x.employeeId)+'|'+clean(x.restaurantId)+'|'+clean(x.workDate),{...x,manualCorrection:false}]));
  for(const c of corrections||[]){
    const key=clean(c.iiko_employee_id??c.employeeId)+'|'+clean(c.restaurant_id??c.restaurantId)+'|'+clean(c.work_date??c.workDate);
    const id=clean(c.iiko_employee_id??c.employeeId),restaurantId=clean(c.restaurant_id??c.restaurantId);
    if(!known.has(id)||!restaurantsById.has(restaurantId))continue;
    const minutes=Number(c.worked_minutes??c.workedMinutes);
    if(!Number.isInteger(minutes)||minutes<0||minutes>1440)continue;
    const previous=unique.get(key)||{
      employeeId:id,employeeName:clean(employees.find(e=>clean(e.iiko_employee_id??e.id)===id)?.display_name),
      restaurantId,restaurantName:clean(restaurantsById.get(restaurantId).name),
      workDate:clean(c.work_date??c.workDate),shiftType:'DAY',firstIn:'',lastOut:'',
      markCount:0,openingDeviceId:'',closingDeviceId:'',independent:true
    };
    unique.set(key,{...previous,workedMinutes:minutes,status:minutes>0?'WORK':'ABSENT',
      manualCorrection:true,correctionReason:clean(c.reason),correctionUpdatedAt:clean(c.updated_at??c.updatedAt)});
  }
  return [...unique.values()].sort((a,b)=>byKey(a.workDate,b.workDate)||byKey(a.restaurantId,b.restaurantId)||byKey(a.employeeId,b.employeeId));
}
export async function hashRmsDocument(data){
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data)));
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export function buildRmsPayrollDocument({month,scope,devices=[],employees=[],events=[],roleRules=[],employeeRules=[],norms=[],employeeTerms=[],roleTerms=[],corrections=[],nowMs=Date.now()}){
  const restIds=new Set((scope?.selectedDepartmentIds||[]).map(clean));
  const rest=(scope?.selectedRestaurants||[]).filter(x=>restIds.has(clean(x.id)));
  const roleShift=new Map((roleRules||[]).map(r=>[clean(r.role_code),clean(r.shift_type).toUpperCase()]));
  const empShift=new Map((employeeRules||[]).map(r=>[clean(r.iiko_employee_id),clean(r.shift_type_override).toUpperCase()]));
  const shifts=Object.fromEntries((employees||[]).filter(x=>!Number(x.is_deleted)).map(x=>{
    const id=clean(x.iiko_employee_id??x.id),override=empShift.get(id);
    return[id,override==='DAY'||override==='NIGHT'?override:roleShift.get(clean(x.role_code))==='NIGHT'?'NIGHT':'DAY'];
  }));
  const roster=(employees||[]).filter(x=>!Number(x.is_deleted)).map(x=>({
    id:clean(x.iiko_employee_id??x.id),name:clean(x.display_name??x.name)
  }));
  const attendance=independentRestaurantAttendance(events,devices,roster,scope,shifts,nowMs)
    .filter(x=>x.workDate.slice(0,7)===month);
  const normalized=normalizeRmsCorrections(attendance,corrections,employees,rest);
  const hours=summarizePayrollRmsHours(normalized,scope);
  const pay=previewRmsRolePayroll({
    hourRows:hours.employeeRows,employees,norms,employeeTerms,roleTerms,month,scope
  });
  const perRestaurant=rest.map(r=>{
    const lines=pay.rows.filter(x=>x.restaurantId===clean(r.id))
      .sort((a,b)=>byKey(a.employeeId,b.employeeId));
    const days=normalized.filter(x=>x.restaurantId===clean(r.id));
    const issues=lines.filter(x=>x.status!=='PREVIEW_NOT_APPROVED');
    const missingCorrectionReasons=days.filter(x=>x.manualCorrection&&!clean(x.correctionReason));
    const gross=cents(lines.reduce((n,x)=>n+Number(x.totalGross||0),0));
    return{restaurantId:clean(r.id),restaurantCode:clean(r.code),restaurantName:clean(r.name)||clean(r.code),
      month,rows:lines,attendanceDays:days.length,
      completeShifts:days.filter(x=>x.status==='WORK').length,
      correctionCount:days.filter(x=>x.manualCorrection).length,
      issueCount:issues.length+missingCorrectionReasons.length,
      ready:issues.length===0&&missingCorrectionReasons.length===0,
      gross,officialGross:cents(lines.reduce((n,x)=>n+Number(x.officialGross||0),0)),
      additionalGross:cents(lines.reduce((n,x)=>n+Number(x.additionalGross||0),0))};
  });
  return{
    month,restaurants:perRestaurant,attendance:normalized,hours,pay,
    network:{
      uniqueEmployees:new Set([...pay.rows,...pay.officeRows].map(x=>x.employeeId)).size,
      restaurantGross:cents(perRestaurant.reduce((n,x)=>n+x.gross,0)),
      officeGross:cents(pay.officeRows.reduce((n,x)=>n+Number(x.totalGross||0),0)),
      gross:cents(perRestaurant.reduce((n,x)=>n+x.gross,0)+pay.officeRows.reduce((n,x)=>n+Number(x.totalGross||0),0)),
      attention:perRestaurant.reduce((n,x)=>n+x.issueCount,0)
    }
  };
}
export function approvalSourceForRestaurant(doc,restaurantId,events=[],corrections=[],norms=[],employeeTerms=[],roleTerms=[],roleRules=[],employeeRules=[]){
  const restaurant=doc.restaurants.find(x=>x.restaurantId===restaurantId);
  if(!restaurant)throw new Error('Ресторан отсутствует в расчёте');
  const employeeIds=new Set(restaurant.rows.map(x=>x.employeeId));
  const days=doc.attendance.filter(x=>x.restaurantId===restaurantId).map(x=>({
    id:x.employeeId,date:x.workDate,minutes:x.workedMinutes,first:x.firstIn,last:x.lastOut,
    marks:x.markCount,status:x.status,manual:x.manualCorrection,reason:x.correctionReason||''
  })).sort((a,b)=>byKey(a.id,b.id)||byKey(a.date,b.date));
  const deviceIds=new Set((events||[]).filter(x=>x.restaurantId===restaurantId).map(x=>clean(x.device_id)));
  const matchingEvents=(events||[]).filter(x=>x.restaurantId===restaurantId).map(x=>({
    id:clean(x.event_id),employeeId:clean(x.iiko_employee_id),deviceId:clean(x.device_id),time:clean(x.event_time)
  })).sort((a,b)=>byKey(a.id,b.id)||byKey(a.time,b.time));
  return{
    version:2,month:doc.month,restaurantId,days,
    rows:restaurant.rows.map(r=>({employeeId:r.employeeId,minutes:r.acceptedMinutes,norm:r.plannedMinutes,
      roleCode:r.roleCode,gross:r.totalGross||0,officialGross:r.officialGross||0,additionalGross:r.additionalGross||0,status:r.status})),
    events:matchingEvents,
    corrections:(corrections||[]).filter(x=>clean(x.restaurant_id)===restaurantId)
      .map(x=>[x.iiko_employee_id,x.work_date,x.worked_minutes,x.reason,x.updated_at])
      .sort((a,b)=>byKey(a.join('|'),b.join('|'))),
    norms:(norms||[]).filter(x=>clean(x.restaurant_id)===restaurantId)
      .map(x=>[x.role_code,x.norm_days,x.daily_norm_minutes,x.updated_at||'']).sort((a,b)=>byKey(a[0],b[0])),
    employeeTerms:(employeeTerms||[]).filter(x=>employeeIds.has(clean(x.iiko_employee_id)))
      .map(x=>[x.iiko_employee_id,x.effective_from,x.effective_to,x.official_gross,x.additional_amount,x.updated_at||''])
      .sort((a,b)=>byKey(a.join('|'),b.join('|'))),
    roleTerms:(roleTerms||[]).filter(x=>restaurant.rows.some(r=>r.roleCode===x.role_code))
      .map(x=>[x.role_code,x.effective_from,x.effective_to,x.official_gross,x.additional_amount,x.updated_at||''])
      .sort((a,b)=>byKey(a.join('|'),b.join('|'))),
    roleRules:roleRules.filter(x=>restaurant.rows.some(r=>r.roleCode===x.role_code))
      .map(x=>[x.role_code,x.shift_type,x.updated_at||'']).sort((a,b)=>byKey(a[0],b[0])),
    employeeRules:employeeRules.filter(x=>employeeIds.has(clean(x.iiko_employee_id)))
      .map(x=>[x.iiko_employee_id,x.shift_type_override,x.updated_at||'']).sort((a,b)=>byKey(a[0],b[0]))
  };
}
