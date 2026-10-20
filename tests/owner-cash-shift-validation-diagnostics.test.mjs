import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDepartmentCashShifts } from "../functions/api/iiko/cash-shifts.js";

const from = new Date("2026-10-19T12:00:00Z");
const to = new Date("2026-10-20T12:00:00Z");
const restaurant = "restaurant-1";

test("scoped shift keeps actual business day when opened after midnight", () => {
  const result = normalizeDepartmentCashShifts([{
    id: "shift-real-001", openDate: "2026-10-20T00:30:00",
    businessDate: "2026-10-18"
  }], from, to, "OPEN", restaurant);
  assert.equal(result.length, 1);
  assert.equal(result[0]._sessionId, "shift-real-001");
  assert.equal(result[0]._dateKey, "2026-10-18");
  assert.equal(result[0]._scopedDepartmentId, restaurant);
});

test("scoped shift parses dd.MM.yyyy from older SH Server", () => {
  const result = normalizeDepartmentCashShifts([{
    id: "shift-real-002", openDate: "20.10.2026 01:13:00",
    businessDate: "19.10.2026"
  }], from, to, "OPEN", restaurant);
  assert.equal(result[0]._dateKey, "2026-10-19");
});

test("missing immutable shift ID remains forbidden; never substitute a shift number", () => {
  assert.throws(() => normalizeDepartmentCashShifts([{
    sessionNumber: 101, openDate: "2026-10-20T02:00:00"
  }], from, to, "OPEN", restaurant),
    /не передал ID кассовой смены.*запись 1, статус OPEN/);
});

test("malformed and invalid calendar dates remain forbidden, not fabricated", () => {
  for (const date of ["", "20/10/2026", "32.10.2026", "2026-02-30"]) {
    assert.throws(() => normalizeDepartmentCashShifts([{
      id: "verified-session", openDate: date
    }], from, to, "OPEN", restaurant),
      /не передал распознаваемую дату кассовой смены/);
  }
});

test("out-of-range opening date fails even when business date is in range", () => {
  assert.throws(() => normalizeDepartmentCashShifts([{
    id: "verified-session", openDate: "2026-10-18T22:00:00",
    businessDate: "2026-10-19"
  }], from, to, "OPEN", restaurant), /вне запрошенного диапазона/);
});

test("a shift with an explicit different restaurant is never relabeled", () => {
  assert.throws(() => normalizeDepartmentCashShifts([{
    id: "verified-session", openDate: "2026-10-20T00:20:00",
    departmentId: "other-restaurant"
  }], from, to, "OPEN", restaurant), /чужую кассовую смену/);
});

test("invalid entry in multi-shift list is not silently omitted", () => {
  assert.throws(() => normalizeDepartmentCashShifts([
    {id: "shift-1", openDate: "2026-10-20T03:00:00"},
    {id: "", openDate: "2026-10-20T04:00:00"}
  ], from, to, "OPEN", restaurant), /запись 2/);
});
