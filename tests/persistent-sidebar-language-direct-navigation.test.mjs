import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = p => readFileSync(new URL('../'+p, import.meta.url),'utf8');
const app = load('app-shell.js');
const html = load('persistent-workspace.html');
const source = app.slice(
  app.indexOf('  function persistentWorkspaceEntry(){'),
  app.indexOf('  const workspaceEntry=persistentWorkspaceEntry();')
);
assert.ok(source.startsWith('  function persistentWorkspaceEntry(){'),'workspace route helper exists');

function resolve({page='hr-timeclock.html',path='/hr-timeclock',host='smarthoreca.pages.dev',
  query='',embedded=false,topLevel=true,sidebar=true,authPage=false}={}){
  const top = {},self = topLevel ? top : {};
  const location = {hostname:host,origin:'https://'+host,pathname:path,search:query,hash:''};
  const document = {querySelector:()=>sidebar?{}:null};
  const root = {classList:{contains:key=>key==='sh-pilot-embedded'&&embedded}};
  return new Function('location','document','root','window','isAuthPage','currentPage',source+
    '\nreturn persistentWorkspaceEntry();')(location,document,root,
      {self,top},()=>authPage,()=>page);
}
test('deep HR pages open in the persistent workspace without losing their query',()=>{
  assert.equal(resolve(),'/persistent-workspace.html?target=%2Fhr-timeclock.html');
  assert.equal(resolve({page:'hr-payroll-accounting.html',path:'/hr-payroll-accounting',query:'?period=2026-10'}),
    '/persistent-workspace.html?target=%2Fhr-payroll-accounting.html%3Fperiod%3D2026-10');
  assert.equal(resolve({page:'hr-payroll.html',path:'/hr-payroll'}),'/persistent-workspace.html?target=%2Fhr-payroll.html');
});
test('other protected sections use the same persistent navigation',()=>{
  assert.equal(resolve({page:'ai-documents.html',path:'/ai-documents'}),
    '/persistent-workspace.html?target=%2Fai-documents.html');
  assert.equal(resolve({page:'assets.html',path:'/assets'}),
    '/persistent-workspace.html?target=%2Fassets.html');
  assert.equal(resolve({page:'index.html',path:'/dashboard'}),
    '/persistent-workspace.html?target=%2Fdashboard.html');
});
test('never redirect the protected embedded child or legacy/auxiliary routes',()=>{
  assert.equal(resolve({embedded:true}),null);
  assert.equal(resolve({topLevel:false}),null);
  assert.equal(resolve({host:'anarsystem.pages.dev'}),null);
  assert.equal(resolve({page:'index.html'}),null);
  assert.equal(resolve({page:'settings.html'}),null);
  assert.equal(resolve({page:'cash.html'}),null);
  assert.equal(resolve({sidebar:false}),null);
  assert.equal(resolve({authPage:true}),null);
});
test('stalled shell offers an explicitly requested protected classic Dashboard',()=>{
  const shell=load('persistent-workspace.js');
  const dashboard=load('dashboard.html');
  assert.equal(resolve({page:'index.html',path:'/dashboard.html',query:'?classic=1'}),null,
    'an explicit classic Dashboard never bounces back into the persistent shell');
  assert.match(dashboard,/if\(p\.get\('classic'\)==='1'\)return;/);
  assert.match(dashboard,/data-protected="true"/);
  assert.match(shell,/showStartupRecovery\(\)/);
  assert.match(shell,/data-sh-shell-retry/);
  assert.match(shell,/dashboard\.html\?classic=1/);
  assert.match(shell,/setTimeout\(\(\)=>\{/);
  assert.doesNotMatch(shell,/shBrokerBypass/);
});
test('persistent workspace can resume after a missed authorized-access event',()=>{
  const source=load('persistent-workspace.js');
  assert.match(source,/if\(started\|\|!window\.SHAccess\?\.context\?\.allowed\)return;/);
  assert.match(source,/if\(ensureMenu\(\)\)\{\s*started=true;/);
  assert.match(source,/window\.addEventListener\('load',start\)/);
  assert.match(source,/if\(!started&&window\.SHAccess\?\.context\?\.allowed\)start\(\)/);
  assert.match(source,/new MutationObserver\(\(\)=>start\(\)\)/);
  assert.match(source,/showStartupRecovery\(\)/);
});
test('language controls remain in the same persistent menu and are pinned for long sidebars',()=>{
  assert.match(html,/body\.sh-workspace-page \.sidebar>\.sh-language-picker\{[\s\S]*?position:fixed!important/);
  assert.match(html,/bottom:0!important;left:0!important/);
  assert.match(html,/sh-sidebar-collapsed \.sidebar>\.sh-language-picker\{\s*width:70px!important/);
  assert.match(html,/padding-bottom:72px!important/);
  assert.match(html,/sh-i18n\.js/);
  assert.match(load('sh-i18n.js'),/sidebar\.appendChild\(wrap\)/);
});
test('video regression pages use a cache-busted sidebar script',()=>{
  for (const path of ['hr-timeclock.html','hr-payroll-accounting.html','hr-payroll.html','dashboard.html']){
    assert.match(load(path),/app-shell\.js\?v=20261014-persistent-entry1/);
  }
  assert.match(html,/app-shell\.js\?v=20261028-module-stable1/);
});
