import test from "node:test";
import assert from "node:assert/strict";
import { scopedRequest } from "../functions/api/mobile/v1/assistant.js";

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
 assert.equal(decodeURIComponent(scoped.headers.get("Cookie").split("=")[1]),
   "restaurant1,restaurant2");
});
