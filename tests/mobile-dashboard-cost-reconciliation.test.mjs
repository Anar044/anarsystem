import test from "node:test";
import assert from "node:assert/strict";
import {verifiedCostOfGoods} from "../functions/api/mobile/v1/summary.js";

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
