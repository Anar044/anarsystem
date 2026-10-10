import test from "node:test";
import assert from "node:assert/strict";
import {normalizeInternalLines,validateApproval,internalNextStatus} from "../functions/api/_lib/internal-order-core.js";

const lines=[
  {productId:"item-a",productName:"Курица",unit:"кг",packageSize:5.5,packageCount:5,containerId:"pack-5.5"},
  {productId:"item-b",productName:"Помидор",unit:"кг",packageSize:1,packageCount:10}
];

test("Internal order computes base units from real package quantity",()=>{
  const a=normalizeInternalLines(lines);
  assert.equal(a[0].quantity,27.5);
  assert.equal(a[0].packageCount,5);
  assert.equal(a[0].containerId,"pack-5.5");
});
test("Internal order rejects duplicate products",()=>{
  assert.throws(()=>normalizeInternalLines([...lines,lines[0]]),/повторяется/);
});
test("Internal order rejects empty and nonpositive quantities",()=>{
  assert.throws(()=>normalizeInternalLines([]),/1 до 200/);
  assert.throws(()=>normalizeInternalLines([{...lines[0],packageCount:0}]),/Неверное количество/);
  assert.throws(()=>normalizeInternalLines([{...lines[0],packageSize:-1}]),/Неверное количество/);
});
test("Central warehouse may approve less than requested",()=>{
  const a=normalizeInternalLines(lines);
  const confirmed=validateApproval(a,[{productId:"item-a",packageCount:2},{productId:"item-b",packageCount:10}]);
  assert.equal(confirmed[0].quantity,11);
  assert.equal(confirmed[1].quantity,10);
});
test("Cannot approve over-request quantity, extra row or missing row",()=>{
  const a=normalizeInternalLines(lines);
  assert.throws(()=>validateApproval(a,[{productId:"item-a",packageCount:6},{productId:"item-b",packageCount:10}]),/больше заказанного/);
  assert.throws(()=>validateApproval(a,[{productId:"item-a",packageCount:1}]),/не совпадает/);
  assert.throws(()=>validateApproval(a,[{productId:"item-a",packageCount:1},{productId:"extra",packageCount:1}]),/больше заказанного/);
});
test("Allowed status chain stops at READY without fictitious iiko stock posting",()=>{
  let status="DRAFT";
  for(const [action,expected] of [["submit","SUBMITTED"],["approve","APPROVED"],["picking","PICKING"],["ready","READY"]]){
    status=internalNextStatus(status,action);assert.equal(status,expected);
  }
  assert.throws(()=>internalNextStatus("READY","complete"),/Недопустимый переход/);
});
test("Invalid status transitions are blocked",()=>{
  assert.throws(()=>internalNextStatus("DRAFT","approve"),/Недопустимый/);
  assert.throws(()=>internalNextStatus("SUBMITTED","ready"),/Недопустимый/);
  assert.equal(internalNextStatus("SUBMITTED","reject"),"REJECTED");
  assert.equal(internalNextStatus("DRAFT","cancel"),"CANCELLED");
});
