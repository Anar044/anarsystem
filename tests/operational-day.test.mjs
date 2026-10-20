import test from "node:test";
import assert from "node:assert/strict";
import {
  planOperatingShifts, resolveOlapCashShiftField,
  operatingToday, getCurrentOperatingShifts
} from "../functions/api/iiko/_lib/operational-day.js";
import { normalizeDepartmentCashShifts } from "../functions/api/iiko/cash-shifts.js";

import { buildRequest } from "../functions/api/iiko/dashboard.js";

test("all website dashboard OLAP queries retain shift ID and department filters", () => {
  const result = buildRequest({
    rows:["OpenDate.Typed"],measures:["DishDiscountSumInt"],
    from:"2026-10-13",to:"2026-10-14",departmentIds:["r1","r2"],
    filters:{"Session.ID":{filterType:"IncludeValues",values:["s-1","s-2"]}}
  });
  assert.deepEqual(result.filters["Session.ID"],{
    filterType:"IncludeValues",values:["s-1","s-2"]});
  assert.deepEqual(result.filters["Department.Id"],{
    filterType:"IncludeValues",values:["r1","r2"]});
  assert.equal(result.filters["OpenDate.Typed"].from,"2026-10-13");
  assert.equal(result.filters["OpenDate.Typed"].to,"2026-10-14");
});

const s = (id, dep, date, status) => ({
  id, departmentId: dep, businessDate: date, status
});

test("midnight does not reset open-shift sales: include yesterday's active IDs", () => {
  const plan = planOperatingShifts([
    s("a-old","r1","2026-10-12","CLOSED"),
    s("a-start","r1","2026-10-13","CLOSED"),
    s("a-active","r1","2026-10-13","OPEN"),
    s("a-ignored","r1","2026-10-14","CLOSED"),
    s("b-active","r2","2026-10-14","OPEN"),
    s("foreign","r3","2026-10-13","OPEN")
  ], ["r1","r2"], "2026-10-14");
  assert.equal(plan.from,"2026-10-13");
  assert.equal(plan.to,"2026-10-14");
  assert.deepEqual(new Set(plan.shiftIds),
    new Set(["a-start","a-active","b-active"]));
  assert.equal(plan.activeShiftCount,2);
  assert.equal(plan.departments.length,2);
});

test("multiple registers on one business day are deduplicated by shift ID", () => {
  const plan = planOperatingShifts([
    s("x","r1","2026-10-13","OPEN"),
    s("x","r1","2026-10-13","OPEN"),
    s("y","r1","2026-10-13","CLOSED")
  ],["r1"],"2026-10-14");
  assert.deepEqual(new Set(plan.shiftIds),new Set(["x","y"]));
  assert.equal(plan.shiftCount,2);
});

test("inactive restaurant in CHAIN does not block active restaurant", () => {
  const plan = planOperatingShifts([
    s("active","r1","2026-10-13","OPEN")
  ],["r1","r2"],"2026-10-14");
  assert.deepEqual(plan.shiftIds,["active"]);
  const inactive = plan.departments.find(d => d.departmentId==="r2");
  assert.equal(inactive.status,"NO_RECENT_SHIFTS");
  assert.equal(inactive.shiftCount,0);
});

test("no source shifts is not misrepresented as zero revenue", () => {
  assert.throws(()=>planOperatingShifts([],["r1"],"2026-10-14"),
    e=>e.code==="OPERATING_SHIFT_NOT_FOUND");
});

test("unverified restaurant or shift identifiers fail closed", () => {
  assert.throws(()=>planOperatingShifts([
    {id:"x",businessDate:"2026-10-13",status:"OPEN"}
  ],["r1"],"2026-10-14"),
  e=>e.code==="OPERATING_SHIFT_SCOPE_UNVERIFIED");
  assert.throws(()=>planOperatingShifts([
    {departmentId:"r1",businessDate:"2026-10-13",status:"OPEN"}
  ],["r1"],"2026-10-14"),
  e=>e.code==="OPERATING_SHIFT_SCOPE_UNVERIFIED");
});

