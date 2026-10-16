import test from "node:test";
import assert from "node:assert/strict";
import { resolveOlapDishNames } from "../functions/api/iiko/_lib/ai-assistant-tools.js";

test("OLAP dish UUID gets iiko-verified display name without losing the ID",()=>{
 const id="a1234567-0000-4000-8000-aaaaaaaaaaaa";
 const result=resolveOlapDishNames(
  {data:[{"Dish.Id":id,"DishDiscountSumInt":150}]},
  ["Dish.Id"],new Map([[id,"Куриный суп"]]));
 assert.equal(result.resolved,1);
 assert.equal(result.report.data[0]["Dish.Id"],id);
 assert.equal(result.report.data[0]["Dish.Id.DisplayName"],"Куриный суп");
 assert.equal(result.report.data[0].DishDiscountSumInt,150);
});
test("unknown dish IDs are not replaced with invented names",()=>{
 const id="a1234567-0000-4000-8000-bbbbbbbbbbbb";
 const result=resolveOlapDishNames({data:[{"Dish.Id":id}]},
  ["Dish.Id"],new Map());
 assert.equal(result.unresolved,1);
 assert.equal(result.report.data[0]["Dish.Id.DisplayName"],undefined);
});
test("name enrichment never runs on non-dish grouping dimensions",()=>{
 const id="a1234567-0000-4000-8000-aaaaaaaaaaaa";
 const payload={data:[{"CashRegister.Id":id}]};
 const result=resolveOlapDishNames(payload,["CashRegister.Id"],new Map([[id,"Куриный суп"]]));
 assert.deepEqual(result.report,payload);
 assert.equal(result.resolved,0);
});
