import test from "node:test";
import assert from "node:assert/strict";
import { assistantAnalyticQuestion, mobileOwnerExecutiveInstructions }
  from "../functions/api/ai-assistant.js";

test("Owner AI treats RU, AZ and EN business questions as analysis", () => {
  for (const question of [
    "Какая выручка сегодня?",
    "Сравни продажи ресторанов за неделю",
    "Покажи график прибыли",
    "Satışların dinamikasını göstər",
    "Bu gün mənfəət nə qədərdir?",
    "Compare revenue and discounts",
    "Show sales trend",
  ]) {
    assert.equal(assistantAnalyticQuestion(question), true, question);
  }
});
test("ordinary dialogue does not need heavy analytical reasoning", () => {
  for (const question of ["Привет", "Спасибо", "Hello"]) {
    assert.equal(assistantAnalyticQuestion(question), false, question);
  }
});
test("executive instructions preserve verify-only, scope and date accuracy", () => {
  const s=mobileOwnerExecutiveInstructions();
  assert.match(s,/выбранные и разрешённые/);
  assert.match(s,/операционный день/);
  assert.match(s,/отсутствие данных нулевыми/);
  assert.match(s,/не рисуй вымышленных/);
  assert.match(s,/AZN/);
});
