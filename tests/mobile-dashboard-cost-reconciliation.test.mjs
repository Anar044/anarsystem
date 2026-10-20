import test from "node:test";
import assert from "node:assert/strict";
import {verifiedCostOfGoods,normalizeSummary} from "../functions/api/mobile/v1/summary.js";

test("Cost on dashboard matches report cost when using verified gross profit",()=>{
 assert.equal(verifiedCostOfGoods({
   revenue:352685.96,profit:259176.96,
   revenueField:"DishDiscountSumInt",profitField:"ProductCostBase.Profit"
 }),93509);
});
test("Cost rejects unit price fields and arbitrary profit fields",()=>{
 assert.equal(verifiedCostOfGoods({
   revenue:100,profit:80,revenueField:"Sales",profitField:"Profit"
 }),null);
 assert.equal(verifiedCostOfGoods({
   revenue:100,profit:null,revenueField:"DishDiscountSumInt",
   profitField:"ProductCostBase.Profit"
 }),null);
 assert.equal(verifiedCostOfGoods({
   revenue:10,profit:15,revenueField:"DishDiscountSumInt",
   profitField:"ProductCostBase.Profit"
 }),null);
});

test("verified empty calendar sales produce zeros, not misleading dashes",()=>{
  const fields=[
    {name:"OpenDate.Typed",title:"Дата открытия"},
    {name:"DishDiscountSumInt",title:"Выручка"},
    {name:"UniqOrderId",title:"Чеков"},
    {name:"ProductCostBase.Profit",title:"Валовая прибыль"},
    {name:"DiscountSumInt",title:"Скидки"}
  ];
  const payload={
    success:true,from:"2026-10-19",to:"2026-10-19",mode:"calendar",
    departmentIds:["restaurant-1"], fields,
    revenueField:"DishDiscountSumInt",orderField:"UniqOrderId",
    profitField:"ProductCostBase.Profit",discountField:"DiscountSumInt",
    reports:{
      daily:{success:true,report:[],request:{groupByRowFields:["OpenDate.Typed"]}},
      discountReport:{success:true,report:[]}
    },
    meta:{departmentScopeApplied:true}
  };
  const result=normalizeSummary(payload);
  assert.equal(result.noSalesForPeriod,true);
  assert.equal(result.metrics.revenue,0);
  assert.equal(result.metrics.checks,0);
  assert.equal(result.metrics.grossProfit,0);
  assert.equal(result.metrics.discounts,0);
  assert.equal(result.metrics.costOfGoods,0);
  assert.equal(result.metrics.avgCheck,null);
  assert.equal(result.metrics.surcharges,null);
});
test("invalid or missing SH OLAP rows never masquerade as zero sales",()=>{
  const invalid={
    success:true,fields:[{name:"DishDiscountSumInt"}],
    revenueField:"DishDiscountSumInt",
    reports:{daily:{success:true,report:{notARowset:true}}},
    meta:{departmentScopeApplied:true}
  };
  assert.throws(()=>normalizeSummary(invalid),
    error=>error.code==="DASHBOARD_ROWS_INVALID");
});
