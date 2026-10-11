import test from "node:test";
import assert from "node:assert/strict";
import {assessDualAccountingMode,expectedInternalStockMovement,compareChainRmsStockSnapshot} from "../functions/api/_lib/internal-order-stock-contract.js";

test("accounting-only-in-chain=true is always forbidden",()=>{
 const v=assessDualAccountingMode({accountingOnlyInChain:true});
 assert.equal(v.valid,false);assert.equal(v.code,"CHAIN_ONLY_MODE_FORBIDDEN");
});
test("missing or unknown iiko accounting mode cannot unlock shipment",()=>{
 for(const mode of [undefined,null,"false","true",0,1]){
  const v=assessDualAccountingMode({accountingOnlyInChain:mode});
  assert.equal(v.valid,false);
  assert.equal(v.code,"ACCOUNTING_MODE_UNVERIFIED");
 }
 assert.equal(assessDualAccountingMode({accountingOnlyInChain:false}).valid,true);
});
test("ordinary transfer removes stock quantity/value from source and adds it to recipient",()=>{
 const v=expectedInternalStockMovement({quantity:10,unitCost:0.6});
 assert.equal(v.valid,true);
 assert.deepEqual(v.outgoing,{quantityDelta:-10,inventoryValueDelta:-6});
 assert.deepEqual(v.incoming,{quantityDelta:10,inventoryValueDelta:6});
 assert.deepEqual(v.inTransit,{quantity:10,value:6});
 assert.equal(v.marginAdded,0);
});
test("zero cost permitted and fractional quantities round stock value to cents",()=>{
 const free=expectedInternalStockMovement({quantity:3,unitCost:0});
 assert.equal(free.valid,true);assert.equal(free.outgoing.inventoryValueDelta,0);
 const fractional=expectedInternalStockMovement({quantity:1.125,unitCost:1.3});
 assert.equal(fractional.value,1.46);
});
test("invalid quantities and costs are rejected before future transport",()=>{
 for(const quantity of [0,-1,0.0001,NaN,Infinity,"10"]){
  assert.equal(expectedInternalStockMovement({quantity,unitCost:0.6}).valid,false);
 }
 for(const unitCost of [-0.1,NaN,Infinity,"0.6"]){
  assert.equal(expectedInternalStockMovement({quantity:10,unitCost}).valid,false);
 }
});
const opts={sameWarehouse:true,sameProduct:true,sameUnit:true,sameValuationBasis:true,synced:true};
test("Chain and owning RMS are compared per warehouse and product after completed sync",()=>{
 const chain={quantity:90,inventoryValue:54},rms={quantity:90,inventoryValue:54};
 const v=compareChainRmsStockSnapshot(chain,rms,opts);
 assert.equal(v.valid,true);assert.equal(v.reconciled,true);
});
test("after completed sync, quantity or stock value differences are flagged",()=>{
 let v=compareChainRmsStockSnapshot({quantity:90,inventoryValue:54},{quantity:89,inventoryValue:54},opts);
 assert.equal(v.code,"STOCK_DIFFERENCE");assert.equal(v.quantityDifference,1);
 v=compareChainRmsStockSnapshot({quantity:90,inventoryValue:54},{quantity:90,inventoryValue:53.5},opts);
 assert.equal(v.code,"STOCK_DIFFERENCE");assert.equal(v.inventoryValueDifference,0.5);
});
test("never claim reconciliation until scope and sync watermark are confirmed",()=>{
 const same={quantity:90,inventoryValue:54};
 const pending=compareChainRmsStockSnapshot(same,same,{...opts,synced:false});
 assert.equal(pending.valid,false);assert.equal(pending.code,"SYNC_NOT_COMPLETE");
 const wrong=compareChainRmsStockSnapshot(same,same,{...opts,sameWarehouse:false});
 assert.equal(wrong.valid,false);assert.equal(wrong.code,"SCOPE_MISMATCH");
 const missing=compareChainRmsStockSnapshot(same,{quantity:90,inventoryValue:undefined},opts);
 assert.equal(missing.valid,false);assert.equal(missing.code,"BALANCES_MISSING");
});
