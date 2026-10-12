import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const shell=readFileSync(resolve(root,"app-shell.js"),"utf8");
const access=readFileSync(resolve(root,"site-access.js"),"utf8");
const legacy=readFileSync(resolve(root,"documents-nav.js"),"utf8");
const css=readFileSync(resolve(root,"app-shell.css"),"utf8");
function navigationFactory(){
  const a=shell.indexOf("  const NAV_STATE_KEY='shUnifiedSidebarStateV1';");
  const b=shell.indexOf("  function syncNavGroup(",a);
  assert.ok(a>0&&b>a,"persistent menu helpers must remain");
  return new Function("sessionStorage","document",shell.slice(a,b)+
    "\nreturn {state:savedNavState,rememberSidebarNavigation,restoreSidebarScroll};");
}
function mockGroup(key,open,{hidden=false}={}){
  const classes=new Set([key,...(open?["open"]:[])]);
  return {hidden,classList:{contains:k=>classes.has(k)},querySelector:()=>({dataset:{unifiedNavItem:key}})};
}
function instance(storage,groups,scrollTop=0){
  const sidebar={scrollTop,querySelectorAll:()=>groups};
  const document={querySelector:query=>query===".sidebar"?sidebar:null};
  return {...navigationFactory()(storage,document),sidebar};
}
test("expanded groups and sidebar scroll survive navigation",()=>{
  const db=new Map();
  const storage={getItem:key=>db.get(key)||null,setItem:(key,value)=>db.set(key,value)};
  const first=instance(storage,[mockGroup("procurement-nav-group",true),mockGroup("internal-orders-nav-group",false)],240);
  first.rememberSidebarNavigation();
  const saved=JSON.parse(db.get("shUnifiedSidebarStateV1"));
  assert.equal(saved.groups.procurement,true);
  assert.equal(saved.groups["internal-orders"],false);
  const second=instance(storage,[],0);
  second.restoreSidebarScroll();
  assert.equal(second.sidebar.scrollTop,240);
});
test("hidden/unauthorized groups cannot overwrite saved expansion preferences",()=>{
  const db=new Map([["shUnifiedSidebarStateV1",JSON.stringify({groups:{procurement:true},scrollTop:56})]]);
  const storage={getItem:key=>db.get(key),setItem:(key,value)=>db.set(key,value)};
  instance(storage,[mockGroup("procurement-nav-group",false,{hidden:true})],56).rememberSidebarNavigation();
  assert.equal(JSON.parse(db.get("shUnifiedSidebarStateV1")).groups.procurement,true);
});
test("blocked session storage does not break the menu",()=>{
  const storage={getItem(){throw Error("blocked")},setItem(){throw Error("blocked")}};
  const state=instance(storage,[mockGroup("reports-nav-group",true)],80);
  state.rememberSidebarNavigation();
  assert.equal(state.state.groups.reports,true);
});
test("first paint does not wait on asynchronous access check",()=>{
  const init=shell.slice(shell.indexOf("  function init(){"),shell.indexOf("\n  init();"));
  assert.match(init,/buildUnifiedSidebar\(\)/);
  assert.match(init,/restoreSidebarScroll\(\);\s*reveal\(\)/);
  assert.doesNotMatch(init,/sh:access-visibility-ready|showCompletedNavigation|finishPageNavigationTransition/);
  assert.match(access,/guardCurrentPage\(\);applyVisibility\(document\);installWorkspaceSwitcher\(\)/);
});
test("long full-page navigation overlays and delays are removed",()=>{
  assert.doesNotMatch(css,/@view-transition|shNavKeepOld|Загрузка раздела/);
  assert.doesNotMatch(css,/4200ms/);
  assert.doesNotMatch(shell,/prefetchSidebarLink|skipTransition\(\)/);
});
test("the legacy HR menu cannot collapse sibling sections",()=>{
  assert.doesNotMatch(legacy,/if\(g===group\)return;g\.classList\.remove\('open'\)/);
});

test("persistent demo navigates separate HTML documents without rebuilding sidebar",()=>{
  const demo=readFileSync(resolve(root,"sidebar-persistent-demo.html"),"utf8");
  for(const page of ["a","b"]){
    const content=readFileSync(resolve(root,"sidebar-persistent-demo-page-"+page+".html"),"utf8");
    assert.match(content,/<title>Smart Horeca — демонстрационный рабочий раздел/);
    assert.doesNotMatch(content,/<script[^>]+(?:auth\.js|site-access\.js|supabase)/);
    assert.doesNotMatch(content,/fetch\s*\(/);
  }
  assert.match(demo,/<aside class="sidebar"><\/aside>/);
  assert.match(demo,/<iframe class="persistent-demo-frame"/);
  assert.match(demo,/<style id="sh-persistent-demo-style">/);
  assert.match(shell,/style\.id!==\x27sh-persistent-demo-style\x27/);
  assert.match(demo,/\.persistent-demo-frame\{position:absolute;inset:0;/);
  assert.match(demo,/\.persistent-demo-frame-host\{position:relative;display:block;/);
  assert.match(demo,/sidebar\.addEventListener\('click'/);
  assert.match(demo,/event\.preventDefault\(\)/);
  assert.match(demo,/host\.appendChild\(next\)/);
  assert.match(demo,/currentFrame\.remove\(\)/);
  assert.match(demo,/window\.addEventListener\('popstate'/);
  assert.doesNotMatch(demo,/location\.(assign|replace|reload)\(/);
  assert.doesNotMatch(demo,/<script[^>]+(?:auth\.js|site-access\.js|supabase)/);
  assert.doesNotMatch(demo,/fetch\s*\(/);
  assert.doesNotMatch(demo,/data-protected="true"/);
});
