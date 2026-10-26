import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import broker from "../services/iiko-session-broker/src/worker.mjs";
import {readFileSync} from "node:fs";
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const env={
 IIKO_BROKER_SERVICE_SECRET:"only-private-service",
 IIKO_BROKER_ENCRYPTION_KEY_B64:Buffer.alloc(32,5).toString("base64"),
 IIKO_ALLOWED_TARGETS:"iiko.internal.example:9132"
};
const connection={ip:"iiko.internal.example",port:"9132",login:"staff",password:"private"};
const probe=({secret=env.IIKO_BROKER_SERVICE_SECRET,connection:conn=connection}={})=>new Request(
 "https://broker.internal/request",{method:"POST",
 headers:{"content-type":"application/json","x-sh-broker-secret":secret},
 body:JSON.stringify({action:"status",tenantId:"workspace:one",connection:conn})
});

test("production private readiness requires secret, exact target and AES key, no iiko login",async()=>{
 let objectCalls=0,upstreamCalls=0;
 const saved=globalThis.fetch;
 globalThis.fetch=async()=>{upstreamCalls++;throw Error("no iiko request allowed")};
 const realEnv={...env,IIKO_SESSIONS:{
   idFromName:()=>{objectCalls++;throw Error("Durable Object should not be touched")}
 }};
 try{
  const r=await broker.fetch(probe(),realEnv);
  assert.equal(r.status,200);
  assert.deepEqual(await r.json(),{success:true,code:"BROKER_READY",readOnly:true});
  assert.equal(upstreamCalls,0);
  assert.equal(objectCalls,0);
  assert.equal((await broker.fetch(probe({secret:"invalid"}),realEnv)).status,403);
  assert.equal((await broker.fetch(probe({connection:{...connection,ip:"different.example"}}),realEnv)).status,403);
  assert.equal((await broker.fetch(probe(),{...realEnv,IIKO_BROKER_ENCRYPTION_KEY_B64:"invalid"})).status,503);
  assert.equal((await broker.fetch(probe(),{...realEnv,IIKO_SESSIONS:null})).status,503);
  assert.equal(upstreamCalls,0);
  assert.equal(objectCalls,0);
 } finally {globalThis.fetch=saved}
});

test("broker status route is privileged and never exposes stored iiko credentials",()=>{
 const endpoint=readFileSync("functions/api/iiko/broker-status.js","utf8");
 const middleware=readFileSync("functions/api/iiko/_middleware.js","utf8");
 assert.match(endpoint,/hasPermission\(auth.access,"settings.manage"\)/);
 assert.match(endpoint,/auth\.access\?\.workspace\?\.id/);
 assert.match(endpoint,/privateConnection\(auth.state\)/);
 assert.match(endpoint,/action:"status"/);
 assert.doesNotMatch(endpoint,/\/resto\/api\/auth|\/resto\/api\/logout/);
 assert.match(middleware,/p\.endsWith\("\/broker-status"\).*"settings.manage"/);
});
