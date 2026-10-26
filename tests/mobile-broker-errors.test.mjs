import test from "node:test";
import assert from "node:assert/strict";
import {ownerBrokerFailure,errorResponse} from "../functions/api/mobile/_lib/context.js";
import {readFileSync} from "node:fs";

for(const code of ["FORBIDDEN","CONFIG_MISSING","ENCRYPTION_CONFIG_INVALID","TARGET_DENIED","BAD_REQUEST","BROKER_BUSY","AUTH_UNCERTAIN","AUTH_FAILED"]){
  test("Owner shows safe error for broker "+code,async()=>{
    const upstream="SH central iiko broker "+code+" (HTTP 403). Direct authorization blocked. privatePassword=never-echo";
    const mapped=ownerBrokerFailure(upstream);
    assert.equal(mapped.code,"IIKO_BROKER_"+code);
    assert.equal(mapped.status,502);
    assert.ok(mapped.message.length>20);
    assert.equal(mapped.message.includes("HTTP"),false);
    assert.equal(mapped.message.includes("privatePassword"),false);
    const res=await errorResponse(new Error(upstream));
    assert.equal(res.status,502);
    const body=await res.json();
    assert.equal(body.code,mapped.code);
    assert.equal(body.message,mapped.message);
    assert.equal(JSON.stringify(body).includes("privatePassword"),false);
  });
}
test("non-broker errors cannot be incorrectly classified",()=>{
  for(const value of ["iiko auth HTTP 403","Temporary issue","SH central iiko broker SOMETHING_UNKNOWN (HTTP 503)","PRIVATE FORBIDDEN PASSWORD"])
    assert.equal(ownerBrokerFailure(value),null);
});
test("Owner Summary maps internal broker error before generic OLAP failure",()=>{
  const source=readFileSync("functions/api/mobile/v1/summary.js","utf8");
  assert.match(source,/ownerBrokerFailure\(payload\?\.message\)/);
  assert.match(source,/if \(brokerError\) throw brokerError/);
  assert.ok(source.indexOf("ownerBrokerFailure(payload?.message)")<
    source.indexOf("if (!upstream.ok || !payload?.success)"));
});
