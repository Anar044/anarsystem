import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const uiSource=readFileSync(new URL("../plugin-events.js",import.meta.url),"utf8");
const apiSource=readFileSync(new URL("../functions/api/plugin/events.js",import.meta.url),"utf8");

function harness(statuses){
  const elements=new Map(),listeners=new Map(),requests=[];
  const element=id=>{
    if(!elements.has(id)){
      elements.set(id,{
        value:"",textContent:id.endsWith("count")?"0":"",
        innerHTML:"",
        classList:{add(){},remove(){},toggle(){}},
        addEventListener(){},
      });
    }
    return elements.get(id);
  };
  const client={
    auth:{
      async getSession(){return {data:{session:{access_token:"original"}},error:null};},
      async refreshSession(){return {data:{session:{access_token:"refreshed"}},error:null};}
    }
  };
  let createClientCalls=0;
  const window={
    SH_AUTH_CONFIG:{},
    SH_CURRENT_USER:null,
    SHAuth:{async createClient(){createClientCalls++;return client;}},
    SH_IikoContext:{
      async getBinding(){return {departmentIds:[]};},
      async fetchWithTimeout(url,options){
        requests.push({url,authorization:options.headers.Authorization});
        const status=statuses[Math.min(requests.length-1,statuses.length-1)];
        return {status,ok:status===200,
          async json(){return status===200?{success:true,events:[]}:
            {success:false,error:"Invalid or expired session"};}};
      }
    }
  };
  const document={
    visibilityState:"hidden",
    addEventListener(name,callback){listeners.set(name,callback);},
    getElementById:element,
    querySelectorAll(){return [];}
  };
  vm.runInNewContext(uiSource,{window,document,URLSearchParams,
    setTimeout(){},setInterval(){},clearInterval(){}});
  listeners.get("DOMContentLoaded")();
  return {requests,elements,run:()=>listeners.get("sh-auth-ready")(),
    get createClientCalls(){return createClientCalls;}};
}

test("plugin event API uses shared authenticated user validation",()=>{
  assert.match(apiSource,/import \{ getUser, loadRequestIikoState \} from/);
  assert.match(apiSource,/await getUser\(context\.request, context\.env\)/);
  assert.doesNotMatch(apiSource,/getAuthenticatedUser/);
});

test("expired journal token refreshes once using the site's client",async()=>{
  const app=harness([401,200]);
  await app.run();
  assert.deepEqual(app.requests.map(x=>x.authorization),
    ["Bearer original","Bearer refreshed"]);
  assert.equal(app.requests.length,2);
  assert.equal(app.createClientCalls,2);
  assert.equal(app.elements.get("event-count").textContent,0);
  assert.match(app.elements.get("load-status").textContent,/Обновлено/);
});

test("persistent 401 does not invent zero plugin events",async()=>{
  const app=harness([401,401]);
  await app.run();
  assert.equal(app.requests.length,2);
  assert.equal(app.elements.get("event-count").textContent,"—");
  assert.match(app.elements.get("events-list").innerHTML,/HTTP 401/);
  assert.match(app.elements.get("load-status").textContent,/Ошибка загрузки/);
});
