import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const src=readFileSync(new URL('../auth.js',import.meta.url),'utf8');
function slice(first,last){
  const start=src.indexOf('    '+first),end=src.indexOf('    '+last,start);
  assert.ok(start>=0&&end>start,'Cannot locate auth.js source: '+first);
  return src.slice(start,end);
}
const helpers=slice('function inviteCallbackUrl(', 'function redirectTarget(');
const registerFunction=slice('async function initRegister(', 'async function initForgotPassword(');
const callbackFunction=slice('async function initCallback(', 'async function initSiteAccess(');
const passwordFunction=slice('async function initInvitePassword(', 'async function initCallback(');

test('Invitation email callback contains claim token without relying on original browser storage',()=>{
  const ctx={URL,window:{location:{origin:'https://smarthoreca.pages.dev'}}};
  runInNewContext(helpers+'; globalThis.callback=inviteCallbackUrl;',ctx);
  const url=new URL(ctx.callback('token-mobile-not-persistent'));
  assert.equal(url.pathname,'/auth-callback.html');
  assert.equal(url.searchParams.get('invite'),'token-mobile-not-persistent');
});
test('Confirmed email session applies invite with Bearer token and clears old invitation',async()=>{
  const calls=[],removed=[];
  const ctx={
    URL,encodeURIComponent,
    window:{location:{origin:'https://smarthoreca.pages.dev'}},
    localStorage:{removeItem:name=>removed.push(name)},
    fetch:async(url,opts)=>{
      calls.push({url,opts});
      return{ok:true,json:async()=>({access:{allowed:true,workspace:{name:'TEST CHAIN'}}})};
    }
  };
  runInNewContext(helpers+';globalThis.claim=claimInvitedWorkspace;',ctx);
  const sb={auth:{getSession:async()=>({data:{session:{access_token:'verified-access-jwt'}}})}};
  const result=await ctx.claim(sb,'invite-abc');
  assert.equal(result.ok,true);
  assert.equal(calls[0].url,'/api/access/me?invite=invite-abc');
  assert.equal(calls[0].opts.headers.Authorization,'Bearer verified-access-jwt');
  assert.deepEqual(removed,['sh_pending_invite']);
});
test('No identity proof can accept invitation, even if invite token exists',async()=>{
  let called=0;
  const ctx={
    URL,encodeURIComponent,window:{location:{origin:'https://smarthoreca.pages.dev'}},
    fetch:async()=>{called++;throw Error('Unexpected request')}
  };
  runInNewContext(helpers+';globalThis.claim=claimInvitedWorkspace;',ctx);
  const result=await ctx.claim({auth:{getSession:async()=>({data:{session:null}})}},'invite');
  assert.equal(result.ok,false);
  assert.equal(result.reason,'UNAUTHENTICATED');
  assert.equal(called,0);
});
test('Mismatched email is rejected without discarding invitation',async()=>{
  const removed=[];
  const ctx={
    URL,encodeURIComponent,
    window:{location:{origin:'https://smarthoreca.pages.dev'}},
    localStorage:{removeItem:x=>removed.push(x)},
    fetch:async()=>({ok:false,json:async()=>({access:{allowed:false,reason:'INVITE_EMAIL_MISMATCH'}})})
  };
  runInNewContext(helpers+';globalThis.claim=claimInvitedWorkspace;',ctx);
  const res=await ctx.claim({auth:{getSession:async()=>({data:{session:{access_token:'jwt'}}})}},'invite');
  assert.equal(res.ok,false);
  assert.equal(res.reason,'INVITE_EMAIL_MISMATCH');
  assert.equal(removed.length,0);
});
test('New invited user sees passwordless email flow without full registration form',async()=>{
  const buttons=[],messages=[],card={insertBefore(x){buttons.push(x)},querySelector(selector){return{set textContent(v){}}}};
  const form={style:{}},sb={auth:{signInWithOtp:async args=>{sb.otp=args;return{error:null}},signUp:()=>{throw Error('Must not register via signUp')}}};
  const ctx={
    window:{location:{origin:'https://smarthoreca.pages.dev',replace:()=>{throw Error('Unexpected redirect')}}},
    URL,encodeURIComponent,
    document:{querySelector:s=>s==='.auth-card'?card:null,createElement:()=>({})},
    captureInvite:()=> 'one-use-token',
    invitePreview:async()=>({email:'rms.manager@example.test',workspace:{name:'TEST CHAIN'}}),
    getUser:async()=>null,requireConfigured:()=>true,createClient:async()=>sb,
    byId:id=>id==='register-form'?form:null,
    setBusy:()=>{},showMessage:(...args)=>messages.push(args)
  };
  runInNewContext(helpers+registerFunction+';globalThis.start=initRegister;',ctx);
  await ctx.start();
  assert.equal(form.style.display,'none');
  const btn=buttons.find(x=>x.type==='button'&&typeof x.onclick==='function');
  assert.ok(btn);
  await btn.onclick();
  assert.equal(sb.otp.email,'rms.manager@example.test');
  assert.equal(sb.otp.options.shouldCreateUser,true);
  assert.equal(sb.otp.options.data.sh_invite_password_pending,true);
  const callback=new URL(sb.otp.options.emailRedirectTo);
  assert.equal(callback.searchParams.get('invite'),'one-use-token');
  assert.ok(messages.some(x=>/Письмо отправлено/.test(x[0])));
});
test('Confirmation email callback claims workspace before opening dashboard',async()=>{
  const messages=[],replaced=[],claimCalls=[];
  const ctx={
    URLSearchParams,window:{location:{search:'?invite=signed-link',replace:x=>replaced.push(x)}},
    captureInvite:()=> 'signed-link',requireConfigured:()=>true,
    createClient:async()=>({auth:{getSession:async()=>({data:{session:{access_token:'jwt'}}})}}),
    claimInvitedWorkspace:async(sb,token)=>{claimCalls.push(token);return{ok:true}},
    showMessage:(...args)=>messages.push(args),
    setTimeout:fn=>fn()
  };
  runInNewContext(callbackFunction+';globalThis.go=initCallback;',ctx);
  await ctx.go();
  assert.deepEqual(claimCalls,['signed-link']);
  assert.deepEqual(replaced,['index.html']);
  assert.ok(messages.some(x=>/Готово/.test(x[0])));
});
test('Invite claim errors block dashboard redirect and keep recovery instructions',async()=>{
  const messages=[],replaced=[];
  const ctx={
    URLSearchParams,window:{location:{search:'?invite=signed-link',replace:x=>replaced.push(x)}},
    captureInvite:()=> 'signed-link',requireConfigured:()=>true,
    createClient:async()=>({auth:{getSession:async()=>({data:{session:{access_token:'jwt'}}})}}),
    claimInvitedWorkspace:async()=>({ok:false,reason:'INVITE_EMAIL_MISMATCH'}),
    invitedUserMessage:reason=>reason==='INVITE_EMAIL_MISMATCH'?'Email не совпадает':'',
    showMessage:(...args)=>messages.push(args),setTimeout:fn=>fn()
  };
  runInNewContext(callbackFunction+';globalThis.go=initCallback;',ctx);
  await ctx.go();
  assert.equal(replaced.length,0);
  assert.match(messages.at(-1)[0],/Email не совпадает/);
});

