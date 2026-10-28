import {getUser,loadPrivateIikoState,privateConnection,hasPrivateConnection} from "./_lib/user-state.js";
import {resolveAccessForUser} from "../access/_lib/access-control.js";
import {stateForAccess} from "./state.js";
import {bindWorkspaceIikoBroker} from "./_lib/iiko-client.js";
import {fetchChainGroupTopology} from "./chain.js";
import {getVerifiedRevenueComparison} from "./_lib/assistant-revenue-comparison.js";
import {departmentActivityMetadata,classifyDepartmentActivity} from "./_lib/department-activity.js";

const clean=value=>String(value??"").trim();
const items=value=>Array.isArray(value)?value:[];
const uniq=values=>[...new Set(items(values).map(clean).filter(Boolean))];
const headers={"Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store"};
const respond=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const todayBaku=()=>new Intl.DateTimeFormat("sv-SE",{
  timeZone:"Asia/Baku",year:"numeric",month:"2-digit",day:"2-digit"
}).format(new Date());
const dayBack=(today,days)=>new Date(Date.parse(today+"T00:00:00Z")-days*86400000)
  .toISOString().slice(0,10);

export function availableActivityRestaurants(state) {
  // The input must already be filtered by stateForAccess, which also handles
  // per-user scope and department codes. Never accept department IDs from URL.
  const id=state?.identity||{},conn=state?.connection||{};
  const records=items(id.departments).length?id.departments:
    items(id.organizations).length?id.organizations:
    items(conn.departments).length?conn.departments:conn.organizations;
  const seen=new Set();
  return items(records).map(x=>({id:clean(x?.id),name:clean(x?.name||x?.code||x?.id)}))
    .filter(x=>x.id && !seen.has(x.id) && seen.add(x.id));
}
export async function onRequestGet({request,env}) {
  try{
    if(!env.DB)return respond({success:false,code:"DB_UNAVAILABLE"},503);
    const auth=await getUser(request,env);
    if(!auth)return respond({success:false,code:"AUTH_REQUIRED"},401);
    const access=await resolveAccessForUser(env.DB,auth.user,{claimInvite:true,request});
    if(!access?.allowed)return respond({success:false,code:"ACCESS_DENIED"},403);
    const storageUserId=access.storageUserId||access.ownerUserId||auth.user.id;
    const stored=await loadPrivateIikoState(env.DB,storageUserId,env);
    if(!stored.found)return respond({success:true,departments:[],sourceStatus:"UNAVAILABLE",
      topology:{sourceStatus:"UNAVAILABLE"},message:"Нет подключения SH Server."});
    const scoped=stateForAccess(stored.state,access);
    const restaurants=availableActivityRestaurants(scoped);
    const ids=uniq(restaurants.map(x=>x.id));
    if(!ids.length)return respond({success:true,departments:[],sourceStatus:"UNAVAILABLE",
      topology:{sourceStatus:"UNAVAILABLE"}});
    const today=todayBaku(),from=dayBack(today,29);
    const ctx={availableIds:ids,restaurants};
    let topology={verified:false,groups:[],pointsOfSale:[],code:"TOPOLOGY_UNAVAILABLE"};
    let revenue=null;
    if(hasPrivateConnection(stored.state)){
      const connection=bindWorkspaceIikoBroker(privateConnection(stored.state),env,access);
      // Group discovery is read-only. Never substitute cached connection
      // settings for proof of present-day activity.
      try{topology=await fetchChainGroupTopology(connection)}catch(_){}
      try{revenue=await getVerifiedRevenueComparison(connection,{
        mobileStrict:true,selectedDepartmentIds:ids,
        allowedDepartmentIds:ids,selectedRestaurants:restaurants
      },from,today)}catch(_){}
    }
    const metadata=departmentActivityMetadata(ctx,topology);
    return respond({
      success:true,lookbackDays:30,period:{from,to:today},
      sourceStatus:revenue?.success===true?"VERIFIED":"UNAVAILABLE",
      sourceCode:revenue?.success===true?null:clean(revenue?.code)||"SALES_DATA_UNAVAILABLE",
      topology:{
        groupsKnown:topology.verified===true&&metadata.every(x=>x.groupCount!==null),
        cashKnown:topology.verified===true&&metadata.every(x=>x.cashCount!==null),
        sourceStatus:topology.verified!==true?"UNAVAILABLE":
          metadata.every(x=>x.groupCount!==null&&x.cashCount!==null)?"VERIFIED":"PARTIAL"
      },
      // Cash-shift proof is not yet provided by this web endpoint. Never
      // infer closed/inactive from a missing shift count or sales row.
      shiftChecks:{checked:0,incomplete:true},
      departments:classifyDepartmentActivity(metadata,revenue)
    });
  }catch(e){
    return respond({success:false,code:"ACTIVITY_CHECK_FAILED",
      message:"Не удалось проверить активность подразделений."},
      Number(e?.status)===403?403:500);
  }
}
