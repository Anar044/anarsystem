import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname,resolve } from "node:path";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const routed=["abc","account-postings","accounts","cash-shift-detail","cash-shifts","chain","connect","contractors","dashboard","dashboard-summary","debug","document-action","document-by-number","documents","events","finance-data","food-cost","incoming-invoices","invoice-reference-data","nomenclature","olap","orders","outgoing-invoices","pnl","qr-image","qr-menu","references","restaurant-name","sales","stock-balances","stock-movements","supplier-balances","waiter-performance"];
test("all authenticated iiko endpoints use workspace-scoped broker adapter",()=>{
 for(const name of routed){
  const source=readFileSync(resolve(root,"functions/api/iiko",name+".js"),"utf8");
  assert.match(source,/bindIikoBroker\(/,"Missing broker binding for "+name);
 }
});
test("independent server-side flows bind the verified workspace",()=>{
 for(const name of ["procurement","internal-orders","internal-order-shipments","ai-assistant","ai-documents"]){
  const source=readFileSync(resolve(root,"functions/api",name+".js"),"utf8");
  assert.match(source,/bindWorkspaceIikoBroker\(/,"Missing workspace bind for "+name);
 }
});
test("reference lookup never extracts raw token or builds a key URL",()=>{
 const source=readFileSync(resolve(root,"functions/api/iiko/references.js"),"utf8");
 assert.doesNotMatch(source,/getIikoAuth|key=\$\{|encodeURIComponent\(token\)/);
 assert.match(source,/iikoText\(/);
});