test('Legacy anarsystem auth callback forwards invite and Supabase tokens to Smart Horeca',()=>{
  const canonical=readFileSync(new URL('../auth-canonical-origin.js',import.meta.url),'utf8');
  const redirects=[],errors=[];
  runInNewContext(canonical,{
    URL,Set,
    window:{location:{
      href:'https://anarsystem.pages.dev/auth-callback.html?invite=abc%2B123&code=confirm-code#access_token=opaque',
      replace:url=>redirects.push(url)
    }},
    console:{error:text=>errors.push(text)}
  });
  assert.equal(redirects.length,1);
  const u=new URL(redirects[0]);
  assert.equal(u.origin,'https://smarthoreca.pages.dev');
  assert.equal(u.searchParams.get('invite'),'abc+123');
  assert.equal(u.searchParams.get('code'),'confirm-code');
  assert.equal(u.hash,'#access_token=opaque');
  assert.equal(errors.length,0);
});
test('Canonical redirect does not affect normal pages or already-canonical auth',()=>{
  const canonical=readFileSync(new URL('../auth-canonical-origin.js',import.meta.url),'utf8');
  for(const href of ['https://anarsystem.pages.dev/dashboard','https://smarthoreca.pages.dev/auth-callback.html?invite=abc']){
    const redirects=[];
    runInNewContext(canonical,{
      URL,Set,
      window:{location:{href,replace:url=>redirects.push(url)}},
      console:{error:()=>{}}
    });
    assert.equal(redirects.length,0);
  }
});


