import test from "node:test";
import assert from "node:assert/strict";
import { findCostAggregateField, buildDashboardOlapRequest } from "../functions/api/iiko/dashboard-summary.js";

test("dashboard cost resolver recognizes supported cost-of-goods fields",()=>{
 assert.equal(findCostAggregateField([
  {name:"ProductCostBase.Profit",title:"Gross profit",aggregationAllowed:true},
  {name:"CostOfGoods",title:"Себестоимость товаров",aggregationAllowed:true}
 ]),"CostOfGoods");
});
test("dashboard cost resolver never substitutes profit for missing cost",()=>{
 assert.equal(findCostAggregateField([
  {name:"ProductCostBase.Profit",title:"Product cost profit",aggregationAllowed:true}
 ]),null);
});

test("dashboard grouped OLAP does not request an unnecessary total summary",()=>{
  const request=buildDashboardOlapRequest({
    rowFields:["OpenDate.Typed"],
    aggregateFields:["DishDiscountSumInt","UniqOrderId"],
    filters:{"Department.Id":{filterType:"IncludeValues",values:["RMS1"]}}
  });
  assert.equal(request.reportType,"SALES");
  assert.equal(request.buildSummary,false);
  assert.deepEqual(request.groupByRowFields,["OpenDate.Typed"]);
  assert.deepEqual(request.groupByColFields,[]);
  assert.deepEqual(request.filters["Department.Id"].values,["RMS1"]);
});
