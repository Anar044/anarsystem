import test from "node:test";
import assert from "node:assert/strict";
import { scopedRequest } from "../functions/api/mobile/v1/assistant.js";
import { cookieDepartmentIds, parseCookies } from "../functions/api/iiko/_lib/restaurant-scope.js";

const verified = {
  access: { workspace: { id: "workspace-22" } },
  selectedIds: ["rest-2", "rest-7"]
};
test("mobile AI binds the verified workspace, not an unrelated default membership", () => {
  const incoming = new Request("https://example.test/api/mobile/v1/assistant",{
    headers: {
      Cookie: "sh_workspace_id=foreign-workspace; sh_selected_departments=foreign",
      "X-SH-Workspace-Id": "spoofed-workspace"
    }
  });
  const result = scopedRequest(incoming, verified);
  const cookies = parseCookies(result);
  assert.equal(cookies.sh_workspace_id, "workspace-22");
  assert.deepEqual(cookieDepartmentIds(result), ["rest-2","rest-7"]);
  assert.equal(result.headers.get("X-SH-Mobile-Strict-Scope"), "1");
  assert.equal(result.headers.get("X-SH-Workspace-Id"),"workspace-22");
  assert.ok(!result.headers.get("Cookie").includes("foreign"));
});
test("mobile AI request body stays strictly read-only scoped", async () => {
  const incoming = new Request("https://example.test/api/mobile/v1/assistant", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({message:"ignored"})
  });
  const req = scopedRequest(incoming, verified, {
    method:"POST", body:{action:"message", message:"revenue",departmentIds:verified.selectedIds}
  });
  assert.equal(req.method,"POST");
  assert.equal(req.headers.get("Content-Type"),"application/json");
  assert.deepEqual((await req.json()).departmentIds,verified.selectedIds);
  assert.equal(parseCookies(req).sh_workspace_id,"workspace-22");
});
