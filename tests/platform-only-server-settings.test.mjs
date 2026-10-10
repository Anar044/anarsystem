import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const shell=root('app-shell.js');
const css=root('app-shell.css');
const mobile=root('mobile-responsive.js');
const state=root('functions/api/iiko/state.js');
const platform=root('functions/api/platform/server.js');
const settings=root('settings.html');
const debug=root('debug.html');

test('Server settings are not linked in the organization sidebar',()=>{
  assert.doesNotMatch(shell,/<a href="\/settings\.html" data-unified-nav-item="settings\.html"/);
  const nav=shell.match(/const CANONICAL=\[[^\n]+\]/)?.[0]||'';
  assert.doesNotMatch(nav,/settings\.html|debug\.html/);
  assert.match(css,/\.sidebar a\[href="\/settings\.html"\]/);
  assert.match(css,/\.sidebar a\[href="\/debug\.html"\]/);
});
test('Mobile navigation always excludes legacy SH Server Settings and Debug',()=>{
  assert.match(mobile,/pageFor\(href\)==='settings\.html'/);
  assert.match(mobile,/pageFor\(href\)==='debug\.html'/);
  const priorities=mobile.slice(mobile.indexOf('const QUICK_PRIORITY'),mobile.indexOf('function pageFor'));
  assert.doesNotMatch(priorities,/settings\.html/);
});
test('Legacy direct links cannot open server settings or old debug form',()=>{
  for(const page of [settings,debug]){
    assert.match(page,/location\.replace\('\/index\.html'\)/);
    assert.doesNotMatch(page,/<input\b|<button\b|connect-iiko|iiko-password|debug-run|clear-iiko-data/);
    assert.match(page,/только администратору платформы/);
  }
});
test('Organization connection remains readable but never writable through old API',()=>{
  assert.match(state,/export async function onRequestGet/);
  assert.match(state,/loadPrivateIikoState\(env\.DB,\s*c\.storageUserId/);
  for(const name of ['Post','Delete']){
    const start=state.indexOf('export async function onRequest'+name);
    assert.ok(start>=0);
    const next=state.indexOf('export async function onRequest',start+1);
    const block=state.slice(start,next<0?undefined:next);
    assert.match(block,/PLATFORM_MANAGED_CONNECTION/);
    assert.match(block,/403/);
    assert.doesNotMatch(block,/savePrivateIikoState|DELETE FROM iiko_connections|UPDATE iiko_connections/);
  }
  assert.match(platform,/requirePlatformAdmin\(env,auth\?\.user\)/);
  assert.match(platform,/savePrivateIikoState/);
});
test('Unrelated module-specific organization settings remain available',()=>{
  assert.match(shell,/Настройки закупок/);
  assert.match(shell,/procurement\.html\?view=settings/);
  assert.match(shell,/data-unified-nav-item="site-users\.html"/);
});
