import test from "node:test";
import assert from "node:assert/strict";
import { getCurrentOperatingShiftsStatusOnly } from "../functions/api/iiko/_lib/operational-day.js";

const connection = {ip:"127.0.0.1",port:"9999",login:"mock",password:"test"};

async function withMockServer(handler, callback) {
  const previous = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/resto/api/auth")) return new Response("fake-token");
    assert.equal(url.pathname, "/resto/api/v2/cashshifts/list");
    paths.push(url);
    return handler(url);
  };
  try { return await callback(paths); }
  finally { globalThis.fetch = previous; }
}

test("10+ day active shifts are included without a fixed OPEN date bound", async () => {
  await withMockServer(url => {
    assert.equal(url.searchParams.get("departmentId"), "r1");
    const status=url.searchParams.get("status");
    if (status === "OPEN") {
      assert.equal(url.searchParams.has("openDateFrom"),false);
      assert.equal(url.searchParams.has("openDateTo"),false);
      return Response.json([{id:"open-45-days",openDate:"2026-09-05T14:15:00",sessionStatus:"UNACCEPTED"}]);
    }
    assert.equal(status,"CLOSED");
    assert.equal(url.searchParams.get("openDateFrom"),"2026-09-04");
    assert.equal(url.searchParams.get("openDateTo"),"2026-10-20");
    return Response.json([{id:"closed-same-business-day",
      openDate:"2026-09-05T08:00:00",closeDate:"2026-09-05T12:00:00"}]);
  }, async paths => {
    const plan=await getCurrentOperatingShiftsStatusOnly(connection,["r1"],
      {today:"2026-10-20"});
    assert.equal(paths.length,2);
    assert.equal(plan.from,"2026-09-05");
    assert.equal(plan.to,"2026-10-20");
    assert.deepEqual(new Set(plan.shiftIds),
      new Set(["open-45-days","closed-same-business-day"]));
    assert.equal(plan.activeShiftCount,1);
  });
});

test("a date-free OPEN query rejected by the SH Server must fail closed", async () => {
  await withMockServer(url => url.searchParams.get("status")==="OPEN"
    ? new Response("date filters required",{status:400}) : Response.json([]),
    async () => assert.rejects(
      getCurrentOperatingShiftsStatusOnly(connection,["r1"],{today:"2026-10-20"}),
      e=>e.code==="OPERATING_OPEN_STATUS_UNSUPPORTED"));
});

test("a leaked shift from another department never enters report selection", async () => {
  await withMockServer(url=>Response.json(
    url.searchParams.get("status")==="OPEN"
      ? [{id:"forbidden",departmentId:"other",openDate:"2026-10-20T03:00:00"}]
      : []),
    async () => assert.rejects(
      getCurrentOperatingShiftsStatusOnly(connection,["r1"],{today:"2026-10-20"}),
      e=>e.code==="OPERATING_OPEN_STATUS_UNSUPPORTED"));
});

test("closed shifts still use a bounded recent period if no register is open", async () => {
  await withMockServer(url => {
    if (url.searchParams.get("status")==="OPEN") return Response.json([]);
    assert.equal(url.searchParams.get("openDateFrom"),"2026-10-17");
    return Response.json([{id:"recently-closed",
      openDate:"2026-10-19T14:00:00",closeDate:"2026-10-19T23:00:00"}]);
  }, async () => {
    const plan=await getCurrentOperatingShiftsStatusOnly(connection,["r1"],
      {today:"2026-10-20"});
    assert.deepEqual(plan.shiftIds,["recently-closed"]);
    assert.equal(plan.activeShiftCount,0);
  });
});
