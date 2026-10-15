import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { onRequestPost as sourceDetail } from "../../iiko/cash-shift-detail.js";
import { departmentId, shiftId } from "./shifts.js";
import { getShiftsForDateAndStatus } from "../../iiko/cash-shifts.js";

const text = v => v === null || v === undefined || v === "" ? null : String(v);
const first = (object, fields) => {
  for (const field of fields) {
    const value = object?.[field];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
};
const money = value => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};
export function normalizeShiftDetail(payload, selectedIds) {
  if (!payload?.success || !payload.shift || typeof payload.shift !== "object") {
    throw new MobileError("SHIFT_UNAVAILABLE", "Кассовая смена недоступна.", 502);
  }
  const dep = departmentId(payload.shift);
  if (!dep) throw new MobileError("SHIFT_SCOPE_UNVERIFIED",
      "Сервер не вернул ресторан для данной кассовой смены.", 502);
  if (!selectedIds.includes(dep)) throw new MobileError("SHIFT_FORBIDDEN",
      "Нет доступа к кассовой смене этого ресторана.", 403);
  const shift = payload.shift;
  return {
    success: true,
    id: text(payload.sessionId),
    departmentId: dep,
    number: first(shift, ["sessionNumber", "shiftNumber", "number", "num"]),
    status: text(first(shift, ["status", "sessionStatus", "state"])),
    openedAt: first(shift, ["openDate", "openedAt", "openTime", "startTime"]),
    closedAt: first(shift, ["closeDate", "closedAt", "closeTime", "endTime"]),
    cashierName: first(shift, ["cashierName", "cashier", "employeeName"]),
    cashRegisterName: first(shift, ["cashRegisterName", "terminalName",
        "cashDeskName", "pointOfSaleName"]),
    revenue: money(first(shift, ["revenue", "salesSum", "salesAmount"])),
    checkCount: money(first(shift, ["checksCount", "ordersCount", "checkCount"])),
    paymentsLoaded: payload.paymentsLoaded === true,
    // Cashless payment, cash deposit and withdrawal records are intentionally
    // distinct. They MUST NOT be summed and relabeled as sales revenue.
    operations: payload.paymentsLoaded === true
      ? (Array.isArray(payload.payments) ? payload.payments : []).map(p => ({
          id: text(p.id),
          group: text(p.group),
          amount: money(p.actualSum ?? p.sum),
          paymentType: text(p.type),
          date: text(p.date ?? p.creationDate)
        }))
      : [],
    currency: "AZN",
    source: "SH Cash Shift",
    updatedAt: new Date().toISOString()
  };
}

export function verifyScopedShiftMembership(responses,id,dep,day) {
  if(responses.some(x=>!x.ok))throw new MobileError(
    "SHIFT_SCOPE_SOURCE_FAILED",
    "SH Server не подтвердил принадлежность кассовой смены ресторану.",502);
  const matches=responses.flatMap(x=>x.shifts)
    .filter(x=>shiftId(x)===id);
  if(matches.length!==1||matches[0].departmentId!==dep||
     matches[0]._dateKey!==day||matches[0]._scopedDepartmentId!==dep)
    throw new MobileError("SHIFT_NOT_IN_RESTAURANT",
      "Смена не найдена в выбранном ресторане за указанную дату.",404);
  return matches[0];
}

export async function onRequestGet({ request, env }) {
  try {
    const url=new URL(request.url);
    const id=(url.searchParams.get("id")||"").trim();
    const dep=(url.searchParams.get("departmentId")||"").trim();
    const day=(url.searchParams.get("date")||"").trim();
    if(!id || id.length>200 || !dep ||
        !/^\\d{4}-\\d{2}-\\d{2}$/.test(day) ||
        new Date(day+"T00:00:00Z").toISOString().slice(0,10)!==day)
      throw new MobileError("INVALID_SHIFT_REF",
        "Выберите кассовую смену из списка для просмотра.",400);
    const ctx=await mobileContext(request,env,{connectionRequired:true});
    if(!ctx.selectedIds.includes(dep))throw new MobileError(
      "SHIFT_FORBIDDEN","Нет доступа к этому ресторану.",403);
    // Verify that the session really belongs to the requested restaurant.
    // A byId DTO may contain no departmentId, so never trust the supplied
    // departmentId alone or authorize using byId without this scoped lookup.
    const from=new Date(day+"T12:00:00Z");
    const responses=await Promise.all(["OPEN","CLOSED"].map(status=>
      getShiftsForDateAndStatus(ctx.connection,from,status,{
        departmentId:dep,toDate:from})));
    verifyScopedShiftMembership(responses,id,dep,day);
    const internal=new Request(request.url,{
      method:"POST",headers:{"Content-Type":"application/json"},
      // Scoped ownership was verified above. The read-only byId endpoint
      // cannot filter by department; do not invoke its legacy CHAIN guard.
      body:JSON.stringify({...ctx.connection,sessionId:id})
    });
    const upstream=await sourceDetail({request:internal});
    if(!upstream.ok)throw new MobileError("SHIFT_UPSTREAM_FAILED",
      "Сервер не вернул детали смены.",502);
    const payload=await upstream.json().catch(()=>null);
    const raw=payload?.shift;
    if(!raw || (shiftId(raw) && shiftId(raw)!==id) ||
       (departmentId(raw) && departmentId(raw)!==dep))
      throw new MobileError("SHIFT_DETAIL_SCOPE_MISMATCH",
        "Получены сведения другой кассовой смены или ресторана.",409);
    return response(normalizeShiftDetail({
      ...payload, shift:{...raw,departmentId:dep}
    },ctx.selectedIds));
  }catch(error){return errorResponse(error);}
}
