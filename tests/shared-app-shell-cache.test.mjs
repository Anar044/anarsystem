import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const canonical="/app-shell.js?v=20261028-module-stable1";
const keyPages=["persistent-workspace.html","dashboard.html","procurement.html",
  "internal-orders.html","stock-balances.html","stock-movements.html",
  "nomenclature.html","reports.html","hr-timesheet.html","hr-payroll.html",
  "hr-employees.html","finance.html"];
test("core screens reuse the same cache key for their permission-aware app shell",()=>{
  for(const page of keyPages){
    const html=read(page);
    const urls=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']*app-shell\.js[^"']*)["']/gi)].map(x=>x[1]);
    assert.deepEqual(urls,[canonical],page+" must load exactly one current shell");
  }
});
test("common app shell revalidates after deployment rather than serving stale permissions UI",()=>{
  assert.match(read("_headers"),/\/app-shell\.js\s+Cache-Control: no-cache, max-age=0, must-revalidate/);
  assert.match(read("app-shell.js"),/SHAccess/);
});
