import test from "node:test";
import assert from "node:assert/strict";
import {
  planRevenueComparison, summarizeVerifiedRevenue
} from "../functions/api/iiko/_lib/assistant-revenue-comparison.js";
import { verifiedRevenuePresentation } from "../functions/api/iiko/_lib/assistant-verified-revenue-presentation.js";
import {
  mobileRevenueComparisonQuestion, mobileInitialToolChoice
} from "../functions/api/ai-assistant.js";
import { assistantToolAuthorized } from "../functions/api/iiko/_lib/ai-assistant-context.js";

const fields=[
  {name:"Department.Id",title:"Подразделение",groupingAllowed:true},
  {name:"OpenDate.Typed",title:"Дата открытия",groupingAllowed:true},
  {name:"DishDiscountSumInt",title:"Сумма со скидкой",aggregationAllowed:true}
];
const scope={mobileStrict:true,selectedDepartmentIds:["r1","r2","r3"],
  allowedDepartmentIds:["r1","r2","r3","r4"],
  selectedRestaurants:[
    {id:"r1",name:"KABINET ZAL"},
    {id:"r2",name:"TERRAS"},
    {id:"r3",name:"ZAL"}
  ]};
const plan=planRevenueComparison(fields,scope,"2026-10-15","2026-10-21");
const olap={data:[
  {"Department.Id":"r1","OpenDate.Typed":"2026-10-15","DishDiscountSumInt":100.5},
  {"Department.Id":"r1","OpenDate.Typed":"2026-10-16","DishDiscountSumInt":200},
  {"Department.Id":"r2","OpenDate.Typed":"2026-10-21","DishDiscountSumInt":50}
]};
test("only approved restaurants and real OLAP sales fields are accepted",()=>{
  assert.equal(plan.success,true);
  assert.deepEqual(plan.ids,["r1","r2","r3"]);
  assert.equal(plan.revenue.name,"DishDiscountSumInt");
  assert.deepEqual(plan.filters["Department.Id"].values,["r1","r2","r3"]);
  assert.equal(plan.filters["OpenDate.Typed"].to,"2026-10-21");
  assert.equal(planRevenueComparison(fields,{
    ...scope,selectedDepartmentIds:["r1","other"]
  },"2026-10-15","2026-10-21").code,"AI_REVENUE_SCOPE_NOT_VERIFIED");
  assert.equal(planRevenueComparison(fields,{...scope,mobileStrict:false},
    "2026-10-15","2026-10-21").success,false);
});
test("numeric revenue comparison shows the right totals and unknown stores",()=>{
  const r=summarizeVerifiedRevenue(olap,plan,fields,scope.selectedRestaurants);
  assert.equal(r.success,true);
  assert.equal(r.totalRevenue,350.5);
  assert.deepEqual(r.rows.map(x=>x.departmentName),["KABINET ZAL","TERRAS"]);
  assert.equal(r.rows[0].revenue,300.5);
  assert.deepEqual(r.restaurantsWithoutRows.map(x=>x.departmentName),["ZAL"]);
  const result=verifiedRevenuePresentation(r,{chartRequested:true});
  assert.equal(result.kind,"report_with_chart");
  assert.equal(result.report.rows[0][1],"300,50");
  assert.equal(result.chart.series[0].data[0].value,300.5);
  assert.match(result.report.notes.join(" "),/не ноль/);
});
test("out-of-scope department or date blocks whole report without leaking",()=>{
  for (const row of [
    {"Department.Id":"other","OpenDate.Typed":"2026-10-15","DishDiscountSumInt":99999},
    {"Department.Id":"r1","OpenDate.Typed":"2026-10-22","DishDiscountSumInt":2},
  ]) {
    const r=summarizeVerifiedRevenue({data:[row]},plan,fields,scope.selectedRestaurants);
    assert.equal(r.success,false);
    assert.equal(r.rows,undefined);
    assert.equal(verifiedRevenuePresentation(r),null);
  }
});
test("missing measure is a source failure rather than a misleading empty table",()=>{
  const r=summarizeVerifiedRevenue({data:[{
    "Department.Id":"r1","OpenDate.Typed":"2026-10-15"
  }]},plan,fields,scope.selectedRestaurants);
  assert.equal(r.code,"AI_REVENUE_AMOUNT_MISSING");
  assert.equal(verifiedRevenuePresentation(r),null);
  assert.equal(summarizeVerifiedRevenue({data:[]},plan,fields).code,"AI_REVENUE_NO_ROWS");
  assert.equal(summarizeVerifiedRevenue({totals:44},plan,fields).success,false);
});
test("server selects verified revenue tool for revenue-by-restaurant requests",()=>{
  for(const q of [
    "Сравни выручку ресторанов за 15–21 октября 2026 года и покажи таблицу и график",
    "Compare restaurant revenue for the week",
    "Restoranların satış gəlirini müqayisə et"
  ]) {
    assert.equal(mobileRevenueComparisonQuestion(q),true,q);
    assert.deepEqual(mobileInitialToolChoice(q,true),
      {type:"function",name:"get_verified_restaurant_revenue"});
  }
  assert.equal(mobileRevenueComparisonQuestion("Привет"),false);
  assert.equal(mobileInitialToolChoice("Привет",true),"auto");
  assert.equal(mobileInitialToolChoice("Сравни выручку ресторанов",false),"auto");
});
test("new revenue comparison tool is blocked without reports.olap permission",()=>{
  assert.equal(assistantToolAuthorized({permissions:[]},
    "get_verified_restaurant_revenue"),false);
});
