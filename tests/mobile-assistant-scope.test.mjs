import test from "node:test";
import assert from "node:assert/strict";
import { scopedRequest } from "../functions/api/mobile/v1/assistant.js";
import { parseCookies } from "../functions/api/iiko/_lib/restaurant-scope.js";
import { assistantToolDepartmentScope } from "../functions/api/iiko/_lib/ai-assistant-tools.js";

test("assistant receives server-validated CHAIN selection, never forged cookie",async()=>{
 const request=new Request("https://example.com/api/mobile/v1/assistant",{
  method:"GET",
  headers:{"Cookie":"sh_selected_departments=foreign",
    "Authorization":"Bearer token-test"}
 });
 const scoped=scopedRequest(request,{
  selectedIds:["restaurant1","restaurant2"],
  access:{workspace:{id:"own-workspace"}}
 });
 assert.equal(scoped.headers.get("X-SH-Workspace-Id"),"own-workspace");
 assert.equal(scoped.headers.get("X-SH-Mobile-Strict-Scope"),"1");
 const cookies=parseCookies(scoped);
 assert.equal(cookies.sh_workspace_id,"own-workspace");
 assert.equal(cookies.sh_selected_departments,"restaurant1,restaurant2");
 assert.equal(cookies.sh_workspace_id.includes("foreign"),false);
});

test("mobile AI does not omit Department filter when all CHAIN restaurants selected",()=>{
 const scope=assistantToolDepartmentScope({
   isChain:true,mobileStrict:true,
   selectedDepartmentIds:["dept-A","dept-B"],
   allowedDepartmentIds:["dept-A","dept-B"]
 });
 assert.equal(scope.enforceDepartmentScope,true);
 assert.deepEqual(scope.effectiveDepartmentIds,["dept-A","dept-B"]);
});
test("standard website remains backward-compatible, mobile mode only narrows",()=>{
 const scope=assistantToolDepartmentScope({
   isChain:true,selectedDepartmentIds:["dept-A"],
   allowedDepartmentIds:["dept-A"]
 });
 assert.deepEqual(scope.effectiveDepartmentIds,[]);
 const subset=assistantToolDepartmentScope({
   isChain:true,selectedDepartmentIds:["dept-A"],
   allowedDepartmentIds:["dept-A","dept-B"]
 });
 assert.deepEqual(subset.effectiveDepartmentIds,["dept-A"]);
});
