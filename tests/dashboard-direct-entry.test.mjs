import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
import {runInNewContext} from "node:vm";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const dashboard=readFileSync(resolve(root,"dashboard.html"),"utf8");
const match=dashboard.match(/<script>([\s\S]*?)<\/script>/i);
assert.ok(match,"Dashboard entry guard is an inline early head script");

function openDashboard(url,{embedded=false,tagged=false}={}){
  const actual=new URL(url);
  const nav=[];
  const classes=[];
  const frame=embedded?{dataset:{shPersistentWorkspace:tagged?"1":"0"}}:null;
  const window={frameElement:frame};
  window.self=window;
  window.top=embedded?{}:window;
  const location={
    hostname:actual.hostname,
    search:actual.search,
    hash:actual.hash,
    replace(target){nav.push(target)}
  };
  const document={documentElement:{classList:{add(name){classes.push(name)}}}};
  runInNewContext(match[1],{window,location,document,URLSearchParams});
  return {nav,classes};
}
test("old bookmarks /dashboard and /dashboard.html enter permanent sidebar",()=>{
  assert.deepEqual(openDashboard("https://smarthoreca.pages.dev/dashboard").nav,
    ["/persistent-workspace.html?target=%2Fdashboard.html"]);
  assert.deepEqual(openDashboard("https://smarthoreca.pages.dev/dashboard.html").nav,
    ["/persistent-workspace.html?target=%2Fdashboard.html"]);
  assert.deepEqual(openDashboard("https://feature-test.smarthoreca.pages.dev/dashboard").nav,
    ["/persistent-workspace.html?target=%2Fdashboard.html"]);
});
test("actual module iframe does not redirect or start a second sidebar",()=>{
  const result=openDashboard("https://smarthoreca.pages.dev/dashboard.html",{embedded:true,tagged:true});
  assert.deepEqual(result.nav,[]);
  assert.deepEqual(result.classes,["sh-pilot-embedded"]);
});
test("unrelated embeds are never redirected or tagged",()=>{
  const result=openDashboard("https://smarthoreca.pages.dev/dashboard.html",{embedded:true});
  assert.deepEqual(result.nav,[]);
  assert.deepEqual(result.classes,[]);
});
test("auth and invitation callback parameters never enter content routing",()=>{
  for(const url of [
    "https://smarthoreca.pages.dev/dashboard?invite=abc",
    "https://smarthoreca.pages.dev/dashboard?code=abc",
    "https://smarthoreca.pages.dev/dashboard?token_hash=abc",
    "https://smarthoreca.pages.dev/dashboard#access_token=abc&refresh_token=def"
  ])assert.deepEqual(openDashboard(url).nav,[]);
});
test("other origins keep their original navigation",()=>{
  for(const url of [
    "https://anarsystem.pages.dev/dashboard",
    "http://localhost:8788/dashboard",
    "https://example.com/dashboard"
  ])assert.deepEqual(openDashboard(url).nav,[]);
});
test("Dashboard app logic remains the existing unchanged module",()=>{
  assert.ok(dashboard.includes('dashboard-optimized.js?v=20260917-9'));
  assert.ok(dashboard.includes('data-protected="true"'));
  assert.ok(dashboard.includes('app-shell.js?v=20261012-fast-nav1'));
  assert.ok(dashboard.indexOf("location.replace(")<dashboard.indexOf("auth-canonical-origin.js"));
});
