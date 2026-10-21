import test from "node:test";
import assert from "node:assert/strict";
import {
  assistantToolBudget, assistantContinuationToolChoice,
  mobileRequiresSalesSource, assistantAnalyticQuestion, compactToolTrace,
} from "../functions/api/ai-assistant.js";

test("seven-day restaurant comparison is treated as a live data request", () => {
  const question="Сравни выручку ресторанов за 7 дней и покажи график";
  assert.equal(mobileRequiresSalesSource(question),true);
  assert.equal(assistantAnalyticQuestion(question),true);
  assert.equal(assistantToolBudget({mobile:true,analytic:true}),6);
  assert.equal(assistantToolBudget({mobile:true,analytic:false}),4);
  assert.equal(assistantToolBudget({mobile:false,analytic:false}),6);
});
test("mobile analysis can discover fields then fetch OLAP then build the report", () => {
  const budget=assistantToolBudget({mobile:true,analytic:true});
  for(let round=0;round<budget-1;round++){
    assert.equal(assistantContinuationToolChoice(round,budget),"auto",
      "Do not force a final answer before OLAP data can be fetched");
  }
  assert.equal(assistantContinuationToolChoice(budget-1,budget),"none");
});
test("never force tools for greetings but do for requested sales or charts", () => {
  for(const q of ["Привет","Спасибо","Hello!"])
    assert.equal(mobileRequiresSalesSource(q),false);
  for(const q of [
    "Сравни выручку 9 ресторанов",
    "Покажи продажи за октябрь",
    "Show revenue chart",
    "Satışları müqayisə et"
  ]) assert.equal(mobileRequiresSalesSource(q),true,q);
});
test("failed backend OLAP status remains visible to the mobile client", () => {
  const x=compactToolTrace({name:"run_olap_report"}, {
    success:false,code:"CHAIN_SCOPE_FIELD_MISSING",
    message:"OLAP не отдаёт Department.Id"
  });
  assert.equal(x.ok,false);
  assert.equal(x.success,false);
  assert.equal(x.code,"CHAIN_SCOPE_FIELD_MISSING");
});
