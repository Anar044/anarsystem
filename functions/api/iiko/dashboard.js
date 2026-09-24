import { clean, getOlapFields, iikoJson } from "./_lib/iiko-client.js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders()
    }
  });
}

function norm(value) {
  return clean(value).toLowerCase().replace(/[\s._()-]+/g, "");
}

function fieldName(fields, candidates) {
  for (const candidate of candidates) {
    const q = norm(candidate);
    const exact = fields.find(field => norm(field.name) === q || norm(field.title) === q);
    if (exact) return exact.name;
  }
  for (const candidate of candidates) {
    const q = norm(candidate);
    const partial = fields.find(field => norm(field.name).includes(q) || norm(field.title).includes(q));
    if (partial) return partial.name;
  }
  return null;
}

function buildRequest(q) {
  const rows = Array.isArray(q.rows) ? q.rows.filter(Boolean) : [];
  const cols = Array.isArray(q.columns) ? q.columns.filter(Boolean) : [];
  const measures = Array.isArray(q.measures) ? q.measures.filter(Boolean) : [];
  const from = clean(q.from).slice(0, 10);
  const to = clean(q.to || q.from).slice(0, 10);
  const filters = q.filters && typeof q.filters === "object" && !Array.isArray(q.filters)
    ? { ...q.filters }
    : {};

  if (from && to) {
    filters[q.dateField || "OpenDate.Typed"] = {
      filterType: "DateRange",
      periodType: "CUSTOM",
      from,
      to,
      includeLow: true,
      includeHigh: true
    };
  }

  if (Array.isArray(q.departmentIds) && q.departmentIds.length && q.departmentField) {
    filters[q.departmentField] = {
      filterType: "IncludeValues",
      values: [...new Set(q.departmentIds.map(String).filter(Boolean))]
    };
  }

  if (filters.DeletedWithWriteoff === undefined) {
    filters.DeletedWithWriteoff = { filterType: "IncludeValues", values: ["NOT_DELETED"] };
  }
  if (filters.OrderDeleted === undefined) {
    filters.OrderDeleted = { filterType: "IncludeValues", values: ["NOT_DELETED"] };
  }

  return {
    reportType: "SALES",
    buildSummary: true,
    groupByRowFields: rows,
    groupByColFields: cols,
    aggregateFields: measures,
    filters
  };
}

async function query(connection, q) {
  const request = buildRequest(q);
  if (!request.groupByRowFields.length && !request.groupByColFields.length && !request.aggregateFields.length) {
    return { success: false, report: { data: [], summary: [] }, request };
  }

  const result = await iikoJson(connection, "/resto/api/v2/reports/olap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request)
  });
  const report = result.payload;

  if (!result.ok) {
    return {
      success: false,
      error: `iiko OLAP HTTP ${result.status}: ${(report?.message || report?.error || result.text).slice(0, 3000)}`,
      request,
      report
    };
  }
  return { success: true, request, report };
}

function reportRows(result) {
  return Array.isArray(result?.report?.data) ? result.report.data : [];
}