test("closed shifts can provide the last completed operating period", () => {
  const plan = planOperatingShifts([
    s("x","r1","2026-10-13","CLOSED"),
    s("y","r1","2026-10-13","CLOSED"),
    s("old","r1","2026-10-12","CLOSED")
  ],["r1"],"2026-10-14");
  assert.deepEqual(new Set(plan.shiftIds),new Set(["x","y"]));
  assert.equal(plan.activeShiftCount,0);
});

test("only globally unique cash shift fields qualify for financial OLAP", () => {
  assert.equal(resolveOlapCashShiftField([
    {name:"Session.ID"},{name:"OpenDate.Typed"}
  ]),"Session.ID");
  assert.equal(resolveOlapCashShiftField([
    {name:"SessionNumber"}, {name:"OpenDate.Typed"}
  ]),null);
  assert.equal(resolveOlapCashShiftField([
    {name:"CashShift.Id",filteringAllowed:false}
  ]),null);
});

test("Baku operating date does not depend on UTC midnight", () => {
  assert.equal(operatingToday(new Date("2026-10-14T21:00:00Z")),
    "2026-10-15");
});

test("iiko standard cash-shift DTO without department is scoped by server filter", () => {
  const from = new Date("2026-10-14T12:00:00Z");
  const to = new Date("2026-10-15T12:00:00Z");
  const rows = normalizeDepartmentCashShifts([{
    id:"session-1",sessionNumber:8,pointOfSale:"Main register",
    openDate:"2026-10-14T19:30:00", sessionStatus:"UNACCEPTED"
  }],from,to,"OPEN","restaurant-1");
  assert.equal(rows[0].departmentId,"restaurant-1");
  assert.equal(rows[0]._scopedDepartmentId,"restaurant-1");
  assert.equal(rows[0]._dateKey,"2026-10-14");
  assert.deepEqual(planOperatingShifts(rows,["restaurant-1"],"2026-10-15").shiftIds,["session-1"]);
});

test("scoped shift normalization rejects foreign restaurants, missing IDs and out-of-range dates", () => {
  const from = new Date("2026-10-14T12:00:00Z");
  const to = new Date("2026-10-15T12:00:00Z");
  const normalize = rows => normalizeDepartmentCashShifts(rows,from,to,"OPEN","restaurant-1");
  assert.throws(()=>normalize([{id:"x",departmentId:"restaurant-2",openDate:"2026-10-14"}]),/чужую/);
  assert.throws(()=>normalize([{openDate:"2026-10-14"}]),/идентификатор/);
  assert.throws(()=>normalize([{id:"x",openDate:"2026-10-13"}]),/дату/);
  assert.throws(()=>normalize({result:"ERROR",message:"failed"}),/ожидаемом формате/);
  assert.throws(()=>normalize([{id:"x",openDate:"2026-10-14",closeDate:"2026-10-14"}]),/закрытую/);
});

// Exercise the real shared iiko client with mock HTTP transport; no external
// restaurant data or credentials are used. A CHAIN shift can lack departmentId
// and still be provably scoped by iiko's departmentId query parameter.
test("operating CHAIN queries use bounded department filters and survive midnight", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const fixtures = {
    "restaurant-1|OPEN":[{id:"one-open",openDate:"2026-10-14T21:00:00",sessionStatus:"UNACCEPTED"}],
    "restaurant-1|CLOSED":[{id:"one-closed",openDate:"2026-10-14T08:00:00",closeDate:"2026-10-14T17:00:00",sessionStatus:"ACCEPTED"}],
    "restaurant-2|OPEN":[{id:"two-open",openDate:"2026-10-15T02:00:00",sessionStatus:"UNACCEPTED"}],
    "restaurant-2|CLOSED":[]
  };
  globalThis.fetch = async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/resto/api/auth")) return new Response("fake-token");
    assert.equal(url.pathname,"/resto/api/v2/cashshifts/list");
    assert.equal(url.searchParams.get("openDateFrom"),"2026-10-12");
    assert.equal(url.searchParams.get("openDateTo"),"2026-10-15");
    const dept = url.searchParams.get("departmentId");
    const status = url.searchParams.get("status");
    calls.push({dept,status});
    return Response.json(fixtures[`${dept}|${status}`] ?? []);
  };
  try {
    const plan = await getCurrentOperatingShifts(
      {ip:"127.0.0.1",port:"9999",login:"mock",password:"test"}, 
      ["restaurant-1","restaurant-2"], {today:"2026-10-15"});
    assert.equal(calls.length,4);
    assert.deepEqual(new Set(plan.shiftIds),new Set(["one-open","one-closed","two-open"]));
    assert.equal(plan.from,"2026-10-14");
    assert.equal(plan.activeShiftCount,2);
    assert.deepEqual(plan.departments.map(d=>d.departmentId),["restaurant-1","restaurant-2"]);
  } finally { globalThis.fetch = originalFetch; }
});

