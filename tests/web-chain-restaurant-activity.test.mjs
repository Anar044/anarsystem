import test from "node:test";
import assert from "node:assert/strict";
import {
  departmentActivityMetadata,classifyDepartmentActivity
} from "../functions/api/iiko/_lib/department-activity.js";
import {availableActivityRestaurants} from "../functions/api/iiko/restaurant-activity.js";
import {recentScopedCashShifts} from "../functions/api/iiko/_lib/recent-scoped-cash-shifts.js";

const ctx={
  availableIds:["r1","r2","r3","r4"],
  selectedIds:["r2","r1"],
  restaurants:["r1","r2","r3","r4"].map(id=>({id,name:id})),
  state:{identity:{
    // A stale identity snapshot must NOT be used as live evidence.
    groups:[{id:"cached",departmentId:"r4"}],
    pointsOfSale:[{id:"cached-terminal",groupId:"cached"}]
  }}
};
const topology={
  verified:true,
  groups:[
    {id:"g1",departmentId:"r2"},
    {id:"g2",departmentId:"foreign"}
  ],
  pointsOfSale:[
    {id:"cash1",groupId:"g1"},
    {id:"cash2",departmentId:"r3"},
    {id:"outside",groupId:"g2"}
  ]
};
test("missing live CHAIN topology means unknown, never false zero",()=>{
  const list=departmentActivityMetadata(ctx);
  assert.equal(list.length,4);
  assert.equal(list[0].groupCount,null);
  assert.equal(list[0].cashCount,null);
  assert.equal(list.find(x=>x.id==="r4").groupCount,null);
  assert.equal(list[0].groupStatus,"UNAVAILABLE");
});
test("real live CHAIN groups and cash points are scoped and counted",()=>{
  const list=departmentActivityMetadata(ctx,topology);
  assert.equal(list.find(x=>x.id==="r2").groupCount,1);
  assert.equal(list.find(x=>x.id==="r2").cashCount,1);
  assert.equal(list.find(x=>x.id==="r3").cashCount,1);
  assert.equal(list.find(x=>x.id==="r1").groupCount,0);
  assert.equal(list.find(x=>x.id==="r4").groupCount,0);
  assert.ok(!list.some(x=>x.id==="foreign"));
});
test("uncertain group ownership cannot prove zero groups or zero cash",()=>{
  const list=departmentActivityMetadata(ctx,{
    verified:true,groups:[{id:"g1",departmentId:"r2"},{id:"g?",departmentId:null}],
    pointsOfSale:[{id:"cash1",groupId:"g1"},{id:"cash?",groupId:"g?"}]
  });
  assert.equal(list.find(x=>x.id==="r2").groupCount,1);
  assert.equal(list.find(x=>x.id==="r2").cashCount,1);
  assert.equal(list.find(x=>x.id==="r1").groupCount,null);
  assert.equal(list.find(x=>x.id==="r1").cashCount,null);
  assert.equal(list.find(x=>x.id==="r1").groupStatus,"PARTIAL");
});
test("sales and verified cash shifts prove activity independently",()=>{
  const list=classifyDepartmentActivity(departmentActivityMetadata(ctx,topology),{
    success:true,rows:[{departmentId:"r1",revenue:145},
      {departmentId:"r4",revenue:0}]
  },{r4:{count:2,verified:true,lookbackDays:14}});
  assert.equal(list.find(x=>x.id==="r1").activity,"SALES_CONFIRMED");
  assert.equal(list.find(x=>x.id==="r2").activity,"POS_CONFIGURED");
  assert.equal(list.find(x=>x.id==="r3").activity,"POS_CONFIGURED");
  assert.equal(list.find(x=>x.id==="r4").activity,"SHIFTS_CONFIRMED");
  assert.equal(list.find(x=>x.id==="r4").recentShiftCount,2);
  assert.equal(list.find(x=>x.id==="r2").recentRevenueAZN,null);
});
test("failed OLAP and unknown topology cannot imply inactive business",()=>{
  const list=classifyDepartmentActivity(departmentActivityMetadata(ctx),
    {success:false}, {});
  for(const x of list){
    assert.equal(x.activity,"UNVERIFIED");
    assert.equal(x.recentRevenueAZN,null);
    assert.equal(x.groupCount,null);
    assert.equal(x.cashCount,null);
    assert.equal(x.recentShiftCount,null);
  }
});

test("web CHAIN activity respects filtered identity even if connection stores all 22",()=>{
  const filtered={
    identity:{departments:[{id:"r1",name:"One"},{id:"r2",name:"Two"}]},
    connection:{departments:[{id:"r1",name:"One"},{id:"r3",name:"Forbidden"}]}
  };
  assert.deepEqual(availableActivityRestaurants(filtered).map(x=>x.id),["r1","r2"]);
  assert.deepEqual(availableActivityRestaurants({
    identity:{departments:[]},
    connection:{departments:[{id:"r3",name:"Forbidden"}]}
  }),[]);
});

test("cash shift probes always require per-department, range and scope validation",async()=>{
  const calls=[];
  const loadShifts=async(_connection,start,status,options)=>{
    calls.push({status,id:options.departmentId,from:start,to:options.toDate});
    return {ok:true,shifts:status==="OPEN"
      ?[{_sessionId:"s1",_scopedDepartmentId:options.departmentId,
          departmentId:options.departmentId}]:[]};
  };
  const info=await recentScopedCashShifts({},["r2","r1"],"2026-10-22",{
    loadShifts,maxDepartments:8
  });
  assert.equal(calls.length,2); // Once OPEN is verified, no CLOSED request.
  assert.deepEqual(new Set(calls.map(x=>x.id)),new Set(["r1","r2"]));
  assert.ok(calls.every(x=>x.from instanceof Date&&x.to instanceof Date));
  assert.equal(info.r1.count,1);
  assert.equal(info.r2.verified,true);
});
test("unscoped or mismatched shifts are excluded, not 'confirmed'",async()=>{
  const info=await recentScopedCashShifts({},["r1"],"2026-10-22",{
    loadShifts:async()=>({ok:true,shifts:[
      {_sessionId:"foreign",departmentId:"r3",_scopedDepartmentId:"r1"}
    ]})
  });
  assert.equal(info.r1.verified,false);
  assert.equal(info.r1.count,null);
});
test("shift probe failures do not mark departments as closed",async()=>{
  const info=await recentScopedCashShifts({},["r1","r2"],"2026-10-22",{
    loadShifts:async(_,__,status,options)=>options.departmentId==="r2"?
      {ok:false,status:503} : {ok:true,shifts:[]}
  });
  assert.equal(info.r1.verified,true);
  assert.equal(info.r1.count,0);
  assert.equal(info.r2.verified,false);
  assert.equal(info.r2.count,null);
});
