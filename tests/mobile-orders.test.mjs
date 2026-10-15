import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMobileOrders } from "../functions/api/mobile/v1/orders.js";

const valid={success:true,from:"2026-10-13",to:"2026-10-13",
  orders:[{number:"23",date:"2026-10-13",
    departmentId:"A",shiftId:"shift-1",amount:11}],
  meta:{departmentScopeApplied:true,departmentIds:["A"]}};

test("mobile receipts preserve unique restaurant and shift identity",()=>{
  const out=normalizeMobileOrders(valid,["A"]);
  assert.equal(out.orders.length,1);
  assert.equal(out.orders[0].amount,11);
  assert.equal(out.orders[0].departmentId,"A");
  assert.equal(out.orders[0].shiftId,"shift-1");
  assert.equal(out.orders[0].detailsAvailable,true);
});
test("missing restaurant scope blocks all receipt rows",()=>{
  assert.throws(()=>normalizeMobileOrders({...valid,
    meta:{departmentScopeApplied:false,departmentIds:["A"]}},["A"]),
    /ресторанов/);
  assert.throws(()=>normalizeMobileOrders(valid,["B"]),/ресторанов/);
  assert.throws(()=>normalizeMobileOrders({...valid,
    orders:[{number:"23",departmentId:"B"}]},["A"]),
    e=>e.code==="CHECKS_RESTAURANT_MISMATCH");
});
test("no globally unique order or shift ID cannot claim receipt details",()=>{
  const out=normalizeMobileOrders({...valid,orders:[{
    number:"23",date:"2026-10-13",departmentId:"A",amount:11
  }]},["A"]);
  assert.equal(out.orders[0].detailsAvailable,false);
});
