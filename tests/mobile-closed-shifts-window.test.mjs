import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDepartmentCashShifts
} from "../functions/api/iiko/cash-shifts.js";
import {
  getCurrentOperatingShifts
} from "../functions/api/iiko/_lib/operational-day.js";

const from = new Date("2026-10-17T12:00:00Z");
const to = new Date("2026-10-20T12:00:00Z");
const dept = "sc12";

test("historical CLOSED response rows outside the requested window do not break the SC12 dashboard", () => {
  const rows = normalizeDepartmentCashShifts([
    {id:"old-closed",openDate:"2026-10-14T00:02:00",closeDate:"2026-10-15T00:30:00"},
    {id:"recent-closed",openDate:"2026-10-19T00:24:00",closeDate:"2026-10-20T00:01:00"},
  ], from,to,"CLOSED",dept);
  assert.deepEqual(rows.map(r=>r._sessionId),["recent-closed"]);
  assert.equal(rows[0]._scopedDepartmentId,dept);
});

test("closed shift opened earlier but tied to a verified in-range operating day is retained", () => {
  const rows = normalizeDepartmentCashShifts([
    {id:"shift-extended",openDate:"2026-10-14T18:00:00",businessDate:"2026-10-19"}
  ],from,to,"CLOSED",dept);
  assert.equal(rows[0]._sessionId,"shift-extended");
  assert.equal(rows[0]._dateKey,"2026-10-19");
});

test("OPEN shift outside requested opening dates is never silently dropped", () => {
  assert.throws(() => normalizeDepartmentCashShifts([
    {id:"still-open",openDate:"2026-10-10T13:00:00"}
  ],from,to,"OPEN",dept),/вне запрошенного диапазона/);
});

test("malformed and foreign historical CLOSED records still fail safely", () => {
  assert.throws(()=>normalizeDepartmentCashShifts([
    {id:"foreign",departmentId:"different",openDate:"2026-10-14"}
  ],from,to,"CLOSED",dept), /чужую кассовую смену/);
  assert.throws(()=>normalizeDepartmentCashShifts([
    {id:"",openDate:"2026-10-14"}
  ],from,to,"CLOSED",dept), /не передал ID/);
  assert.throws(()=>normalizeDepartmentCashShifts([
    {id:"bad",openDate:"not a date"}
  ],from,to,"CLOSED",dept), /не передал распознаваемую дату/);
  assert.throws(()=>normalizeDepartmentCashShifts([
    {id:"future",openDate:"2026-10-21",businessDate:"2026-10-20"}
  ],from,to,"CLOSED",dept), /вне запрошенного диапазона/);
});

test("end-to-end operating plan excludes old CLOSED rows while keeping current open and closed IDs", async () => {
  const originalFetch=globalThis.fetch;
  const connection={ip:"127.0.0.1",port:"9999",login:"test",password:"test"};
  const calls=[];
  globalThis.fetch=async input=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith("/resto/api/auth"))return new Response("test-token");
    assert.equal(url.pathname,"/resto/api/v2/cashshifts/list");
    assert.equal(url.searchParams.get("departmentId"),dept);
    calls.push(url.searchParams.get("status"));
    if(url.searchParams.get("status")==="OPEN")return Response.json([
      {id:"sc12-current-open",openDate:"2026-10-20T00:02:00",sessionStatus:"UNACCEPTED"}
    ]);
    return Response.json([
      {id:"irrelevant-old",openDate:"2026-10-14T08:00:00",closeDate:"2026-10-15T12:00:00"},
      {id:"today-closed",openDate:"2026-10-20T01:00:00",closeDate:"2026-10-20T11:00:00"}
    ]);
  };
  try {
    const result=await getCurrentOperatingShifts(connection,[dept],{today:"2026-10-20"});
    assert.deepEqual(new Set(result.shiftIds),new Set(["sc12-current-open","today-closed"]));
    assert.equal(result.activeShiftCount,1);
    assert.deepEqual(calls.sort(),["CLOSED","OPEN"]);
  } finally {globalThis.fetch=originalFetch;}
});
