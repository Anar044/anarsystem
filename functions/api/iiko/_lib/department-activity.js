// Shared CHAIN evidence classification; unknown source counts must remain null.
const clean=v=>String(v??"").trim();
const items=v=>Array.isArray(v)?v:[];
export function departmentActivityMetadata(ctx, liveTopology = null) {
  // No trustworthy live topology => unknown counts, NEVER "0".
  const verified=liveTopology?.verified===true;
  const allowed=new Set(ctx.availableIds.map(clean));
  const metadata=new Map(ctx.restaurants.filter(r=>allowed.has(clean(r.id)))
    .map(r=>[clean(r.id),{
      id:clean(r.id),name:clean(r.name),
      groupCount:verified?0:null,cashCount:verified?0:null,sectionCount:verified?0:null,
      groupStatus:verified?"VERIFIED":"UNAVAILABLE",
      cashStatus:verified?"VERIFIED":"UNAVAILABLE",
      sectionStatus:verified?"VERIFIED":"UNAVAILABLE"
    }]));
  if(!verified)return [...metadata.values()];

  const groupOwners=new Map();
  const groupsByDepartment=new Map(),cashByDepartment=new Map();
  const pointOwners=new Map(),sectionsByDepartment=new Map();
  let groupScopeComplete=true,pointScopeComplete=true;
  for(const group of items(liveTopology.groups)) {
    const id=clean(group?.id), owner=clean(group?.departmentId);
    if(!id||!owner){groupScopeComplete=false;continue;}
    if(!metadata.has(owner) || !allowed.has(owner))continue;
    if(groupOwners.has(id) && groupOwners.get(id)!==owner) {
      groupScopeComplete=false;continue;
    }
    groupOwners.set(id,owner);
    if(!groupsByDepartment.has(owner))groupsByDepartment.set(owner,new Set());
    groupsByDepartment.get(owner).add(id);
  }
  for(const point of items(liveTopology.pointsOfSale)) {
    const id=clean(point?.id), groupId=clean(point?.groupId);
    const groupOwner=groupOwners.get(groupId);
    const directOwner=clean(point?.departmentId);
    if(groupOwner && directOwner && groupOwner!==directOwner) {
      pointScopeComplete=false;continue;
    }
    const owner=groupOwner || (allowed.has(directOwner)?directOwner:"");
    if(!id||!owner||!metadata.has(owner)){
      pointScopeComplete=false;continue;
    }
    pointOwners.set(id,owner);
    if(!cashByDepartment.has(owner))cashByDepartment.set(owner,new Set());
    cashByDepartment.get(owner).add(id);
  }
  let sectionScopeComplete=groupScopeComplete && pointScopeComplete;
  for(const section of items(liveTopology.restaurantSections)){
    const id=clean(section?.id);
    const groupOwner=groupOwners.get(clean(section?.groupId));
    const pointOwner=pointOwners.get(clean(section?.pointOfSaleId));
    const owner=groupOwner||pointOwner;
    if(groupOwner&&pointOwner&&groupOwner!==pointOwner){
      sectionScopeComplete=false;continue;
    }
    if(!id||!owner||!metadata.has(owner)){
      sectionScopeComplete=false;continue;
    }
    if(!sectionsByDepartment.has(owner))sectionsByDepartment.set(owner,new Set());
    sectionsByDepartment.get(owner).add(id);
  }
  for(const [id,row] of metadata) {
    row.groupCount=groupsByDepartment.get(id)?.size ||
      (groupScopeComplete?0:null);
    row.cashCount=cashByDepartment.get(id)?.size ||
      (groupScopeComplete && pointScopeComplete?0:null);
    row.sectionCount=sectionsByDepartment.get(id)?.size ||
      (sectionScopeComplete?0:null);
    row.sectionStatus=sectionScopeComplete?"VERIFIED":"PARTIAL";
    row.groupStatus=groupScopeComplete?"VERIFIED":"PARTIAL";
    row.cashStatus=groupScopeComplete&&pointScopeComplete?"VERIFIED":"PARTIAL";
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

