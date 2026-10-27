import test from "node:test";
import assert from "node:assert/strict";
import { mobileAssistantCharts } from "../functions/api/mobile/v1/assistant.js";

test("mobile assistant preserves three structured charts from verified web AI", () => {
  const graphs = Array.from({length:4}, (_, i) => ({
    type:"horizontal_bar", title:`Chart ${i}`,
    series:[{name:"AZN",data:[{label:"TEST",value:2304}]}]
  }));
  assert.deepEqual(mobileAssistantCharts({charts:graphs}),graphs.slice(0,3));
  assert.equal(mobileAssistantCharts({chart:graphs[0]}).length,0);
});
test("invalid or text-only charts are not substituted with invented points", () => {
  assert.deepEqual(mobileAssistantCharts({charts:[
    {type:"bar",title:"No points"},null,"not a chart",
    {type:"bar",series:[]}
  ]}),[{type:"bar",series:[]}]);
  assert.deepEqual(mobileAssistantCharts(null),[]);
});
