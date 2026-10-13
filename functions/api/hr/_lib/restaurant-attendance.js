const clean=v=>String(v??'').trim();
const prevDay=date=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)};
export function independentRestaurantAttendance(events,devices,employees,scope,rules={},nowMs=Date.now()){
  const selected=new Set((scope?.selectedDepartmentIds||[]).map(clean));
  const restaurants=new Map((scope?.selectedRestaurants||[]).filter(x=>selected.has(clean(x.id))).map(x=>[clean(x.id),x]));
  const deviceRestaurant=new Map((devices||[]).map(x=>[clean(x.device_id??x.id),clean(x.restaurant_id??x.restaurantId)]));
  const byId=new Map((employees||[]).map(x=>[clean(x.id??x.iiko_employee_id),x]));
  const groups=new Map();
  for(const item of events||[]){
    const id=clean(item.iiko_employee_id??item.employeeId),deviceId=clean(item.device_id??item.deviceId);
    const restId=deviceRestaurant.get(deviceId);
    if(!id||!byId.has(id)||!restaurants.has(restId))continue;
    const time=Date.parse(item.event_time??item.eventTime);
    if(!Number.isFinite(time))continue;
    const local=new Date(time+4*60*60000).toISOString();
    const minute=Number(local.slice(11,13))*60+Number(local.slice(14,16));
    const shiftType=rules[id]==='NIGHT'?'NIGHT':'DAY';
    const workDate=minute>=(shiftType==='NIGHT'?720:300)?local.slice(0,10):prevDay(local.slice(0,10));
    const key=id+'|'+restId+'|'+workDate;
    if(!groups.has(key))groups.set(key,{employeeId:id,restaurantId:restId,restaurantName:clean(restaurants.get(restId).name),workDate,shiftType,marks:[]});
    groups.get(key).marks.push({...item,time,deviceId});
  }
  return [...groups.values()].map(g=>{
    const ordered=g.marks.sort((a,b)=>a.time-b.time),unique=[];let last=null;
    for(const mark of ordered){if(last!==null&&mark.time-last<10000)continue;unique.push(mark);last=mark.time}
    const first=unique[0],end=unique[unique.length-1],complete=unique.length>=2;
    const opening=clean(first.event_time??first.eventTime);
    const closing=complete?clean(end.event_time??end.eventTime):'';
    const boundary=new Date(g.workDate+'T00:00:00Z').getTime()+ (g.shiftType==='NIGHT'?36:29)*3600000;
    const status=complete?'WORK':nowMs>=boundary?'INCOMPLETE':'SHIFT_IN_PROGRESS';
    return{employeeId:g.employeeId,employeeName:clean(byId.get(g.employeeId)?.name??byId.get(g.employeeId)?.display_name),restaurantId:g.restaurantId,restaurantName:g.restaurantName,workDate:g.workDate,
      shiftType:g.shiftType,firstIn:opening,lastOut:closing,workedMinutes:complete?Math.max(0,Math.round((end.time-first.time)/60000)):0,
      markCount:unique.length,status,openingDeviceId:first.deviceId,closingDeviceId:complete?end.deviceId:'',
      // Both devices always belong to the same RMS. Marks at other RMS never close this record.
      independent:true};
  }).sort((a,b)=>a.workDate.localeCompare(b.workDate)||a.restaurantName.localeCompare(b.restaurantName)||a.employeeId.localeCompare(b.employeeId));
}
