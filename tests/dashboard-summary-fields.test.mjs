import test from "node:test";
import assert from "node:assert/strict";
import { findCostAggregateField } from "../functions/api/iiko/dashboard-summary.js";

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
