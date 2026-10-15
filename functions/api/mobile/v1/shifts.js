import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { getShiftsForDateAndStatus } from "../../iiko/cash-shifts.js";
import { planOperatingShifts, operatingToday } from "../../iiko/_lib/operational-day.js";

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
    const rawStatus = str(first(shift, ["_requestedStatus", "status", "state",
      "sessionStatus"])).toUpperCase();
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
        "cashDeskName", "pointOfSaleName", "cashRegister",
        "pointOfSale", "cashRegNumber"]),
      revenue: amount(first(shift, ["revenue", "salesSum", "salesAmount"])),
      checks: amount(first(shift, ["checksCount", "ordersCount", "checkCount"]))
    });
  }
  return out;
}

// Authenticated mobile history uses exactly the restaurant-scoped cash-shift
// list reader that was validated for the operational dashboard. A raw unscoped
// list cannot be safely assigned to CHAIN restaurants.
export async function loadScopedCashHistory(connection, selectedIds, from, to,
    {operational = false} = {}) {
  const start = new Date(from + "T12:00:00Z");
  const end = new Date(to + "T12:00:00Z");
  const tasks = [...new Set(selectedIds)].flatMap(departmentId =>
    ["OPEN", "CLOSED"].map(status => ({departmentId,status})));
  const found = new Map();
  let cursor = 0;
  await Promise.all(Array.from({length:Math.min(4,tasks.length)},async ()=>{
    while(cursor<tasks.length){
      const {departmentId,status}=tasks[cursor++];
      const response=await getShiftsForDateAndStatus(connection,start,status,{
        departmentId,toDate:end});
      if(!response.ok)throw new MobileError("SHIFTS_UPSTREAM_FAILED",
        "SH Server не подтвердил кассовые смены ресторана: " +
        String(response.text||response.status||"Ошибка сервера").slice(0,100),502);
      for(const shift of response.shifts){
        const id=shiftId(shift), dept=departmentIdOfShift(shift);
        if(!id||dept!==departmentId||shift._scopedDepartmentId!==departmentId)
          throw new MobileError("SHIFTS_SCOPE_UNVERIFIED",
            "Не подтверждена принадлежность кассовой смены ресторану.",409);
        const previous=found.get(id);
        if(previous){
          if(previous.departmentId!==dept||previous._dateKey!==shift._dateKey||
              previous._requestedStatus!==status)
            throw new MobileError("SHIFTS_AMBIGUOUS",
              "Смена повторилась в разных ресторанах, датах или статусах.",409);
          continue;
        }
        found.set(id,shift);
      }
    }
  }));
  let rows=[...found.values()];
  if(operational && rows.length){
    const operating=planOperatingShifts(rows,selectedIds,to);
    const included=new Set(operating.shiftIds);
    rows=rows.filter(s=>included.has(shiftId(s)));
  }
  return rows.sort((a,b)=>String(b.openDate||b._dateKey||"")
    .localeCompare(String(a.openDate||a._dateKey||"")));
}
const departmentIdOfShift = shift => departmentId(shift);

export async function onRequestGet({ request, env }) {
  try {
    const { from, to } = period(request);
    const ctx = await mobileContext(request, env, { connectionRequired: true });
    const mode = new URL(request.url).searchParams.get("mode");
    const operational = mode === "operational";
    if(operational && to !== operatingToday())throw new MobileError(
      "SHIFTS_OPERATING_DATE_INVALID",
      "Текущие операционные смены доступны только для «Сегодня».",400);
    const raw=await loadScopedCashHistory(ctx.connection,ctx.selectedIds,
      from,to,{operational});
    const shifts=normalizeShifts({success:true,shifts:raw,errors:[]},
      ctx.selectedIds);
    const names=Object.fromEntries(ctx.restaurants.map(r=>[r.id,r.name]));
    return response({
      success:true,from,to,mode:operational?"operational":"calendar",
      count:shifts.length,shifts,
      restaurants:ctx.selectedIds.map(id=>({id,name:names[id]||id})),
      currency:"AZN",source:"SH Cash Shifts (department scoped)",
      updatedAt:new Date().toISOString()
    });
  }catch(error){return errorResponse(error);}
}
