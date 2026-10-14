import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolveRestaurantScope, allowedDepartmentIds } from '../functions/api/iiko/_lib/restaurant-scope.js';
import { scopeStateForAssistant } from '../functions/api/iiko/_lib/ai-assistant-context.js';
import { auditScopeFromConnection, serverScopeFromConnection } from '../functions/api/_lib/audit-log.js';

const source = path => readFileSync(new URL('../'+path, import.meta.url),'utf8');
const assetsSource=source('functions/api/assets.js');
const metaSource=source('functions/api/asset-meta.js');
const filesSource=source('functions/api/asset-files.js');
const auditSource=source('functions/api/audit-log.js');
const auditLogger=source('functions/api/_lib/audit-log.js');

const departments=[{id:'r1',name:'One',code:'1'},{id:'r2',name:'Two',code:'2'}];
const connection={ip:'example.az',port:'8080',login:'reader',password:'test-secret',connectionType:'CHAIN',departmentIds:['r1','r2'],departments};
const state={connection,identity:{mode:'CHAIN',departmentIds:['r1','r2'],departments,organizations:departments}};
const access={
  allowed:true,isOwner:false,storageUserId:'platform-org:one',permissions:['inventory.assets.view','audit.view'],
  scope:{mode:'SELECTED',departmentIds:['r2'],departmentCodes:['2']}
};
function harness(path,session={user:{id:'staff'},access,storageUserId:'platform-org:one',found:true,state}){
  const calls=[];
  const DB={
    async batch(){return[]},
    prepare(sql){
      const entry={sql,args:[]};calls.push(entry);
      return {
        bind(...args){entry.args=args;return this},
        async run(){return{success:true}},
        async first(){return {total:0}},
        async all(){return{results:[]}}
      };
    }
  };
  const allowed=()=>session?.access?.allowed===true;
  const ctx={
    Response,Request,URL,Date,Map,Set,JSON,crypto,TextEncoder,structuredClone,
    loadRequestIikoState:async()=>session,
    hasPrivateConnection:s=>Boolean(s?.connection?.ip&&s?.connection?.password),
    privateConnection:s=>s.connection,
    scopeStateForAssistant,resolveRestaurantScope,allowedDepartmentIds,
    hasPermission:(a,p)=>Boolean(allowed()&&(a.permissions||[]).includes('*')||(a?.permissions||[]).includes(p)),
    ensureAuditTable:async()=>{},
    auditScopeFromConnection,
    console
  };
  const code=source(path).replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
  runInNewContext(code+'\nglobalThis.target={onRequestGet,onRequestPost};',ctx);
  return{...ctx.target,env:{DB},calls};
}
const req=(method='GET',selected='r2')=>new Request('https://smarthoreca.pages.dev/api/assets',{
  method,headers:{Cookie:'sh_selected_departments='+selected},
  ...(method==='POST'?{body:JSON.stringify({action:'saveAsset'})}:{})
});
test('Asset pages have no direct per-user connection lookup or permissive null scope',()=>{
  for(const [name,script] of [['assets',assetsSource],['asset-meta',metaSource],['asset-files',filesSource]]){
    assert.match(script,/loadRequestIikoState\(request,env\)/,name);
    assert.match(script,/scopeStateForAssistant\(stored\.state,stored\.access\)/,name);
    assert.match(script,/hasPrivateConnection\(stored\.state\)/,name);
    assert.match(script,/ASSET_PERMISSION_DENIED/,name);
    assert.doesNotMatch(script,/loadPrivateIikoState\(env\.DB,(?:auth|a)\.user\.id/,name);
  }
});
test('Assets reject requests without a membership, server, or read permission',async()=>{
  const cases=[
    [{access:{allowed:false,reason:'WORKSPACE_INACTIVE'}},403,'WORKSPACE_INACTIVE'],
    [{access:{...access,permissions:[]}},403,'ASSET_PERMISSION_DENIED'],
    [{found:false,state:null},409,'ASSET_SERVER_NOT_CONFIGURED']
  ];
  for(const [override,status,code] of cases){
    const h=harness('functions/api/assets.js',{user:{id:'staff'},storageUserId:'platform-org:one',found:true,state,access,...override});
    const res=await h.onRequestGet({request:req(),env:h.env});
    assert.equal(res.status,status);
    assert.equal((await res.json()).code,code);
  }
});
test('Assets use member-allowed departments and reject out-of-scope cookies',async()=>{
  const h=harness('functions/api/assets.js');
  const res=await h.onRequestGet({request:req(),env:h.env});
  assert.equal(res.status,200);
  const query=h.calls.find(x=>x.sql.startsWith('SELECT * FROM fixed_assets WHERE'));
  assert.ok(query);
  assert.match(query.sql,/restaurant_id IN/);
  assert.equal(query.args[1],'r2');
  const forbidden=await h.onRequestGet({request:req('GET','r1'),env:h.env});
  assert.equal(forbidden.status,403);
});
test('Asset changes require manage permission rather than read permission',async()=>{
  const h=harness('functions/api/assets.js');
  const res=await h.onRequestPost({request:req('POST'),env:h.env});
  assert.equal(res.status,403);
  assert.equal((await res.json()).code,'ASSET_PERMISSION_DENIED');
  assert.match(metaSource,/request\.method==='POST'/);
  assert.match(filesSource,/request\.method==='POST'/);
});
test('Audit scopes differ across organizations on the same physical server',async()=>{
  const base=await serverScopeFromConnection(connection);
  const first=await auditScopeFromConnection(connection,'platform-org:one');
  const second=await auditScopeFromConnection(connection,'platform-org:two');
  assert.notEqual(first,second);
  assert.notEqual(first,base);
  assert.equal(await auditScopeFromConnection(connection,''),'');
});
test('Audit endpoint checks organization and audit permission',async()=>{
  const denied=harness('functions/api/audit-log.js',{user:{id:'staff'},access:{...access,permissions:[]},storageUserId:'platform-org:one',found:true,state});
  const res=await denied.onRequestGet({request:req(),env:denied.env});
  assert.equal(res.status,403);
  assert.equal((await res.json()).code,'AUDIT_PERMISSION_DENIED');
  const allowed=harness('functions/api/audit-log.js');
  const ok=await allowed.onRequestGet({request:req(),env:allowed.env});
  assert.equal(ok.status,200);
  const query=allowed.calls.find(c=>/COUNT\(\*\)/.test(c.sql));
  assert.ok(query);
  assert.match(query.sql,/json_each\(audit_log\.restaurant_ids_json\)/);
  assert.equal(query.args[1],'r2');
  assert.match(auditLogger,/auditScopeFromConnection\(connection,stored\.storageUserId\)/);
});
