import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { onRequestPost as sourceBalance } from "../../iiko/stock-balances.js";
import { clean, scopeMatches, safeNumber, projectionFailure } from "../_lib/query-helpers.js";

export function normalizeInventory(payload, ids, { offset = 0, pageSize = 200 } = {}) {
  if (!payload?.success || !Array.isArray(payload.rows)) {
    projectionFailure("INVENTORY_UNAVAILABLE", "Складские остатки недоступны.");
  }
  if (!scopeMatches(payload, ids)) {
    projectionFailure("INVENTORY_SCOPE_UNVERIFIED", "Не подтверждена область ресторанов в складском отчёте.");
  }
  const rows = payload.rows.map(r => ({
    productId: clean(r.productId), productName: clean(r.productName),
    productCode: clean(r.productCode), groupName: clean(r.groupName),
    categoryName: clean(r.categoryName), storeId: clean(r.storeId),
    storeName: clean(r.storeName), unit: clean(r.unit),
    quantity: safeNumber(r.amount), value: safeNumber(r.sum),
    unitCost: safeNumber(r.unitCost), minimum: safeNumber(r.minAmount),
    belowMin: r.belowMin === true,
  })).filter(r => r.productId && r.storeId);
  const warehouses = (payload.warehouses || []).map(w => ({
    id: clean(w.id), name: clean(w.name)
  })).filter(w => w.id);
  return {
    success: true, asOf: payload.timestamp, currency: "AZN",
    summary: {
      value: safeNumber(payload.summary?.totalValue),
      positions: safeNumber(payload.summary?.positions),
      negative: safeNumber(payload.summary?.negativeCount),
      belowMinimum: safeNumber(payload.summary?.belowMinCount)
    },
    warehouses,
    rows: rows.slice(offset, offset + pageSize),
    totalRows: rows.length,
    nextOffset: offset + pageSize < rows.length ? offset + pageSize : null,
    selectedDepartmentIds: ids,
    source: "SH STOCK BALANCES"
  };
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const date = clean(url.searchParams.get("date"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(Date.parse(date + "T00:00:00Z")) ||
        new Date(date + "T00:00:00Z").toISOString().slice(0,10) !== date) {
      throw new MobileError("INVALID_DATE", "Выберите корректную дату остатков.", 400);
    }
    const offset = Number(url.searchParams.get("offset") || 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100000) {
      throw new MobileError("INVALID_OFFSET", "Некорректная страница остатков.", 400);
    }
    const ctx = await mobileContext(request, env, { connectionRequired: true });
    const body = {
      ...ctx.connection, date, time: "23:59:59", includeZero: false,
      departmentIds: ctx.selectedIds, chainScope: {
        mode: "CHAIN", allowedDepartmentIds: ctx.availableIds
      }
    };
    const internal = new Request(request.url, {method:"POST",
      headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
    const upstream = await sourceBalance({request:internal});
    if (!upstream.ok) throw new MobileError("INVENTORY_SOURCE_FAILED", "SH Server не вернул остатки.", 502);
    const payload = await upstream.json().catch(() => null);
    return response(normalizeInventory(payload, ctx.selectedIds, {offset}));
  } catch (error) { return errorResponse(error); }
}
