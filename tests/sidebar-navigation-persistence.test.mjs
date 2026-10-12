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

test("real-page persistent workspace stays opt-in and reuses independent authentication",()=>{
  const html=readFileSync(resolve(root,"persistent-workspace.html"),"utf8");
  const route=readFileSync(resolve(root,"persistent-workspace.js"),"utf8");
  assert.match(html,/data-protected="true"/);
  assert.match(html,/\/auth\.js\?/);
  assert.match(html,/\/app-shell\.js\?/);
  assert.match(html,/persistent-workspace\.js\?/);
  assert.match(html,/<aside class="sidebar"><\/aside>/);
  assert.match(html,/sh-workspace-frame-host/);
  assert.match(html,/<style id="sh-workspace-shell-style">/);
  assert.match(shell,/style\.id!=='sh-workspace-shell-style'/);
  assert.doesNotMatch(html,/<iframe[^>]+src="\/dashboard/);
  assert.match(route,/SHAccess\?\.context\?\.allowed/);
  assert.match(route,/SHAccess\.canAny\?\.\(route\.permissions\)/);
  assert.match(route,/frame\.dataset\.shPersistentWorkspace='1'/);
  assert.match(route,/frame\.src=route\.href/);
  assert.match(route,/addEventListener\('popstate'/);
  assert.match(route,/location\.assign\('\/login\.html'\)/);
  assert.doesNotMatch(route,/fetch\s*\(/);
  assert.doesNotMatch(route,/location\.replace\s*\(/);
});
test("permitted navigation routes are sourced from the checked sidebar, not duplicated",()=>{
  const route=readFileSync(resolve(root,"persistent-workspace.js"),"utf8");
  const rules=route.slice(route.indexOf("  const PROCUREMENT="),route.indexOf("  const host="));
  const resolveFn=route.slice(route.indexOf("  function canonicalPagePath(path){"),route.indexOf("  function permitted(route){"));
  const hrLink={
    href:"https://preview.smarthoreca.pages.dev/hr-payroll.html",
    hidden:false,
    dataset:{permission:"hr.payroll.view",shAccessChecked:"1"},
    closest(){return null},
    textContent:"Расчёт зарплаты"
  };
  const doc={querySelector(selector){
    return selector===".sidebar .unified-main-nav"?
      {querySelectorAll(){return [hrLink]}}:null;
  }};
  const make=new Function("location","document",rules+resolveFn+"\nreturn resolvePilotRoute;");
  const resolveRoute=make({origin:"https://preview.smarthoreca.pages.dev"},doc);
  assert.ok(route.includes("Object.keys(PROCUREMENT).map(view=>"));
  assert.ok(route.includes("preparing"));
  assert.equal(resolveRoute("/index.html").href,"/dashboard.html");
  assert.equal(resolveRoute("/dashboard").href,"/dashboard.html");
  assert.equal(resolveRoute("/").href,"/dashboard.html");
  assert.equal(resolveRoute("/procurement?view=sourcing").href,"/procurement.html?view=sourcing");
  assert.equal(resolveRoute("/internal-orders?view=shipments").href,"/internal-orders.html?view=shipments");
  assert.equal(resolveRoute("/dashboard.html").permissions[0],"dashboard.view");
  assert.deepEqual(resolveRoute("/procurement.html?view=sourcing").permissions,["procurement.sourcing"]);
  assert.deepEqual(resolveRoute("/internal-orders.html?view=shipments").permissions,
    ["procurement.internal.fulfill","procurement.internal.configure"]);
  assert.equal(resolveRoute("/procurement.html?view=unknown"),null);
  assert.equal(resolveRoute("/internal-orders.html?view=unknown"),null);

  assert.deepEqual(resolveRoute("/hr-payroll.html").permissions,["hr.payroll.view"]);
  assert.equal(resolveRoute("/hr-payroll").href,"/hr-payroll.html");
  assert.equal(resolveRoute("/login"),null);
  assert.equal(resolveRoute("/persistent-workspace"),null);
  hrLink.dataset.shAccessChecked="0";
  assert.equal(resolveRoute("/hr-payroll.html"),null,"unchecked links are never routed");
  hrLink.dataset.shAccessChecked="1";
  hrLink.hidden=true;
  assert.equal(resolveRoute("/hr-payroll.html"),null,"hidden links are never routed");
  hrLink.hidden=false;
  assert.equal(resolveRoute("/hr-payroll.html?invite=secret"),null,
    "authentication parameters must not enter generic navigation");
  assert.equal(resolveRoute("https://example.com/dashboard.html"),null);
});
test("embedded content hides duplicate sidebar only when opened by the pilot frame",()=>{
  for(const path of ["dashboard.html","procurement.html","internal-orders.html"]){
    const content=readFileSync(resolve(root,path),"utf8");
    assert.match(content,/frameElement\?\.dataset\?\.shPersistentWorkspace/);
    assert.match(content,/classList\.add\("sh-pilot-embedded"\)/);
    assert.match(content,/data-protected="true"/);
  }
  assert.ok(shell.includes("frameElement?.dataset?.shPersistentWorkspace"));
  assert.match(css,/html\.sh-pilot-embedded \.sidebar\{display:none!important\}/);
  assert.match(css,/html\.sh-pilot-embedded \.app-shell>\.main/);
});
