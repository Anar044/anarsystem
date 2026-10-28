import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("protected pages do not fetch the obsolete delayed P&L navigation shim",()=>{
  const auth=read("auth.js");
  const shim=read("pnl-nav-loader.js");
  const shell=read("app-shell.js");
  assert.match(shim,/Compatibility stub/);
  assert.match(shim,/P&L navigation is rendered by app-shell\.js/);
  assert.doesNotMatch(auth,/pnl-nav-loader-script|pnl-nav-loader\.js/);
  assert.match(auth,/await protectPage\(\);\s*await initSiteAccess\(\);\s*await initUserUI\(\);/);
  assert.match(shell,/function buildUnifiedSidebar\(\)/);
});
