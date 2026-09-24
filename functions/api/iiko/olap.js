import { clean, getOlapFields, iikoJson } from "./_lib/iiko-client.js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...corsHeaders()
    }
  });
}

function requestId() {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  } catch (_) {}
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function credentials(body) {
  const connection = {
    ip: clean(body?.ip),
    port: clean(body?.port),
    login: clean(body?.login),
    password: String(body?.password ?? "")
  };
  if (!connection.ip || !connection.port || !connection.login || !connection.password) {
    throw new Error("Заполните IP, порт, логин и пароль iiko");
  }
  return connection;
}

function normalizeField(technicalName, meta, index = 0, forcedMeasure = false) {
  if (typeof meta === "string") {
    const name = clean(technicalName || meta);
    if (!name) return null;
    return {
      name,
      field: name,
      key: name,
      id: name,
      technicalName: name,
      title: name,
      type: "unknown",
      isMeasure: forcedMeasure,
      aggregationAllowed: forcedMeasure,
      groupingAllowed: true,
      filteringAllowed: true,
      tags: [],
      index
    };
  }

  if (!meta || typeof meta !== "object") return null;

  const name = clean(
    technicalName ||
    meta.technicalName ||
    meta.technical_name ||
    meta.field ||
    meta.key ||
    meta.code ||
    meta.id ||
    meta.name
  );
  if (!name) return null;

  const aggregationAllowed =
    forcedMeasure ||
    meta.aggregationAllowed === true ||
    meta.allowAggregation === true ||
    meta.canAggregate === true;

  return {
    ...meta,
    name,
    field: name,
    key: name,
    id: name,
    technicalName: name,
    title: clean(meta.title || meta.caption || meta.label || meta.displayName || meta.display_name || meta.name || name),
    type: clean(meta.type || meta.dataType || meta.data_type || meta.kind || meta.fieldType || "unknown"),
    aggregationAllowed,
    groupingAllowed: meta.groupingAllowed !== false,
    filteringAllowed: meta.filteringAllowed !== false,
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    isMeasure: meta.isMeasure === true || meta.measure === true || aggregationAllowed,
    index
  };
}

function normalizeColumns(raw) {
  const result = [];

  const add = (name, meta, forcedMeasure = false) => {
    const field = normalizeField(name, meta, result.length, forcedMeasure);
    if (field) result.push(field);
  };

  const addList = (items, forcedMeasure = false) => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (typeof item === "string") add(item, { name: item }, forcedMeasure);
      else if (item && typeof item === "object") {
        add(
          item.technicalName || item.field || item.key || item.code || item.id || item.name,
          item,
          forcedMeasure || item.isMeasure === true || item.measure === true || item.aggregationAllowed === true
        );
      }
    }
  };

  if (Array.isArray(raw)) {
    addList(raw);
  } else if (raw && typeof raw === "object") {
    addList(raw.fields);
    addList(raw.columns);
    addList(raw.dimensions);
    addList(raw.measures, true);

    for (const [key, value] of Object.entries(raw)) {
      if (["fields", "columns", "dimensions", "measures", "data", "items"].includes(key)) continue;
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      add(
        key,
        value,
        value.aggregationAllowed === true || value.isMeasure === true || value.measure === true
      );
    }
  }

  const map = new Map();
  for (const field of result) {
    const key = field.name.toLowerCase();
    if (!map.has(key)) {
      map.set(key, field);
      continue;
    }
    const old = map.get(key);
    map.set(key, {
      ...old,
      ...field,
      title: field.title || old.title,
      isMeasure: old.isMeasure || field.isMeasure,
      aggregationAllowed: old.aggregationAllowed || field.aggregationAllowed
    });
  }

  return [...map.values()].map((field, index) => ({ ...field, index }));
}

async function getOlapColumns(connection, reportType, rid) {
  const metadata = await getOlapFields(connection, reportType);
  const fields = normalizeColumns(metadata.raw || metadata.fields);
  if (!fields.length) {
    throw new Error("iiko вернул 0 OLAP-полей. Проверьте reportType и права пользователя iiko.");
  }

  console.log(`[OLAP][${rid}] COLUMNS`, reportType, `count=${fields.length}`, `cache=${metadata.cacheHit ? "hit" : "miss"}`);

  return {
    raw: metadata.raw || metadata.fields,
    fields,
    cacheHit: metadata.cacheHit === true
  };
}

function toArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(item => {
    if (typeof item === "string") return clean(item);
    if (item && typeof item === "object") {
      return clean(item.technicalName || item.field || item.name || item.key || item.code || item.id);
    }
    return "";
  }).filter(Boolean);
}

function normalizeFilterOperator(operator) {
  const value = clean(operator).toLowerCase();
  if (["exclude", "not equal", "notequal", "excludelist", "excludevalues", "exclude_list"].includes(value)) {
    return "ExcludeValues";
  }
  if (["daterange", "date_range"].includes(value)) return "DateRange";
  return "IncludeValues";
}

function addArrayFilter(filters, item) {
  const field = clean(item?.field || item?.technicalName || item?.name || item?.key || item?.code || item?.id);
  if (!field) return;

  const operator = normalizeFilterOperator(item?.operator);
  if (operator === "DateRange") {
    const from = clean(item?.from).slice(0, 10);
    const to = clean(item?.to || item?.from).slice(0, 10);
    if (!from || !to) return;
    filters[field] = {
      filterType: "DateRange",
      periodType: "CUSTOM",
      from,
      to,
      includeLow: true,
      includeHigh: true
    };
    return;
  }

  if (Array.isArray(item?.values)) {
    filters[field] = {
      filterType: operator,
      values: item.values.filter(value => value !== "")
    };
    return;
  }

  if (item?.value !== undefined && item?.value !== null && item?.value !== "") {
    filters[field] = {
      filterType: operator,
      values: [item.value]
    };
  }
}

