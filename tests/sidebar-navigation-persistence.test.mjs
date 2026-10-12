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
test("full-page blocking overlays remain removed even with sidebar-only transition",()=>{
  assert.match(css,/@view-transition\s*\{\s*navigation:\s*auto;/);
  assert.match(css,/::view-transition-old\(root\)/);
  assert.doesNotMatch(css,/shNavKeepOld|Загрузка раздела|4200ms/);
  assert.doesNotMatch(shell,/prefetchSidebarLink|finishPageNavigationTransition/);
});
test("the legacy HR menu cannot collapse sibling sections",()=>{
  assert.doesNotMatch(legacy,/if\(g===group\)return;g\.classList\.remove\('open'\)/);
});

test("cross-document transition preserves only sidebar, not page-content loading",()=>{
  const css=readFileSync(resolve(root,"app-shell.css"),"utf8");
  assert.match(css,/@view-transition\s*\{\s*navigation:\s*auto;/);
  assert.match(css,/\.sidebar\s*\{\s*view-transition-name:\s*sh-sidebar;/);
  assert.match(css,/::view-transition-old\(sh-sidebar\)/);
  assert.match(css,/::view-transition-new\(sh-sidebar\)/);
  assert.match(css,/::view-transition-old\(root\)/);
  assert.doesNotMatch(css,/Загрузка раздела|shNavKeepOld|4200ms/);
  assert.match(shell,/addEventListener\('pagereveal'/);
  assert.match(shell,/addEventListener\('sh:access-visibility-ready'/);
  assert.match(shell,/vt\.skipTransition\(\)/);
});
test("sidebar transition is released only after RBAC checked links and groups",()=>{
  const source=shell.slice(shell.indexOf("  let pendingSidebarTransition=null;"),
    shell.indexOf("  function syncChainScopeCookie("));
  assert.match(source,/window\.SHAccess\?\.context\?\.allowed/);
  assert.match(source,/links\.every\(a=>a\.dataset\.shAccessChecked==='1'\)/);
  assert.match(source,/groups\.every\(g=>g\.dataset\.shAccessChecked==='1'\)/);
  assert.match(source,/releaseSidebarSnapshot\(true\)/);
});

test("sidebar-only view transition waits for verified permissions without delaying main content",()=>{
  const marker="  let pendingSidebarTransition=null;";
  const start=shell.indexOf(marker),stop=shell.indexOf("  function syncChainScopeCookie(",start);
  assert.ok(start>0&&stop>start);
  const listeners=new Map();
  const navLinks=[{dataset:{shAccessChecked:"0"}},{dataset:{shAccessChecked:"0"}}];
  const navGroups=[{dataset:{shAccessChecked:"0"}}];
  const nav={querySelectorAll(selector){
    return selector==="a[href]"?navLinks:navGroups;
  }};
  const window={SHAccess:{context:{allowed:true}},
    addEventListener(type,fn){listeners.set("window:"+type,fn);}};
  const document={querySelector(selector){return selector===".sidebar .unified-main-nav"?nav:null},
    addEventListener(type,fn){listeners.set("document:"+type,fn);}};
  new Function("window","document","rememberVerifiedSidebarLinks",shell.slice(start,stop))(window,document,()=>{});
  let skipCount=0;
  const vt={finished:new Promise(()=>{}),skipTransition(){skipCount++}};
  listeners.get("window:pagereveal")({viewTransition:vt});
  assert.equal(skipCount,0,"early incomplete sidebar must keep outgoing snapshot");
  navLinks.forEach(el=>el.dataset.shAccessChecked="1");
  navGroups.forEach(el=>el.dataset.shAccessChecked="1");
  listeners.get("window:sh:access-visibility-ready")();
  assert.equal(skipCount,1,"fully checked navigation releases screenshot immediately");
  listeners.get("window:sh:access-visibility-ready")();
  assert.equal(skipCount,1,"release is idempotent");
});
test("denied access releases the old sidebar snapshot and lets deny page render",()=>{
  const start=shell.indexOf("  let pendingSidebarTransition=null;");
  const stop=shell.indexOf("  function syncChainScopeCookie(",start);
  const listeners=new Map(),window={SHAccess:{context:{allowed:false}},addEventListener(t,fn){listeners.set(t,fn)}};
  const document={querySelector(){return null},addEventListener(t,fn){listeners.set(t,fn)}};
  new Function("window","document","rememberVerifiedSidebarLinks",shell.slice(start,stop))(window,document,()=>{});
  let releases=0;
  listeners.get("pagereveal")({viewTransition:{finished:new Promise(()=>{}),skipTransition(){releases++}}});
  assert.equal(releases,0);
  listeners.get("sh-access-ready")({detail:{allowed:false}});
  assert.equal(releases,1);
});

test("sidebar restores only previously permission-verified links for the same user",()=>{
  const segment=shell.slice(shell.indexOf("  const SIDEBAR_VERIFIED_CACHE_KEY="),
    shell.indexOf("  // Cross-document navigation keeps"));
  assert.match(segment,/sidebarCacheIdentity/);
  assert.match(segment,/window\.SH_CURRENT_USER/);
  assert.match(segment,/cached\.owner!==owner/);
  assert.match(segment,/Date\.now\(\)-cached\.at>60000/);
  assert.match(segment,/link\.hidden=!visible\.has\(href\)/);
  assert.match(segment,/link\.dataset\.shAccessChecked='1'/);
  assert.match(segment,/sidebarPermissionsReady\(\)/);
  assert.match(css,/\.reports-nav-group:not\(\[data-sh-access-checked="1"\]\)/);
});
test("static sidebar demo uses the same app shell without authenticating to production data",()=>{
  for(const path of ["sidebar-navigation-demo-a.html","sidebar-navigation-demo-b.html"]){
    const demo=readFileSync(resolve(root,path),"utf8");
    assert.match(demo,/app-shell\.js\?v=20261012-sidebar-continuity2/);
    assert.match(demo,/app-shell\.css\?v=20261012-sidebar-continuity2/);
    assert.match(demo,/sidebar-navigation-demo-[ab]\.html/);
    assert.match(demo,/setTimeout\(\(\)=>\{/);
    assert.doesNotMatch(demo,/<script[^>]+(?:auth\.js|site-access\.js|supabase)/);
    assert.doesNotMatch(demo,/fetch\s*\(/);
    assert.doesNotMatch(demo,/data-protected="true"/);
  }
});
