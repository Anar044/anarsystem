import test from "node:test";
import assert from "node:assert/strict";
import {
  planOperatingShifts, resolveOlapCashShiftField,
  operatingToday
} from "../functions/api/iiko/_lib/operational-day.js";

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