function buildRequest(body) {
  const reportType = clean(body.reportType || "SALES").toUpperCase();
  const rows = toArray(body.groupByRowFields ?? body.rows);
  const columns = toArray(body.groupByColumnFields ?? body.groupByColFields ?? body.columns);
  const measures = Array.isArray(body.measures)
    ? body.measures.map(item => {
        if (typeof item === "string") return clean(item);
        return clean(item?.technicalName || item?.field || item?.name || item?.key || item?.code || item?.id);
      }).filter(Boolean)
    : toArray(body.aggregateFields);

  let filters = {};
  if (body.filters && typeof body.filters === "object" && !Array.isArray(body.filters)) {
    filters = JSON.parse(JSON.stringify(body.filters));
  }
  if (Array.isArray(body.filters)) {
    for (const item of body.filters) addArrayFilter(filters, item);
  }

  if (body.from || body.to) {
    const from = clean(body.from).slice(0, 10);
    const to = clean(body.to || body.from).slice(0, 10);
    if (from && to) {
      filters["OpenDate.Typed"] = {
        filterType: "DateRange",
        periodType: "CUSTOM",
        from,
        to,
        includeLow: true,
        includeHigh: true
      };
    }
  }

  return {
    reportType,
    buildSummary: body.buildSummary !== false,
    groupByRowFields: rows,
    groupByColFields: columns,
    aggregateFields: measures,
    filters
  };
}

async function runQuery(connection, body, rid) {
  const request = buildRequest(body);

  if (!request.groupByRowFields.length && !request.groupByColFields.length && !request.aggregateFields.length) {
    return {
      success: false,
      type: "EMPTY_QUERY",
      message: "Выберите хотя бы одно поле в Строки, Колонки или Показатели",
      request
    };
  }

  let result;
  try {
    result = await iikoJson(connection, "/resto/api/v2/reports/olap", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request)
    });
  } catch (error) {
    return {
      success: false,
      type: "FETCH_ERROR",
      message: `Ошибка соединения с iiko OLAP: ${error?.message || "fetch failed"}`,
      request
    };
  }

  const report = result.payload;
  const text = result.text;

  console.log(`[OLAP][${rid}] QUERY HTTP`, result.status, "length", text.length);
  console.log(`[OLAP][${rid}] QUERY REQUEST`, JSON.stringify(request));

  if (!result.ok) {
    const detail = report && typeof report === "object"
      ? report.message || report.error || report.description || text.slice(0, 5000)
      : text.slice(0, 5000);
    return {
      success: false,
      type: "IIKO_ERROR",
      message: `iiko OLAP HTTP ${result.status}${detail ? `: ${detail}` : ""}`,
      iikoHttpStatus: result.status,
      iikoStatusText: result.statusText,
      request,
      report,
      meta: {
        sharedIikoClient: true,
        authCacheHit: result.auth?.cacheHit === true
      }
    };
  }

  const errorInsideBody = report && typeof report === "object" && (
    report.error === true ||
    report.success === false ||
    report.errorMessage ||
    report.errorCode
  );

  if (errorInsideBody) {
    const detail = report.message || report.errorMessage || report.errorCode || "iiko вернул ошибку внутри HTTP 200";
    return {
      success: false,
      type: "IIKO_BODY_ERROR",
      message: `iiko OLAP HTTP 200: ${detail}`,
      iikoHttpStatus: result.status,
      request,
      report,
      meta: {
        sharedIikoClient: true,
        authCacheHit: result.auth?.cacheHit === true
      }
    };
  }

  return {
    success: true,
    type: "SUCCESS",
    iikoHttpStatus: result.status,
    request,
    report,
    meta: {
      sharedIikoClient: true,
      authCacheHit: result.auth?.cacheHit === true
    }
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestGet() {
  return jsonResponse({
    success: false,
    type: "METHOD_NOT_ALLOWED",
    message: "OLAP GET отключён. Используйте авторизованный POST-запрос."
  }, 405);
}

export async function onRequestPost(context) {
  const rid = requestId();
  try {
    let body;
    try {
      body = await context.request.json();
    } catch (_) {
      return jsonResponse({
        success: false,
        requestId: rid,
        type: "INVALID_JSON",
        message: "Request body не является JSON"
      }, 400);
    }

    const connection = credentials(body);
    const reportType = clean(body.reportType || "SALES").toUpperCase();
    const action = clean(body.action || "query").toLowerCase();

    if (action === "fields") {
      const result = await getOlapColumns(connection, reportType, rid);
      return jsonResponse({
        success: true,
        action: "fields",
        requestId: rid,
        reportType,
        count: result.fields.length,
        fields: result.fields,
        raw: result.raw,
        meta: {
          sharedIikoClient: true,
          olapFieldsCacheHit: result.cacheHit
        }
      });
    }

    if (action === "query") {
      const result = await runQuery(connection, body, rid);
      const status = result.success
        ? 200
        : Math.min(599, Math.max(400, Number(result.iikoHttpStatus) || 502));
      return jsonResponse({ ...result, requestId: rid }, status);
    }

    return jsonResponse({
      success: false,
      requestId: rid,
      type: "UNKNOWN_ACTION",
      message: `Неизвестное действие OLAP: ${action}`,
      availableActions: ["fields", "query"]
    }, 400);
  } catch (error) {
    console.error(`[OLAP][${rid}] POST ERROR`, error);
    return jsonResponse({
      success: false,
      requestId: rid,
      type: "FUNCTION_ERROR",
      message: error?.message || "Ошибка OLAP Function",
    }, 502);
  }
}
