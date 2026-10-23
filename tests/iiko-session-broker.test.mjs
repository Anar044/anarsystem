import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto, createHash } from "node:crypto";
import brokerWorker, { IikoSession } from "../services/iiko-session-broker/src/worker.mjs";
import { bindIikoBroker, bindWorkspaceIikoBroker, isIikoBrokerPilot, iikoText, clearIikoClientCache } from "../functions/api/iiko/_lib/iiko-client.js";
if(!globalThis.crypto)globalThis.crypto=webcrypto;

const connection={ip:"iiko.example",port:"8080",login:"demo",password:"secret"};
const env={IIKO_AUTH_METHOD:"GET",IIKO_ALLOWED_TARGETS:"iiko.example:8080",IIKO_BROKER_ENCRYPTION_KEY_B64:Buffer.alloc(32,7).toString("base64")};
function storage(){
 const saved=new Map();
 return {get:async k=>saved.get(k),put:async(k,v)=>{saved.set(k,v)},delete:async k=>{saved.delete(k)}};
}
const request=(action="request",path="/resto/api/demo")=>new Request("https://broker.internal/request",{
 method:"POST",headers:{"content-type":"application/json"},
 body:JSON.stringify({tenantId:"workspace:org-a",connection,action,
   request:{path,method:"GET"}})
});
const installFetch = fn => {
 const old=globalThis.fetch;
 globalThis.fetch=fn;
 return ()=>{globalThis.fetch=old};
};

test("one REST API seat for concurrent calls and across Durable Object eviction",async()=>{
 let auth=0, data=0;
 const undo=installFetch(async url=>{
  const u=new URL(String(url));
  if(u.pathname.endsWith("/auth")){assert.equal(u.searchParams.get("pass"),createHash("sha1").update(connection.password).digest("hex"));return new Response("token-"+(++auth));}
  data++;assert.equal(u.searchParams.get("key"),"token-1");
  return new Response("ok");
 });
 try{
  const state={storage:storage()};
  const object=new IikoSession(state,env);
  const replies=await Promise.all([object.fetch(request()),object.fetch(request()),object.fetch(request())]);
  assert.deepEqual(await Promise.all(replies.map(x=>x.text())),["ok","ok","ok"]);
  assert.equal(auth,1);assert.equal(data,3);
  const afterEviction=new IikoSession(state,env);
  const reply=await afterEviction.fetch(request());
  assert.equal(await reply.text(),"ok");assert.equal(auth,1);
  assert.equal(reply.headers.get("x-sh-broker-cache"),"1");
 }finally{undo()}
});

test("stale cached token may re-login exactly once; license 403 never reauthenticates",async()=>{
 let auth=0,data=0;
 const undo=installFetch(async url=>{
  const u=new URL(String(url));
  if(u.pathname.endsWith("/auth"))return new Response("token-"+(++auth));
  data++;
  const t=u.searchParams.get("key");
  if(t==="token-1"&&data>1)return new Response("expired",{status:401});
  if(t==="token-2"&&data>2)return new Response("REST_API(2000) full",{status:403});
  return new Response("ok");
 });
 try{
  const object=new IikoSession({storage:storage()},env);
  assert.equal((await object.fetch(request())).status,200);
  assert.equal((await object.fetch(request())).status,403);
  assert.equal((await object.fetch(request())).status,403);
  assert.equal(auth,2);
 }finally{undo()}
});

test("uncertain login is not repeated while cooldown persists",async()=>{
 let auth=0;
 const undo=installFetch(async()=>{auth++;return new Response("upstream error",{status:503})});
 try{
  const state={storage:storage()};
  assert.equal((await new IikoSession(state,env).fetch(request())).status,503);
  assert.equal((await new IikoSession(state,env).fetch(request())).status,503);
  assert.equal(auth,1);
 }finally{undo()}
});

