import test from "node:test";
import assert from "node:assert/strict";
import {
  departmentActivityMetadata,classifyDepartmentActivity
} from "../functions/api/mobile/v1/restaurant-activity.js";

const ctx={
  availableIds:["r1","r2","r3","r4"],
  restaurants:["r1","r2","r3","r4"].map(id=>({id,name:id})),
  state:{
    identity:{
      groups:[{id:"g1",departmentId:"r2"},{id:"g2",departmentId:"foreign"}],
      pointsOfSale:[{id:"cash1",groupId:"g1"},
        {id:"cash2",departmentId:"r3"},
        {id:"cash3",groupId:"g2"}]
    }
  }
};
test("only belonging to workspace groups/cashes are exposed",()=>{
  const list=departmentActivityMetadata(ctx);
  assert.equal(list.length,4);
  assert.deepEqual(list.find(x=>x.id==="r2"),{
    id:"r2",name:"r2",groupCount:1,cashCount:1
  });
  assert.equal(list.find(x=>x.id==="r3").cashCount,1);
  assert.equal(list.find(x=>x.id==="r1").groupCount,0);
  assert.ok(!list.some(x=>x.id==="foreign"));
});
test("sales prove activity; configured POS proves setup; absence is unverified",()=>{
  const list=classifyDepartmentActivity(departmentActivityMetadata(ctx),{
    success:true,rows:[{departmentId:"r1",revenue:145},
      {departmentId:"r4",revenue:0}]
  });
  assert.equal(list.find(x=>x.id==="r1").activity,"SALES_CONFIRMED");
  assert.equal(list.find(x=>x.id==="r2").activity,"POS_CONFIGURED");
  assert.equal(list.find(x=>x.id==="r3").activity,"POS_CONFIGURED");
  assert.equal(list.find(x=>x.id==="r4").activity,"UNVERIFIED");
  assert.equal(list.find(x=>x.id==="r4").recentSalesVerified,true);
  assert.equal(list.find(x=>x.id==="r2").recentRevenueAZN,null);
});
test("failed OLAP does not imply zero sales, unavailable group data stays unknown",()=>{
  const list=departmentActivityMetadata({
    availableIds:["a"],restaurants:[{id:"a",name:"A"}],state:{}
  });
  assert.equal(list[0].groupCount,null);
  assert.equal(list[0].cashCount,null);
  const item=classifyDepartmentActivity(list,{success:false})[0];
  assert.equal(item.activity,"UNVERIFIED");
  assert.equal(item.recentRevenueAZN,null);
  assert.equal(item.recentPeriodVerified,false);
});
