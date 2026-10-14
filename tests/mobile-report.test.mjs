import test from "node:test";
import assert from "node:assert/strict";
import { mobileOlapRows } from "../functions/api/mobile/v1/report.js";
const fields=[{name:"DishName",title:"Dish"},{name:"DishDiscountSumInt",title:"Net"}];
test("OLAP fields are normalized and compact",()=>{
 const x=mobileOlapRows({data:[{DishName:"Pizza",DishDiscountSumInt:22.5}]},
 "DishName","DishDiscountSumInt",fields,["A"],"dishes");
 assert.deepEqual(x.rows,[{label:"Pizza",group:"Pizza",value:22.5}]);
 assert.equal(x.kind,"dishes");
 assert.equal(x.selectedDepartmentIds[0],"A");
});

test("cash OLAP groups real dishes under each cashier once",()=>{
 const cols=[{name:"CashRegisterName",title:"Register"},
   {name:"DishName",title:"Dish"},
   {name:"DishDiscountSumInt",title:"Revenue"}];
 const data={data:[
   {CashRegisterName:"Cash1",DishName:"Soup",DishDiscountSumInt:18},
   {CashRegisterName:"Cash1",DishName:"Tea",DishDiscountSumInt:3},
   {CashRegisterName:"Cash2",DishName:"Pizza",DishDiscountSumInt:25}
 ]};
 const x=mobileOlapRows(data,"CashRegisterName","DishDiscountSumInt",
   cols,["dept1"],"cash","DishName");
 assert.equal(x.secondaryField,"DishName");
 assert.deepEqual(x.rows.map(r=>r.group),["Cash1","Cash1","Cash2"]);
 assert.deepEqual(x.rows.map(r=>r.label),["Soup","Tea","Pizza"]);
});
