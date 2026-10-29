import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const source=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const editor=source("qr-menu.js"), syncSource=source("qr-menu-sync-context.js");
const publisher=source("qr-menu-publish-context.js"), html=source("qr-menu.html");
const originalState={
  categories:[{id:"main",name:"Основные блюда",source:"local"}],
  dishes:[{id:"local_1",cat:"main",name:"Паста",price:10,source:"local"}],
  design:{name:"Restaurant R1"},active:"main"
};
const copy=value=>JSON.parse(JSON.stringify(value));
const chain=ids=>({
  identity:{mode:"CHAIN"},
  connection:{connectionType:"CHAIN",ip:"server",login:"demo"},
  departmentIds:ids
});

function menuStateHarness({selection=["r1"],selectedKey,stored={}}={}){
  let binding=chain(selection);
  const KEY="horeca_qr_menu_v1",key=selectedKey||KEY+":chain:"+selection.join(",");
  const values=new Map(Object.entries(stored));
  if(!values.has(key))values.set(key,JSON.stringify(originalState));
  let renderCount=0;
  const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,String(value))};
  const context={SH_IikoContext:{getBinding:async()=>binding}};
  const code=editor.slice(editor.indexOf("  function scopedStorageKey("),editor.indexOf("  async function init(){try{"));
  assert.ok(code.startsWith("  function scopedStorageKey("));
  const api=new Function("window","localStorage","KEY","render","initialState","selectedStorageKey",
    "let state=initialState,storageKey=selectedStorageKey;"+
    "function save(){localStorage.setItem(storageKey,JSON.stringify(state))}"+
    "function loadState(){state=JSON.parse(localStorage.getItem(storageKey)||'null')}"+
    code+"return window.SH_QRMenuState;"
  )(context,storage,KEY,()=>renderCount++,copy(originalState),key);
  return{api,values,setBinding:value=>{binding=value},get renderCount(){return renderCount}};
}

test("QR editor reads scoped restaurant menu, not another organization's legacy state",async()=>{
  const root=JSON.stringify({...originalState,design:{name:"OTHER ORGANIZATION"}});
  const h=menuStateHarness({stored:{"horeca_qr_menu_v1":root}});
  const s=await h.api.read(chain(["r1"]));
  assert.equal(s.design.name,"Restaurant R1");
  assert.equal(h.api.getStorageKey(),"horeca_qr_menu_v1:chain:r1");
  await h.api.update(chain(["r1"]),old=>({...old,design:{name:"Updated R1"}}));
  assert.equal(JSON.parse(h.values.get("horeca_qr_menu_v1:chain:r1")).design.name,"Updated R1");
  assert.equal(JSON.parse(h.values.get("horeca_qr_menu_v1")).design.name,"OTHER ORGANIZATION");
});

test("CHAIN QR Menu requires exactly one restaurant, even after selection changes",async()=>{
  const h=menuStateHarness({selection:["r1","r2"]});
  await assert.rejects(h.api.read(chain(["r1","r2"])),/ровно один ресторан/);
  const single=menuStateHarness();
  await assert.rejects(single.api.read(chain(["r2"])),/Выбранный ресторан изменился/);
});

test("QR editor refuses to save a previous restaurant when selection changed mid-request",async()=>{
  const h=menuStateHarness();
  await h.api.read(chain(["r1"]));
  h.setBinding(chain(["r2"]));
  await assert.rejects(h.api.update(chain(["r1"]),()=>({...originalState,design:{name:"WRONG NETWORK"}})),/Ресторан изменился/);
  assert.equal(JSON.parse(h.values.get("horeca_qr_menu_v1:chain:r1")).design.name,"Restaurant R1");
  assert.equal(h.values.has("horeca_qr_menu_v1:chain:r2"),false);
});

function syncHarness(){
  const legacy={categories:[],dishes:[],design:{name:"Another restaurant"}};
  let state=copy(originalState),calls=0,reads=0,updates=0;
  const alerts=[];
  const window={
    SH_IikoContext:{getBinding:async()=>chain(["r1"])},
    SH_QRMenuState:{
      read:async()=>{reads++;return copy(state)},
      update:async(_binding,transform)=>{updates++;state=transform(copy(state));return copy(state)}
    }
  };
  const response={
    ok:true,json:async()=>({success:true,productCount:1,
      categories:[{iikoId:"cat",name:"Горячее",sortOrder:1}],
      products:[{id:"item",categoryId:"cat",name:"Суп",price:5}]})
  };
  const listeners=[];
  const button={disabled:false,textContent:"Синхронизировать"};
  const sandbox={window,fetch:async(url,init)=>{
    calls++;assert.equal(init.method,"POST");assert.equal(url,"/api/iiko/qr-menu");
    return response;
  },document:{addEventListener(type,cb,capture){listeners.push({type,cb,capture})}},
  alert:message=>alerts.push(message),setTimeout:()=>{throw Error("reload timer not allowed")},
  location:{reload:()=>{throw Error("sync must not reload")}},
  localStorage:{getItem:()=>JSON.stringify(legacy),setItem(){throw Error("legacy key must not be written")}}};
  runInNewContext(syncSource,sandbox);
  const listener=listeners.find(x=>x.type==="click"&&x.capture===true);
  async function click(){
    listener.cb({target:{closest:selector=>selector==="#syncBtn"?button:null},
      preventDefault(){},stopImmediatePropagation(){}});
    for(let i=0;i<24;i++)await Promise.resolve();
  }
  return{click,state:()=>state,calls:()=>calls,reads:()=>reads,updates:()=>updates,alerts,button};
}

test("QR sync merges remote dishes into live scoped menu without reload",async()=>{
  const h=syncHarness();
  await h.click();
  assert.equal(h.alerts.length,0);
  assert.equal(h.calls(),1);assert.equal(h.reads(),1);assert.equal(h.updates(),1);
  const names=h.state().dishes.map(d=>d.name);
  assert.ok(names.includes("Паста"));
  assert.ok(names.includes("Суп"));
  assert.equal(h.button.disabled,false);
  assert.match(h.button.textContent,/1 блюд/);
});

test("Publication also uses verified editor state, never legacy global menu storage",()=>{
  assert.match(publisher,/await readMenuState\(binding\)/);
  assert.match(publisher,/saveMenuState\(binding, current =>/);
  assert.match(publisher,/window\.SH_QRMenuState\.update\(binding, updater\)/);
  assert.doesNotMatch(publisher,/localStorage\.getItem\(MENU_KEY\)|localStorage\.setItem\(MENU_KEY|location\.reload\(\)/);
  assert.doesNotMatch(syncSource,/localStorage\.getItem|localStorage\.setItem|location\.reload\(\)/);
  assert.match(html,/qr-menu\.js\?v=20261029-scoped-menu1/);
  assert.match(html,/qr-menu-publish-context\.js\?v=20261029-scoped-menu1/);
  assert.match(publisher,/qr-menu-sync-context\.js\?v=20261029-restaurant-scoped1/);
});

test("Sync and publish keep original QR-only server API endpoints",()=>{
  assert.match(syncSource,/\/api\/iiko\/qr-menu/);
  assert.match(publisher,/\/api\/qr-menu\/publish/);
  assert.doesNotMatch(syncSource+publisher,/\/api\/orders|\/api\/payments|\/api\/iiko\/document-action/);
});
