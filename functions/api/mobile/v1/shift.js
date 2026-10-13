import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { onRequestPost as sourceDetail } from "../../iiko/cash-shift-detail.js";
import { departmentId } from "./shifts.js";

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

export async function onRequestGet({ request, env }) {
  try {
    const id = (new URL(request.url).searchParams.get("id") || "").trim();
    if (!id || id.length > 200) {
      throw new MobileError("INVALID_SHIFT_ID", "Выберите кассовую смену.", 400);
    }
    const ctx = await mobileContext(request, env, { connectionRequired: true });
    const backendRequest = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...ctx.connection, sessionId: id,
        departmentIds: ctx.selectedIds,
        chainScope: { mode: "CHAIN", allowedDepartmentIds: ctx.availableIds }
      })
    });
    const upstream = await sourceDetail({ request: backendRequest });
    if (!upstream.ok) {
      throw new MobileError("SHIFT_UPSTREAM_FAILED", "Сервер не вернул детали смены.", 502);
    }
    const payload = await upstream.json().catch(() => null);
    return response(normalizeShiftDetail(payload, ctx.selectedIds));
  } catch (error) {
    return errorResponse(error);
  }
}
