import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const helper=readFileSync(new URL('../functions/api/platform/_lib/organizations.js',import.meta.url),'utf8');
const access=readFileSync(new URL('../functions/api/access/_lib/access-control.js',import.meta.url),'utf8');
const site=readFileSync(new URL('../site-access.js',import.meta.url),'utf8');
const auth=readFileSync(new URL('../auth.js',import.meta.url),'utf8');
const controller=readFileSync(new URL('../functions/api/platform/organizations.js',import.meta.url),'utf8');
function createHarness(overrides={}){
  let id=0;
  const ctx={
    crypto:{randomUUID:()=>('stable-test-'+(++id))},
    URL,Date,console,
    ensureOwnerWorkspace:async()=>({id:'workspace-1'}),
    listAccessAdmin:async()=>({roles:[{id:'org-role-admin',code:'ADMIN'}]}),
    upsertMember:async()=>({inviteToken:'opaque-invite',alreadyRegistered:false}),
    ...overrides
  };
  const js=helper.replace(/^import .+\n/gm,'').replace(/^export /gm,'');
  runInNewContext(js+';globalThis.subject={isPlatformAdmin,platformDatabase,requirePlatformAdmin,validateDraft,createDraft,inviteSysAdmin,changeOrganizationStatus,ensurePlatformTables};',ctx);
  return ctx.subject;
}
function fakeDb({org={id:'org1',workspace_id:'ws1',storage_owner_id:'platform-org:org1',status:'ACTIVE'},existingUser=null}={}){
  const batch=[],writes=[],reads=[];
  return{
    batch,writes,reads,
    db:{
      prepare(sql){
        const stmt={
          sql,values:[],bind(...args){this.values=args;return this},
          async first(){
            reads.push({sql,values:this.values});
            if(sql.includes('SELECT * FROM sh_platform_organizations'))return org;
            if(sql.includes('SELECT user_id FROM sh_access_members'))return existingUser?{user_id:existingUser}:null;
            return null;
          },
          async run(){writes.push({sql,values:this.values});return{success:true}},
          async all(){return{results:[]}}
        };
        return stmt;
      },
      async batch(commands){batch.push(...commands.map(x=>({sql:x.sql,values:x.values})));return[]}
    }
  };
}
test('Platform role requires server-side user-id allowlist; emails never grant it',()=>{
  const {isPlatformAdmin,requirePlatformAdmin}=createHarness();
  const user={id:'uuid-one',email:'admin@example.com'};
  assert.equal(isPlatformAdmin({},user),false);
  assert.equal(isPlatformAdmin({PLATFORM_ADMIN_USER_IDS:'admin@example.com'},user),false);
  assert.equal(isPlatformAdmin({PLATFORM_ADMIN_USER_IDS:'uuid-other;uuid-one'},user),true);
  assert.throws(()=>requirePlatformAdmin({DB:{prepare(){}}},user),e=>e.code==='PLATFORM_FORBIDDEN');
});
test('Platform uses existing DB binding and does not fall back to a new DB',()=>{
  const {platformDatabase}=createHarness(),db={prepare(){}};
  assert.equal(platformDatabase({DB:db}),db);
  assert.throws(()=>platformDatabase({PLATFORM_DB:db}),e=>e.code==='DB_MISSING');
});
test('Draft validates RMS/CHAIN and contact email',()=>{
  const {validateDraft}=createHarness();
  assert.deepEqual(JSON.parse(JSON.stringify(validateDraft({name:'TEST CHAIN',serverMode:'CHAIN',contactEmail:'owner@test.az'}))),{
    name:'TEST CHAIN',serverMode:'CHAIN',contactEmail:'owner@test.az'
  });
  assert.throws(()=>validateDraft({name:'',serverMode:'RMS'}));
  assert.throws(()=>validateDraft({name:'Demo',serverMode:'invalid'}));
  assert.throws(()=>validateDraft({name:'Demo',serverMode:'RMS',contactEmail:'bad'}));
});
test('New organizations get synthetic owner and shared D1 transaction',async()=>{
  const {db,batch}=fakeDb(),{createDraft}=createHarness();
  const result=await createDraft(db,{name:'Chain',serverMode:'CHAIN'},'platform-admin');
  assert.match(result.id,/stable-test-/);
  assert.equal(result.status,'DRAFT');
  assert.equal(batch.length,2);
  assert.ok(batch.some(x=>x.sql.includes('UPDATE sh_workspaces')&&x.values[0]==='workspace-1'));
  assert.ok(batch.some(x=>x.sql.includes('INSERT INTO sh_platform_organizations')&&String(x.values[2]).startsWith('platform-org:')));
});
test('Sysadmin invitation requires ACTIVE org and does not reset linked members',async()=>{
  const sent=[];
  const {inviteSysAdmin}=createHarness({upsertMember:async(...args)=>{sent.push(args);return{inviteToken:'token1'}}});
  await assert.rejects(inviteSysAdmin(fakeDb({org:{id:'o',status:'DRAFT'}}).db,'o','a@example.com','','admin','https://smarthoreca.pages.dev'),e=>e.code==='ORG_INACTIVE');
  const invitation=await inviteSysAdmin(fakeDb().db,'org1','manager@example.com','Director','admin','https://smarthoreca.pages.dev');
  assert.equal(sent.length,1);
  assert.equal(sent[0][1],'platform-org:org1');
  assert.deepEqual([...sent[0][2].roleIds],['org-role-admin']);
  assert.equal(new URL(invitation.inviteLink).searchParams.get('invite'),'token1');
  await assert.rejects(inviteSysAdmin(fakeDb({existingUser:'linked-user'}).db,'org1','manager@example.com','','admin','https://smarthoreca.pages.dev'),e=>e.code==='MEMBER_ALREADY_LINKED');
});
test('Suspension updates just one Workspace and organization registry',async()=>{
  const {changeOrganizationStatus}=createHarness(),{db,batch}=fakeDb();
  const result=await changeOrganizationStatus(db,'org1','SUSPENDED','platformadmin');
  assert.equal(result.status,'SUSPENDED');
  assert.equal(batch.length,2);
  assert.deepEqual([...batch.map(x=>x.values[0])],['org1','ws1']);
  assert.ok(batch.every(x=>x.values[1]==='SUSPENDED'));
});
test('Workspace access checks status and prompts multi-org accounts',()=>{
  assert.match(access,/reason:'WORKSPACE_INACTIVE'/);
  assert.match(access,/!selected&&activeOptions\.length>1/);
  assert.match(site,/WORKSPACE_INACTIVE:'Доступ к организации/);
  assert.match(auth,/clearWorkspaceSelection/);
  assert.match(controller,/requirePlatformAdmin/);
});
