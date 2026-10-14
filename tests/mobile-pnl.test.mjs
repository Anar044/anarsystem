import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMobilePnl } from "../functions/api/mobile/v1/pnl.js";
const valid={success:true,revenue:310,cogs:200,grossProfit:110,
  operatingProfit:70,netProfit:50,
  rows:[{name:"Выручка",value:310,kind:"section"}],
  meta:{departmentScopeApplied:true,transactionDepartmentScopeApplied:true,scopeWarning:null}};
test("P&L returns real financial account metrics when CHAIN verified",()=>{
 const out=normalizeMobilePnl(valid,["dept1"]);
 assert.equal(out.metrics.grossProfit,110);
 assert.equal(out.rows[0].name,"Выручка");
});
test("P&L refuses unverified bookkeeping scope",()=>{
 assert.throws(()=>normalizeMobilePnl({...valid,
    meta:{departmentScopeApplied:true,transactionDepartmentScopeApplied:false}},["dept1"]),/ресторанный фильтр/);
});