function number(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function aggregateBy(result, groupField, measures) {
  if (!groupField || !result?.success) {
    return { success: true, request: result?.request || {}, report: { data: [], summary: [] }, derived: true };
  }

  const groups = new Map();
  for (const row of reportRows(result)) {
    const key = String(row?.[groupField] ?? row?.[String(groupField).toLowerCase()] ?? "");
    if (!groups.has(key)) groups.set(key, { [groupField]: row?.[groupField] ?? key });
    const target = groups.get(key);
    for (const measure of measures.filter(Boolean)) {
      target[measure] = number(target[measure]) + number(row?.[measure] ?? row?.[String(measure).toLowerCase()]);
    }
  }

  return {
    success: true,
    request: { ...(result.request || {}), groupByRowFields: [groupField] },
    report: { data: [...groups.values()], summary: [] },
    derived: true
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const connection = {
      ip: clean(body.ip),
      port: clean(body.port),
      login: clean(body.login),
      password: String(body.password ?? "")
    };

    if (!connection.ip || !connection.port || !connection.login || !connection.password) {
      return jsonResponse({ success: false, message: "Заполните IP, порт, логин и пароль iiko" }, 400);
    }

    const from = clean(body.from).slice(0, 10);
    const to = clean(body.to || body.from).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return jsonResponse({ success: false, message: "Укажите корректный период" }, 400);
    }

    const fieldResult = await getOlapFields(connection, "SALES");
    const fields = fieldResult.fields;

    const dateField = fieldName(fields, ["OpenDate.Typed", "OpenDate"]);
    const revenueField = fieldName(fields, ["DishDiscountSumInt", "DishSumInt", "Sales"]);
    const orderField = fieldName(fields, ["UniqOrderId", "UniqOrderId.Id"]);
    const categoryField = fieldName(fields, ["DishCategory", "DishCategory.Accounting", "Product.Category"]);
    const dishField = fieldName(fields, ["DishName", "Product.Name", "Dish"]);
    const amountField = fieldName(fields, ["DishAmountInt", "Amount"]);
    const payField = fieldName(fields, ["PayTypes", "PayTypes.Group", "PaymentType"]);
    const hourField = fieldName(fields, ["OpenHour", "OpenTime.Hour", "Hour", "Час открытия"]);
    const profitField = fieldName(fields, ["ProductCostBase.Profit", "Profit"]);
    const departmentField = fieldName(fields, ["Department.Id", "Department.ID", "DepartmentId"]);

    if (!dateField || !revenueField) {
      return jsonResponse({
        success: false,
        message: "Не найдены необходимые OLAP-поля даты или выручки.",
        fields
      }, 502);
    }

    const departmentIds = Array.isArray(body.departmentIds)
      ? [...new Set(body.departmentIds.map(String).map(x => x.trim()).filter(Boolean))]
      : [];

    if (departmentIds.length && !departmentField) {
      return jsonResponse({
        success: false,
        message: "Не найдено OLAP-поле Department.Id — Dashboard нельзя безопасно ограничить выбранным рестораном."
      }, 502);
    }

    const common = { from, to, dateField, departmentIds, departmentField };
    const timelineMeasures = [revenueField, orderField, profitField].filter(Boolean);

    // Three iiko OLAP requests normally cover the whole dashboard:
    // 1) date+hour timeline -> daily + hourly charts
    // 2) dishes+category -> top dishes + category chart
    // 3) payment types
    const timelinePromise = query(connection, {
      ...common,
      rows: [dateField, ...(hourField ? [hourField] : [])],
      measures: timelineMeasures
    });

    const dishesPromise = dishField
      ? query(connection, {
          ...common,
          rows: [dishField, ...(categoryField ? [categoryField] : [])],
          measures: [revenueField, ...(amountField ? [amountField] : [])]
        })
      : (categoryField
          ? query(connection, { ...common, rows: [categoryField], measures: [revenueField] })
          : Promise.resolve({ success: true, request: {}, report: { data: [], summary: [] }, skipped: true }));

    const paymentsPromise = payField
      ? query(connection, { ...common, rows: [payField], measures: [revenueField] })
      : Promise.resolve({ success: true, request: {}, report: { data: [], summary: [] }, skipped: true });

    const [timeline, dishSource, payments] = await Promise.all([
      timelinePromise,
      dishesPromise,
      paymentsPromise
    ]);

    if (!timeline.success) {
      throw new Error(timeline.error || "Ошибка основного OLAP запроса Dashboard");
    }

    const daily = aggregateBy(timeline, dateField, timelineMeasures);
    const hours = hourField
      ? aggregateBy(timeline, hourField, [revenueField])
      : { success: true, request: {}, report: { data: [], summary: [] }, derived: true };

    let categories;
    let dishes;
    if (dishField) {
      dishes = dishSource;
      categories = categoryField
        ? aggregateBy(dishSource, categoryField, [revenueField])
        : { success: true, request: {}, report: { data: [], summary: [] }, derived: true };
    } else {
      dishes = { success: true, request: {}, report: { data: [], summary: [] }, skipped: true };
      categories = dishSource;
    }

    const iikoQueryCount =
      1 +
      (dishSource?.skipped ? 0 : 1) +
      (payments?.skipped ? 0 : 1);

    return jsonResponse({
      success: true,
      from,
      to,
      departmentIds,
      fields,
      revenueField,
      orderField,
      categoryField,
      dishField,
      amountField,
      payField,
      hourField,
      profitField,
      departmentField,
      reports: { daily, categories, payments, dishes, hours },
      meta: {
        browserApiRequests: 1,
        iikoQueryCount,
        olapFieldsCacheHit: fieldResult.cacheHit === true,
        timelineDerivedReports: true,
        categoryDerivedFromDishes: Boolean(dishField && categoryField),
        departmentScopeApplied: departmentIds.length > 0
      }
    });
  } catch (error) {
    return jsonResponse({ success: false, message: error?.message || "Ошибка Dashboard OLAP" }, 502);
  }
}
