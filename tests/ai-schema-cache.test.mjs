import test from "node:test";
import assert from "node:assert/strict";
import { ensureTables } from "../functions/api/ai-assistant.js";

function dbMock({failFirst=false}={}) {
 let batches=0;
 const calls=[];
 return {
  get batches(){return batches;},
  get statements(){return calls;},
  prepare(sql) {
   calls.push(sql);
   return {run: async()=>({success:true})};
  },
  async batch(stmts) {
   batches++;
   if(failFirst && batches===1)throw new Error("D1 TEMPORARY_FAILURE");
   return stmts.map(()=>({success:true}));
  }
 };
}
test("AI chat table initialization is shared across concurrent requests", async () => {
 const db=dbMock();
 await Promise.all(Array.from({length:8},()=>ensureTables(db)));
 assert.equal(db.batches,1);
 await ensureTables(db);
 assert.equal(db.batches,1);
});
test("AI schema cache retries if the first initialization fails", async () => {
 const db=dbMock({failFirst:true});
 await assert.rejects(()=>ensureTables(db), /D1 TEMPORARY_FAILURE/);
 await ensureTables(db);
 assert.equal(db.batches,2);
});
