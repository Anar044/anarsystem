import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolveRestaurantScope } from '../functions/api/iiko/_lib/restaurant-scope.js';
import { scopeStateForAssistant } from '../functions/api/iiko/_lib/ai-assistant-context.js';

const source = readFileSync(new URL('../functions/api/ai-documents.js', import.meta.url), 'utf8');
const frontend = readFileSync(new URL('../ai-documents.js', import.meta.url), 'utf8');

const departments = ['r1', 'r2', 'r3', 'r4'].map((id,i)=>({id,name:'Restaurant '+(i+1),code:String(i+1)}));
const state = {
  connection: {ip:'server.example.az',port:'8080',login:'service',password:'secret',
    connectionType:'CHAIN',organizationId:'r1',departmentIds:departments.map(d=>d.id),departments},
  identity: {mode:'CHAIN',organizationId:'r1',departmentIds:departments.map(d=>d.id),departments,organizations:departments,
    groups:departments.map(d=>({id:'g-'+d.id,departmentId:d.id})),pointsOfSale:[],restaurantSections:[]}
};
const admin = {allowed:true,storageUserId:'platform-org:one',permissions:['*'],isOwner:false,
  scope:{mode:'ALL',departmentIds:[],departmentCodes:[]}};
const manager = {...admin,permissions:['inventory.ai_documents'],scope:{mode:'SELECTED',departmentIds:['r2'],departmentCodes:['2']}};

function harness(session={user:{id:'admin-user'},access:admin,storageUserId:'platform-org:one',found:true,state}) {
  const dbCalls=[];
  const db={
    async batch() {return []},
    prepare(sql) {
      const entry={sql,args:[]};dbCalls.push(entry);
      return {
        bind(...args){entry.args=args;return this},
        async run(){return {success:true}},
        async all(){return {results:[]}},
        async first(){return null}
      }
    }
  };
  const globals={
    Response,Request,URL,Date,Set,Map,Error,JSON,crypto,structuredClone,
    getUser:async()=>{throw Error('AI Docs must not load raw user state')},
    loadRequestIikoState:async()=>session,
    privateConnection:value=>value?.connection,
    bindWorkspaceIikoBroker:(connection,env,access)=>connection,
    hasPrivateConnection:value=>Boolean(value?.connection?.ip&&value?.connection?.password),
    hasPermission:(access,permission)=>Boolean(access?.permissions?.includes('*')||access?.permissions?.includes(permission)),
    scopeStateForAssistant,resolveRestaurantScope,
    aiProviderStatus:()=>({local:{configured:true},openai:{configured:false}})
  };
  const rewritten=source.replace(/^import .*;\s*$/gm,'').replace(/^export /gm,'');
  runInNewContext(rewritten+'\nglobalThis.api={onRequestGet,onRequestPost,documentOwnerKey};',globals);
  return {...globals.api,db,dbCalls,env:{DB:db}};
}
const req = cookie => new Request('https://smarthoreca.pages.dev/api/ai-documents',{
  headers: cookie ? {Cookie:cookie} : {}
});
const get = async(h,cookie='sh_selected_departments=r2') => h.onRequestGet({request:req(cookie),env:h.env});

test('AI Documents use selected workspace state rather than Supabase user storage',async()=>{
  const h=harness();
  const response=await get(h);
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.success,true);
  assert.deepEqual(Array.from(result.restaurantScope.departmentIds),['r2']);
  const dbQuery=h.dbCalls.find(call=>call.sql.includes('SELECT * FROM ai_documents'));
  assert.ok(dbQuery,'expected document query');
  assert.equal(dbQuery.args[0],'workspace:platform-org:one:user:admin-user');
});
test('Different organizations cannot look up documents or aliases through the same person ID',()=>{
  const h=harness();
  const a=h.documentOwnerKey('platform-org:one','admin-user');
  const b=h.documentOwnerKey('platform-org:two','admin-user');
  assert.notEqual(a,b);
  assert.equal(h.documentOwnerKey('admin-user','admin-user'),'admin-user',
    'original owner account retains old documents');
  assert.match(source,/aliasMap\(env\.DB,userId/);
  assert.match(source,/const result=await enrich\(env,a\.connection,a\.documentUserId/);
  assert.doesNotMatch(source,/loadPrivateIikoState\(env\.DB,\s*userId/);
});
test('Restricted staff cannot access an unassigned restaurant',async()=>{
  const h=harness({user:{id:'manager'},access:manager,storageUserId:'platform-org:one',found:true,state});
  const denied=await get(h,'sh_selected_departments=r1');
  assert.equal(denied.status,403);
  assert.equal((await denied.json()).code,'CHAIN_SCOPE_FORBIDDEN');
  const allowed=await get(h);
  assert.equal(allowed.status,200);
  const data=await allowed.json();
  assert.deepEqual(Array.from(data.restaurantScope.departmentIds),['r2']);
});
test('Inactive workspace and users without AI Documents permission are rejected',async()=>{
  const suspended=harness({user:{id:'u'},access:{allowed:false,reason:'WORKSPACE_INACTIVE'}});
  assert.equal((await get(suspended)).status,403);
  const noPermission=harness({user:{id:'u'},access:{...admin,permissions:['reports.olap']},storageUserId:'platform-org:one',found:true,state});
  const result=await get(noPermission);
  assert.equal(result.status,403);
  assert.equal((await result.json()).code,'AI_DOCUMENT_ACCESS_DENIED');
});
test('Absent saved connection is a clear configuration error instead of a generic 500',async()=>{
  const h=harness({user:{id:'u'},access:admin,storageUserId:'platform-org:one',found:false,state:null});
  const r=await get(h);
  assert.equal(r.status,409);
  assert.equal((await r.json()).code,'AI_DOCUMENT_SERVER_NOT_CONFIGURED');
});
test('Changing workspaces rejects stale restaurant cookies instead of showing old company documents',async()=>{
  const second=structuredClone(state);
  second.identity.departmentIds=['new'];
  second.identity.departments=[{id:'new',code:'9',name:'Other restaurant'}];
  second.identity.organizations=second.identity.departments;
  second.identity.organizationId='new';
  second.connection.departmentIds=['new'];
  second.connection.departments=second.identity.departments;
  second.connection.organizationId='new';
  const h=harness({user:{id:'admin-user'},access:{...admin,storageUserId:'platform-org:two'},storageUserId:'platform-org:two',found:true,state:second});
  assert.equal((await get(h,'sh_selected_departments=r1')).status,403);
  assert.equal((await get(h,'sh_selected_departments=new')).status,200);
});
test('Frontend uses explicit auth for invoice references and document posting, and refreshes on restaurant change',()=>{
  assert.match(frontend,/sh:iiko-selection-changed/);
  assert.match(frontend,/async function loadRefs\(\).*requireSingleRestaurant/);
  assert.match(frontend,/invoice-reference-data[^\n]+Authorization:/);
  assert.match(frontend,/const authToken=await token\(\)/);
  assert.match(frontend,/Authorization:'Bearer '\+authToken/);
});
