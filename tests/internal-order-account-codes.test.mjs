import test from "node:test";
import assert from "node:assert/strict";
import {validateInternalAccountCodes,normalizeInternalIikoAccounts} from "../functions/api/_lib/internal-order-account-codes.js";
import {shipmentXml} from "../functions/api/_lib/internal-shipment-core.js";

test("both blank codes preserve original server-side iiko accounting defaults",()=>{
  const result=validateInternalAccountCodes({revenueAccountCode:"",expenseAccountCode:""});
  assert.equal(result.valid,true);assert.equal(result.usesIikoDefaults,true);
});
test("user-defined revenue and expense accounts are independent and trimmed",()=>{
  const result=validateInternalAccountCodes({revenueAccountCode:" 701.1 ",expenseAccountCode:" 711.2 "});
  assert.equal(result.valid,true);
  assert.equal(result.revenueAccountCode,"701.1");
  assert.equal(result.expenseAccountCode,"711.2");
  assert.equal(result.usesIikoDefaults,false);
});
test("one missing account fails closed",()=>{
  for(const pair of [
    {revenueAccountCode:"701",expenseAccountCode:""},
    {revenueAccountCode:"",expenseAccountCode:"711"}
  ])assert.equal(validateInternalAccountCodes(pair).code,"INCOMPLETE_ACCOUNT_PAIR");
});
test("disallow long or malformed account codes",()=>{
  for(const code of ["a".repeat(41),"foo bar","<script>","101&102","101\n102"]){
    const result=validateInternalAccountCodes({revenueAccountCode:code,expenseAccountCode:"711"});
    assert.equal(result.valid,false);
    assert.equal(result.code,"INVALID_ACCOUNT_CODE");
  }
});
test("outgoing XML uses the persisted account code pair",()=>{
  const cfg=validateInternalAccountCodes({revenueAccountCode:"701.1",expenseAccountCode:"711.2"});
  const xml=shipmentXml({id:"test-id",number:"IO-TEST-S01",date:"2026-10-12",
    storeId:"sender-store",counteragentId:"receiver-buyer",status:"PROCESSED",
    accountToCode:cfg.expenseAccountCode,revenueAccountCode:cfg.revenueAccountCode,
    comment:"test",lines:[{productId:"cheese",amount:1,unitPrice:15,sumCents:1500}]});
  assert.match(xml,/<accountToCode>711\.2<\/accountToCode>/);
  assert.match(xml,/<revenueAccountCode>701\.1<\/revenueAccountCode>/);
  assert.match(xml,/<defaultStoreId>sender-store<\/defaultStoreId>/);
  assert.match(xml,/<counteragentId>receiver-buyer<\/counteragentId>/);
});

test("account list ignores deleted accounts and returns iiko codes rather than labels",()=>{
  const rows=normalizeInternalIikoAccounts([
    {code:"701",name:"Revenue",type:"INCOME",deleted:false},
    {code:"711",name:"Expenses",type:"EXPENSES",deleted:false},
    {code:"799",name:"Retired",deleted:true},
    {code:"701",name:"Duplicate",type:"INCOME"},
    {code:"bad code",name:"Invalid"},
    {code:"722",name:""}
  ]);
  assert.deepEqual(rows.map(x=>x.code),["701","711"]);
  assert.equal(rows[0].name,"Revenue");
});
test("account list handles wrapped JSON and unavailable payloads",()=>{
  assert.equal(normalizeInternalIikoAccounts({data:[{code:"101",name:"Cash"}]}).length,1);
  assert.deepEqual(normalizeInternalIikoAccounts(null),[]);
  assert.deepEqual(normalizeInternalIikoAccounts({status:"ERROR"}),[]);
});

test("the same accounting code is explicitly valid for both revenue and expense",()=>{
  const cfg=validateInternalAccountCodes({revenueAccountCode:"4.01",expenseAccountCode:"4.01"});
  assert.equal(cfg.valid,true);
  assert.equal(cfg.revenueAccountCode,cfg.expenseAccountCode);
  const xml=shipmentXml({id:"equal-account-demo",number:"TEST-EQUAL-S01",date:"2026-10-12",
    storeId:"sender",counteragentId:"receiver",status:"PROCESSED",
    accountToCode:cfg.expenseAccountCode,revenueAccountCode:cfg.revenueAccountCode,
    comment:"test-only",lines:[{productId:"p1",amount:1,unitPrice:15,sumCents:1500}]});
  assert.match(xml,/<accountToCode>4\.01<\/accountToCode>/);
  assert.match(xml,/<revenueAccountCode>4\.01<\/revenueAccountCode>/);
});
