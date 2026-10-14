import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMobileAlerts } from "../functions/api/mobile/v1/alerts.js";
const data={success:true,timestamp:"2026-10-14T23:59:59",
  rows:[
    {productId:"a",productName:"Milk",storeId:"s",storeName:"Main",amount:-1,unit:"kg"},
    {productId:"b",productName:"Rice",storeId:"s",storeName:"Main",amount:2,unit:"kg",belowMin:true,minAmount:5},
    {productId:"c",productName:"Tea",storeId:"s",storeName:"Main",amount:10,unit:"kg"}
  ],meta:{departmentIds:["dept"]}};
test("alerts contain only real scoped negative and below-minimum stock",()=>{
 const result=normalizeMobileAlerts(data,["dept"]);
 assert.equal(result.rows.length,2);
 assert.equal(result.rows[0].severity,"NEGATIVE");
 assert.equal(result.rows[1].severity,"BELOW_MIN");
 assert.equal(result.pushEnabled,false);
});
test("alerts fail closed without source department confirmation",()=>{
 assert.throws(()=>normalizeMobileAlerts({...data,meta:{}},["dept"]),
   /область складских предупреждений/);
});