test("bridge carries verified tenant via private binding and does not expose token",async()=>{
 clearIikoClientCache();
 let payload;
 const bound=bindIikoBroker(connection,{data:{
  shBrokerTenantId:"workspace:org-a",shBrokerVerifiedConnection:connection},
  env:{IIKO_BROKER_ENABLED_WORKSPACES:"org-a",IIKO_BROKER_SERVICE_SECRET:"local-test-secret",IIKO_SESSION_BROKER:{
   fetch:async(_,init)=>{
    assert.equal(init.headers["x-sh-broker-secret"],"local-test-secret");
    payload=JSON.parse(init.body);
    return new Response('{"ok":true}',{status:200,headers:{
     "content-type":"application/json","x-sh-broker-result":"upstream","x-sh-broker-cache":"1"
    }});
   }
  }}});
 assert.equal(Object.keys(bound).includes("_shBroker"),false);
 const r=await iikoText(bound,"/resto/api/v2/reports/olap");
 assert.equal(r.ok,true);assert.equal(r.auth.cacheHit,true);
 assert.equal(payload.tenantId,"workspace:org-a");
 assert.equal(payload.request.path,"/resto/api/v2/reports/olap");
});

test("broker rejects unauthenticated callers and non-allowlisted egress",async()=>{
 const workerEnv={...env,IIKO_BROKER_SERVICE_SECRET:"test-only-secret",
  IIKO_SESSIONS:{idFromName:x=>x,get:()=>({fetch:async()=>new Response("should not call")})}};
 const input={tenantId:"workspace:org-a",connection,action:"request",
   request:{path:"/resto/api/demo",method:"GET"}};
 const send=(secret,payload)=>brokerWorker.fetch(new Request("https://broker.internal/request",{
   method:"POST",headers:{"content-type":"application/json","x-sh-broker-secret":secret},
   body:JSON.stringify(payload)
 }),workerEnv);
 assert.equal((await send("incorrect",input)).status,403);
 assert.equal((await send("test-only-secret",{...input,connection:{...connection,ip:"unregistered.example"}})).status,403);
});

test("broker uses distinct Durable Objects for separate authorized workspaces",async()=>{
 const names=[];
 const workerEnv={...env,IIKO_BROKER_SERVICE_SECRET:"test-only-secret",
   IIKO_SESSIONS:{idFromName:key=>{names.push(key);return key},
    get:()=>({fetch:async()=>new Response("ok")})}};
 for(const tenantId of ["workspace:org-a","workspace:org-b"]){
  const result=await brokerWorker.fetch(new Request("https://broker.internal/request",{
    method:"POST",headers:{"x-sh-broker-secret":"test-only-secret"},
    body:JSON.stringify({tenantId,connection,action:"request",request:{path:"/resto/api/demo",method:"GET"}})
  }),workerEnv);
  assert.equal(result.status,200);
 }
 assert.equal(names.length,2);
 assert.notEqual(names[0],names[1]);
});

test("an unconfirmed authentication response cannot allocate another licensed seat",async()=>{
 let auth=0;
 const state={storage:storage()};
 const undo=installFetch(async url=>{
  if(new URL(String(url)).pathname.endsWith("/auth")){auth++;throw Error("proxy response lost")}
  return new Response("unreachable");
 });
 try{
  assert.equal((await new IikoSession(state,env).fetch(request())).status,503);
  assert.equal((await new IikoSession(state,env).fetch(request())).status,503);
  assert.equal(auth,1);
  assert.ok(Number(await state.storage.get("authBlockedUntil"))>Date.now()+60*60*1000);
 }finally{undo()}
});

test("iiko image proxy preserves binary bytes without decoding",async()=>{
 const expected=new Uint8Array([0,255,137,80,78,71,13,10,26,10]);
 let auth=0;
 const undo=installFetch(async url=>{
  const u=new URL(String(url));
  if(u.pathname.endsWith("/auth")){auth++;return new Response("token-image");}
  return new Response(expected,{status:200,headers:{"content-type":"image/png"}});
 });
 try{
  const object=new IikoSession({storage:storage()},env);
  const response=await object.fetch(request("request","/resto/api/v2/images/test"));
  assert.equal(response.headers.get("content-type"),"image/png");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()),expected);
  assert.equal(auth,1);
 }finally{undo()}
});

const postOlap=(name, body)=>new Request("https://broker.internal/request",{
 method:"POST",headers:{"content-type":"application/json"},
 body:JSON.stringify({tenantId:"workspace:org-a",connection,action:"request",
  request:{path:"/resto/api/v2/reports/olap",method:"POST",
    headers:{"content-type":"application/json"},body:JSON.stringify({query:name,...body})}})
});

