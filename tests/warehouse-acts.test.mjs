import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { validateWarehouseAct,buildSalesActXml,extractValidationTag,selectedDepartmentsForActs } from "../functions/api/iiko/warehouse-acts.js";
import { normalizeStores } from "../functions/api/iiko/stock-balances.js";
import { warehouseLabel, warehouseKey } from "../functions/api/iiko/_lib/warehouse-names.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const store="11111111-1111-4111-8111-111111111111";
const other="11111111-1111-4111-8111-222222222222";
const account="22222222-2222-4222-8222-222222222222";
const product="33333333-3333-4333-8333-333333333333";
const base={dateIncoming:"2026-10-23T10:15",storeId:store,accountId:account,
 items:[{productId:product,amount:2}],status:"NEW"};
const sales={...base,accountToCode:"5.01",revenueAccountCode:"4.01",
 items:[{productId:product,amount:2,sum:20.5,discountSum:1,vatPercent:18}]};
const stores=new Set([store]);
test("writeoff JSON shape and selected warehouse restriction",()=>{
 const d=validateWarehouseAct({document:base},"writeoff",stores);
 assert.equal(d.status,"NEW");assert.equal(d.items[0].amount,2);
 assert.throws(()=>validateWarehouseAct({document:{...base,storeId:other}},"writeoff",stores),/склад другого подразделения/);
 assert.throws(()=>validateWarehouseAct({document:{...base,accountId:""}},"writeoff",stores),/счёт списания/);
 assert.throws(()=>validateWarehouseAct({document:{...base,status:"DELETED"}},"writeoff",stores),/статус/i);
 assert.throws(()=>validateWarehouseAct({document:{...base,items:[]}},"writeoff",stores),/1 до 250/);
});
test("salesDocument is XML and contains correct accounts, totals and separate line store",()=>{
 const d=validateWarehouseAct({document:sales},"sales",stores);
 assert.ok(d.documentNumber.startsWith("SH-SALE-"),"autogenerate idempotency-friendly document number");
 const xml=buildSalesActXml(d);
 for(const expected of ["<status>NEW</status>","<accountToCode>5.01</accountToCode>",
  "<revenueAccountCode>4.01</revenueAccountCode>","<amount>2</amount>",
  "<sum>20.5</sum>","<discountSum>1</discountSum>",
  "<vatPercent>18</vatPercent>","<storeId>"+store+"</storeId>",
  "<productId>"+product+"</productId>"])
  assert.ok(xml.includes(expected),expected);
 assert.ok(xml.indexOf("<status>")<xml.indexOf("<items>"));
 assert.match(xml,/<dateIncoming>2026-10-23T10:15:00<\/dateIncoming>/);
 assert.equal(extractValidationTag("<documentValidationResult><valid>true</valid><warning>false</warning></documentValidationResult>","valid"),"true");
 assert.equal(extractValidationTag("<documentValidationResult><valid>false</valid><errorMessage>reject</errorMessage></documentValidationResult>","valid"),"false");
});
test("sales validation blocks incorrect amount and discount",()=>{
 assert.throws(()=>validateWarehouseAct({document:{...sales,items:[{productId:product,amount:0,sum:10}]}},"sales",stores),/количество/);
 assert.throws(()=>validateWarehouseAct({document:{...sales,items:[{productId:product,amount:1,sum:10,discountSum:11}]}},"sales",stores),/скидка/i);
 assert.throws(()=>validateWarehouseAct({document:{...sales,items:[{productId:product,amount:1,sum:null}]}},"sales",stores),/сумму реализации/);
 assert.throws(()=>validateWarehouseAct({document:{...sales,items:[{productId:product,amount:1,sum:10,vatPercent:150}]}},"sales",stores),/НДС/);
 assert.throws(()=>validateWarehouseAct({document:{...sales,accountToCode:""}},"sales",stores),/счет[а-я]*|счёт[а-я]*/i);
});
test("new UI and new handler are server-protected and linked into app shell",()=>{
 const backend=readFileSync(new URL("../functions/api/iiko/warehouse-acts.js",import.meta.url),"utf8");
 const sidebar=readFileSync(new URL("../app-shell.js",import.meta.url),"utf8");
 const frontend=readFileSync(new URL("../warehouse-acts-editor.js",import.meta.url),"utf8");
 assert.match(backend,/resolveAccessForUser/);
 assert.match(backend,/bindWorkspaceIikoBroker/);
 assert.match(backend,/hasPermission\(access,permission\)/);
 assert.match(backend,/resolveStoreScope/);
 assert.match(backend,/import\/salesDocument/);
 assert.match(backend,/v2\/documents\/writeoff/);
 assert.match(sidebar,/akty-realizatsii.html/);
 assert.match(frontend,/wa-draft/);
 assert.match(frontend,/wa-process/);
});

