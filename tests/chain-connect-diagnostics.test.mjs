import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { onRequestPost } from '../functions/api/iiko/chain.js';

const originalFetch=globalThis.fetch;
const originalCrypto=globalThis.crypto;
const creds={ip:'test-chain.invalid',port:'9132',login:'test-user',password:'test-password'};
const departmentsXML='<?xml version="1.0"?><corporateItemDtoes><corporateItemDto><id>dept-A</id><parentId>head</parentId><code>A</code><name>Restaurant A</name><type>DEPARTMENT</type></corporateItemDto><corporateItemDto><id>dept-B</id><parentId>head</parentId><code>B</code><name>Restaurant B</name><type>DEPARTMENT</type></corporateItemDto></corporateItemDtoes>';
const makeResponse=(content,status=200)=>new Response(content,{status,headers:{'Content-Type':'application/xml'}});
async function run(mockFetch,credentials=creds){
  globalThis.fetch=mockFetch;
  if(!globalThis.crypto)globalThis.crypto=webcrypto;
  try{
    const response=await onRequestPost({request:{json:async()=>credentials}});
    return{status:response.status,payload:await response.json()};
  }finally{
    globalThis.fetch=originalFetch;
    if(!originalCrypto)delete globalThis.crypto;
  }
}
test('CHAIN finds restaurants even if optional groups API fails',async()=>{
  const calls=[];
  const r=await run(async url=>{
    calls.push(String(url));
    if(String(url).includes('/resto/api/auth?'))return makeResponse('auth-token');
    if(String(url).includes('/resto/api/corporation/departments?'))return makeResponse(departmentsXML);
    if(String(url).includes('/resto/api/corporation/groups?'))return makeResponse('groups unavailable',404);
    throw Error('Unexpected endpoint: '+url);
  });
  assert.equal(r.status,200);
  assert.equal(r.payload.success,true);
  assert.equal(r.payload.mode,'CHAIN');
  assert.deepEqual(r.payload.departments.map(x=>x.id),['dept-A','dept-B']);
  assert.equal(r.payload.groups.length,0);
  assert.match(r.payload.meta.groupWarning,/HTTP 404/);
  assert.equal(calls.filter(x=>x.includes('/resto/api/auth?')).length,1);
});
test('No Department items yields structured diagnostics',async()=>{
  const r=await run(async url=>{
    if(String(url).includes('/resto/api/auth?'))return makeResponse('auth-token');
    if(String(url).includes('/resto/api/corporation/departments?'))
      return makeResponse('<corporateItemDtoes><corporateItemDto><id>corp1</id><name>Company</name><type>CORPORATION</type></corporateItemDto></corporateItemDtoes>');
    if(String(url).includes('/resto/api/corporation/groups?'))return makeResponse('<groupDtoes/>');
    throw Error('Unexpected endpoint');
  },{...creds,login:'second-user'});
  assert.equal(r.status,422);
  assert.equal(r.payload.success,false);
  assert.equal(r.payload.diagnostics.hierarchyCount,1);
  assert.deepEqual(r.payload.diagnostics.types,['CORPORATION']);
});
test('Rejected credentials never become a fake empty-department success',async()=>{
  const r=await run(async url=>{
    if(String(url).includes('/resto/api/auth?'))return makeResponse('invalid credentials',401);
    throw Error('Department API cannot be reached after failed auth');
  },{...creds,login:'third-user'});
  assert.equal(r.status,502);
  assert.equal(r.payload.success,false);
  assert.match(r.payload.message,/авторизации|401/);
});
