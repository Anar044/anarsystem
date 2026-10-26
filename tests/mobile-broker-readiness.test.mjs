import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { onRequestGet } from "../functions/api/iiko/broker-status.js";

const handler=readFileSync("functions/api/iiko/broker-status.js","utf8");
const gate=readFileSync("functions/api/iiko/_middleware.js","utf8");

test("Preview diagnostics fail closed without database or authenticated scope", async()=>{
  let calls=0;
  const request=new Request("https://example.test/api/iiko/broker-status");
  const out=await onRequestGet({request,env:{IIKO_SESSION_BROKER:{
    fetch:async()=>{calls++;throw Error("Should never be reached")}
  }}});
  assert.equal(out.status,503);
  assert.equal((await out.json()).code,"DB_UNAVAILABLE");
  assert.equal(calls,0);
  assert.equal(out.headers.get("cache-control"),"no-store");
});

test("only settings managers can invoke private readiness and secrets stay private",()=>{
  assert.match(handler,/hasPermission\(state.access,"settings.manage"\)/);
  assert.match(handler,/state.access\?\.workspace\?\.id/);
  assert.match(handler,/loadRequestIikoState\(request,env\)/);
  assert.match(handler,/hasPrivateConnection\(state.state\)/);
  assert.match(handler,/privateConnection\(state.state\)/);
  assert.match(handler,/action:"status"/);
  assert.match(handler,/x-sh-broker-secret/);
  assert.match(gate,/p\.endsWith\("\/broker-status"\).*settings.manage/);
  assert.doesNotMatch(handler,/\/resto\/api\/auth|\/resto\/api\/logout/);
  assert.doesNotMatch(handler,/response.*password|return .*password/);
});
