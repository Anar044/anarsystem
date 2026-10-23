import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { validateWarehouseAct,buildSalesActXml,extractValidationTag } from "../functions/api/iiko/warehouse-acts.js";
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
 assert.equal(extractValidationTag("<documentValidationResult><valid>true</valid><warning>false</warning></documentValidationResult>","valid"),"true");
 assert.equal(extractValidationTag("<documentValidationResult><valid>false</valid><errorMessage>reject</errorMessage></documentValidationResult>","valid"),"false");
});
test("sales validation blocks incorrect amount and discount",()=>{
 assert.throws(()=>validateWarehouseAct({document:{...sales,items:[{productId:product,amount:0,sum:10}]}},"sales",stores),/количество/);
 assert.throws(()=>validateWarehouseAct({document:{...sales,items:[{productId:product,amount:1,sum:10,discountSum:11}]}},"sales",stores),/скидка/i);
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
