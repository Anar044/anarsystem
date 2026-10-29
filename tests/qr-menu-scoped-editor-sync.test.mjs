import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const syncSource=read("qr-menu-sync-context.js");
const publishSource=read("qr-menu-publish-context.js");
const editorSource=read("qr-menu.js");
const html=read("qr-menu.html");

const baseState=()=>({
  active:"local",
  design:{name:"Restaurant A",accent:"#111"},
  categories:[{id:"local",name:"Local Specials",source:"local"}],
  dishes:[{id:"house",cat:"local",name:"House Special",price:20,source:"local"}]
});
const binding=(id="r1",other={})=>({
  connection:{ip:"example",login:"user"},
  identity:{mode:"CHAIN",restaurantName:"Restaurant A"},
  departmentIds:[id],...other
});
function makeEditor(id="r1",initial=baseState()){
  let state=structuredClone(initial);
  let writes=0;
  const editor={
    getState:()=>state,
    getScope:()=>({restaurantId:id,departmentIds:[id],mode:"CHAIN",storageKey:"horeca_qr_menu_v1:chain:"+id}),
    replaceFromSync:next=>{state=next;writes++},
    setPublishedInfo:meta=>{state={...state,...meta};writes++}
  };
  return{editor,get state(){return state},get writes(){return writes}};
}
function makeHarness(source,{id="r1",configured=true,api={success:true,categories:[{iikoId:"g1",name:"Mains"}],products:[{id:"p1",categoryId:"g1",name:"Steak",price:30}],productCount:1},publish=false}={}){
  const alerts=[],requests=[],listeners={},editorHolder=makeEditor();
  const active=()=>binding(id);
  const button={textContent:"Синхронизировать",disabled:false};
  const saveStatus={textContent:""};
  const fetchStub=async(url,options)=>{
    requests.push({url,options});
    return {ok:api.success!==false,status:api.success===false?400:200,json:async()=>publish?{
      success:true,publicUrl:"https://example.test/menu.html?id=pub1",organizationId:"r1"
    }:api};
  };
  const window={
    SH_QRMenuEditor:configured?editorHolder.editor:null,
    SH_IikoContext:{getBinding:async()=>active(),fetchWithTimeout:fetchStub},
    SHAuth:{createClient:async()=>({auth:{getSession:async()=>({data:{session:{access_token:"testtoken"}}})}})},
    addEventListener(name,handler){listeners[name]=handler},
    SH_QRMenuSyncContextLoaded:false
  };
  const document={
    readyState:"loading",
    getElementById(key){
      if(key==="saveStatus")return saveStatus;
      if(key==="qr-publish-result-style")return {id:key}; // existing styling in the DOM
      return null
    },
    addEventListener(name,handler){listeners[name]=handler},
  };
  const localStorage={getItem(){throw Error("LEGACY GLOBAL STORAGE MUST NOT BE READ")},setItem(){throw Error("LEGACY GLOBAL STORAGE MUST NOT BE WRITTEN")}};
  const context={window,document,localStorage,fetch:fetchStub,alert:m=>alerts.push(m),console:{warn(){}},
    location:{reload(){throw Error("Navigation must remain stable")}},setTimeout(){throw Error("No reload timers")},
    Map,Set,Date,JSON,Number,String,Error};
  const exposed=publish?"publish":"sync";
  const appended=source.replace(/\}\)\(\);\s*$/,"window.__testAction="+exposed+";})();");
  assert.notEqual(appended,source);
  vm.runInNewContext(appended,context);
  return {context,window,button,editorHolder,requests,alerts,saveStatus,
    action:async()=>window.__testAction(button)};
}

test("Editor owns active scoped in-memory menu; no legacy key is exposed",()=>{
  assert.match(editorSource,/window\.SH_QRMenuEditor=Object\.freeze/);
  assert.match(editorSource,/getState:\(\)=>state/);
  assert.match(editorSource,/replaceFromSync\(next\)/);
  assert.match(editorSource,/storageKey/);
  assert.match(html,/qr-menu\.js\?v=20261029-scoped-editor1/);
  assert.match(html,/qr-menu-publish-context\.js\?v=20261029-scoped-publish1/);
});
test("New unsaved restaurant menu synchronizes without global localStorage",async()=>{
  const h=makeHarness(syncSource);
  assert.equal(h.editorHolder.state.dishes.length,1);
  await h.action();
  assert.equal(h.requests.length,1);
  assert.equal(h.editorHolder.writes,1);
  assert.ok(h.editorHolder.state.dishes.some(x=>x.id==="house"));
  assert.ok(h.editorHolder.state.dishes.some(x=>x.id==="iiko_p1"));
  assert.equal(h.editorHolder.state.design.name,"Restaurant A");
  assert.equal(h.button.disabled,false);
  assert.equal(h.alerts.length,0);
  assert.match(h.saveStatus.textContent,/Меню синхронизировано/);
});
test("Sync is rejected before API request when editor is not ready",async()=>{
  const h=makeHarness(syncSource,{configured:false});
  await h.action();
  assert.equal(h.requests.length,0);
  assert.match(h.alerts[0],/Контекст QR Menu ещё не загружен/);
});
test("Sync cannot edit menu of another restaurant even if user has access",async()=>{
  const h=makeHarness(syncSource,{id:"r2"});
  await h.action();
  assert.equal(h.requests.length,0);
  assert.equal(h.editorHolder.writes,0);
  assert.match(h.alerts[0],/Выбор ресторана изменился/);
});
test("Sync refuses CHAIN selection with multiple restaurants instead of mixing catalogues",async()=>{
  const h=makeHarness(syncSource);
  h.window.SH_IikoContext.getBinding=async()=>binding("r1",{departmentIds:["r1","r2"]});
  await h.action();
  assert.equal(h.requests.length,0);
  assert.match(h.alerts[0],/ровно один ресторан/);
});
test("Publish also uses in-memory restaurant state, not a shared global key",async()=>{
  const h=makeHarness(publishSource,{publish:true});
  await h.action();
  assert.equal(h.requests.length,1);
  const data=JSON.parse(h.requests[0].options.body);
  assert.equal(data.departmentIds[0],"r1");
  assert.equal(data.menu.dishes[0].name,"House Special");
  assert.equal(h.editorHolder.state.publicUrl,"https://example.test/menu.html?id=pub1");
  assert.equal(h.editorHolder.writes,1);
  assert.equal(h.button.disabled,false);
  assert.equal(h.alerts.length,0);
});
test("Publish refuses cross-restaurant context before any write",async()=>{
  const h=makeHarness(publishSource,{id:"r2",publish:true});
  await h.action();
  assert.equal(h.requests.length,0);
  assert.equal(h.editorHolder.writes,0);
  assert.match(h.alerts[0],/Выбор ресторана изменился/);
});
test("No accidental global key or reload in sync/publish controllers",()=>{
  for(const source of [syncSource,publishSource]){
    assert.doesNotMatch(source,/localStorage\.(getItem|setItem)\(MENU_KEY/);
    assert.doesNotMatch(source,/location\.reload\(/);
  }
});