test("slow OLAP request does not delay unrelated report on same licensed session",async()=>{
 let releaseSlow=()=>{};
 let slowReached=()=>{};
 const reached=new Promise(resolve=>{slowReached=resolve});
 const undo=installFetch(async url=>{
  const u=new URL(String(url));
  if(u.pathname.endsWith("/auth"))return new Response("one-token");
  if(u.pathname.endsWith("/olap") && u.searchParams.has("key")){
    // The distinct POST payloads identify the slow and fast reports.
    return new Response("fallback");
  }
  return new Response("fast");
 });
 // Override once to model a slow server call and ensure the token is shared.
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  const u=new URL(String(url));
  if(u.pathname.endsWith("/auth"))return new Response("one-token");
  if(JSON.parse(options.body).query==="slow"){
    slowReached();
    return new Promise(resolve=>{releaseSlow=()=>resolve(new Response("slow"))});
  }
  return new Response("fast");
 };
 try{
  const session=new IikoSession({storage:storage()},env);
  const slow=session.fetch(postOlap("slow"));
  await reached;
  const fast=session.fetch(postOlap("fast"));
  const outcome=await Promise.race([
    fast.then(async r=>({status:r.status,body:await r.text()})),
    new Promise(resolve=>setTimeout(()=>resolve({status:0}),300))
  ]);
  assert.equal(outcome.status,200,"fast request blocked by unrelated slow report");
  assert.equal(outcome.body,"fast");
  releaseSlow();
  assert.equal((await slow).status,200);
 }finally{releaseSlow();globalThis.fetch=originalFetch;undo()}
});

test("load: 100 independent report requests share one auth and a bounded parallel pool",async()=>{
 let auth=0,active=0,maxActive=0,completed=0;
 const undo=installFetch(async url=>{
  const u=new URL(String(url));
  if(u.pathname.endsWith("/auth")){auth++;return new Response("one-token")}
  active++;maxActive=Math.max(active,maxActive);
  await new Promise(resolve=>setTimeout(resolve,12));
  active--;completed++;
  return new Response("ok");
 });
 try{
  const broker=new IikoSession({storage:storage()},env);
  const responses=await Promise.all(Array.from({length:100},(_,i)=>broker.fetch(
    request("request","/resto/api/v2/reports/olap/unique-"+i))));
  assert.ok(responses.every(x=>x.status===200));
  assert.equal(auth,1);
  assert.equal(completed,100);
  assert.ok(maxActive>1,"no meaningful upstream parallelism");
  assert.ok(maxActive<=3,"upstream concurrency ceiling exceeded");
  assert.equal(broker.active,0);
  assert.equal(broker.waiting.length,0);
 }finally{undo()}
});

test("duplicate read-only OLAP queries coalesce without stale result caching",async()=>{
 let auth=0, data=0;
 const undo=installFetch(async(url)=>{
  const u=new URL(String(url));
  if(u.pathname.endsWith("/auth")){auth++;return new Response("one-token")}
  data++;
  await new Promise(resolve=>setTimeout(resolve,18));
  return new Response(JSON.stringify({rows:[{sum:42}]}),{headers:{"content-type":"application/json"}});
 });
 try{
  const broker=new IikoSession({storage:storage()},env);
  const all=await Promise.all(Array.from({length:18},()=>broker.fetch(postOlap("same",{date:"2026-10-22"}))));
  assert.equal(auth,1);
  assert.equal(data,1,"identical concurrent read must share a single iiko request");
  assert.deepEqual(new Set(await Promise.all(all.map(x=>x.text()))).size,1);
  assert.ok(all.some(x=>x.headers.get("x-sh-broker-coalesced")==="1"));
  await broker.fetch(postOlap("same",{date:"2026-10-22"}));
  assert.equal(data,2,"in-flight coalescing is not a stale cross-request cache");
 }finally{undo()}
});

