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
  runInNewContext(registerFunction+';globalThis.start=initRegister;',ctx);
  await ctx.start();
  assert.equal(form.style.display,'none');
  const btn=buttons.find(x=>x.type==='button'&&typeof x.onclick==='function');
  assert.ok(btn);
  await btn.onclick();
  assert.equal(sb.otp.email,'rms.manager@example.test');
  assert.equal(sb.otp.options.shouldCreateUser,true);
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
