import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePosOrderDetail, scopedOrderPluginRegistryUrl
} from "../functions/api/mobile/v1/cash-order.js";

test("POS order details include hall, table, open/close times, items and payments",()=>{
 const out=normalizePosOrderDetail({success:true,data:{
  OrderNum:"51",OrderStatus:"closed",Tables:"12",Floor:"Основной зал",
  Waiter:"Ali",Cashier:"Leyla",OpenTime:"2026-10-16T11:00:00",
  BillTime:"2026-10-16T11:25:00",CloseTime:"2026-10-16T11:30:00",
  Revenue:25,DiscountSum:2,IncreaseSum:1,
  Payments:[{Name:"Карта",Sum:25}],
  Items:[{Name:"Пицца",Amount:2,Price:10,ResultSum:20,Modifiers:[{Name:"Сыр",Amount:1}]}]
 }},{orderNum:"51",pluginId:"pos1",departmentId:"r1"});
 assert.equal(out.number,"51");
 assert.equal(out.floor,"Основной зал");
 assert.equal(out.table,"12");
 assert.equal(out.openedAt,"2026-10-16T11:00:00");
 assert.equal(out.billAt,"2026-10-16T11:25:00");
 assert.equal(out.closedAt,"2026-10-16T11:30:00");
 assert.equal(out.items[0].name,"Пицца");
 assert.equal(out.items[0].quantity,2);
 assert.equal(out.items[0].amount,20);
 assert.equal(out.items[0].modifiers[0].name,"Сыр");
 assert.equal(out.payments[0].name,"Карта");
 assert.equal(out.discountAmount,2);
 assert.equal(out.surchargeAmount,1);
});
test("POS order item total is calculated only from actual quantity and price",()=>{
 const out=normalizePosOrderDetail({data:{items:[{name:"Чай",quantity:2,price:3}]}},
  {orderNum:"7"});
 assert.equal(out.items[0].amount,6);
 assert.equal(out.itemsAvailable,true);
});
test("unknown order amounts remain unavailable rather than becoming zero",()=>{
 const out=normalizePosOrderDetail({data:{items:[{name:"Чай",quantity:1}]}},
  {orderNum:"7"});
 assert.equal(out.amount,null);
 assert.equal(out.discountAmount,null);
 assert.equal(out.surchargeAmount,null);
});

test("numeric fields wrapped by POS objects and currency text remain readable",()=>{
 const out=normalizePosOrderDetail({data:{
  Revenue:{Value:"25,00 AZN"},
  Items:[{Name:"Кофе",Amount:{Value:"2"},Price:"3,50 AZN"}]
 }},{orderNum:"8"});
 assert.equal(out.amount,25);
 assert.equal(out.items[0].quantity,2);
 assert.equal(out.items[0].price,3.5);
 assert.equal(out.items[0].amount,7);
});

test("single-order registry verifies ONLY the authorized restaurant",()=>{
  const url=scopedOrderPluginRegistryUrl("http://68-233-120-197.nip.io",
    "rms-2",{ip:"10.0.0.5",port:"8080"});
  assert.equal(url.pathname,"/api/plugin/data");
  assert.equal(url.searchParams.get("departmentIds"),"rms-2");
  assert.equal(url.searchParams.get("serverUrl"),"http://10.0.0.5:8080");
  assert.equal(url.searchParams.get("departmentIds")?.includes("rms-3"),false);
});
test("single-order registry refuses to query an unspecified department",()=>{
  assert.throws(()=>scopedOrderPluginRegistryUrl("https://vps.example",""),
    error=>error.code==="CASH_ORDER_SCOPE_REQUIRED");
});
test("plugin detail response from a DIFFERENT order must never be displayed",()=>{
  assert.throws(()=>normalizePosOrderDetail({success:true,data:{
    OrderNum:"58",items:[{name:"Пицца",amount:1}]
  }},{orderNum:"57",departmentId:"rms2",pluginId:"pos"}),
  error=>error.code==="CASH_ORDER_ID_MISMATCH");
});
test("the POS detail reader makes one canonical get_order request",async()=>{
  const {readFileSync}=await import("node:fs");
  const source=readFileSync(new URL("../functions/api/mobile/v1/cash-order.js",
    import.meta.url),"utf8");
  assert.match(source,/action:"get_order"/);
  assert.doesNotMatch(source,/\["Order","get_order"\]/);
  assert.doesNotMatch(source,/Promise\.allSettled\(/);
  assert.match(source,/authorizedCashPlugins\(pluginPayload,\[requested\.departmentId\]\)/);
});
