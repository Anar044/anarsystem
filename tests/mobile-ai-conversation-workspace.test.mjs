import test from "node:test";
import assert from "node:assert/strict";
import { conversationScopeKey } from "../functions/api/ai-assistant.js";

function ctx(workspaceId, ids = [], chain=true) {
  return { access:{workspace:{id:workspaceId}}, scope:chain
    ? {isChain:true, selectedDepartmentIds:ids}
    : {isChain:false} };
}
test("same user cannot reuse the same chat ID from another workspace", () => {
  const first=conversationScopeKey(ctx("workspace-one",["restaurant-01"]));
  const second=conversationScopeKey(ctx("workspace-two",["restaurant-01"]));
  assert.notEqual(first,second);
  assert.match(first,/workspace-one/);
  assert.match(second,/workspace-two/);
});
test("standalone workspaces never share an empty conversation scope key", () => {
  assert.notEqual(conversationScopeKey(ctx("a",[],false)),
    conversationScopeKey(ctx("b",[],false)));
  assert.notEqual(conversationScopeKey(ctx("a",[],false)), "");
});
test("only the order of a fixed authorized restaurant set may vary", () => {
  assert.equal(
    conversationScopeKey(ctx("a",["b","a","a"])),
    conversationScopeKey(ctx("a",["a","b"])));
  assert.notEqual(
    conversationScopeKey(ctx("a",["a"])),
    conversationScopeKey(ctx("a",["a","b"])));
});
test("missing workspace or empty CHAIN selection fails closed", () => {
  assert.throws(()=>conversationScopeKey(ctx("",["a"])),
    e=>e.code==="AI_WORKSPACE_SCOPE_UNVERIFIED"&&e.status===403);
  assert.throws(()=>conversationScopeKey(ctx("a",[])),
    e=>e.code==="AI_RESTAURANT_SCOPE_EMPTY"&&e.status===403);
});
