import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {webcrypto} from "node:crypto";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const stripImports=source=>source.replace(/^import[\s\S]*?from\s+["'][^"']+["'];/gm,"")
  .replace(/\bexport\s+(?=(?:async\s+)?(?:function|const|class|let|var))/g,"");
const route=read("functions/api/ai-assistant.js");
function functions(){
  return new Function("crypto","TextEncoder",stripImports(route)+
    "\nreturn {conversationScopeKey,validateAiRequestId,checkAiCancelled};")(webcrypto,TextEncoder);
}
const access={allowed:true,workspace:{id:"orgA-ws"},storageUserId:"platform-org:A",permissions:["assistant.use"]};
const server={ip:"server-host",port:"8080",login:"account",password:"secret"};
const make=(overrides={})=>({
  connected:true,access:{...access,...overrides.access},connection:{...server,...overrides.connection},
  scope:{mode:"RMS",isChain:false,selectedDepartmentIds:["rest1"],...overrides.scope}
});

test("same user in different organizations and servers has isolated conversation keys",async()=>{
  const {conversationScopeKey:key}=functions();
  const a=await key(make());
  const b=await key(make({access:{workspace:{id:"orgB-ws"},storageUserId:"platform-org:B"}}));
  const c=await key(make({connection:{ip:"another-host"}}));
  const rotated=await key(make({connection:{password:"other-password"}}));
  const d=await key(make({scope:{isChain:true,mode:"CHAIN",selectedDepartmentIds:["rest2"]}}));
  const equivalent=await key(make({scope:{isChain:true,mode:"CHAIN",selectedDepartmentIds:["rest2","rest1","rest1"]}}));
  const equivalentReverse=await key(make({scope:{isChain:true,mode:"CHAIN",selectedDepartmentIds:["rest1","rest2"]}}));
  assert.match(a,/^ai-v3:[0-9a-f]{64}$/);
  assert.equal(new Set([a,b,c,d,rotated]).size,5);
  assert.equal(equivalent,equivalentReverse);
  assert.ok(!a.includes("secret"));
  assert.ok(!rotated.includes("other-password"));
});

test("tenant key fails closed without verified workspace, connection or CHAIN selection",async()=>{
  const {conversationScopeKey:key}=functions();
  for(const bad of [
    make({access:{workspace:null}}),
    make({access:{storageUserId:""}}),
    make({connection:{login:""}}),
    {...make(),connected:false},
    make({scope:{isChain:true,mode:"CHAIN",selectedDepartmentIds:[]}})
  ])await assert.rejects(()=>key(bad),e=>e.status===403);
  assert.doesNotMatch(route,/if\(!scope\?\.isChain\)return ""/);
  assert.match(route,/await conversationScopeKey\(iiko\)/);
});

test("Stop flag is scoped by request UUID, user ID and workspace scope",async()=>{
  const {validateAiRequestId,checkAiCancelled}=functions();
  const id="a8a591fa-b734-43f9-b2aa-0f62f7f73c44";
  assert.equal(validateAiRequestId(id),id);
  assert.equal(validateAiRequestId("an-invalid-id"),"");
  const seen=[];
  const db={prepare(sql){return{
    bind(...values){seen.push({sql,values});return{
      async first(){return values[1]==="userA"&&values[2]==="scopeA"?{request_id:id}:null;}
    }}
  }}};
  await assert.rejects(()=>checkAiCancelled(db,"userA","scopeA",id),e=>e.code==="AI_REQUEST_CANCELLED");
  await checkAiCancelled(db,"userA","scopeB",id);
  await checkAiCancelled(db,"userB","scopeA",id);
  assert.ok(seen.every(x=>x.values.length===3));
  await assert.rejects(()=>checkAiCancelled(db,"userB","scopeB",id,{aborted:true}),e=>e.code==="AI_REQUEST_CANCELLED");
  assert.match(route,/action === "cancelRequest"/);
  assert.match(route,/await guard\(\);\s*await saveMessage/);
  assert.match(route,/markCancelledUserPrompt/);
  assert.match(route,/history\.filter\(message=>message\.meta\?\.cancelled!==true\)/);
  assert.match(route,/openAiResponse\(env, \{/);
});

function toolsHarness(){
  const source=stripImports(read("functions/api/iiko/_lib/ai-assistant-tools.js"));
  const synced=[];
  const mock={
    clean:value=>String(value??"").trim(),
    iikoReferenceScope:()=> "http://shared-server:8080",
    syncReferences:async(...params)=>{synced.push(params);return{maps:{products:new Map([["p1","Томаты"]]),warehouses:new Map(),suppliers:new Map()}}},
    getIikoSuppliers:async()=>({rows:[{id:"sup",name:"Поставщик"}]}),
    iikoJson:async(_c,path)=>{
      if(path.includes("accounts/list"))return{ok:true,payload:[{id:"acc",type:"ACCOUNTS_PAYABLE"}]};
      return{ok:true,payload:[{counteragent:{id:"sup"},account:{id:"acc"},sum:9999}]};
    },
    iikoText:async()=>({ok:false,status:404,text:""}),
    resolveStoreScope:async()=>({resolved:true,storeIds:["storeA"]})
  };
  const get=new Function(...Object.keys(mock),source+"\nreturn {executeAssistantTool,supplierBalances};");
  return {...get(...Object.values(mock)),synced};
}
test("AI reference dictionaries are segregated by workspace even on identical server URL",async()=>{
  const harness=toolsHarness();
  const scope={mode:"CHAIN",isChain:true,selectedDepartmentIds:["rest1"],allowedDepartmentIds:["rest1","rest2"]};
  const a=await harness.executeAssistantTool("search_products",{query:"Томаты",limit:10},{env:{},connection:server,scope,access});
  const b=await harness.executeAssistantTool("search_products",{query:"Томаты",limit:10},{env:{},connection:server,scope,access:{...access,workspace:{id:"orgB-ws"}}});
  assert.ok(a.products.length);
  assert.ok(b.products.length);
  assert.equal(harness.synced.length,2);
  assert.notEqual(harness.synced[0][3],harness.synced[1][3]);
  assert.ok(harness.synced.every(entry=>entry[3].includes("ai-v2")));
});

test("AI rejects supplier balances when department ownership cannot be proven",async()=>{
  const harness=toolsHarness();
  const result=await harness.executeAssistantTool("get_supplier_balances",{supplier_query:"",timestamp:"2026-10-19T23:59:59"},{
    env:{},connection:server,
    scope:{isChain:true,selectedDepartmentIds:["rest1"],allowedDepartmentIds:["rest1","rest2"]},
    access
  });
  assert.equal(result.code,"CHAIN_BALANCE_SCOPE_UNVERIFIED");
  assert.equal(result.rows,undefined);
});

test("Client exposes Stop while busy and cancels server-side request",()=>{
  const js=read("ai-assistant.js"),html=read("ai-assistant.html");
  assert.match(js,/button\.textContent=running\?'■ Стоп':'Отправить'/);
  assert.match(js,/request\.controller\.abort\(\)/);
  assert.match(js,/action:'cancelRequest',requestId:request\.id/);
  assert.match(js,/fetch\('\/api\/ai-assistant',\{\.\.\.requestOptions,signal\}/);
  assert.match(html,/ai-assistant\.js\?v=10/);
});
