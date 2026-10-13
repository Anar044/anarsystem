// Read-only payroll allocation basis. A person has one network identity but
// earns working time independently in every RMS where their own marks occur.
// No money is calculated or posted until per-RMS hourly rate/approval rules are set.
const clean=v=>String(v??'').trim();
export function summarizePayrollRmsHours(attendance,scope){
  const selected=new Set((scope?.selectedDepartmentIds||[]).map(clean));
  const departments=(scope?.selectedRestaurants||[]).filter(r=>selected.has(clean(r.id)));
  const summary=departments.map(r=>({
    restaurantId:clean(r.id),restaurantName:clean(r.name)||clean(r.code)||clean(r.id),
    employees:0,completeShifts:0,incompleteShifts:0,overlapShifts:0,recordedMinutes:0,nonOverlappingMinutes:0
  }));
  const byRestaurant=new Map(summary.map(r=>[r.restaurantId,r]));
  const employeeRows=new Map(),shiftGroups=new Map();
  for(const x of attendance||[]){
    const id=clean(x.employeeId),restaurantId=clean(x.restaurantId);
    if(!id||!byRestaurant.has(restaurantId))continue;
    const key=id+'|'+restaurantId;
    if(!employeeRows.has(key))employeeRows.set(key,{
      employeeId:id,employeeName:clean(x.employeeName)||id,restaurantId,
      restaurantName:byRestaurant.get(restaurantId).restaurantName,
      recordedMinutes:0,nonOverlappingMinutes:0,completeShifts:0,incompleteShifts:0,overlapShifts:0
    });
    if(!shiftGroups.has(id))shiftGroups.set(id,[]);
    shiftGroups.get(id).push(x);
  }
  // A forgotten checkout may cause physical overlap when later corrected.
  // Detect collisions and flag both sessions; never allocate overlapping time silently.
  const collisions=new Set();
  const times=x=>[Date.parse(x.firstIn),Date.parse(x.lastOut)];
  for(const shifts of shiftGroups.values()){
    const complete=shifts.filter(x=>x.status==='WORK'&&x.lastOut&&x.workedMinutes>0);
    for(let i=0;i<complete.length;i++)for(let j=i+1;j<complete.length;j++){
      const a=complete[i],b=complete[j];
      if(a.restaurantId===b.restaurantId)continue;
      const [as,ae]=times(a),[bs,be]=times(b);
      if(Number.isFinite(as)&&Number.isFinite(ae)&&Number.isFinite(bs)&&Number.isFinite(be)&&Math.max(as,bs)<Math.min(ae,be)){
        collisions.add(a);collisions.add(b);
      }
    }
  }
  const employeesByRestaurant=new Map(summary.map(r=>[r.restaurantId,new Set()]));
  for(const shifts of shiftGroups.values())for(const x of shifts){
    const id=clean(x.employeeId),restaurantId=clean(x.restaurantId),line=employeeRows.get(id+'|'+restaurantId);
    if(!line)continue;
    employeesByRestaurant.get(restaurantId).add(id);
    const complete=x.status==='WORK'&&x.workedMinutes>0;
    if(complete){
      line.completeShifts++;
      line.recordedMinutes+=Number(x.workedMinutes||0);
      if(collisions.has(x))line.overlapShifts++;
      else line.nonOverlappingMinutes+=Number(x.workedMinutes||0);
    }else line.incompleteShifts++;
  }
  for(const line of employeeRows.values()){
    const total=byRestaurant.get(line.restaurantId);
    for(const field of ['completeShifts','incompleteShifts','overlapShifts','recordedMinutes','nonOverlappingMinutes'])total[field]+=line[field];
  }
  for(const line of summary)line.employees=employeesByRestaurant.get(line.restaurantId).size;
  const employees=[...new Set([...employeeRows.values()].map(x=>x.employeeId))];
  return{
    mode:'READ_ONLY_PER_RMS_HOURS',appliedToPayroll:false,currency:null,
    departments:summary,employeeRows:[...employeeRows.values()]
      .sort((a,b)=>a.restaurantName.localeCompare(b.restaurantName)||a.employeeName.localeCompare(b.employeeName)),
    network:{uniqueEmployees:employees.length,completeShifts:summary.reduce((a,x)=>a+x.completeShifts,0),
      incompleteShifts:summary.reduce((a,x)=>a+x.incompleteShifts,0),overlapShifts:summary.reduce((a,x)=>a+x.overlapShifts,0),
      recordedMinutes:summary.reduce((a,x)=>a+x.recordedMinutes,0),
      nonOverlappingMinutes:summary.reduce((a,x)=>a+x.nonOverlappingMinutes,0)},
    note:'Часы сверены по отдельным RMS; сумма зарплаты не рассчитана. Нужны ставка/оклад и утверждение табеля по каждому ресторану.'
  };
}
