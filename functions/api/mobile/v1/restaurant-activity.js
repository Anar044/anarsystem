import { mobileContext, response, errorResponse } from "../_lib/context.js";
import { getVerifiedRevenueComparison } from "../../iiko/_lib/assistant-revenue-comparison.js";

const clean=v=>String(v??"").trim();
const values=v=>Array.isArray(v)?v:[];
const unique=items=>[...new Set(items.map(clean).filter(Boolean))];

export function departmentActivityMetadata(ctx) {
  const allowed=new Set(ctx.availableIds.map(clean));
  const state=ctx.state||{},identity=state.identity||{},connection=state.connection||{};
  const groups=values(identity.groups).length?identity.groups:values(connection.groups);
  const points=values(identity.pointsOfSale).length?identity.pointsOfSale:values(connection.pointsOfSale);
  // Empty or absent topology is not proof that a restaurant never had a POS.
  const groupsKnown=Array.isArray(identity.groups)||Array.isArray(connection.groups);
  const posKnown=Array.isArray(identity.pointsOfSale)||Array.isArray(connection.pointsOfSale);
  const counts=new Map(ctx.restaurants.map(r=>[clean(r.id),{
    id:clean(r.id),name:clean(r.name),groupCount:groupsKnown?0:null,
    cashCount:posKnown?0:null
  }]));
  const groupOwners=new Map();
  for(const group of groups){
    const owner=clean(group?.departmentId),groupId=clean(group?.id);
    if(!allowed.has(owner)||!counts.has(owner))continue;
    if(groupId)groupOwners.set(groupId,owner);
    if(groupsKnown)counts.get(owner).groupCount++;
  }
  for(const point of points){
    const owner=clean(point?.departmentId) ||
      groupOwners.get(clean(point?.groupId))||"";
    if(!allowed.has(owner)||!counts.has(owner))continue;
    if(posKnown)counts.get(owner).cashCount++;
  }
  return [...counts.values()];
}

export function classifyDepartmentActivity(metadata,revenue) {
  const rows=new Map((revenue?.success===true?revenue.rows:[])
    .map(x=>[clean(x.departmentId),x]));
  return metadata.map(item=>{
    const row=rows.get(item.id);
    const salesAmount=row?.revenue;
    const hasSales=typeof salesAmount==="number"&&Number.isFinite(salesAmount)
      && salesAmount>0;
    const configured=(item.groupCount||0)>0||(item.cashCount||0)>0;
    return {...item,
      activity:hasSales?"SALES_CONFIRMED":
        configured?"POS_CONFIGURED":"UNVERIFIED",
      recentRevenueAZN:row?row.revenue:null,
      recentSalesVerified:!!row,
      recentPeriodVerified:revenue?.success===true,
      // No OLAP rows is UNKNOWN, not zero revenue or a closed restaurant.
      note:!row?"Нет подтверждённых продаж за период; это не означает закрытие.":null
    };
  });
}

function bakuToday(){
  return new Intl.DateTimeFormat("sv-SE",{timeZone:"Asia/Baku",
    year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
}

export async function onRequestGet({request,env}){
  try {
    const ctx=await mobileContext(request,env,{connectionRequired:false});
    const metadata=departmentActivityMetadata(ctx);
    const to=bakuToday();
    const from=new Date(Date.parse(to+"T00:00:00Z")-29*86400000)
      .toISOString().slice(0,10);
    let revenue=null;
    let sourceStatus="UNAVAILABLE";
    let sourceCode=null;
    if(ctx.connectionReady){
      try{
        // This one read-only OLAP request runs ONLY on authorized departments.
        revenue=await getVerifiedRevenueComparison(
          await (async()=>{
            const { privateConnection }=await import("../../iiko/_lib/private-state.js");
            return privateConnection(ctx.state);
          })(),
          {mobileStrict:true,selectedDepartmentIds:ctx.availableIds,
            allowedDepartmentIds:ctx.availableIds,
            selectedRestaurants:ctx.restaurants},
          from,to
        );
        sourceStatus=revenue?.success===true?"VERIFIED":"UNAVAILABLE";
        if(revenue?.success!==true)sourceCode=clean(revenue?.code)||"SALES_DATA_UNAVAILABLE";
      }catch(e){
        sourceStatus="UNAVAILABLE";
        sourceCode=clean(e?.code)||"SALES_DATA_UNAVAILABLE";
      }
    }else sourceCode="SH_CONNECTION_MISSING";
    const departments=classifyDepartmentActivity(metadata,revenue);
    return response({
      lookbackDays:30,period:{from,to},
      sourceStatus,sourceCode,
      topology:{
        groupsKnown:metadata.some(x=>x.groupCount!==null),
        cashKnown:metadata.some(x=>x.cashCount!==null)
      },
      departments
    });
  }catch(e){return errorResponse(e);}
}