test("ambiguous CHAIN shift under two department filters fails closed", async () => {
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async input=>{
    const url=new URL(String(input));
    if(url.pathname.endsWith("/resto/api/auth"))return new Response("fake-token");
    if(url.searchParams.get("status")==="CLOSED")return Response.json([]);
    return Response.json([{id:"same",openDate:"2026-10-15T08:00:00"}]);
  };
  try {
    await assert.rejects(getCurrentOperatingShifts(
      {ip:"127.0.0.1",port:"9999",login:"mock",password:"test"},
      ["restaurant-1","restaurant-2"],{today:"2026-10-15"}
    ),error=>error.code==="OPERATING_SHIFT_FILTER_AMBIGUOUS");
  } finally {globalThis.fetch=originalFetch;}
});

test("shift opened today may legitimately belong to yesterday's business day", () => {
  const from = new Date("2026-10-19T12:00:00Z");
  const to = new Date("2026-10-20T12:00:00Z");
  const rows = normalizeDepartmentCashShifts([{
    id: "verified-shift-1",
    openDate: "2026-10-20T01:13:00",
    businessDate: "2026-10-18",
    sessionStatus: "UNACCEPTED",
  }], from, to, "OPEN", "restaurant-1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]._dateKey, "2026-10-18");
  assert.equal(rows[0]._scopedDepartmentId, "restaurant-1");
  const plan = planOperatingShifts(rows, ["restaurant-1"], "2026-10-20");
  assert.deepEqual(plan.shiftIds, ["verified-shift-1"]);
  assert.equal(plan.from, "2026-10-18");
  assert.equal(plan.to, "2026-10-20");
});

test("localized SH cash-shift date is accepted without assuming an identity", () => {
  const from = new Date("2026-10-19T12:00:00Z");
  const to = new Date("2026-10-20T12:00:00Z");
  const rows = normalizeDepartmentCashShifts([{
    id: "verified-shift-2", openDate: "20.10.2026 01:13:00",
    businessDate: "19.10.2026", sessionStatus: "UNACCEPTED",
  }], from, to, "OPEN", "restaurant-1");
  assert.equal(rows[0]._dateKey, "2026-10-19");
  assert.equal(planOperatingShifts(rows, ["restaurant-1"], "2026-10-20").activeShiftCount, 1);
});

test("out-of-range opening date still fails closed even if business date matches", () => {
  const from = new Date("2026-10-19T12:00:00Z");
  const to = new Date("2026-10-20T12:00:00Z");
  assert.throws(() => normalizeDepartmentCashShifts([{
    id: "out-of-range", openDate: "2026-10-18T18:00:00",
    businessDate: "2026-10-19",
  }], from, to, "OPEN", "restaurant-1"),
  /не подтвердил дату открытия/);
  assert.throws(() => normalizeDepartmentCashShifts([{
    openDate: "2026-10-20T01:00:00", businessDate: "2026-10-19",
  }], from, to, "OPEN", "restaurant-1"),
  /не подтвердил идентификатор/);
});
