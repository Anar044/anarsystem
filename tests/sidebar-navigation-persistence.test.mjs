import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const shell=readFileSync(resolve(root,"app-shell.js"),"utf8");
const access=readFileSync(resolve(root,"site-access.js"),"utf8");
const legacy=readFileSync(resolve(root,"documents-nav.js"),"utf8");
function navigationFactory(){
  const a=shell.indexOf("  const NAV_STATE_KEY='shUnifiedSidebarStateV1';");
  const b=shell.indexOf("  function syncNavGroup(",a);
  assert.ok(a>0&&b>a,"state helper must exist above syncNavGroup");
  return new Function("sessionStorage","document",shell.slice(a,b)+
    "\nreturn {state:savedNavState,rememberSidebarNavigation,restoreSidebarScroll,navGroupKey};");
}
function mockGroup(key,open,{hidden=false}={}){
  const classes=new Set([key,...open?["open"]:[]]);
  return {hidden,classList:{contains:k=>classes.has(k)},querySelector:()=>({dataset:{unifiedNavItem:key}})};
}
function instance(storage,groups,scrollTop=0){
  const sidebar={scrollTop,querySelectorAll:()=>groups};
  const document={querySelector:query=>query===".sidebar"?sidebar:null};
  return {...navigationFactory()(storage,document),sidebar};
}
test("expanded menu groups and sidebar scroll survive full-page navigation",()=>{
  const db=new Map();
  const storage={getItem:key=>db.get(key)||null,setItem:(key,value)=>db.set(key,value)};
  const group1=mockGroup("procurement-nav-group",true);
  const group2=mockGroup("internal-orders-nav-group",false);
  const first=instance(storage,[group1,group2],240);
  first.rememberSidebarNavigation();
  const saved=JSON.parse(db.get("shUnifiedSidebarStateV1"));
  assert.equal(saved.groups.procurement,true);
  assert.equal(saved.groups["internal-orders"],false);
  assert.equal(saved.scrollTop,240);
  const next=instance(storage,[group1,group2],0);
  assert.equal(next.state.groups.procurement,true);
  assert.equal(next.state.groups["internal-orders"],false);
  next.restoreSidebarScroll();
  assert.equal(next.sidebar.scrollTop,240);
});
test("permission-hidden menu groups cannot erase saved choices",()=>{
  const values=new Map([["shUnifiedSidebarStateV1",JSON.stringify({groups:{procurement:true},scrollTop:56})]]);
  const storage={getItem:key=>values.get(key),setItem:(key,val)=>values.set(key,val)};
  const hidden=mockGroup("procurement-nav-group",false,{hidden:true});
  const visible=mockGroup("internal-orders-nav-group",true);
  instance(storage,[hidden,visible],56).rememberSidebarNavigation();
  const next=JSON.parse(values.get("shUnifiedSidebarStateV1"));
  assert.equal(next.groups.procurement,true);
  assert.equal(next.groups["internal-orders"],true);
});
test("failed/blocked session storage is tolerated",()=>{
  const storage={getItem(){throw Error("blocked")},setItem(){throw Error("blocked")}};
  const sidebar=instance(storage,[mockGroup("reports-nav-group",true)],90);
  sidebar.rememberSidebarNavigation();
  assert.equal(sidebar.state.groups.reports,true);
});
test("the access gate exposes sidebar only after all links are checked",()=>{
  assert.match(shell,/addEventListener\('sh:access-visibility-ready',showCompletedNavigation/);
  assert.match(access,/guardCurrentPage\(\);applyVisibility\(document\);installWorkspaceSwitcher\(\)/);
  assert.match(access,/dispatchEvent\(new Event\('sh:access-visibility-ready'\)\)/);
});
test("legacy HR menu cannot forcibly collapse other sections",()=>{
  assert.doesNotMatch(legacy,/if\(g===group\)return;g\.classList\.remove\('open'\)/);
});