test("simultaneous stale token 401 responses trigger exactly one license refresh",async()=>{
 let auth=0;
 const undo=installFetch(async url=>{
  const u=new URL(String(url));
  if(u.pathname.endsWith("/auth")){auth++;return new Response("token-"+auth)}
  if(u.searchParams.get("key")==="token-1" && u.pathname.endsWith("/expired")){
   await new Promise(resolve=>setTimeout(resolve,5));
   return new Response("expired",{status:401});
  }
  return new Response("ok");
 });
 try{
  const broker=new IikoSession({storage:storage()},env);
  assert.equal((await broker.fetch(request("request","/resto/api/demo"))).status,200);
  const replies=await Promise.all(Array.from({length:12},()=>broker.fetch(
    request("request","/resto/api/expired"))));
  assert.ok(replies.every(r=>r.status===200));
  assert.equal(auth,2);
 }finally{undo()}
});

test("bounded request admission rejects overload without allocating another token",async()=>{
 let auth=0;
 const pending=[];
 const undo=installFetch(async url=>{
  if(new URL(String(url)).pathname.endsWith("/auth")){auth++;return new Response("one-token")}
  return new Promise(resolve=>pending.push(()=>resolve(new Response("ok"))));
 });
 const waitUntil=async(predicate)=>{
  for(let i=0;i<150;i++){
   if(predicate())return;
   await new Promise(resolve=>setTimeout(resolve,1));
  }
  throw Error("Test server did not reach expected state");
 };
 try{
  const broker=new IikoSession({storage:storage()},{...env,
    IIKO_MAX_PARALLEL_REQUESTS:"1",IIKO_MAX_PENDING_REQUESTS:"1"});
  const first=broker.fetch(request("request","/resto/api/first"));
  await waitUntil(()=>pending.length===1);
  const second=broker.fetch(request("request","/resto/api/second"));
  await waitUntil(()=>broker.activities.size===2 && broker.waiting.length===1);
  const overflow=await broker.fetch(request("request","/resto/api/third"));
  assert.equal(overflow.status,429);
  assert.equal((await overflow.json()).code,"BROKER_BUSY");
  pending.shift()();
  assert.equal((await first).status,200);
  await waitUntil(()=>pending.length===1);
  pending.shift()();
  assert.equal((await second).status,200);
  assert.equal(auth,1);
 }finally{
  while(pending.length)pending.shift()();
  undo();
 }
});

test("broker requires exact, explicitly enabled, RBAC workspace ID",()=>{
 const e={IIKO_BROKER_ENABLED_WORKSPACES:"org-a,org-b"};
 assert.equal(isIikoBrokerPilot(e,"workspace:org-a"),true);
 assert.equal(isIikoBrokerPilot(e,"workspace:org-b"),true);
 assert.equal(isIikoBrokerPilot(e,"workspace:org"),false);
 assert.equal(isIikoBrokerPilot(e,"workspace:org-acme"),false);
 assert.equal(isIikoBrokerPilot(e,"org-a"),false);
 assert.equal(isIikoBrokerPilot({...e,IIKO_BROKER_ENABLED_WORKSPACES:"*"},"workspace:org-a"),true);
 assert.equal(isIikoBrokerPilot({...e,IIKO_BROKER_ENABLED_WORKSPACES:"*"},"workspace:org-b"),true);
 assert.equal(isIikoBrokerPilot({...e,IIKO_BROKER_ENABLED_WORKSPACES:"*"},"org-a"),false);
 assert.equal(isIikoBrokerPilot({...e,IIKO_BROKER_ENABLED_WORKSPACES:"*"},"workspace:"),false);
 assert.equal(isIikoBrokerPilot({},"workspace:org-a"),false);
});

test("binding alone never enables broker or silently falls back for an opted-in workspace",()=>{
 const stub={fetch:async()=>new Response("ok")};
 const opts={data:{shBrokerTenantId:"workspace:org-a",shBrokerVerifiedConnection:connection},
  env:{IIKO_SESSION_BROKER:stub,IIKO_BROKER_SERVICE_SECRET:"shared"}};
 assert.equal(bindIikoBroker(connection,opts),connection,"binding only is a no-op");
 assert.equal(bindWorkspaceIikoBroker(connection,opts.env,{allowed:true,workspace:{id:"org-a"}}),connection);
 assert.throws(()=>bindIikoBroker(connection,{
  ...opts,env:{IIKO_BROKER_ENABLED_WORKSPACES:"org-a"}
 }),/not fully configured/,"pilot workspace must never silently use direct auth");
 assert.throws(()=>bindWorkspaceIikoBroker(connection,{
  IIKO_BROKER_ENABLED_WORKSPACES:"org-a",IIKO_BROKER_SERVICE_SECRET:"shared"
 },{allowed:true,workspace:{id:"org-a"}}),/not fully configured/);
});

