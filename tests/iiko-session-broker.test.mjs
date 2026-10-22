import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { IikoSession } from "../services/iiko-session-broker/src/worker.mjs";
import { bindIikoBroker, iikoText, clearIikoClientCache } from "../functions/api/iiko/_lib/iiko-client.js";
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
  if(u.pathname.endsWith("/auth"))return new Response("token-"+(++auth));
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
 const bound=bindIikoBroker(connection,{data:{shBrokerTenantId:"workspace:org-a"},
  env:{IIKO_BROKER_SERVICE_SECRET:"local-test-secret",IIKO_SESSION_BROKER:{
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
