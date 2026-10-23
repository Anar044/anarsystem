import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {ownerBrokerContext,MobileError} from "../functions/api/mobile/_lib/context.js";
import {bindWorkspaceIikoBroker,iikoText} from "../functions/api/iiko/_lib/iiko-client.js";

const conn={ip:"iiko.example",port:"8080",login:"private",password:"server-only"};
const verified={access:{allowed:true,workspace:{id:"org-1"}},connection:conn};
const enabled={IIKO_BROKER_ENABLED_WORKSPACES:"org-1",
  IIKO_BROKER_SERVICE_SECRET:"private-service",
  IIKO_SESSION_BROKER:{fetch:async(_,init)=>{
    const message=JSON.parse(init.body);
    assert.equal(message.tenantId,"workspace:org-1");
    assert.equal(message.connection.login,"private");
    return new Response("ok",{headers:{"x-sh-broker-result":"upstream"}});
  }}};

test("verified owner workspace shares a private broker session with web",async()=>{
  const delegate=ownerBrokerContext(verified,enabled);
  assert.equal(delegate.data.shBrokerTenantId,"workspace:org-1");
  assert.equal(delegate.data.shBrokerVerifiedConnection,conn);
  const bound=bindWorkspaceIikoBroker(conn,enabled,verified.access);
  const out=await iikoText(bound,"/resto/api/corporation/departments");
  assert.equal(out.text,"ok");
  assert.equal(out.auth.viaBroker,true);
});
test("unverified workspace cannot delegate backend iiko requests",()=>{
  for(const ctx of [
    {connection:conn,access:{allowed:false,workspace:{id:"org-1"}}},
    {connection:conn,access:{allowed:true,workspace:{id:""}}},
    {connection:null,access:{allowed:true,workspace:{id:"org-1"}}}
  ]){
    assert.throws(()=>ownerBrokerContext(ctx,enabled),e=>e instanceof MobileError&&e.status===403);
  }
});
test("selected production broker has no silent fallback to direct /auth",()=>{
  assert.throws(()=>bindWorkspaceIikoBroker(conn,{
    IIKO_BROKER_ENABLED_WORKSPACES:"org-1"
  },verified.access),/not fully configured/);
  assert.equal(bindWorkspaceIikoBroker(conn,{
    IIKO_BROKER_ENABLED_WORKSPACES:""
  },verified.access),conn);
});
test("all Owner delegated REST API routes carry verified broker context",()=>{
  for(const file of ["summary","alerts","inventory","movements","pnl","shift"]){
    const src=readFileSync(resolve("functions/api/mobile/v1",file+".js"),"utf8");
    assert.match(src,/ownerBrokerContext\(ctx,env\)/,file);
  }
  for(const file of ["dashboard-summary","stock-balances","stock-movements","pnl","cash-shift-detail"]){
    const src=readFileSync(resolve("functions/api/iiko",file+".js"),"utf8");
    assert.match(src,/bindIikoBroker\(/,file);
  }
  for(const file of ["orders","report","receipt","shifts"]){
    const src=readFileSync(resolve("functions/api/mobile/v1",file+".js"),"utf8");
    assert.match(src,/ctx\.connection/,file);
  }
});
