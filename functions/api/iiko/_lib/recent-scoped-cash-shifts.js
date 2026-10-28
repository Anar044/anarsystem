import {getShiftsForDateAndStatus} from "./scoped-cash-shifts.js";
const clean=v=>String(v??"").trim();
const uniq=v=>[...new Set((Array.isArray(v)?v:[]).map(clean).filter(Boolean))];
const dateAt=(iso,offset)=>new Date(Date.parse(iso+"T00:00:00Z")+offset*86400000);

// Never query an unrestricted CHAIN cash-shift feed. Every request carries
// its own departmentId and the existing endpoint verifies the resulting rows.
// Limit optional lookups so Owner login does not exhaust REST API licences.
export async function recentScopedCashShifts(connection,ids,today,options={}) {
  const limit=Math.min(Math.max(Number(options.maxDepartments??8)||8,1),8);
  const chosen=uniq(ids).slice(0,limit);
  const result={};
  const load=options.loadShifts || getShiftsForDateAndStatus;
  const runOne=async id=>{
    const oldOpen=dateAt(today,-89), recent=dateAt(today,-13),end=dateAt(today,0);
    const found=new Set();
    for(const [status,start] of [["OPEN",oldOpen],["CLOSED",recent]]) {
      try{
        const reply=await load(connection,start,status,{
          departmentId:id,toDate:end
        });
        if(!reply?.ok||!Array.isArray(reply.shifts)) {
          result[id]={verified:false,count:found.size||null,lookbackDays:14};
          return;
        }
        for(const shift of reply.shifts) {
          const session=clean(shift?._sessionId);
          if(!session||clean(shift?._scopedDepartmentId)!==id||
              clean(shift?.departmentId)!==id) {
            result[id]={verified:false,count:null,lookbackDays:14};
            return;
          }
          found.add(session);
        }
        // Positive proof is enough; don't make another call just to count
        // every historical shift of an already active restaurant.
        if(found.size) {
          result[id]={verified:true,count:found.size,lookbackDays:14};
          return;
        }
      }catch(_){
        result[id]={verified:false,count:null,lookbackDays:14};
        return;
      }
    }
    result[id]={verified:true,count:0,lookbackDays:14};
  };
  const workers=Math.min(3,chosen.length);
  let index=0;
  await Promise.all(Array.from({length:workers},async()=>{
    while(index<chosen.length){const id=chosen[index++];await runOne(id);}
  }));
  return result;
}

