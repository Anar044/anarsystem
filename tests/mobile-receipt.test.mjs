import test from "node:test";
import assert from "node:assert/strict";
import { receiptFields, normalizeReceiptRows, buildReceiptOlapRequest, selectReceiptRows } from "../functions/api/mobile/v1/receipt.js";

const fields=[
  {name:"OrderNum",title:"Номер заказа"},
  {name:"OpenDate.Typed",title:"Дата"},
  {name:"Department.Id",title:"Ресторан"},
  {name:"Session.ID",title:"Смена"},
  {name:"DishName",title:"Блюдо"},
  {name:"DishAmountInt",title:"Количество"},
  {name:"DishDiscountSumInt",title:"Сумма со скидкой"}
];
const ref={number:"12",date:"2026-10-15",departmentId:"A",
  shiftId:"shift-a",orderId:""};
test("receipts read real dish amounts only for unique shift and restaurant",()=>{
  const meta=receiptFields(fields);
  const payload=[
    {OrderNum:"12","Department.Id":"A","Session.ID":"shift-a",
      DishName:"Americano",DishAmountInt:1,DishDiscountSumInt:5},
    {OrderNum:"12","Department.Id":"A","Session.ID":"shift-a",
      DishName:"Tea",DishAmountInt:2,DishDiscountSumInt:7}
  ];
  const out=normalizeReceiptRows(payload,meta,ref,fields);
  assert.equal(out.total,2);
  assert.equal(out.itemsTotal,12);
  assert.deepEqual(out.positions.map(x=>x.name),["Americano","Tea"]);
  assert.equal(out.positions[1].quantity,2);
});
test("receipt details fail closed for another restaurant or session",()=>{
  const meta=receiptFields(fields);
  const row={OrderNum:"12","Department.Id":"A","Session.ID":"shift-a",
    DishName:"Tea",DishDiscountSumInt:7};
  assert.throws(()=>normalizeReceiptRows([{...row,
    "Department.Id":"B"}],meta,ref,fields),
    e=>e.code==="RECEIPT_SCOPE_MISMATCH");
  assert.throws(()=>normalizeReceiptRows([{...row,
    "Session.ID":"shift-b"}],meta,ref,fields),
    e=>e.code==="RECEIPT_SCOPE_MISMATCH");
  assert.throws(()=>normalizeReceiptRows([{
    ...row,OrderNum:"13"}],meta,ref,fields),
    e=>e.code==="RECEIPT_SCOPE_MISMATCH");
});
test("receipt breakdown never relies on a mere number without shift identity",()=>{
  const meta=receiptFields(fields);
  assert.throws(()=>normalizeReceiptRows([],meta,{
    number:"12",date:"2026-10-15",departmentId:"A",
    shiftId:"",orderId:""
  },fields),e=>e.code==="RECEIPT_IDENTITY_UNAVAILABLE");
});

test("receipt query uses verified restaurant, shift and date; not fragile order-number OLAP filter",()=>{
  const meta=receiptFields(fields);
  const q=buildReceiptOlapRequest(meta,ref);
  assert.equal(q.filters.OrderNum,undefined);
  assert.deepEqual(q.filters["Department.Id"].values,["A"]);
  assert.deepEqual(q.filters["Session.ID"].values,["shift-a"]);
  assert.equal(q.filters["OpenDate.Typed"].from,"2026-10-15");
  assert.ok(q.groupByRowFields.includes("OrderNum"));
  assert.ok(q.groupByRowFields.includes("DishName"));
  assert.deepEqual(q.aggregateFields,["DishDiscountSumInt","DishAmountInt"]);
  assert.deepEqual(buildReceiptOlapRequest(meta,ref,{quantity:false}).aggregateFields,
    ["DishDiscountSumInt"]);
});

test("server isolates receipt number only after verifying every returned restaurant and shift",()=>{
  const meta=receiptFields(fields);
  const rows=[
    {OrderNum:12,"Department.Id":"A","Session.ID":"shift-a",DishName:"Tea",DishDiscountSumInt:5},
    {OrderNum:13,"Department.Id":"A","Session.ID":"shift-a",DishName:"Coffee",DishDiscountSumInt:8}
  ];
  const wanted=selectReceiptRows(rows,meta,ref,fields);
  assert.equal(wanted.length,1);
  assert.equal(wanted[0].DishName,"Tea");
  assert.throws(()=>selectReceiptRows([...rows,{...rows[1],
    "Department.Id":"B"}],meta,ref,fields),e=>e.code==="RECEIPT_SCOPE_MISMATCH");
  assert.throws(()=>selectReceiptRows([...rows,{...rows[1],
    "Session.ID":"shift-b"}],meta,ref,fields),e=>e.code==="RECEIPT_SCOPE_MISMATCH");
});
