import test from "node:test";
import assert from "node:assert/strict";
import { mobileOlapRows } from "../functions/api/mobile/v1/report.js";
const fields=[{name:"DishName",title:"Dish"},{name:"DishDiscountSumInt",title:"Net"}];
test("OLAP fields are normalized and compact",()=>{
 const x=mobileOlapRows({data:[{DishName:"Pizza",DishDiscountSumInt:22.5}]},
 "DishName","DishDiscountSumInt",fields,["A"],"dishes");
 assert.deepEqual(x.rows,[{label:"Pizza",value:22.5}]);
 assert.equal(x.kind,"dishes");
 assert.equal(x.selectedDepartmentIds[0],"A");
});
