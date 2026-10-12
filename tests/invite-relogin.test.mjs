import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const auth=readFileSync(new URL('../auth.js',import.meta.url),'utf8');
const site=readFileSync(new URL('../site-access.js',import.meta.url),'utf8');
const server=readFileSync(new URL('../functions/api/access/_lib/access-control.js',import.meta.url),'utf8');
function extract(src,from,to){
  const a=src.indexOf(from),b=src.indexOf(to,a+from.length);
  assert.ok(a>=0&&b>a,'Function boundaries not found: '+from);
  return src.slice(a,b);
}
const loginSource=extract(auth,'    async function initLogin() {','    async function initRegister() {');
const siteSource=extract(site,'  function pendingInvite(){','  async function selectWorkspace(');
const claimSource=extract(server,'async function claimInviteByToken(','async function claimLegacyEmailInvite(');

function loginHarness({query='?next=%2Fdashboard',currentUser=null,signInUser=null}={}){
  const redirects=[],claims=[],removed=[],messages=[],authCalls=[];
  let submit;
  const form={
    addEventListener:(name,handler)=>{assert.equal(name,'submit');submit=handler},
    querySelector:()=>({dataset:{},disabled:false,textContent:'Войти'})
  };
  const sb={auth:{signInWithPassword:async args=>{
    authCalls.push(args);
    return{data:{user:signInUser},error:null};
  }}};
  const ctx={
    window:{location:{search:query,replace:url=>redirects.push(url)}},
    URLSearchParams,
    localStorage:{removeItem:key=>removed.push(key),getItem:()=>{throw Error('Login must not read stale invite')}},
    captureInvite:()=>new URLSearchParams(query).get('invite'),
    invitePreview:async()=>({email:'already@example.test',workspace:{name:'Test Ofis Chain'}}),
    requireConfigured:()=>true,createClient:async()=>sb,
    getUser:async()=>currentUser,
    claimInvitedWorkspace:async(_,token)=>{claims.push(token);return{ok:true}},
    invitationPasswordPending:()=>false,
    invitePasswordUrl:()=>'/invite-password.html',
    invitedUserMessage:x=>x,
    invitationSignOut:()=>{throw Error('Should not sign out')},
    redirectTarget:()=>'/dashboard',
    byId:id=>id==='login-form'?form:id==='login-email'?{value:'already@example.test'}:id==='login-password'?{value:'password-has-been-set'}:null,
    showMessage:(...args)=>messages.push(args),
    setBusy:()=>{},
  };
  runInNewContext(loginSource+';globalThis.run=initLogin;',ctx);
  return{run:ctx.run,redirects,claims,removed,authCalls,messages,submit:()=>submit};
}
test('Existing active user with leftover invite token enters by password without claiming it',async()=>{
  const h=loginHarness({signInUser:{id:'supabase-account'}});
  await h.run();
  assert.deepEqual(h.removed,['sh_pending_invite']);
  await h.submit()({preventDefault(){}});
  assert.equal(h.authCalls.length,1);
  assert.deepEqual(h.claims,[]);
  assert.deepEqual(h.redirects,['/dashboard']);
  assert.ok(h.messages.every(args=>args[0]==='' || /Test Ofis Chain/.test(args[0])));
});
test('Already signed-in member ignores leftover invitation during normal login',async()=>{
  const h=loginHarness({currentUser:{id:'supabase-account'}});
  await h.run();
  assert.deepEqual(h.claims,[]);
  assert.deepEqual(h.redirects,['/dashboard']);
  assert.deepEqual(h.removed,['sh_pending_invite']);
});
test('Explicit new invite is still claimable while login uses an existing password',async()=>{
  const h=loginHarness({query:'?invite=valid-new-invite',signInUser:{id:'existing-account'}});
  await h.run();
  await h.submit()({preventDefault(){}});
  assert.deepEqual(h.claims,['valid-new-invite']);
  assert.deepEqual(h.redirects,['/dashboard']);
  assert.deepEqual(h.removed,[]);
});
test('Site access never replays a stale saved token on dashboard/HR pages',()=>{
  const removed=[];
  const ctx={URLSearchParams,location:{search:'?view=employees'},localStorage:{
    getItem:()=>{throw Error('Do not read sh_pending_invite')},
    removeItem:value=>removed.push(value)
  }};
  runInNewContext(siteSource+';globalThis.run=pendingInvite;',ctx);
  assert.equal(ctx.run(),'');
  assert.deepEqual(removed,['sh_pending_invite']);
  ctx.location.search='?invite=fresh-token';
  assert.equal(ctx.run(),'fresh-token');
  assert.deepEqual(removed,['sh_pending_invite']);
});
function claimHarness({status='ACCEPTED',memberUser='member-1',memberStatus='ACTIVE',email='member@example.test'}={}){
  const writes=[],queries=[];
  const member={id:'membership-1',owner_user_id:'platform-org:test',user_id:memberUser,status:memberStatus};
  const invite={id:'invite-1',owner_user_id:'platform-org:test',member_id:'membership-1',email,status,
    expires_at:'2020-01-01T00:00:00Z'};
  const db={prepare:sql=>{
    queries.push(sql);
    return {
      bind(...args){this.args=args;return this},
      first:async()=>sql.includes('sh_workspace_invites')?invite:
        sql.includes('sh_access_members')?member:null,
      run:async()=>{writes.push(sql);return{success:true}}
    };
  },batch:async stmts=>{writes.push(...stmts);return []}};
  const ctx={
    tokenHash:async()=> 'opaque-hash',
    emailKey:x=>String(x||'').toLowerCase().trim(),
    clean:x=>String(x||'').trim(),
    NOW:()=>new Date().toISOString(),
    ensureOwnerWorkspace:async()=>({id:'org-1',owner_user_id:'platform-org:test'}),
    db:null
  };
  runInNewContext(claimSource+';globalThis.claim=claimInviteByToken;',ctx);
  return{run:ctx.claim,db,writes,queries};
}
test('Accepted invite retry is idempotent ONLY for its original verified Supabase user',async()=>{
  const h=claimHarness();
  const r=await h.run(h.db,{id:'member-1'},'member@example.test','previously-used');
  assert.equal(r.ok,true);
  assert.equal(r.alreadyAccepted,true);
  assert.equal(h.writes.length,0);
  assert.match(h.queries[0],/WHERE token_hash=\?1 LIMIT 1/);
});
test('Old invite cannot be reused by another Supabase user even with same email',async()=>{
  const h=claimHarness();
  const r=await h.run(h.db,{id:'attacker-account'},'member@example.test','previously-used');
  assert.equal(r.ok,false);
  assert.equal(r.reason,'INVITE_ALREADY_USED');
  assert.equal(h.writes.length,0);
});
test('Consumed invite does not reactivate a disabled member',async()=>{
  const h=claimHarness({memberStatus:'DISABLED'});
  const r=await h.run(h.db,{id:'member-1'},'member@example.test','previously-used');
  assert.equal(r.ok,true);
  assert.equal(h.writes.length,0);
  assert.equal(r.member.status,'DISABLED');
  // resolveAccessForUser must still enforce the disabled state after the claim.
  assert.match(server,/MEMBERSHIP_'\+String\(row\.status\)/);
});
test('Revoked link cannot be reused even by former member',async()=>{
  const h=claimHarness({status:'REVOKED'});
  const r=await h.run(h.db,{id:'member-1'},'member@example.test','revoked');
  assert.equal(r.ok,false);
  assert.equal(r.reason,'INVITE_NOT_FOUND');
});
