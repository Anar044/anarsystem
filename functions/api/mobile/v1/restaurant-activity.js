import { mobileContext, response, errorResponse } from "../_lib/context.js";
import { getVerifiedRevenueComparison } from "../../iiko/_lib/assistant-revenue-comparison.js";
import { privateConnection } from "../../iiko/_lib/user-state.js";
import { fetchChainGroupTopology } from "../../iiko/chain.js";
import { getShiftsForDateAndStatus } from "../../iiko/cash-shifts.js";

const clean=v=>String(v??"").trim();
const items=v=>Array.isArray(v)?v:[];
const uniq=values=>[...new Set(items(values).map(clean).filter(Boolean))];

export function departmentActivityMetadata(ctx, liveTopology = null) {
  // No trustworthy live topology => unknown counts, NEVER "0".
  const verified=liveTopology?.verified===true;
  const allowed=new Set(ctx.availableIds.map(clean));
  const metadata=new Map(ctx.restaurants.filter(r=>allowed.has(clean(r.id)))
    .map(r=>[clean(r.id),{
      id:clean(r.id),name:clean(r.name),
      groupCount:verified?0:null,cashCount:verified?0:null,
      groupStatus:verified?"VERIFIED":"UNAVAILABLE",
      cashStatus:verified?"VERIFIED":"UNAVAILABLE"
    }]));
  if(!verified)return [...metadata.values()];

  const groupOwners=new Map();
  const groupsByDepartment=new Map(),cashByDepartment=new Map();
  for(const group of items(liveTopology.groups)) {
    const id=clean(group?.id), owner=clean(group?.departmentId);
    if(!id || !metadata.has(owner) || !allowed.has(owner))continue;
    if(groupOwners.has(id) && groupOwners.get(id)!==owner)continue;
    groupOwners.set(id,owner);
    if(!groupsByDepartment.has(owner))groupsByDepartment.set(owner,new Set());
    groupsByDepartment.get(owner).add(id);
  }
  for(const point of items(liveTopology.pointsOfSale)) {
    const id=clean(point?.id), groupId=clean(point?.groupId);
    const owner=groupOwners.get(groupId);
    if(!id||!owner||!metadata.has(owner))continue;
    if(!cashByDepartment.has(owner))cashByDepartment.set(owner,new Set());
    cashByDepartment.get(owner).add(id);
  }
  for(const [id,row] of metadata) {
    row.groupCount=groupsByDepartment.get(id)?.size||0;
    row.cashCount=cashByDepartment.get(id)?.size||0;
  }
  return [...metadata.values()];
}

export function classifyDepartmentActivity(metadata,revenue,shifts={}) {
  const rows=new Map(items(revenue?.success===true?revenue.rows:[])
    .map(x=>[clean(x.departmentId),x]));
  return metadata.map(item=>{
    const row=rows.get(item.id);
    const amount=row?.revenue;
    const positiveSale=typeof amount==="number" && Number.isFinite(amount) && amount>0;
    const config=(item.groupCount??0)>0||(item.cashCount??0)>0;
    const shift=shifts[item.id]||{};
    const recentShifts=Number.isInteger(shift.count)&&shift.count>0;
    return {...item,
      activity:positiveSale?"SALES_CONFIRMED":
        recentShifts?"SHIFTS_CONFIRMED":
        config?"POS_CONFIGURED":"UNVERIFIED",
      recentRevenueAZN:row?row.revenue:null,
      recentSalesVerified:!!row,
      recentPeriodVerified:revenue?.success===true,
      recentShiftCount:shift.count??null,
      recentShiftsVerified:shift.verified===true,
      shiftLookbackDays:shift.lookbackDays??null,
      note:!row && !recentShifts?
        "Отсутствие подтверждённой активности не означает закрытие ресторана.":null
    };
  });
}

function bakuToday(){
  return new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Baku",
    year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}
const dateAt=(iso,offset)=>new Date(Date.parse(iso+"T00:00:00Z")+offset*86400000);

// Never query an unrestricted CHAIN cash-shift feed. Every request carries
// its own departmentId and the existing endpoint verifies the resulting rows.
// Limit optional lookups so Owner login does not exhaust REST API licences.
export async function recentScopedCashShifts(connection,ids,today,options={}) {
  const limit=Math.min(Math.max(Number(options.maxDepartments??8)||8,1),8);
  const chosen=uniq(ids).slice(0,limit);
  const result={};
  const runOne=async id=>{
    const oldOpen=dateAt(today,-89), recent=dateAt(today,-13),end=dateAt(today,0);
    const found=new Set();
    for(const [status,start] of [["OPEN",oldOpen],["CLOSED",recent]]) {
      try{
        const reply=await getShiftsForDateAndStatus(connection,start,status,{
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

export async function onRequestGet({request,env}) {
  try {
    const ctx=await mobileContext(request,env,{connectionRequired:false});
    const today=bakuToday(),from=dateAt(today,-29).toISOString().slice(0,10);
    const emptyTopology={verified:false,groups:[],pointsOfSale:[],
      code:"SH_CONNECTION_MISSING"};
    let topology=emptyTopology,revenue=null;
    let sourceCode="SH_CONNECTION_MISSING";
    let recentShifts={};
    if(ctx.connectionReady) {
      const connection=privateConnection(ctx.state);
      // Both calls are read-only; no mutation to stored iiko/CHAIN state.
      const answers=await Promise.allSettled([
        fetchChainGroupTopology(connection),
        getVerifiedRevenueComparison(connection,{
          mobileStrict:true,
          selectedDepartmentIds:ctx.availableIds,
          allowedDepartmentIds:ctx.availableIds,
          selectedRestaurants:ctx.restaurants
        },from,today)
      ]);
      if(answers[0].status==="fulfilled")topology=answers[0].value;
      if(answers[1].status==="fulfilled")revenue=answers[1].value;
      sourceCode=revenue?.success===true?null:
        clean(revenue?.code)||"SALES_DATA_UNAVAILABLE";

      // Check shifts only where no recent sales and no live group/POS proof.
      const preliminary=classifyDepartmentActivity(
        departmentActivityMetadata(ctx,topology),revenue);
      const unresolved=new Set(preliminary.filter(x=>x.activity==="UNVERIFIED")
        .map(x=>x.id));
      const priority=uniq([...ctx.selectedIds,...ctx.availableIds])
        .filter(id=>unresolved.has(id));
      if(priority.length)recentShifts=await recentScopedCashShifts(
        connection,priority,today,{maxDepartments:8});
    }
    const metadata=departmentActivityMetadata(ctx,topology);
    return response({
      success:true,lookbackDays:30,period:{from,to:today},
      sourceStatus:revenue?.success===true?"VERIFIED":"UNAVAILABLE",
      sourceCode,
      topology:{
        groupsKnown:topology.verified===true,
        cashKnown:topology.verified===true,
        sourceStatus:topology.verified===true?"VERIFIED":"UNAVAILABLE",
        sourceCode:topology.code||null
      },
      shiftChecks:{
        checked:Object.keys(recentShifts).length,
        incomplete:metadata.some(x=>
          recentShifts[x.id]===undefined &&
          classifyDepartmentActivity([x],revenue)[0].activity==="UNVERIFIED"),
        maxPerRequest:8
      },
      departments:classifyDepartmentActivity(metadata,revenue,recentShifts)
    });
  } catch(e) { return errorResponse(e); }
}
