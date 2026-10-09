import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const serverSource=readFileSync(new URL('../functions/api/platform/server.js',import.meta.url),'utf8');
const platformSource=readFileSync(new URL('../functions/api/platform/_lib/organizations.js',import.meta.url),'utf8');
const adminSource=readFileSync(new URL('../platform-admin.js',import.meta.url),'utf8');
const viewSource=readFileSync(new URL('../platform-admin.html',import.meta.url),'utf8');
const legacySource=readFileSync(new URL('../functions/api/iiko/state.js',import.meta.url),'utf8');
const connectionSource=readFileSync(new URL('../functions/api/iiko/connect.js',import.meta.url),'utf8');
class PlatformError extends Error{
  constructor(message,status=400,code='PLATFORM_ERROR'){super(message);this.status=status;this.code=code}
}
const ORG={id:'org-one',name:'Chain',storage_owner_id:'platform-org:org-one',server_mode:'CHAIN',status:'DRAFT'};
function setup(opts={}){
  const writes=[],calls=[],ctx={
    Response,URL,Date,console,crypto:{randomUUID:()=>String(writes.length+1)},
    SMART_HORECA_STATE_ENCRYPTION_ENV:'SMART_HORECA_STATE_ENCRYPTION_KEY',
    PlatformError,
    getUser:async()=>({user:{id:'platform-admin'}}),
    requirePlatformAdmin:()=>opts.db||db,
    ensurePlatformTables:async()=>{},
    loadPrivateIikoState:async()=>({found:false,state:null,encrypted:false}),
    savePrivateIikoState:async(_db,key,data,env)=>{
      writes.push({key,data,hasSecret:!!env.SMART_HORECA_STATE_ENCRYPTION_KEY});
      return {encrypted:true,updatedAt:'2026-10-10T00:00:00Z'};
    },
    getDepartments:async()=>({departments:[{id:'d1',name:'Restaurant RMS 1',code:'RMS1'}],rawFormat:'json'}),
    getDepartmentsSearch:async()=>({departments:[],rawFormat:'empty',diagnostic:{format:'empty',candidates:0,types:[]}}),
    getDepartmentsFromOlap:async()=>{throw Error('Unexpected OLAP fallback')},
    ...opts
  };
  const db={
    prepare(sql){
      return{
        bind(...args){this.args=args;return this},
        async first(){
          calls.push({sql,args:this.args});
          if(sql.includes('sh_platform_organizations'))return ORG;
          return null;
        },
        async run(){writes.push({sql,args:this.args});return{success:true}}
      };
    }
  };
  const clean=serverSource.replace(/^import .+\n/gm,'').replace(/^export /gm,'');
  runInNewContext(clean+';globalThis.server={validateServer,onRequestGet,onRequestPost,onRequestDelete};',ctx);
  return {server:ctx.server,calls,writes,db};
}
test('Server endpoints are guarded by the platform administrator role',()=>{
  assert.match(serverSource,/requirePlatformAdmin\(env,auth\?\.user\)/);
  assert.match(serverSource,/ensurePlatformTables\(db\)/);
  assert.match(serverSource,/new URL\(request\.url\)\.searchParams\.get\('organizationId'\)/);
});
test('Server validates host, port and rejects private/internal address targets',()=>{
  const {server}=setup();
  const out=server.validateServer({host:'s01.smarthoreca.az',port:'8080',login:'server',password:'abc'});
  assert.equal(out.port,'8080');
  assert.equal(out.ip,'s01.smarthoreca.az');
  for(const host of ['localhost','127.0.0.1','192.168.1.1','10.0.0.10','172.16.15.20','169.254.1.2','server.local','http://site.az','site.az/foo','foo@host.com','::1','198.51.100.2']){
    assert.throws(()=>server.validateServer({host,port:8080,login:'a',password:'x'}),Error,host);
  }
  assert.throws(()=>server.validateServer({host:'s01.smarthoreca.az',port:70000,login:'server',password:'abc'}));
});
test('POST requires encrypted D1 storage, never writes plaintext without key',async()=>{
  const h=setup();
  const request=()=>new Request('https://smarthoreca.pages.dev/api/platform/server',{method:'POST',body:JSON.stringify({
    organizationId:'org-one',connection:{host:'s01.smarthoreca.az',port:'8080',login:'server',password:'plain-secret'}
  })});
  const noSecret=await h.server.onRequestPost({request:request(),env:{DB:h.db}});
  assert.equal(noSecret.status,503);
  assert.equal(h.writes.length,0);
  const ok=await h.server.onRequestPost({request:request(),env:{DB:h.db,SMART_HORECA_STATE_ENCRYPTION_KEY:'test-key'}});
  assert.equal(ok.status,200);
  const response=await ok.json();
  assert.equal(response.server.departmentCount,1);
  assert.equal(response.server.encrypted,true);
  assert.equal(JSON.stringify(response).includes('plain-secret'),false);
  assert.equal(h.writes[0].key,ORG.storage_owner_id);
  assert.equal(h.writes[0].data.identity.mode,'CHAIN');
  assert.equal(h.writes[0].data.identity.departments[0].id,'d1');
  assert.equal(h.writes[0].hasSecret,true);
});
test('GET exposes server metadata but no stored login password',async()=>{
  const h=setup({loadPrivateIikoState:async()=>({
    found:true,encrypted:true,updatedAt:'2026-10-10',
    state:{connection:{ip:'server.example.az',port:'8080',login:'user',password:'should-not-leak'},
      identity:{departments:[{id:'d1',name:'RMS1',code:'1'}]}}
  })});
  const res=await h.server.onRequestGet({
    request:new Request('https://smarthoreca.pages.dev/api/platform/server?organizationId=org-one'),
    env:{DB:h.db}
  });
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.server.passwordStored,true);
  assert.equal(JSON.stringify(body).includes('should-not-leak'),false);
});
test('Organizational sysadmins cannot modify server through legacy API; activation is gated',()=>{
  assert.match(platformSource,/SERVER_REQUIRED/);
  assert.match(platformSource,/SELECT 1 AS connected FROM iiko_connections/);
  assert.match(legacySource,/startsWith\('platform-org:'\)/);
  assert.match(connectionSource,/export async function getDepartments\(/);
  assert.match(connectionSource,/export async function getDepartmentsFromOlap\(/);
  assert.match(viewSource,/id="serverForm"/);
  assert.match(adminSource,/serverApi\('POST'/);
});
