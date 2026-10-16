import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { iikoText, clearIikoClientCache } from "../functions/api/iiko/_lib/iiko-client.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const connection = { ip: "127.0.0.1", port: "8080", login: "demo", password: "test" };

async function withServer(responses, callback) {
  const originalFetch = globalThis.fetch;
  const calls = { auth: 0, data: 0, tokens: [] };
  clearIikoClientCache();
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes("/resto/api/auth?")) {
      calls.auth++;
      return new Response("session-" + calls.auth, { status: 200 });
    }
    calls.data++;
    calls.tokens.push(new URL(url).searchParams.get("key"));
    const item = responses[Math.min(calls.data - 1, responses.length - 1)];
    return new Response(item.body, { status: item.status });
  };
  try {
    await callback(calls);
  } finally {
    globalThis.fetch = originalFetch;
    clearIikoClientCache();
  }
}

test("REST_API(2000) license HTTP 403 does not create a second iiko session", async () => {
  await withServer([{
    status: 403,
    body: "License enhancement is required: no connections available for module REST_API(2000)"
  }], async calls => {
    const result = await iikoText(connection, "/resto/api/test");
    assert.equal(result.status, 403);
    assert.match(result.text, /REST_API\(2000\)/);
    assert.equal(calls.auth, 1);
    assert.equal(calls.data, 1);
  });
});

test("ordinary HTTP 403 also does not force a new iiko login", async () => {
  await withServer([{ status: 403, body: "Forbidden" }], async calls => {
    const result = await iikoText(connection, "/resto/api/test");
    assert.equal(result.status, 403);
    assert.equal(calls.auth, 1);
    assert.equal(calls.data, 1);
  });
});

test("HTTP 401 still retries once with a freshly authenticated token", async () => {
  await withServer([
    { status: 401, body: "Invalid token" },
    { status: 200, body: "ok" }
  ], async calls => {
    const result = await iikoText(connection, "/resto/api/test");
    assert.equal(result.status, 200);
    assert.equal(result.text, "ok");
    assert.deepEqual(calls.tokens, ["session-1", "session-2"]);
    assert.equal(calls.auth, 2);
    assert.equal(calls.data, 2);
  });
});

test("failed 403 request leaves cached token reusable in the same worker instance", async () => {
  await withServer([
    { status: 403, body: "REST_API(2000) no connections available" },
    { status: 200, body: "ok" }
  ], async calls => {
    assert.equal((await iikoText(connection, "/resto/api/test")).status, 403);
    assert.equal((await iikoText(connection, "/resto/api/test")).status, 200);
    assert.deepEqual(calls.tokens, ["session-1", "session-1"]);
    assert.equal(calls.auth, 1);
  });
});
