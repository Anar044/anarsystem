import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'dashboard.html'),'utf8');
const script=html.match(/<script id="sh-dashboard-entry-redirect">([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,'Dashboard has a top-level-only redirect');

function redirect(raw,{embedded=false}={}){
  const url=new URL(raw),nav=[];
  const location={hostname:url.hostname,origin:url.origin,pathname:url.pathname,
    search:url.search,hash:url.hash,replace:x=>nav.push(x)};
  const me={},top=embedded?{}:me;
  runInNewContext(script,{window:{top,self:me},location,URL,URLSearchParams});
  return nav;
}
test('direct production and clean Dashboard URLs use the permanent shell',()=>{
  assert.deepEqual(redirect('https://smarthoreca.pages.dev/dashboard'),
    ['/persistent-workspace.html?target=%2Fdashboard']);
  assert.deepEqual(redirect('https://smarthoreca.pages.dev/dashboard.html'),
    ['/persistent-workspace.html?target=%2Fdashboard.html']);
});
test('original Dashboard search parameters are preserved without double navigation',()=>{
  assert.deepEqual(redirect('https://smarthoreca.pages.dev/dashboard?view=overview'),
    ['/persistent-workspace.html?target=%2Fdashboard%3Fview%3Doverview']);
});
test('embedded Dashboard never redirects its parent or itself',()=>{
  assert.deepEqual(redirect('https://smarthoreca.pages.dev/dashboard',{embedded:true}),[]);
});
test('legacy domains and authentication tokens are never rewritten',()=>{
  assert.deepEqual(redirect('https://anarsystem.pages.dev/dashboard'),[]);
  assert.deepEqual(redirect('https://smarthoreca.pages.dev/dashboard?invite=abc'),[]);
  assert.deepEqual(redirect('https://smarthoreca.pages.dev/dashboard?code=abc'),[]);
  assert.deepEqual(redirect('https://smarthoreca.pages.dev/dashboard#access_token=secret'),[]);
});
test('preview and production origins route within themselves',()=>{
  assert.deepEqual(redirect('https://test-feature.smarthoreca.pages.dev/dashboard'),
    ['/persistent-workspace.html?target=%2Fdashboard']);
});
