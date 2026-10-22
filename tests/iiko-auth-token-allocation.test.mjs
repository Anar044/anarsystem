import test from 'node:test';
import assert from 'node:assert/strict';
import {getIikoAuth,clearIikoClientCache} from '../functions/api/iiko/_lib/iiko-client.js';

test('transient failure of licensed authentication does not allocate more tokens', async()=>{
  const oldFetch=globalThis.fetch;
  let calls=0,method='';
  try{
    globalThis.fetch=async(_url,init={})=>{
      calls++;method=init.method;
      return new Response('Service Unavailable',{status:503});
    };
    clearIikoClientCache();
    await assert.rejects(
      getIikoAuth({ip:'127.0.0.1',port:'8899',login:'test',password:'example'}),
      /не подтвердил авторизацию/);
    assert.equal(calls,1);
    assert.equal(method,'POST');
  }finally{
    globalThis.fetch=oldFetch;
    clearIikoClientCache();
  }
});
