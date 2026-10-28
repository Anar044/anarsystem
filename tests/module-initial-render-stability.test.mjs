import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const workspace=read('persistent-workspace.js');
const shell=read('app-shell.js');
const procurement=read('procurement.js');
const internal=read('internal-orders.js');
const stock=read('stock-balances.js');
const movement=read('stock-movements.js');
const nomenclature=read('nomenclature.js');

test('site shell holds high-risk modules until first stable authenticated render',()=>{
  const begin=workspace.indexOf('  const BOOTSTRAPPED_MODULES=new Set(');
  const end=workspace.indexOf('  function revealFrame(',begin);
  assert.ok(begin>0 && end>begin);
  const snippet=workspace.slice(begin,end);
  const fn=new Function('canonicalPagePath','location',snippet+
    '\nreturn waitForModuleInitialRender;')(
    path=>path,'https://smarthoreca.pages.dev'
  );
  for(const href of ['procurement.html?view=requests','internal-orders.html?view=my',
    'stock-balances.html','stock-movements.html','nomenclature.html']){
    const route={href:'/'+href};
    const child={contentWindow:{__SH_MODULE_INITIAL_RENDER_READY__:false}};
    assert.equal(fn(child,route),true,href+' before ready');
    child.contentWindow.__SH_MODULE_INITIAL_RENDER_READY__=true;
    assert.equal(fn(child,route),false,href+' after ready');
  }
  assert.equal(fn({contentWindow:{}},{href:'/dashboard.html'}),false);
  assert.match(workspace,/if\(pendingFrame!==frame\|\|waitForModuleInitialRender\(frame,route\)\)return/);
  assert.match(workspace,/event\.data\?\.type!=='sh:embedded-module-ready'/);
  assert.match(workspace,/frame\.contentWindow\?\.SHAccess\?\.context/);
  assert.match(workspace,/currentFrame\)/);
});

test('module ready is one-time and cannot authorize access by itself',()=>{
  assert.match(shell,/let moduleInitialReady=false/);
  assert.match(shell,/window\.__SH_MODULE_INITIAL_RENDER_READY__=true/);
  assert.match(shell,/postMessage\(\{type:'sh:embedded-module-ready'\},location\.origin\)/);
  assert.match(workspace,/onAccessReadyMessage\(\{/);
  assert.match(workspace,/frame\.contentWindow\.SHAccess\?\.context\?\.allowed!==true/);
  assert.match(workspace,/frame\.contentDocument\?\.getElementById\('sh-access-denied'\)/);
});

test('external procurement never performs an interim destructive second initial render',()=>{
  const begin=procurement.indexOf('async function loadAll(){');
  const end=procurement.indexOf('async function saveSettings(',begin);
  const body=procurement.slice(begin,end);
  assert.ok(begin>0 && end>begin);
  assert.match(body,/await loadProcurement\(\)/);
  assert.match(body,/await Promise\.allSettled\(tasks\.map/);
  assert.equal((body.match(/renderAll\(\)/g)||[]).length,1);
  assert.ok(body.indexOf('renderAll()')>body.indexOf('await Promise.allSettled'));
  assert.match(body,/finally\{[\s\S]*?window\.SHModuleBootstrap\?\.ready\(\)/);
  assert.doesNotMatch(procurement,/function goProcurementView\(view\)\{location\.href=/);
  assert.match(procurement,/window\.SHProcurementNavigation=\{go:goProcurementView\}/);
});

test('internal orders and warehouse pages notify after their first full fetch',()=>{
  assert.match(internal,/await load\(\);note\("Список внутренних заказов загружен/);
  assert.match(internal,/window\.SHModuleBootstrap\?\.ready\(\)/);
  for(const source of [stock,movement]){
    assert.match(source,/finally\{btn\.disabled=false;window\.SHModuleBootstrap\?\.ready\(\)\}/);
  }
  assert.match(nomenclature,/finally\{window\.SHModuleBootstrap\?\.ready\(\)\}/);
  assert.match(internal,/window\.SHInternalOrdersNavigation=\{go:selectView\}/);
  assert.match(workspace,/nextPath==='\/procurement\.html'/);
  assert.match(workspace,/nextPath==='\/internal-orders\.html'/);
  assert.match(workspace,/if\(handler\.go\(view\)===true\)/);
});

test('fresh JS filenames activate ready signaling without stale HTML caches',()=>{
  const pages=['persistent-workspace.html','procurement.html','internal-orders.html',
    'stock-balances.html','stock-movements.html','nomenclature.html'];
  for(const page of pages){
    const html=read(page);
    assert.match(html,/app-shell\.js\?v=20261028-module-stable1/,page);
    if(page==='persistent-workspace.html')
      assert.match(html,/persistent-workspace\.js\?v=20261028-module-stable1/);
    else{
      const js=page.replace('.html','.js');
      assert.ok(html.includes(js+'?v=20261028-module-stable1'),page);
    }
  }
});
