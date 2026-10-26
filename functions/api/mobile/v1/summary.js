import { mobileContext, response, errorResponse, MobileError, ownerBrokerContext, ownerBrokerFailure } from "../_lib/context.js";
import { onRequestPost as dashboardSummary } from "../../iiko/dashboard-summary.js";

const clean = value => String(value ?? "").trim();
function validDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) &&
    !Number.isNaN(Date.parse(s + "T00:00:00Z")) &&
    new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;
}
function rowsOf(report) {
  let rows = report?.rawResponse ?? report?.data ?? report ?? [];
  if (typeof rows === "string") {
    try { rows = JSON.parse(rows); } catch { rows = []; }
  }
  return Array.isArray(rows) ? rows : (Array.isArray(rows?.data) ? rows.data : []);
}
function numberFrom(row, field, fields) {
  if (!field) return null;
  const displayName = fields.find(f => f.name === field)?.title;
  const raw = Object.prototype.hasOwnProperty.call(row, field)
    ? row[field] : (displayName ? row[displayName] : undefined);
  if (raw === undefined || raw === null || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
function sumField(rows, field, fields) {
  if (!field) return null;
  let sum = 0, hasValue = false;
  for (const row of rows) {
    const value = numberFrom(row, field, fields);
    if (value === null) continue;
    sum += value;
    hasValue = true;
  }
  return hasValue ? sum : null;
}

export function verifiedCostOfGoods({revenue,profit,revenueField,profitField}) {
  // Do not subtract arbitrary "Profit" from unverified revenue aliases.
  const exactRevenue = ["DishDiscountSumInt","DishSumInt"].includes(revenueField);
  if (!exactRevenue || profitField !== "ProductCostBase.Profit" ||
      !Number.isFinite(revenue) || !Number.isFinite(profit)) return null;
  const result = Number((revenue - profit).toFixed(4));
  // Different currencies/scope or incompatible aggregators must fail closed,
  // rather than showing a negative or a suspiciously small "cost".
  return result >= -0.001 ? Math.max(0,result) : null;
}

export function normalizeSummary(payload) {
  if (!payload?.success || !payload.reports?.daily?.success) {
    throw new MobileError("DASHBOARD_DATA_UNAVAILABLE", "Нет достоверных данных по продажам.", 502);
  }
  const fields = Array.isArray(payload.fields) ? payload.fields : [];
  const rows = rowsOf(payload.reports.daily.report);
  const revenue = sumField(rows, payload.revenueField, fields);
  const checks = sumField(rows, payload.orderField, fields);
  const profit = sumField(rows, payload.profitField, fields);
  // The standalone discounts report groups by discount type and register.
  // Using its identical dimensions, measure and filters avoids displaying
  // a small, unrelated date-aggregate value on Dashboard.
  const discountSource = payload.reports.discountReport;
  const surchargeSource = payload.reports.surchargeReport;
  const discounts = discountSource?.success
    ?sumField(rowsOf(discountSource.report),payload.discountField,fields)
    :null;
  const surcharges = surchargeSource?.success
    ?sumField(rowsOf(surchargeSource.report),payload.surchargeField,fields)
    :null;
  // ProductCostBase.Cost in a date-grouped OLAP result can be a unit cost,
  // not the aggregated cost of goods (e.g. 2.58 vs 93,509 AZN).
  // On iiko SALES, ProductCostBase.Profit is the gross contribution after
  // recipe cost. Both measures are sourced from the SAME rows, scope and
  // period; subtracting yields the report-equivalent cost of goods.
  // Never sum the cost-price field or invent a zero on missing metrics.
  const costOfGoods = verifiedCostOfGoods({
    revenue, profit, revenueField: payload.revenueField,
    profitField: payload.profitField
  });
  // Null distinguishes unavailable values from genuine zero.
  const avgCheck = checks !== null && checks > 0 && revenue !== null
    ? revenue / checks : null;
  const dateField = payload.reports.daily.request?.groupByRowFields?.[0] || "OpenDate.Typed";
  const daily = rows.map(row => {
    const date = clean(row[dateField] ?? row[fields.find(f => f.name === dateField)?.title]).slice(0, 10);
    return { date, revenue: numberFrom(row, payload.revenueField, fields) };
  }).filter(r => validDate(r.date))
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    success: true,
    from: payload.from,
    to: payload.to,
    mode: payload.mode || "calendar",
    operatingDay: payload.operatingDay || null,
    metrics: { revenue, checks, avgCheck, grossProfit: profit,
      discounts, surcharges, costOfGoods },
    adjustmentsSource: "SH_OLAP_SALES_REPORT_MATCHED",
    costOfGoodsSource: costOfGoods === null ? "UNAVAILABLE" :
      "SALES_REVENUE_MINUS_PRODUCT_COST_GROSS_PROFIT",
    daily,
    currency: "AZN",
    source: "SH OLAP SALES",
    updatedAt: new Date().toISOString(),
    scope: {
      selectedDepartmentIds: payload.departmentIds,
      departmentScopeApplied: payload.meta?.departmentScopeApplied === true
    }
  };
}

// Surface a safe, actionable license diagnostic without exposing iiko
// upstream response bodies, usernames, session tokens, or other tenants.
export function ownerSummarySourceError(payload) {
  const descriptions = [
    payload?.message,
    payload?.reports?.daily?.error,
    payload?.reports?.discountReport?.error,
    payload?.reports?.surchargeReport?.error
  ].filter(v => typeof v === "string");
  if (descriptions.some(value =>
      /license enhancement is required|no connections available for module/i.test(value))) {
    return new MobileError("IIKO_LICENSE_SEATS_UNAVAILABLE",
      "Все лицензированные подключения к серверу учёта заняты. Проверьте активные сеансы и лицензии.",503);
  }
  return null;
}

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const from = clean(url.searchParams.get("from")), to = clean(url.searchParams.get("to") || from);
    if (!validDate(from) || !validDate(to) || from > to) {
      throw new MobileError("INVALID_PERIOD", "Укажите правильный период.", 400);
    }
    const days = (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000;
    if (days > 31) throw new MobileError("PERIOD_TOO_LONG", "Период ограничен 32 днями.", 400);
    const mode = url.searchParams.get("mode") === "operational"
      ? "operational" : "calendar";
    const ctx = await mobileContext(request, env, { connectionRequired: true });
    // Reuse the existing authoritative server OLAP logic; credentials remain
    // exclusively inside the Cloudflare Function.
    const backendRequest = new Request(request.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...ctx.connection, from, to, mode,
        // Explicit IDs for *all* selections, including full CHAIN: never
        // accidentally query unrelated departments if an OLAP account is broad.
        departmentIds: ctx.selectedIds
      })
    });
    const upstream = await dashboardSummary({ request: backendRequest ,...ownerBrokerContext(ctx,env)});
    const payload = await upstream.json().catch(() => null);
    const sourceError = ownerSummarySourceError(payload);
    if (sourceError) throw sourceError;
    // A broker's safe error code travels through the internal dashboard
    // handler as payload.message. Map it BEFORE the generic 502 wrapper.
    const brokerError = ownerBrokerFailure(payload?.message);
    if (brokerError) throw brokerError;
    if (!upstream.ok || !payload?.success) {
      const code = String(payload?.code || "OLAP_FAILED");
      let message = typeof payload?.message === "string"
        ? payload.message : "Не удалось получить отчёт SH OLAP.";
      if (code === "OPERATING_SHIFT_SOURCE_FAILED") {
        // The failed department was selected and already authorized by
        // mobileContext. Use its display name instead of a raw UUID.
        for (const restaurant of ctx.restaurants || []) {
          const id = clean(restaurant?.id);
          if (id && ctx.selectedIds.includes(id) && message.includes(id)) {
            message = message.replace(id, clean(restaurant?.name) || id);
            break;
          }
        }
      }
      throw new MobileError(code, message, upstream.status === 409 ? 409 : 502);
    }
    const normalized = normalizeSummary(payload);
    if (!normalized.scope.departmentScopeApplied) {
      throw new MobileError("OLAP_SCOPE_UNVERIFIED", "Не удалось проверить область ресторанов.", 502);
    }
    return response(normalized);
  } catch (error) {
    return errorResponse(error);
  }
}
