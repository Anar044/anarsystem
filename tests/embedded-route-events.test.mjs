import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const shell=read('persistent-workspace.js');
const internal=read('internal-orders.js');
const procurement=read('procurement.js');

test('tab switches notify the parent without full HTML navigation',()=>{
  for(const child of [internal,procurement]){
    assert.match(child,/window\.parent!==window/);
    assert.match(child,/postMessage\(\{type:'sh:embedded-route-changed'\},location\.origin\)/);
  }
  assert.match(internal,/history\.replaceState\(null,"",url\)/);
  assert.match(procurement,/history\[mode\]\(\{shProcurementView:view\}/);
});
test('parent never trusts route or permission claims from a child message',()=>{
  const handler=shell.slice(shell.indexOf("window.addEventListener('message',event=>{",shell.indexOf('  function syncEmbeddedRoute(')),shell.indexOf('  function observeChildHistory()',shell.indexOf('  function syncEmbeddedRoute(')));
  assert.match(handler,/event\.origin!==location\.origin/);
  assert.match(handler,/event\.source!==currentFrame\.contentWindow/);
  assert.match(handler,/syncEmbeddedRoute\(currentFrame\)/);
  const sync=shell.slice(shell.indexOf('  function syncEmbeddedRoute('),shell.indexOf("window.addEventListener('message',event=>{",shell.indexOf('  function syncEmbeddedRoute(')));
  assert.match(sync,/frame!==currentFrame\|\|pendingFrame/);
  assert.match(sync,/childLocation\(frame\)/);
  assert.match(sync,/resolvePilotRoute\(url\.href\)/);
  assert.match(sync,/!permitted\(route\)/);
  assert.match(sync,/SHAccess\?\.context\?\.allowed!==true/);
  assert.match(sync,/getElementById\('sh-access-denied'\)/);
  assert.doesNotMatch(sync,/event\.data\.(href|permissions|organization|workspace)/);
});
test('legacy modules retain low-rate fallback without background polling',()=>{
  const part=shell.slice(shell.indexOf('  function observeChildHistory(){'),shell.indexOf('  // Warm the next document',shell.indexOf('  function observeChildHistory(){')));
  assert.match(part,/if\(document\.hidden\)return/);
  assert.match(part,/syncEmbeddedRoute\(currentFrame\)/);
  assert.match(part,/5000/);
  assert.doesNotMatch(part,/\bfetch\s*\(|location\.reload|history\.(pushState|replaceState)\s*=/);
  assert.doesNotMatch(part,/,750\)/);
});
