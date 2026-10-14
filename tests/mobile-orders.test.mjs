import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMobileOrders } from "../functions/api/mobile/v1/orders.js";
const ok={success:true,available:true,from:"2026-10-13",to:"2026-10-13",
  orders:[{number:"23",date:"2026-10-13",amount:11}],
  meta:{departmentScopeApplied:true,departmentIds:["A"]}};
test("owner receipt list comes only from scoped OLAP",()=>{
 const out=normalizeMobileOrders(ok,["A"]);
 assert.equal(out.orders.length,1);assert.equal(out.orders[0].amount,11);
 assert.equal(out.currency,"AZN");
});
test("missing or mismatched department filter blocks orders",()=>{
 assert.throws(()=>normalizeMobileOrders({...ok,meta:{departmentScopeApplied:false,departmentIds:["A"]}},["A"]),/ресторан/);
 assert.throws(()=>normalizeMobileOrders(ok,["B"]),/ресторан/);
});
test("OLAP without order number returns unavailable, not an invented receipt",()=>{
 assert.throws(()=>normalizeMobileOrders({...ok,available:false},["A"]),/номер заказа/);
});
