import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { onRequestPost as sourceShifts } from "../../iiko/cash-shifts.js";

const str = v => String(v ?? "").trim();
export const departmentId = item => {
  for (const value of [
    item?.departmentId, item?.departmentID, item?.department?.id,
    item?.department?.uuid, item?.department?.guid, item?.departmentGuid,
    item?.organizationId, item?.organisationId, item?.restaurantId,
    item?.organization?.id, item?.organisation?.id, item?.restaurant?.id
  ]) {
    if (str(value)) return str(value);
  }
  return "";
};
export const shiftId = item => str(item?._sessionId || item?.sessionId ||
    item?.sessionID || item?.id || item?.uuid || item?.UUID);

const first = (item, names) => {
  for (const name of names) {
    const value = item?.[name];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
};
const amount = value => {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};
const isDay = s => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = new Date(s + "T00:00:00.000Z");
  return Number.isFinite(t.getTime()) && t.toISOString().slice(0, 10) === s;
};
function period(request) {
  const url = new URL(request.url);
  const from = str(url.searchParams.get("from"));
  const to = str(url.searchParams.get("to") || from);
  if (!isDay(from) || !isDay(to) || from > to) {
    throw new MobileError("INVALID_PERIOD", "Выберите корректный период.", 400);
  }
  const days = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000;
  if (days > 6) {
    throw new MobileError("PERIOD_TOO_LONG", "Можно загрузить не более 7 дней за один раз.", 400);
  }
  return { from, to };
}

export function normalizeShifts(payload, selectedIds) {
  if (!payload?.success || !Array.isArray(payload.shifts)) {
    throw new MobileError("SHIFTS_UNAVAILABLE", "Кассовые смены недоступны.", 502);
  }
  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new MobileError("SHIFTS_PARTIAL", "SH Server вернул неполные сведения о сменах. Попробуйте меньший период.", 502);
  }
  const allowed = new Set(selectedIds);
  if (!allowed.size) {
    throw new MobileError("NO_RESTAURANT_SELECTION", "Не выбран ресторан.", 400);
  }
  const out = [];
  for (const shift of payload.shifts) {
    const dept = departmentId(shift);
    const id = shiftId(shift);
    // Never reveal unknown or other-restaurant shifts, even when the whole
    // CHAIN is selected. A partially populated upstream response is unsafe.
    if (!dept) throw new MobileError("SHIFTS_SCOPE_UNVERIFIED",
        "SH Server не передал подразделение кассовой смены.", 502);
    if (!allowed.has(dept)) throw new MobileError("SHIFTS_SCOPE_MISMATCH",
        "Не удалось проверить принадлежность кассовой смены ресторану.", 502);
    if (!id) throw new MobileError("SHIFTS_NO_ID",
        "SH Server не передал номер кассовой смены.", 502);
    const rawStatus = str(first(shift, ["status", "sessionStatus", "state",
      "_requestedStatus"])).toUpperCase();
    const status = rawStatus.includes("CLOSE") ? "CLOSED" :
      rawStatus.includes("OPEN") ? "OPEN" : "UNKNOWN";
    out.push({
      id, departmentId: dept,
      number: first(shift, ["sessionNumber", "shiftNumber", "number", "num"]),
      date: first(shift, ["_dateKey", "businessDate", "operationDay", "date"]),
      status,
      openedAt: first(shift, ["openDate", "openedAt", "openTime", "startTime"]),
      closedAt: first(shift, ["closeDate", "closedAt", "closeTime", "endTime"]),
      cashierName: first(shift, ["cashierName", "cashier", "employeeName"]),
      cashRegisterName: first(shift, ["cashRegisterName", "terminalName",
        "cashDeskName", "pointOfSaleName", "cashRegister"]),
      revenue: amount(first(shift, ["revenue", "salesSum", "salesAmount"])),
      checks: amount(first(shift, ["checksCount", "ordersCount", "checkCount"]))
    });
  }
  return out;
}

export async function onRequestGet({ request, env }) {
  try {
    const { from, to } = period(request);
    const ctx = await mobileContext(request, env, { connectionRequired: true });
    const body = {
      ...ctx.connection, from, to,
      departmentIds: ctx.selectedIds,
      chainScope: {
        mode: "CHAIN",
        allowedDepartmentIds: ctx.availableIds
      }
    };
    const backendRequest = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const upstream = await sourceShifts({ request: backendRequest });
    if (!upstream.ok) {
      throw new MobileError("SHIFTS_UPSTREAM_FAILED", "Ошибка загрузки кассовых смен.", 502);
    }
    const payload = await upstream.json().catch(() => null);
    const shifts = normalizeShifts(payload, ctx.selectedIds);
    const names = Object.fromEntries(ctx.restaurants.map(r => [r.id, r.name]));
    return response({
      success: true, from, to,
      count: shifts.length, shifts,
      restaurants: ctx.selectedIds.map(id => ({ id, name: names[id] || id })),
      currency: "AZN",
      source: "SH Cash Shifts",
      updatedAt: new Date().toISOString()
    });
  } catch (error) {
    return errorResponse(error);
  }
}