test("pilot broker ignores caller-supplied server credentials and requires verified saved connection",()=>{
 const e={IIKO_SESSION_BROKER:{fetch:async()=>new Response("ok")},
  IIKO_BROKER_SERVICE_SECRET:"shared",IIKO_BROKER_ENABLED_WORKSPACES:"org-a"};
 const untrusted={ip:"attacker.example",port:"8080",login:"attacker",password:"attack"};
 const context={env:e,data:{shBrokerTenantId:"workspace:org-a",
   shBrokerVerifiedConnection:connection}};
 const bound=bindIikoBroker(untrusted,context);
 assert.equal(bound.ip,connection.ip);
 assert.equal(bound.login,connection.login);
 assert.equal(bound.password,connection.password);
 assert.ok(bound._shBroker);
 assert.throws(()=>bindIikoBroker(untrusted,{env:e,data:{shBrokerTenantId:"workspace:org-a"}}),
  /requires server-stored workspace credentials/);
 const outsider=bindIikoBroker(untrusted,{env:e,data:{shBrokerTenantId:"workspace:org-b"}});
 assert.equal(outsider,untrusted,"non-pilot retains legacy path until explicitly migrated");
 const admin=bindIikoBroker(untrusted,{env:e,data:{
  shBrokerTenantId:"workspace:org-a",shBrokerBypass:true}});
 assert.equal(admin,untrusted,"connection-management route stays direct");
});

test("independent backend route uses only verified access workspace to opt in",()=>{
 const e={IIKO_SESSION_BROKER:{fetch:async()=>new Response("ok")},
  IIKO_BROKER_SERVICE_SECRET:"shared",IIKO_BROKER_ENABLED_WORKSPACES:"org-a"};
 const allowed={allowed:true,workspace:{id:"org-a"}};
 assert.ok(bindWorkspaceIikoBroker(connection,e,allowed)._shBroker);
 assert.equal(bindWorkspaceIikoBroker(connection,e,{allowed:true,workspace:{id:"org-b"}}),connection);
 assert.throws(()=>bindWorkspaceIikoBroker(connection,e,{
   allowed:false,workspace:{id:"org-a"}}),/requires verified workspace access/);
});

test("all-workspaces rollout is explicit, isolated, and fails closed if broker unavailable",()=>{
 const enabled={
  IIKO_BROKER_ENABLED_WORKSPACES:"*",
  IIKO_BROKER_SERVICE_SECRET:"shared",
  IIKO_SESSION_BROKER:{fetch:async()=>new Response("unused")}
 };
 const accessA={allowed:true,workspace:{id:"network-a"}};
 const accessB={allowed:true,workspace:{id:"network-b"}};
 const a=bindWorkspaceIikoBroker(connection,enabled,accessA);
 const b=bindWorkspaceIikoBroker(connection,enabled,accessB);
 assert.equal(a._shBroker.tenantId,"workspace:network-a");
 assert.equal(b._shBroker.tenantId,"workspace:network-b");
 assert.notEqual(a._shBroker.tenantId,b._shBroker.tenantId);
 assert.throws(()=>bindWorkspaceIikoBroker(connection,{
  IIKO_BROKER_ENABLED_WORKSPACES:"*"
 },accessA),/not fully configured/);
 assert.throws(()=>bindWorkspaceIikoBroker(connection,enabled,{
  allowed:false,workspace:{id:"network-a"}
 }),/requires verified workspace access/);
 assert.equal(bindIikoBroker(connection,{env:{...enabled,IIKO_BROKER_ENABLED_WORKSPACES:""},
  data:{shBrokerTenantId:"workspace:network-a"}}),connection);
});