test("all four restaurants are resolved from verified stored state even when client sends empty departmentIds",()=>{
 const restaurantIds=[
  "aaa00000-0000-4000-8000-000000000001",
  "aaa00000-0000-4000-8000-000000000002",
  "aaa00000-0000-4000-8000-000000000003",
  "aaa00000-0000-4000-8000-000000000004"
 ];
 const state={identity:{mode:"CHAIN",departments:restaurantIds.map((id,i)=>({id,name:"RMS "+(i+1)}))}};
 const allRequest=new Request("https://smarthoreca.pages.dev/api/iiko/warehouse-acts",{method:"POST",headers:{Cookie:"sh_selected_departments="}});
 const ids=selectedDepartmentsForActs(state,{scope:{mode:"ALL"}},allRequest);
 assert.deepEqual(ids,restaurantIds);
 const subRequest=new Request("https://smarthoreca.pages.dev/api/iiko/warehouse-acts",{headers:{Cookie:"sh_selected_departments="+encodeURIComponent(restaurantIds[2])}});
 assert.deepEqual(selectedDepartmentsForActs(state,{scope:{mode:"ALL"}},subRequest),[restaurantIds[2]]);
 const limited={scope:{mode:"SELECTED",departmentIds:[restaurantIds[0]]}};
 assert.deepEqual(selectedDepartmentsForActs(state,limited,allRequest),[restaurantIds[0]]);
 assert.throws(()=>selectedDepartmentsForActs(state,limited,subRequest),/вне разрешённой области/);
});
test("existing warehouse reference parser turns corporation XML UUIDs into warehouse names",()=>{
 const xml='<?xml version="1.0"?><corporateItemDtoList>'+
  '<corporateItemDto><id>3ccff736-26aa-4596-9938-7c3e813131f4</id><name>Основной склад</name><type>STORE</type></corporateItemDto>'+
  '<corporateItemDto><id>6a4df12c-d95e-42a8-9a92-c4e5e40c061e</id><name>Бар</name><type>STORE</type></corporateItemDto>'+
  '</corporateItemDtoList>';
 const parsed=normalizeStores(xml,null);
 const map=new Map(parsed.map(x=>[warehouseKey(x.id),x.name]));
 assert.equal(warehouseLabel("3ccff736-26aa-4596-9938-7c3e813131f4",map),"Основной склад");
 assert.equal(warehouseLabel("6a4df12c-d95e-42a8-9a92-c4e5e40c061e",map),"Бар");
 assert.ok(!warehouseLabel("33333333-3333-4333-8333-333333333333",map).includes("33333333-3333"));
});
test("document list no longer rejects empty selection for all-restaurants mode",()=>{
 const js=readFileSync(new URL("../documents-page.js",import.meta.url),"utf8");
 assert.doesNotMatch(js,/if\(!departmentIds.length\).*?return/);
 const html=readFileSync(new URL("../akty-realizatsii.html",import.meta.url),"utf8");
 assert.ok(html.includes("warehouse-inline-2"));
 assert.ok(!html.includes("POST /resto/api"));
});

test("warehouse editor keeps one product field per row and an inline filtered suggestion list",()=>{
 const editor=readFileSync(new URL("../warehouse-acts-editor.js",import.meta.url),"utf8");
 assert.match(editor,/wa-product-search/);
 assert.match(editor,/wa-suggestions/);
 assert.match(editor,/data-index/);
 assert.match(editor,/row\.dataset\.productId/);
 assert.doesNotMatch(editor,/wa-product-pick/);
 assert.match(editor,/wa-columns/);
 assert.match(editor,/e\.key==="ArrowDown"/);
 assert.match(editor,/addEventListener\("pointerdown"/);
});
test("financial document writes fail closed on unknown network result and never automatically retry POST",()=>{
 const backend=readFileSync(new URL("../functions/api/iiko/warehouse-acts.js",import.meta.url),"utf8");
 const editor=readFileSync(new URL("../warehouse-acts-editor.js",import.meta.url),"utf8");
 assert.match(backend,/DOCUMENT_RESULT_UNKNOWN/);
 assert.match(backend,/resultUnknown/);
 assert.match(backend,/WAREHOUSE-ACT-POST-UNCONFIRMED/);
 assert.match(editor,/writeUncertain=true/);
 assert.match(editor,/disabled=writeUncertain/);
 assert.match(editor,/\$\("#documents-load"\)\?\.click\(\)/);
 assert.match(editor,/Нет ответа от Smart Horeca/);
});
test("realization detail labels sales totals as sums, not costs",()=>{
 const js=readFileSync(new URL("../documents-page.js",import.meta.url),"utf8");
 assert.match(js,/type==="sales"\?"Сумма":"Себестоимость"/);
});
