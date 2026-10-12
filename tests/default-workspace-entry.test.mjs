import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'index.html'),'utf8');
const redirects=readFileSync(resolve(root,'_redirects'),'utf8');
const match=html.match(/<script>([\s\S]*?)<\/script>/i);
assert.ok(match,'root entry contains an inline controller');

function destination(url){
  const parsed=new URL(url);
  const visited=[];
  const location={
    origin:parsed.origin,
    hostname:parsed.hostname,
    search:parsed.search,
    hash:parsed.hash,
    replace(next){visited.push(next)}
  };
  runInNewContext(match[1],{location,URL,URLSearchParams});
  assert.equal(visited.length,1,'entry performs exactly one navigation');
  return visited[0];
}

test('Smart Horeca home opens the persistent navigation by default',()=>{
  assert.equal(destination('https://smarthoreca.pages.dev/'),'/persistent-workspace.html');
  assert.equal(destination('https://smarthoreca.pages.dev/index.html'),'/persistent-workspace.html');
  assert.equal(destination('https://another-preview.smarthoreca.pages.dev/'),'/persistent-workspace.html');
});
test('existing login default can continue to link to index.html',()=>{
  const auth=readFileSync(resolve(root,'auth.js'),'utf8');
  assert.ok(auth.includes('return "index.html"'));
  assert.equal(destination('https://smarthoreca.pages.dev/index.html'),'/persistent-workspace.html');
});
test('root forwarding preserves selected route and optional navigation debugging',()=>{
  assert.equal(
    destination('https://smarthoreca.pages.dev/?target=%2Fprocurement.html%3Fview%3Drequests&navDebug=1'),
    '/persistent-workspace.html?target=%2Fprocurement.html%3Fview%3Drequests&navDebug=1'
  );
});
test('Supabase callback tokens never enter the normal content frame',()=>{
  assert.equal(
    destination('https://smarthoreca.pages.dev/?code=abc'),
    '/auth-callback.html?code=abc'
  );
  assert.equal(
    destination('https://smarthoreca.pages.dev/#access_token=test&refresh_token=test'),
    '/auth-callback.html#access_token=test&refresh_token=test'
  );
  assert.equal(
    destination('https://anarsystem.pages.dev/?code=abc'),
    'https://smarthoreca.pages.dev/auth-callback.html?code=abc'
  );
});
test('legacy site entry and existing invitation flows retain their original destination',()=>{
  assert.equal(destination('https://anarsystem.pages.dev/'),'/dashboard.html');
  assert.equal(destination('https://anarsystem.pages.dev/?invite=legacy'),
    'https://smarthoreca.pages.dev/auth-callback.html?invite=legacy');
  assert.equal(destination('https://smarthoreca.pages.dev/?invite=invitation'),
    '/dashboard.html?invite=invitation');
});
test('Cloudflare root serves the entry document instead of the old Dashboard',()=>{
  const rules=redirects.split(/\r?\n/).filter(line=>line&&!line.startsWith('#'));
  assert.ok(rules.includes('/ /index.html 200'));
  assert.ok(!rules.some(line=>line.includes(' /dashboard.html ')));
  assert.match(html,/<meta http-equiv="refresh" content="0; url=\/persistent-workspace.html">/);
});
