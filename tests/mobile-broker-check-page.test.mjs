import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const html=readFileSync("broker-check.html","utf8");
test("readiness page uses authenticated Preview session rather than a manually copied token",()=>{
 assert.match(html,/data-protected="true"/);
 assert.match(html,/auth-config\.js/);
 assert.match(html,/auth\.js/);
 assert.match(html,/SHAuth\.createClient/);
 assert.match(html,/client\.auth\.getSession\(\)/);
 assert.match(html,/Authorization.*Bearer/);
 assert.match(html,/fetch\("\/api\/iiko\/broker-status"/);
 assert.match(html,/sh-auth-ready/);
});
test("readiness page cannot itself allocate licensed iiko sessions or disclose credentials",()=>{
 assert.doesNotMatch(html,/fetch\([^\n]*\/resto\/api\//);
 assert.doesNotMatch(html,/getIikoAuth|\/resto\/api\/auth|\/resto\/api\/logout/);
 assert.doesNotMatch(html,/JSON\.stringify\(data\)|status\.textContent.*token|console\.log\(token/);
 assert.match(html,/workerReady/);
 assert.match(html,/workspaceSelected/);
 assert.match(html,/readyForActivation/);
});