test("hostname allowlist works with multiple iiko ports and no unrelated hosts",async()=>{
 const names=[];
 const workerEnv={...env,IIKO_BROKER_SERVICE_SECRET:"local-test-secret",
  IIKO_ALLOWED_TARGETS:"s01.smarthoreca.az",
  IIKO_SESSIONS:{idFromName:key=>key,get:()=>({fetch:async()=>{names.push("hit");return new Response("ok")}})}};
 const send=async(ip,port)=>brokerWorker.fetch(new Request("https://broker.internal/request",{
  method:"POST",headers:{"x-sh-broker-secret":"local-test-secret"},
  body:JSON.stringify({tenantId:"workspace:org-a",
    connection:{...connection,ip,port},action:"request",
    request:{path:"/resto/api/demo",method:"GET"}})
 }),workerEnv);
 assert.equal((await send("s01.smarthoreca.az","9132")).status,200);
 assert.equal((await send("s01.smarthoreca.az","8080")).status,200);
 assert.equal((await send("s02.smarthoreca.az","9132")).status,403);
 assert.equal(names.length,2);
});
test("specific host:port allowlist does not permit all ports",async()=>{
 const workerEnv={...env,IIKO_BROKER_SERVICE_SECRET:"local-test-secret",
  IIKO_ALLOWED_TARGETS:"s01.smarthoreca.az:9132",
  IIKO_SESSIONS:{idFromName:key=>key,get:()=>({fetch:async()=>new Response("ok")})}};
 const send=async port=>brokerWorker.fetch(new Request("https://broker.internal/request",{
   method:"POST",headers:{"x-sh-broker-secret":"local-test-secret"},
   body:JSON.stringify({tenantId:"workspace:org-a",
    connection:{...connection,ip:"s01.smarthoreca.az",port},
    action:"request",request:{path:"/resto/api/demo",method:"GET"}})
 }),workerEnv);
 assert.equal((await send("9132")).status,200);
 assert.equal((await send("8080")).status,403);
});

test("broker refuses invalid encryption keys BEFORE allocating a licensed session",async()=>{
 let upstreamCalls=0;
 const undo=installFetch(async()=>{upstreamCalls++;return new Response("token");});
 try {
  for(const key of ["bad-key",Buffer.alloc(16,1).toString("base64")]){
   const badEnv={...env,IIKO_BROKER_ENCRYPTION_KEY_B64:key};
   const reply=await new IikoSession({storage:storage()},badEnv).fetch(request());
   assert.equal(reply.status,503);
  }
  assert.equal(upstreamCalls,0,"invalid encryption must not consume a license slot");
 } finally {undo()}
});

test("outer private Worker validates encryption before entering the broker Durable Object",async()=>{
 let innerCalls=0;
 const badEnv={...env,IIKO_BROKER_SERVICE_SECRET:"auth-test-secret",
  IIKO_BROKER_ENCRYPTION_KEY_B64:"invalid",
  IIKO_SESSIONS:{idFromName:key=>key,get:()=>({
   fetch:async()=>{innerCalls++;return new Response("unexpected")}})}};
 const response=await brokerWorker.fetch(new Request("https://broker.internal/request",{
   method:"POST",headers:{"x-sh-broker-secret":"auth-test-secret"},
   body:JSON.stringify({tenantId:"workspace:org-a",connection,
      action:"request",request:{path:"/resto/api/demo",method:"GET"}})
 }),badEnv);
 assert.equal(response.status,503);
 assert.equal((await response.json()).code,"ENCRYPTION_CONFIG_INVALID");
 assert.equal(innerCalls,0);
});

test("broker defaults to one sequential iiko data request per credential",async()=>{
 let logins=0,active=0,max=0;
 const undo=installFetch(async url=>{
  const u=new URL(String(url));
  if(u.pathname.endsWith("/auth")){logins++;return new Response("t-1")}
  active++;max=Math.max(active,max);
  await Promise.resolve();await Promise.resolve();
  active--;return new Response("ok");
 });
 try {
  const session=new IikoSession({storage:storage()},env);
  const responses=await Promise.all(Array.from({length:10},()=>session.fetch(request())));
  assert.ok(responses.every(x=>x.ok));
  assert.equal(max,1);
  assert.equal(logins,1);
  assert.ok(responses.every(x=>x.headers.get("x-sh-broker-parallel")==="1"));
 } finally {undo()}
});
