import { getShiftsForDateAndStatus } from "../cash-shifts.js";

// Operating-day dates are resolved in the restaurant's configured system
// timezone (all current Smart Horeca RMS are in Azerbaijan). The browser's
// timezone and midnight are not authoritative for shift membership.
export const operatingToday = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Baku", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now).replace(/\//g, "-");

const clean = v => String(v ?? "").trim();
const dateOnly = v => {
  const match = clean(v).match(/(\d{4})[-.](\d{2})[-.](\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
};
const addDays = (day, delta) => {
  const d = new Date(day + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};
const shiftDepartment = shift => [
  shift?.departmentId, shift?.departmentID, shift?.department?.id,
  shift?.department?.uuid, shift?.department?.guid,
  shift?.organizationId, shift?.organisationId, shift?.restaurantId,
  shift?.organization?.id, shift?.restaurant?.id
].map(clean).find(Boolean) || "";
const shiftId = shift => clean(
  shift?._sessionId || shift?.id || shift?.sessionId ||
  shift?.sessionID || shift?.uuid || shift?.UUID
);
const shiftBusinessDate = shift => dateOnly(
  shift?._dateKey || shift?.businessDate || shift?.operatingDay ||
  shift?.operationalDay || shift?.openDate || shift?.openedAt || shift?.openTime
);

export class OperatingDayError extends Error {
  constructor(code, message, status = 409) {
    super(message); this.code = code; this.status = status;
  }
}

// Never choose an overall earliest date and silently count every unrelated
// shift on it. Every selected department must be represented by explicit
// cash-session IDs which can be used to filter OLAP.
export function planOperatingShifts(shifts, selectedDepartments, today) {
  const selected = [...new Set((selectedDepartments || []).map(clean).filter(Boolean))];
  if (!selected.length) throw new OperatingDayError(
    "OPERATING_SCOPE_REQUIRED", "Для операционного дня выберите рестораны.");
  const groups = {};
  const idKeys = new Set();
  for (const row of shifts || []) {
    if (!row || typeof row !== "object") continue;
    const dep = shiftDepartment(row), id = shiftId(row);
    if (!dep || !id || !shiftBusinessDate(row)) {
      throw new OperatingDayError("OPERATING_SHIFT_SCOPE_UNVERIFIED",
        "SH Server не передал ресторан, дату или идентификатор кассовой смены.");
    }
    if (!selected.includes(dep)) continue;
    const key = dep + "|" + id;
    if (idKeys.has(key)) continue;
    idKeys.add(key);
    (groups[dep] ||= []).push({
      id, date: shiftBusinessDate(row),
      status: clean(row._requestedStatus || row.status || row.sessionStatus ||
        row.sessionStaus || row.state).toUpperCase()
    });
  }
  const daysByDepartment = [];
  const pickedIds = new Set();
  for (const dep of selected) {
    const all = groups[dep] || [];
    if (!all.length) {
      // An inactive restaurant must not block the whole CHAIN. The upstream
      // shift listing succeeded for every date; this one has no sessions.
      daysByDepartment.push({ departmentId:dep, operatingDates:[],
        activeShiftCount:0, shiftCount:0, status:"NO_RECENT_SHIFTS" });
      continue;
    }
    const open = all.filter(s => ["OPEN", "OPENED"].includes(s.status));
    const anchorDate = (open.length ? open : all)
      .map(s => s.date).sort()[open.length ? 0 : all.length - 1];
    // If a department has active sessions of more than one business day,
    // retain all active IDs. Include already closed sessions from each of
    // those days, so multiple POS registers are counted once.
    const dates = [...new Set((open.length ? open.map(s => s.date) : [anchorDate]))];
    const picked = all.filter(s => dates.includes(s.date));
    for (const s of picked) pickedIds.add(s.id);
    daysByDepartment.push({
      departmentId: dep, operatingDates: dates,
      activeShiftCount: open.length, shiftCount: picked.length
    });
  }
  const dateList = daysByDepartment.flatMap(d => d.operatingDates);
  if (!dateList.length || !pickedIds.size) throw new OperatingDayError(
    "OPERATING_SHIFT_NOT_FOUND",
    "На выбранных ресторанах не найдены кассовые смены за проверенный период. Продажи не обнулены.");
  return {
    mode: "operational", requestedDate: today,
    from: dateList.sort()[0], to: today,
    shiftIds: [...pickedIds],
    shiftCount: pickedIds.size,
    activeShiftCount: daysByDepartment.reduce((n,d)=>n+d.activeShiftCount,0),
    departments: daysByDepartment
  };
}

export function resolveOlapCashShiftField(fields) {
  // Only globally unique ID dimensions qualify. Names or sequential shift
  // numbers are ambiguous across restaurants/cash registers.
  const names = [
    "CashShift.Id", "CashShift.ID", "CashRegisterShift.Id",
    "CashSession.Id", "CafeSession.Id", "Session.Id", "Session.ID",
    "SessionId", "CashShiftId", "CashRegisterShiftId",
    "CafeSessionId"
  ];
  const normalized = value => clean(value).toLowerCase().replace(/[._\s-]/g, "");
  for (const name of names) {
    const field = (fields || []).find(f => normalized(f.name)===normalized(name)
      && f.filteringAllowed !== false);
    if (field) return field.name;
  }
  return null;
}

export async function getCurrentOperatingShifts(connection, departmentIds, opts = {}) {
  const today = opts.today || operatingToday();
  const lookback = Math.min(7, Math.max(1, opts.lookbackDays || 3));
  const selected = [...new Set((departmentIds || []).map(clean).filter(Boolean))];
  if (!selected.length) throw new OperatingDayError(
    "OPERATING_SCOPE_REQUIRED", "Для операционного дня выберите рестораны.");
  const from = new Date(addDays(today, -lookback) + "T12:00:00Z");
  const to = new Date(today + "T12:00:00Z");
  // The iiko cash-shift DTO often has no departmentId. Fetching an unscoped
  // list and later guessing the restaurant from selection is unsafe in CHAIN.
  // Request each restaurant explicitly using the documented departmentId
  // filter. One date-range query per status avoids 8*N day-by-day calls.
  const tasks = selected.flatMap(departmentId =>
    ["OPEN", "CLOSED"].map(status => ({ departmentId, status })));
  const result = [];
  const seen = new Map();
  let cursor = 0;
  await Promise.all(Array.from({length:Math.min(4,tasks.length)}, async () => {
    while (cursor < tasks.length) {
      const task = tasks[cursor++];
      const reply = await getShiftsForDateAndStatus(connection, from,
        task.status, { departmentId:task.departmentId, toDate:to });
      if (!reply.ok) throw new OperatingDayError("OPERATING_SHIFT_SOURCE_FAILED",
        "Не удалось подтвердить кассовые смены ресторана " + task.departmentId +
        " (статус " + task.status + "): " +
        String(reply.text || "ошибка SH Server").slice(0,160), 502);
      for (const shift of reply.shifts) {
        const id = shiftId(shift), dep = shiftDepartment(shift);
        const date = shiftBusinessDate(shift);
        if (!id || !date || dep !== task.departmentId ||
            clean(shift._scopedDepartmentId) !== task.departmentId) {
          throw new OperatingDayError("OPERATING_SHIFT_SCOPE_UNVERIFIED",
            "SH Server не подтвердил принадлежность кассовой смены ресторану.");
        }
        const previous = seen.get(id);
        if (previous) {
          // A session cannot simultaneously belong to two departments or
          // appear as OPEN and CLOSED. If either happens, the upstream filter
          // was ignored or its response is inconsistent: fail closed.
          if (previous.departmentId !== dep || previous.date !== date ||
              previous.status !== task.status) {
            throw new OperatingDayError("OPERATING_SHIFT_FILTER_AMBIGUOUS",
              "SH Server вернул одну кассовую смену в разных ресторанах, датах или статусах.");
          }
          continue;
        }
        seen.set(id, {departmentId:dep,date,status:task.status});
        result.push(shift);
      }
    }
  }));
  const plan = planOperatingShifts(result, selected, today);
  if (plan.from > plan.to) throw new OperatingDayError(
    "OPERATING_SHIFT_DATE_INVALID", "Дата кассовой смены недопустима.");
  return plan;
}
