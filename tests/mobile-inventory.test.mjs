import test from "node:test";
import assert from "node:assert/strict";
import { normalizeInventory } from "../functions/api/mobile/v1/inventory.js";

const data={
  success:true, timestamp:"2026-10-13T23:59:59",
  rows:[
    {storeId:"store-1",productId:"tomato",productName:"Tomato",amount:3,sum:18,unit:"kg"},
    {storeId:"store-1",productId:"potato",productName:"Potato",amount:-2,sum:-10,unit:"kg"}
  ],
  warehouses:[{id:"store-1",name:"Main"}],
  summary:{totalValue:8,positions:2,negativeCount:1,belowMinCount:0},
  meta:{departmentIds:["DEPT-A"]}
};
test("stock report only exposes selected department scope and real inventory",()=>{
  const out=normalizeInventory(data,["dept-a"],{pageSize:1,offset:0});
  assert.equal(out.rows.length,1);
  assert.equal(out.nextOffset,1);
  assert.equal(out.summary.value,8);
  assert.equal(out.rows[0].productName,"Tomato");
});
test("stock blocks mismatched or missing department scope",()=>{
  assert.throws(()=>normalizeInventory(data,["dept-b"]),/область ресторанов/);
  assert.throws(()=>normalizeInventory({...data,meta:{}},["dept-a"]),/область ресторанов/);
});
