import test from "node:test";
import assert from "node:assert/strict";
import {
  planDishRankingFields, summarizeDishRanking, readDishRankings
} from "../functions/api/iiko/_lib/assistant-dish-rankings.js";
import { compactToolTrace } from "../functions/api/ai-assistant.js";
import { assistantToolAuthorized } from "../functions/api/iiko/_lib/ai-assistant-context.js";

const fields=[
  {name:"Department.Id",groupingAllowed:true},
  {name:"DishName",groupingAllowed:true},
  {name:"DishDiscountSumInt",aggregationAllowed:true},
  {name:"DishAmountInt",aggregationAllowed:true},
  {name:"OpenDate.Typed",groupingAllowed:true}
];
const plan=planDishRankingFields(fields,["r1","r2"]);
test("choose real OLAP dish fields and permitted restaurant list",()=>{
  assert.equal(plan.success,true);
  assert.equal(plan.dish,"DishName");
  assert.equal(plan.sales,"DishDiscountSumInt");
  assert.equal(plan.quantity,"DishAmountInt");
  assert.deepEqual(plan.ids,["r1","r2"]);
});

test("rank first and last by quantity, without mixing two restaurant scopes",()=>{
  const result=summarizeDishRanking({data:[
    {"Department.Id":"r1","DishName":"Burger","DishDiscountSumInt":120,"DishAmountInt":12},
    {"Department.Id":"r2","DishName":"Burger","DishDiscountSumInt":60,"DishAmountInt":6},
    {"Department.Id":"r1","DishName":"Salad","DishDiscountSumInt":80,"DishAmountInt":4},
    {"Department.Id":"r2","DishName":"Dessert","DishDiscountSumInt":25,"DishAmountInt":2}
  ]},plan,{from:"2026-10-01",to:"2026-10-21"});
  assert.equal(result.success,true);
  assert.deepEqual(result.top.map(x=>x.name),["Burger","Salad","Dessert"]);
  assert.equal(result.top[0].revenueAZN,180);
  assert.equal(result.top[0].quantity,18);
  assert.equal(result.bottom[0].name,"Dessert");
  assert.equal(result.dishesAnalyzed,3);
});
test("foreign or missing Department.Id fails closed even with selected departments",()=>{
  for(const id of ["r3",""]){
    const x=summarizeDishRanking({data:[{
      "Department.Id":id,DishName:"Should not leak",
      DishDiscountSumInt:100,DishAmountInt:7
    }]},plan,{from:"2026-10-01",to:"2026-10-21"});
    assert.equal(x.success,false);
    assert.equal(x.code,"AI_DISH_SCOPE_UNVERIFIED");
    assert.equal(x.top,undefined);
  }
});
test("missing required revenue/group/scope fields never yields invented rankings",()=>{
  const missing=planDishRankingFields([{name:"DishName"}],["r1"]);
  assert.equal(missing.success,false);
  assert.equal(missing.code,"AI_DISH_FIELDS_UNAVAILABLE");
  assert.equal(planDishRankingFields(fields,[]).code,"AI_DISH_SCOPE_EMPTY");
});
test("ranking omits quantity when iiko metadata does not expose it",()=>{
  const p=planDishRankingFields(fields.filter(f=>f.name!=="DishAmountInt"),["r1"]);
  const result=summarizeDishRanking({data:[
    {"Department.Id":"r1",DishName:"Soup",DishDiscountSumInt:12}
  ]},p,{from:"2026-10-01",to:"2026-10-21"});
  assert.equal(result.success,true);
  assert.equal(result.rankingMetric,"revenue");
  assert.ok(result.warnings.some(x=>x.includes("количества")));
});
test("source tools do not classify success:false as a successful analysis",()=>{
  const trace=compactToolTrace({name:"get_dish_sales_rankings"},{
    success:false,code:"REST_API_LICENSE_EXHAUSTED",status:403,
    message:"No connections available for module REST_API(2000)"
  });
  assert.equal(trace.ok,false);
  assert.equal(trace.code,"REST_API_LICENSE_EXHAUSTED");
  assert.equal(trace.status,403);
  assert.equal(trace.success,false);
  assert.equal(assistantToolAuthorized({permissions:[]},"get_dish_sales_rankings"),false);
});
test("date parsing and selected department scope are mandatory",async()=>{
  const scope={mobileStrict:true,selectedDepartmentIds:["r1"]};
  assert.equal((await readDishRankings({},scope,"2026-10-30","2026-10-01")).code,
    "AI_DISH_PERIOD_INVALID");
  assert.equal((await readDishRankings({},null,"2026-10-01","2026-10-21")).code,
    "AI_DISH_SCOPE_UNVERIFIED");
});
