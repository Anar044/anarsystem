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

test("route activation closes old sidebar groups and opens only the active category",()=>{
  const source=readFileSync(resolve(root,"persistent-workspace.js"),"utf8");
  const begin=source.indexOf("  function setGroupExpansion(group,open){");
  const end=source.indexOf("  function syncAddress(",begin);
  assert.ok(begin>=0&&end>begin);
  const classes=(initial=[])=>{
    const set=new Set(initial);
    return{contains:key=>set.has(key),toggle:(key,flag)=>{
      if(flag===undefined)flag=!set.has(key);
      flag?set.add(key):set.delete(key);
    }};
  };
  function group(){
    const toggle={classList:classes(["active"]),attributes:{},
      setAttribute(k,v){this.attributes[k]=v}};
    const sub={hidden:false};
    return{hidden:false,classList:classes(["open"]),querySelector(q){
      if(q===".documents-nav-toggle")return toggle;
      if(q===".documents-subnav")return sub;
      return null;
    },toggle,sub};
  }
  const procurement=group(),reports=group();
  const dashboard={href:"/index.html",classList:classes(),
    getAttribute(){return this.href},closest(){return null}};
  const procurementLink={href:"/procurement.html?view=catalog",classList:classes(),
    getAttribute(){return this.href},closest(){return procurement}};
  const reportLink={href:"/reports.html",classList:classes(),
    getAttribute(){return this.href},closest(){return reports}};
  const nav={querySelectorAll(sel){
    if(sel==="a[href]")return[dashboard,procurementLink,reportLink];
    if(sel===".documents-nav-group,.reports-nav-group")return[procurement,reports];
    return[];
  }};
  const make=new Function("sidebarNav","resolvePilotRoute",
    source.slice(begin,end)+"\nreturn {activateMenu,showOnlyGroup};");
  const {activateMenu}=make(()=>nav,href=>({
    "/index.html":{href:"/dashboard.html"},
    "/procurement.html?view=catalog":{href:"/procurement.html?view=catalog"},
    "/reports.html":{href:"/reports.html"}
  })[href]||null);
  activateMenu({href:"/dashboard.html"});
  assert.equal(procurement.classList.contains("open"),false);
  assert.equal(reports.classList.contains("open"),false);
  assert.equal(procurement.sub.hidden,true);
  assert.equal(reports.sub.hidden,true);
  activateMenu({href:"/procurement.html?view=catalog"});
  assert.equal(procurement.classList.contains("open"),true);
  assert.equal(procurement.sub.hidden,false);
  assert.equal(procurement.toggle.attributes["aria-expanded"],"true");
  assert.equal(reports.classList.contains("open"),false);
  activateMenu({href:"/reports.html"});
  assert.equal(procurement.classList.contains("open"),false);
  assert.equal(reports.classList.contains("open"),true);
});
test("first-party child signals verified access to the persistent shell before iframe load",()=>{
  const workspace=readFileSync(resolve(root,"persistent-workspace.js"),"utf8");
  const markup=readFileSync(resolve(root,"persistent-workspace.html"),"utf8");
  assert.match(shell,/postMessage\(\{type:'sh:embedded-access-ready'\},location\.origin\)/);
  assert.match(workspace,/event\.origin!==location\.origin/);
  assert.match(workspace,/event\.source!==frame\.contentWindow/);
  assert.match(workspace,/frame\.contentWindow\.SHAccess\?\.context\?\.allowed!==true/);
  assert.match(workspace,/frame\.contentDocument\?\.getElementById\('sh-access-denied'\)/);
  assert.match(workspace,/revealFrame\(frame,route,pendingMode\|\|'push'\)/);
  assert.match(workspace,/activateMenu\(route\);\s*const frame=document\.createElement\('iframe'\)/);
  assert.match(markup,/sh-workspace-frame-host\.sh-is-loading::after/);
});

test("desktop sidebar collapse is scoped to workspace and keeps RBAC visibility",()=>{
  const html=readFileSync(resolve(root,"persistent-workspace.html"),"utf8");
  const js=readFileSync(resolve(root,"persistent-workspace.js"),"utf8");
  const css=html.slice(html.indexOf("/* Desktop-only compact sidebar"),html.indexOf("@media (max-width:760px)",html.indexOf("/* Desktop-only compact sidebar")));
  assert.match(css,/body\.sh-workspace-page\.sh-sidebar-collapsed \.app-shell>\.sidebar/);
  assert.match(css,/body\.sh-workspace-page\.sh-sidebar-collapsed \.app-shell>\.main/);
  assert.match(css,/margin-left:70px!important/);
  assert.match(css,/width:calc\(100% - 70px\)!important/);
  assert.match(css,/\.documents-subnav\{\s*display:none!important/);
  assert.doesNotMatch(css,/\.unified-main-nav>a[^{}]*\{[^}]*display:flex!important/);
  assert.doesNotMatch(css,/\.documents-nav-group,\s*body[^{}]+\{[^}]*display:block!important/);
  assert.match(js,/sidebar\.insertBefore\(button,sidebar\.firstChild\)/);
  assert.match(js,/SIDEBAR_COLLAPSE_KEY='shPersistentSidebarCollapsedV1'/);
  assert.match(js,/group\)setGroupExpansion\(group,false\)/);
});
test("sidebar collapse button persists its state and restores expanded scroll",()=>{
  const source=readFileSync(resolve(root,"persistent-workspace.js"),"utf8");
  const begin=source.indexOf("  const SIDEBAR_COLLAPSE_KEY=");
  const end=source.indexOf("  function setGroupExpansion(",begin);
  assert.ok(begin>0&&end>begin);
  const active=new Set();
  const elements={
    ".sh-sidebar-collapse-icon":{textContent:""},
    ".sh-sidebar-collapse-label":{textContent:""}
  };
  const attributes={};
  const button={
    setAttribute(key,value){attributes[key]=value},
    querySelector(sel){return elements[sel]||null}
  };
  const sidebar={scrollTop:142,querySelector(sel){
    return sel===".sh-sidebar-collapse-btn"?button:null;
  }};
  const doc={body:{classList:{
    contains(k){return active.has(k)},
    toggle(k,on){if(on)active.add(k);else active.delete(k)}
  }},querySelector(sel){return sel===".sidebar"?sidebar:null}};
  const saved=new Map();
  const storage={setItem(k,v){saved.set(k,v)},getItem(k){return saved.get(k)||null}};
  const make=new Function("document","sessionStorage","sidebarNav",source.slice(begin,end)+
    "\nreturn {setSidebarCollapsed,isSidebarCollapsed};");
  const {setSidebarCollapsed,isSidebarCollapsed}=make(doc,storage,()=>null);
  setSidebarCollapsed(true);
  assert.equal(isSidebarCollapsed(),true);
  assert.equal(sidebar.scrollTop,0);
  assert.equal(saved.get("shPersistentSidebarCollapsedV1"),"1");
  assert.equal(attributes["aria-expanded"],"false");
  assert.equal(attributes["aria-label"],"Развернуть меню");
  setSidebarCollapsed(false);
  assert.equal(isSidebarCollapsed(),false);
  assert.equal(sidebar.scrollTop,142);
  assert.equal(saved.get("shPersistentSidebarCollapsedV1"),"0");
  assert.equal(attributes["aria-expanded"],"true");
});
