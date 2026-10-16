import test from "node:test";
import assert from "node:assert/strict";
import { mobileOlapRows, buildMobileReportFilters, findOlapGroupField, findOlapMeasureField, findCashRegisterNameField } from "../functions/api/mobile/v1/report.js";
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

test("Today sales filters shift IDs, CHAIN restaurants and both calendar dates",()=>{
  const filters=buildMobileReportFilters({
    from:"2026-10-15",to:"2026-10-15",
    departmentField:"Department.Id",selectedIds:["r1","r2"],
    operating:{from:"2026-10-14",to:"2026-10-15",shiftIds:["s1","s2"]},
    shiftField:"Session.ID"
  });
  assert.deepEqual(filters["Session.ID"].values,["s1","s2"]);
  assert.deepEqual(filters["Department.Id"].values,["r1","r2"]);
  assert.equal(filters["OpenDate.Typed"].from,"2026-10-14");
  assert.equal(filters["OpenDate.Typed"].to,"2026-10-15");
});
test("Historical reports remain calendar and unsupported shift dimensions fail closed",()=>{
  const result=buildMobileReportFilters({
    from:"2026-10-01",to:"2026-10-02",
    departmentField:"Department.Id",selectedIds:["r1"]
  });
  assert.equal(result["Session.ID"],undefined);
  assert.equal(result["OpenDate.Typed"].from,"2026-10-01");
  assert.throws(()=>buildMobileReportFilters({
    from:"2026-10-15",to:"2026-10-15",
    departmentField:"Department.Id",selectedIds:["r1"],
    operating:{from:"2026-10-14",to:"2026-10-15",shiftIds:["s1"]}
  }),e=>e.code==="OLAP_SHIFT_FIELD_UNAVAILABLE");
});

test("report field resolution skips non-groupable or non-aggregatable preferred fields",()=>{
 const fields=[
  {name:"PayTypes",title:"Payment types",groupingAllowed:false},
  {name:"PaymentType.Name",title:"Payment type",groupingAllowed:true},
  {name:"DiscountSumInt",title:"Discount",aggregationAllowed:false},
  {name:"DiscountSum",title:"Discount sum",aggregationAllowed:true}
 ];
 assert.equal(findOlapGroupField(fields,["PayTypes","PaymentType.Name"]),
  "PaymentType.Name");
 assert.equal(findOlapMeasureField(fields,["DiscountSumInt","DiscountSum"]),
  "DiscountSum");
});


test("discount reports resolve a display cash-register name instead of a register ID",()=>{
 const fields=[
  {name:"CashRegister.Id",title:"Cash register ID",groupingAllowed:true},
  {name:"CashRegisterName",title:"Cash register name",groupingAllowed:true}
 ];
 assert.equal(findCashRegisterNameField(fields),"CashRegisterName");
 assert.equal(findCashRegisterNameField([
  {name:"CashRegister.Id",title:"Cash register ID",groupingAllowed:true}
 ]),null);
});