test('Newly invited OTP user is redirected to password setup, not the dashboard',async()=>{
  const messages=[],redirects=[];
  const ctx={
    URLSearchParams,
    window:{location:{search:'?invite=secure-token',replace:v=>redirects.push(v)}},
    captureInvite:()=> 'secure-token',requireConfigured:()=>true,
    createClient:async()=>({auth:{getSession:async()=>({data:{session:{
      access_token:'signed-jwt',
      user:{user_metadata:{sh_invite_password_pending:true}}
    }}})}}),
    claimInvitedWorkspace:async()=>({ok:true}),
    invitationPasswordPending:user=>user?.user_metadata?.sh_invite_password_pending===true,
    invitePasswordUrl:()=>'/invite-password.html',
    showMessage:(...args)=>messages.push(args),
    setTimeout:()=>{throw Error('New account must not reach dashboard yet')}
  };
  runInNewContext(callbackFunction+';globalThis.go=initCallback;',ctx);
  await ctx.go();
  assert.deepEqual(redirects,['/invite-password.html']);
  assert.ok(messages.some(x=>/придумайте пароль/.test(x[0])));
});
test('Existing password user accepts an additional organization without changing password',async()=>{
  const redirects=[],messages=[];
  const ctx={
    URLSearchParams,
    window:{location:{search:'?invite=other-org',replace:v=>redirects.push(v)}},
    captureInvite:()=> 'other-org',requireConfigured:()=>true,
    createClient:async()=>({auth:{getSession:async()=>({data:{session:{
      access_token:'jwt',
      user:{user_metadata:{sh_invite_password_initialized:true}}
    }}})}}),
    claimInvitedWorkspace:async()=>({ok:true}),
    invitationPasswordPending:()=>false,
    invitePasswordUrl:()=>'/invite-password.html',
    showMessage:(...args)=>messages.push(args),
    setTimeout:fn=>fn()
  };
  runInNewContext(callbackFunction+';globalThis.go=initCallback;',ctx);
  await ctx.go();
  assert.deepEqual(redirects,['index.html']);
});
test('First-time password setup confirms both entries and persists credentials only in Supabase',async()=>{
  const redirects=[],messages=[],updates=[];
  let handler;
  const inputs={
    'invite-password':{value:'a-secure-secret'},
    'invite-password-confirm':{value:'a-secure-secret'},
    'invite-password-email':{textContent:''}
  };
  const button={disabled:false,dataset:{},textContent:'Сохранить пароль и продолжить'};
  const form={addEventListener:(event,fn)=>{assert.equal(event,'submit');handler=fn},querySelector:()=>button};
  const sb={auth:{
    getSession:async()=>({data:{session:{access_token:'jwt'}}}),
    getUser:async()=>({data:{user:{email:'new@example.test',user_metadata:{sh_invite_password_pending:true}}}}),
    updateUser:async obj=>{updates.push(obj);return{error:null}}
  }};
  const ctx={
    window:{location:{replace:v=>redirects.push(v)}},
    createClient:async()=>sb,requireConfigured:()=>true,
    byId:id=>id==='invite-password-form'?form:inputs[id],
    invitationPasswordPending:user=>!!user?.user_metadata?.sh_invite_password_pending,
    showMessage:(...args)=>messages.push(args),
    setBusy:(el,on)=>{el.disabled=on}
  };
  runInNewContext(passwordFunction+';globalThis.go=initInvitePassword;',ctx);
  await ctx.go();
  assert.equal(inputs['invite-password-email'].textContent,'new@example.test');
  await handler({preventDefault(){}});
  assert.equal(updates.length,1);
  assert.equal(updates[0].password,'a-secure-secret');
  assert.equal(updates[0].data.sh_invite_password_pending,false);
  assert.equal(updates[0].data.sh_invite_password_initialized,true);
  assert.equal(inputs['invite-password'].value,'');
  assert.equal(inputs['invite-password-confirm'].value,'');
  assert.deepEqual(redirects,['index.html']);
  assert.ok(messages.some(([text])=>/Пароль сохранён/.test(text)));
});
test('Password mismatch never changes account or redirects',async()=>{
  const messages=[],redirects=[];
  let submit,called=0;
  const input={ 'invite-password':{value:'abcdefgh'},'invite-password-confirm':{value:'abcdefgh2'} };
  const auth={getSession:async()=>({data:{session:{access_token:'jwt'}}}),
    getUser:async()=>({data:{user:{user_metadata:{sh_invite_password_pending:true}}}}),
    updateUser:async()=>{called++}};
  const ctx={
    window:{location:{replace:v=>redirects.push(v)}},
    createClient:async()=>({auth}),requireConfigured:()=>true,
    byId:id=>id==='invite-password-form'?{addEventListener:(x,cb)=>{submit=cb},querySelector:()=>({})}:input[id],
    invitationPasswordPending:()=>true,showMessage:(...args)=>messages.push(args),setBusy:()=>{}
  };
  runInNewContext(passwordFunction+';globalThis.go=initInvitePassword;',ctx);
  await ctx.go();
  await submit({preventDefault(){}});
  assert.equal(called,0);
  assert.equal(redirects.length,0);
  assert.ok(messages.some(([msg])=>/не совпадают/i.test(msg)));
});
test('Protected pages redirect password-pending users instead of opening dashboard',()=>{
  assert.match(src,/if \(invitationPasswordPending\(user\)\) \{\s*window\.location\.replace\(invitePasswordUrl\(\)\)/);
  const page=readFileSync(new URL('../invite-password.html',import.meta.url),'utf8');
  assert.match(page,/data-auth-page="invite-password"/);
  assert.match(page,/id="invite-password"/);
  assert.match(page,/id="invite-password-confirm"/);
});
