import test from "node:test";
import assert from "node:assert/strict";
import {assistantNeedsCompletion} from "../functions/api/ai-assistant.js";

test("incomplete reasoning-only responses must be resumed once",()=>{
 assert.equal(assistantNeedsCompletion({
   status:"incomplete",
   incomplete_details:{reason:"max_output_tokens"},
   output:[{type:"reasoning",summary:[]}]
 }),true);
});
test("a valid final response does not need a second OpenAI call",()=>{
 assert.equal(assistantNeedsCompletion({
   status:"completed",output_text:'{"kind":"text","text":"Топ блюд"}',
   output:[{type:"message",content:[{type:"output_text",
     text:'{"kind":"text","text":"Топ блюд"}'}]}]
 }),false);
});
