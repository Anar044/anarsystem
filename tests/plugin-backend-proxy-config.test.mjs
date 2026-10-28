import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const root = path => readFileSync(new URL("../"+path,import.meta.url),"utf8");
test("plugin proxy and registry routes use server-side backend settings",()=>{
  const names=["functions/api/plugin/data.js","functions/api/plugin/request.js",
    "functions/api/plugin/order-history.js","functions/api/plugin/status.js",
    "functions/api/plugin/_lib/ingest-auth.js"];
  for(const name of names) {
    const src=root(name);
    assert.match(src,/pluginBackendUrl/);
    assert.match(src,/pluginBackendHeaders/);
    assert.doesNotMatch(src,/const VPS_API/);
  }
});
test("frontend scripts do not expose private backend credential configuration",()=>{
  for(const name of ["auth-config.js","auth.js","app-shell.js","persistent-workspace.js"])
    assert.doesNotMatch(root(name),/SH_BACKEND_PROXY_TOKEN/);
});
test("server helper validates target and injects credential for server-to-server use",()=>{
  const src=root("functions/api/plugin/_lib/backend-upstream.js");
  assert.match(src,/SH_BACKEND_API_URL/);
  assert.match(src,/SH_BACKEND_PROXY_TOKEN/);
  assert.match(src,/base.username \|\| base.password/);
});
