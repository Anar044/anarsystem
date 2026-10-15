import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMobilePnl } from "../functions/api/mobile/v1/pnl.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const src=new URL("../functions/api/",import.meta.url);
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

test("mobile all-CHAIN P&L demands explicit filtered TRANSACTIONS",()=>{
 const mobile=readFileSync(new URL("mobile/v1/pnl.js",src),"utf8");
 const source=readFileSync(new URL("iiko/pnl.js",src),"utf8");
 assert.ok(mobile.includes("requireVerifiedDepartmentScope:true"));
 assert.ok(source.includes("strictDepartmentScope=b?.requireVerifiedDepartmentScope===true"));
 assert.ok(source.includes("(subsetRequested||strictDepartmentScope)"));
});
