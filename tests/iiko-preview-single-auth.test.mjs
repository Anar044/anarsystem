import test from "node:test";
import assert from "node:assert/strict";
import {webcrypto} from "node:crypto";
import {iikoText,clearIikoClientCache} from "../functions/api/iiko/_lib/iiko-client.js";

if(!globalThis.crypto)globalThis.crypto=webcrypto;
const config={ip:"iiko.test",port:"8080",login:"test",password:"test"};

async function withFetch(mock,body){
  const original=globalThis.fetch;
  clearIikoClientCache();
  globalThis.fetch=mock;
  try{await body()}finally{globalThis.fetch=original;clearIikoClientCache();}
}
test("an ambiguous HTTP 503 during /auth performs only one licensed login attempt",async()=>{
  let auth=0;
  await withFetch(async url=>{
    assert.match(String(url),/\/resto\/api\/auth\?/);
    auth++;
    return new Response("Service unavailable",{status:503});
  },async()=>{
    await assert.rejects(iikoText(config,"/resto/api/demo"),/iiko \/auth HTTP 503/);
    assert.equal(auth,1);
  });
});
test("429, 502 and 504 during /auth are not automatically retried",async()=>{
  for(const status of [429,502,504]){
    let auth=0;
    await withFetch(async url=>{
      assert.match(String(url),/\/resto\/api\/auth\?/);
      auth++;
      return new Response("temporarily unavailable",{status});
    },async()=>{
      await assert.rejects(iikoText(config,"/resto/api/demo"));
      assert.equal(auth,1);
    });
  }
});
test("ordinary data requests reuse token, and REST_API 403 never renews it",async()=>{
  let auth=0, data=0, keys=[];
  await withFetch(async url=>{
    if(String(url).includes("/resto/api/auth?")){
      auth++;
      return new Response("licensed-token");
    }
    data++;
    keys.push(new URL(url).searchParams.get("key"));
    return new Response(data===1?"License enhancement is required: REST_API(2000)":"ok",
      {status:data===1?403:200});
  },async()=>{
    assert.equal((await iikoText(config,"/resto/api/data")).status,403);
    assert.equal((await iikoText(config,"/resto/api/data")).status,200);
    assert.equal(auth,1);
    assert.deepEqual(keys,["licensed-token","licensed-token"]);
  });
});
test("expired session retries once, but only after a confirmed data 401",async()=>{
  let auth=0, data=0;
  await withFetch(async url=>{
    if(String(url).includes("/resto/api/auth?"))return new Response("session-"+(++auth));
    data++;
    return new Response(data===1?"unauthorized":"ok",{status:data===1?401:200});
  },async()=>{
    assert.equal((await iikoText(config,"/resto/api/data")).status,200);
    assert.equal(auth,2);
    assert.equal(data,2);
  });
});
