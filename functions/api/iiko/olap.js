// ============================================================
// ANAR SYSTEM — IIKO OLAP API
// functions/api/iiko/olap.js
//
// Исправления:
// 1. /columns поддерживает объект, массив и обёртки fields/columns.
// 2. Техническое имя поля берётся из КЛЮЧА объекта iiko.
// 3. Никаких искусственных 29 полей внутри backend.
// 4. Ошибка iiko 400/500 больше НЕ превращается в HTTP 200.
// 5. Frontend получает реальный iiko HTTP status + raw response.
// 6. measures принимаются как строки или {field, aggregation}.
// ============================================================

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
            ...corsHeaders()
        }
    });
}

function requestId() {
    try {
        if (crypto?.randomUUID) return crypto.randomUUID();
    } catch (_) {}

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function sha1(text) {
    const data = new TextEncoder().encode(text);

    const hash =
        await crypto.subtle.digest(
            "SHA-1",
            data
        );

    return Array.from(
        new Uint8Array(hash)
    )
        .map(
            b =>
                b
                    .toString(16)
                    .padStart(2, "0")
        )
        .join("");
}

function clean(value) {
    return String(value ?? "").trim();
}

function credentials(body) {

    const ip =
        clean(body.ip);

    const port =
        clean(body.port);

    const login =
        clean(body.login);

    const password =
        String(body.password ?? "");

    if (
        !ip ||
        !port ||
        !login ||
        !password
    ) {
        throw new Error(
            "Заполните IP, порт, логин и пароль iiko"
        );
    }

    return {
        ip,
        port,
        login,
        password
    };
}


// ============================================================
// AUTH
// ============================================================

async function authenticate(
    ip,
    port,
    login,
    password,
    rid
) {

    const serverUrl =
        `http://${ip}:${port}`;

    const pass =
        await sha1(password);

    const url =
        `${serverUrl}/resto/api/auth` +
        `?login=${encodeURIComponent(login)}` +
        `&pass=${pass}`;

    console.log(
        `[OLAP][${rid}] AUTH`,
        serverUrl,
        login
    );

    let response;

    try {

        response =
            await fetch(
                url,
                {
                    method: "GET"
                }
            );

    } catch (error) {

        throw new Error(
            `Не удалось подключиться к iiko Server: ${error?.message || "fetch failed"}`
        );
    }

    const text =
        (
            await response.text()
        ).trim();

    console.log(
        `[OLAP][${rid}] AUTH HTTP`,
        response.status
    );

    if (
        !response.ok ||
        !text
    ) {

        throw new Error(
            `Ошибка авторизации iiko: HTTP ${response.status}` +
            (
                text
                    ? ` — ${text.slice(0, 1000)}`
                    : ""
            )
        );
    }

    return {
        serverUrl,
        token: text
    };
}


// ============================================================
// NORMALIZE FIELD
// ============================================================

function normalizeField(
    technicalName,
    meta,
    index = 0,
    forcedMeasure = false
) {

    if (
        typeof meta === "string"
    ) {

        return {
            name:
                technicalName ||
                meta,

            title:
                technicalName ||
                meta,

            type:
                "unknown",

            isMeasure:
                forcedMeasure,

            aggregationAllowed:
                forcedMeasure,

            groupingAllowed:
                true,

            filteringAllowed:
                true,

            tags:
                [],

            index
        };
    }

    if (
        !meta ||
        typeof meta !== "object"
    ) {
        return null;
    }

    const name =
        clean(
            technicalName ||
            meta.field ||
            meta.key ||
            meta.code ||
            meta.id ||
            meta.name
        );

    if (!name) {
        return null;
    }

    const title =
        clean(
            meta.title ||
            meta.caption ||
            meta.label ||
            meta.displayName ||
            meta.name ||
            name
        );

    const type =
        clean(
            meta.type ||
            meta.dataType ||
            meta.kind ||
            meta.fieldType ||
            "unknown"
        );

    const aggregationAllowed =
        forcedMeasure ||
        meta.aggregationAllowed === true ||
        meta.allowAggregation === true ||
        meta.canAggregate === true;

    return {

        ...meta,

        name,

        field:
            name,

        key:
            name,

        id:
            name,

        title,

        type,

        aggregationAllowed,

        groupingAllowed:
            meta.groupingAllowed !== false,

        filteringAllowed:
            meta.filteringAllowed !== false,

        tags:
            Array.isArray(meta.tags)
                ? meta.tags
                : [],

        isMeasure:
            meta.isMeasure === true ||
            meta.measure === true ||
            aggregationAllowed,

        index
    };
}


// ============================================================
// NORMALIZE COLUMNS
// ============================================================

function normalizeColumns(raw) {

    const result = [];

    function add(
        name,
        meta,
        forcedMeasure = false
    ) {

        const field =
            normalizeField(
                name,
                meta,
                result.length,
                forcedMeasure
            );

        if (field) {
            result.push(field);
        }
    }

    if (!raw) {
        return [];
    }

    // --------------------------------------------------------
    // ARRAY
    // --------------------------------------------------------

    if (
        Array.isArray(raw)
    ) {

        raw.forEach(
            item => {

                if (
                    typeof item === "string"
                ) {

                    add(
                        item,
                        {
                            name: item
                        },
                        false
                    );

                    return;
                }

                if (
                    item &&
                    typeof item === "object"
                ) {

                    add(
                        item.field ||
                        item.key ||
                        item.code ||
                        item.id ||
                        item.technicalName,

                        item,

                        item.isMeasure === true ||
                        item.measure === true ||
                        item.aggregationAllowed === true
                    );
                }
            }
        );

    }

    // --------------------------------------------------------
    // OBJECT
    // --------------------------------------------------------

    else if (
        typeof raw === "object"
    ) {

        // ----------------------------------------------------
        // { fields: [...] }
        // ----------------------------------------------------

        if (
            Array.isArray(
                raw.fields
            )
        ) {

            raw.fields.forEach(
                item => {

                    if (
                        typeof item === "string"
                    ) {

                        add(
                            item,
                            {
                                name: item
                            }
                        );

                    } else if (item) {

                        add(
                            item.field ||
                            item.key ||
                            item.code ||
                            item.id ||
                            item.technicalName,

                            item,

                            item.aggregationAllowed === true ||
                            item.isMeasure === true
                        );
                    }
                }
            );
        }

        // ----------------------------------------------------
        // { columns: [...] }
        // ----------------------------------------------------

        if (
            Array.isArray(
                raw.columns
            )
        ) {

            raw.columns.forEach(
                item => {

                    if (
                        typeof item === "string"
                    ) {

                        add(
                            item,
                            {
                                name: item
                            }
                        );

                    } else if (item) {

                        add(
                            item.field ||
                            item.key ||
                            item.code ||
                            item.id ||
                            item.technicalName,

                            item,

                            item.aggregationAllowed === true ||
                            item.isMeasure === true
                        );
                    }
                }
            );
        }

        // ----------------------------------------------------
        // dimensions
        // ----------------------------------------------------

        if (
            Array.isArray(
                raw.dimensions
            )
        ) {

            raw.dimensions.forEach(
                item => {

                    if (
                        typeof item === "string"
                    ) {

                        add(
                            item,
                            {
                                name: item
                            },
                            false
                        );

                    } else if (item) {

                        add(
                            item.field ||
                            item.key ||
                            item.code ||
                            item.id ||
                            item.technicalName,

                            item,

                            false
                        );
                    }
                }
            );
        }

        // ----------------------------------------------------
        // measures
        // ----------------------------------------------------

        if (
            Array.isArray(
                raw.measures
            )
        ) {

            raw.measures.forEach(
                item => {

                    if (
                        typeof item === "string"
                    ) {

                        add(
                            item,
                            {
                                name: item
                            },
                            true
                        );

                    } else if (item) {

                        add(
                            item.field ||
                            item.key ||
                            item.code ||
                            item.id ||
                            item.technicalName,

                            item,

                            true
                        );
                    }
                }
            );
        }

        // ----------------------------------------------------
        // ГЛАВНЫЙ ВАРИАНТ IIKO
        //
        // {
        //   "CashRegisterName": {...},
        //   "DishSumInt": {...}
        // }
        // ----------------------------------------------------

        Object.entries(raw)
            .forEach(
                ([key, value]) => {

                    if (
                        [
                            "fields",
                            "columns",
                            "dimensions",
                            "measures",
                            "data",
                            "items"
                        ].includes(key)
                    ) {
                        return;
                    }

                    if (
                        !value ||
                        typeof value !== "object" ||
                        Array.isArray(value)
                    ) {
                        return;
                    }

                    add(
                        key,
                        value,
                        value.aggregationAllowed === true ||
                        value.isMeasure === true ||
                        value.measure === true
                    );
                }
            );
    }

    // --------------------------------------------------------
    // DEDUPE
    // --------------------------------------------------------

    const map =
        new Map();

    result.forEach(
        field => {

            const key =
                field.name.toLowerCase();

            if (
                !map.has(key)
            ) {

                map.set(
                    key,
                    field
                );

            } else {

                const old =
                    map.get(key);

                map.set(
                    key,
                    {
                        ...old,
                        ...field,

                        title:
                            field.title ||
                            old.title,

                        isMeasure:
                            old.isMeasure ||
                            field.isMeasure,

                        aggregationAllowed:
                            old.aggregationAllowed ||
                            field.aggregationAllowed
                    }
                );
            }
        }
    );

    return Array.from(
        map.values()
    )
        .map(
            (field, index) => ({
                ...field,
                index
            })
        );
}


// ============================================================
// GET OLAP COLUMNS
// ============================================================

async function getOlapColumns(
    serverUrl,
    token,
    reportType,
    rid
) {

    const url =
        `${serverUrl}/resto/api/v2/reports/olap/columns` +
        `?key=${encodeURIComponent(token)}` +
        `&reportType=${encodeURIComponent(reportType)}`;

    let response;

    try {

        response =
            await fetch(
                url,
                {
                    method: "GET",

                    headers: {
                        Accept:
                            "application/json"
                    }
                }
            );

    } catch (error) {

        throw new Error(
            `Ошибка соединения с iiko при получении OLAP-полей: ${error?.message || "fetch failed"}`
        );
    }

    const text =
        await response.text();

    console.log(
        `[OLAP][${rid}] COLUMNS HTTP`,
        response.status,
        "length",
        text.length
    );

    let raw = null;

    try {

        raw =
            JSON.parse(text);

    } catch (_) {

        raw = null;
    }

    if (
        !response.ok
    ) {

        throw new Error(
            `iiko OLAP columns HTTP ${response.status}: ${text.slice(0, 5000)}`
        );
    }

    if (!raw) {

        throw new Error(
            "iiko вернул некорректный JSON структуры OLAP"
        );
    }

    const fields =
        normalizeColumns(
            raw
        );

    if (
        !fields.length
    ) {

        throw new Error(
            "iiko вернул 0 OLAP-полей. Проверьте reportType=SALES и права пользователя iiko."
        );
    }

    return {
        raw,
        fields,
        httpStatus:
            response.status,
        rawText:
            text
    };
}


// ============================================================
// ARRAY
// ============================================================

function toArray(value) {

    if (
        !Array.isArray(value)
    ) {
        return [];
    }

    return value
        .map(
            item => {

                if (
                    typeof item === "string"
                ) {
                    return clean(item);
                }

                if (
                    item &&
                    typeof item === "object"
                ) {

                    return clean(
                        item.field ||
                        item.name ||
                        item.key ||
                        item.id
                    );
                }

                return "";
            }
        )
        .filter(Boolean);
}


// ============================================================
// BUILD REQUEST
// ============================================================

function buildRequest(body) {

    const reportType =
        clean(
            body.reportType ||
            "SALES"
        )
            .toUpperCase();

    const rows =
        toArray(
            body.groupByRowFields ??
            body.rows
        );

    const columns =
        toArray(
            body.groupByColumnFields ??
            body.groupByColFields ??
            body.columns
        );

    const measures =
        Array.isArray(body.measures)

            ? body.measures
                .map(
                    item => {

                        if (
                            typeof item === "string"
                        ) {
                            return clean(item);
                        }

                        return clean(
                            item?.field ||
                            item?.name ||
                            item?.key ||
                            item?.id
                        );
                    }
                )
                .filter(Boolean)

            : toArray(
                body.aggregateFields
            );

    let filters = {};

    if (
        body.filters &&
        typeof body.filters === "object" &&
        !Array.isArray(body.filters)
    ) {

        filters =
            JSON.parse(
                JSON.stringify(
                    body.filters
                )
            );
    }

    // --------------------------------------------------------
    // ARRAY FILTERS
    // --------------------------------------------------------

    if (
        Array.isArray(body.filters)
    ) {

        for (
            const item of body.filters
        ) {

            const field =
                clean(
                    item?.field ||
                    item?.name ||
                    item?.key
                );

            if (!field) {
                continue;
            }

            if (
                item.values &&
                Array.isArray(
                    item.values
                )
            ) {

                filters[field] = {

                    filterType:
                        "Include",

                    values:
                        item.values
                };

            } else if (
                item.value !== undefined &&
                item.value !== ""
            ) {

                filters[field] = {

                    filterType:
                        "Include",

                    values: [
                        item.value
                    ]
                };
            }
        }
    }

    // --------------------------------------------------------
    // DATE FILTER
    // --------------------------------------------------------

    if (
        body.from ||
        body.to
    ) {

        const from =
            clean(
                body.from
            )
                .slice(0, 10);

        const to =
            clean(
                body.to ||
                body.from
            )
                .slice(0, 10);

        if (
            from &&
            to
        ) {

            filters[
                "OpenDate.Typed"
            ] = {

                filterType:
                    "DateRange",

                periodType:
                    "CUSTOM",

                from:
                    `${from}T00:00:00.000`,

                to:
                    `${to}T23:59:59.999`,

                includeLow:
                    true,

                includeHigh:
                    true
            };
        }
    }

    return {

        reportType,

        buildSummary:
            body.buildSummary !== false,

        groupByRowFields:
            rows,

        groupByColFields:
            columns,

        aggregateFields:
            measures,

        filters
    };
}


// ============================================================
// RUN QUERY
// ============================================================

async function runQuery(
    serverUrl,
    token,
    body,
    rid
) {

    const request =
        buildRequest(
            body
        );

    if (
        request.groupByRowFields.length === 0 &&
        request.groupByColFields.length === 0 &&
        request.aggregateFields.length === 0
    ) {

        return {

            success:
                false,

            type:
                "EMPTY_QUERY",

            message:
                "Выберите хотя бы одно поле в Строки, Колонки или Показатели",

            request
        };
    }

    const url =
        `${serverUrl}/resto/api/v2/reports/olap` +
        `?key=${encodeURIComponent(token)}`;

    let response;

    try {

        response =
            await fetch(
                url,
                {
                    method: "POST",

                    headers: {

                        "Content-Type":
                            "application/json",

                        Accept:
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            request
                        )
                }
            );

    } catch (error) {

        return {

            success:
                false,

            type:
                "FETCH_ERROR",

            message:
                `Ошибка соединения с iiko OLAP: ${error?.message || "fetch failed"}`,

            request
        };
    }

    const text =
        await response.text();

    let report = null;

    try {

        report =
            JSON.parse(
                text
            );

    } catch (_) {}

    console.log(
        `[OLAP][${rid}] QUERY HTTP`,
        response.status,
        "length",
        text.length
    );

    console.log(
        `[OLAP][${rid}] QUERY REQUEST`,
        JSON.stringify(request)
    );

    // --------------------------------------------------------
    // REAL IIKO ERROR
    // --------------------------------------------------------

    if (
        !response.ok
    ) {

        let detail = "";

        if (
            report &&
            typeof report === "object"
        ) {

            detail =
                report.message ||
                report.error ||
                report.description ||
                "";
        }

        if (!detail) {
            detail =
                text.slice(
                    0,
                    5000
                );
        }

        return {

            success:
                false,

            type:
                "IIKO_ERROR",

            message:
                `iiko OLAP HTTP ${response.status}` +
                (
                    detail
                        ? `: ${detail}`
                        : ""
                ),

            iikoHttpStatus:
                response.status,

            iikoStatusText:
                response.statusText,

            request,

            report,

            rawResponse:
                text.slice(
                    0,
                    30000
                )
        };
    }

    // --------------------------------------------------------
    // HTTP 200 BUT ERROR INSIDE BODY
    // --------------------------------------------------------

    const errorInsideBody =
        report &&
        typeof report === "object" &&
        (
            report.error === true ||
            report.success === false ||
            report.errorMessage ||
            report.errorCode
        );

    if (
        errorInsideBody
    ) {

        const detail =
            report.message ||
            report.errorMessage ||
            report.errorCode ||
            "iiko вернул ошибку внутри HTTP 200";

        return {

            success:
                false,

            type:
                "IIKO_BODY_ERROR",

            message:
                `iiko OLAP HTTP 200: ${detail}`,

            iikoHttpStatus:
                response.status,

            request,

            report,

            rawResponse:
                text.slice(
                    0,
                    30000
                )
        };
    }

    return {

        success:
            true,

        type:
            "SUCCESS",

        iikoHttpStatus:
            response.status,

        request,

        report,

        rawResponse:
            text.slice(
                0,
                30000
            )
    };
}


// ============================================================
// OPTIONS
// ============================================================

export async function onRequestOptions() {

    return new Response(
        null,
        {
            status: 204,

            headers:
                corsHeaders()
        }
    );
}


// ============================================================
// GET
// ============================================================

export async function onRequestGet(
    context
) {

    const rid =
        requestId();

    try {

        const url =
            new URL(
                context.request.url
            );

        const body = {

            ip:
                url.searchParams.get("ip") ||
                "",

            port:
                url.searchParams.get("port") ||
                "",

            login:
                url.searchParams.get("login") ||
                "",

            password:
                url.searchParams.get("password") ||
                "",

            reportType:
                url.searchParams.get("reportType") ||
                "SALES"
        };

        const c =
            credentials(
                body
            );

        const auth =
            await authenticate(
                c.ip,
                c.port,
                c.login,
                c.password,
                rid
            );

        const result =
            await getOlapColumns(
                auth.serverUrl,
                auth.token,
                clean(
                    body.reportType
                ).toUpperCase(),
                rid
            );

        return jsonResponse(
            {

                success:
                    true,

                action:
                    "fields",

                requestId:
                    rid,

                reportType:
                    clean(
                        body.reportType
                    ).toUpperCase(),

                count:
                    result.fields.length,

                fields:
                    result.fields,

                raw:
                    result.raw

            },
            200
        );

    } catch (error) {

        console.error(
            `[OLAP][${rid}] GET ERROR`,
            error
        );

        return jsonResponse(
            {

                success:
                    false,

                requestId:
                    rid,

                type:
                    "FIELDS_ERROR",

                message:
                    error?.message ||
                    "Ошибка OLAP fields"

            },
            502
        );
    }
}


// ============================================================
// POST
// ============================================================

export async function onRequestPost(
    context
) {

    const rid =
        requestId();

    try {

        let body;

        try {

            body =
                await context.request.json();

        } catch (_) {

            return jsonResponse(
                {

                    success:
                        false,

                    requestId:
                        rid,

                    type:
                        "INVALID_JSON",

                    message:
                        "Request body не является JSON"

                },
                400
            );
        }

        const c =
            credentials(
                body
            );

        const reportType =
            clean(
                body.reportType ||
                "SALES"
            )
                .toUpperCase();

        const action =
            clean(
                body.action ||
                "query"
            )
                .toLowerCase();

        const auth =
            await authenticate(
                c.ip,
                c.port,
                c.login,
                c.password,
                rid
            );

        // ====================================================
        // FIELDS
        // ====================================================

        if (
            action === "fields"
        ) {

            const result =
                await getOlapColumns(
                    auth.serverUrl,
                    auth.token,
                    reportType,
                    rid
                );

            return jsonResponse(
                {

                    success:
                        true,

                    action:
                        "fields",

                    requestId:
                        rid,

                    reportType,

                    count:
                        result.fields.length,

                    fields:
                        result.fields,

                    raw:
                        result.raw

                },
                200
            );
        }

        // ====================================================
        // QUERY
        // ====================================================

        if (
            action === "query"
        ) {

            const result =
                await runQuery(
                    auth.serverUrl,
                    auth.token,
                    body,
                    rid
                );

            // ВАЖНО:
            // если iiko ответил 400,
            // наружу тоже отдаём 400.
            //
            // Больше не будет:
            //
            // "Ошибка OLAP HTTP 200"
            //

            const status =
                result.success

                    ? 200

                    : Math.min(
                        599,
                        Math.max(
                            400,
                            Number(
                                result.iikoHttpStatus
                            ) || 502
                        )
                    );

            return jsonResponse(
                {
                    ...result,
                    requestId:
                        rid
                },
                status
            );
        }

        // ====================================================
        // UNKNOWN
        // ====================================================

        return jsonResponse(
            {

                success:
                    false,

                requestId:
                    rid,

                type:
                    "UNKNOWN_ACTION",

                message:
                    `Неизвестное действие OLAP: ${action}`,

                availableActions: [
                    "fields",
                    "query"
                ]

            },
            400
        );

    } catch (error) {

        console.error(
            `[OLAP][${rid}] POST ERROR`,
            error
        );

        return jsonResponse(
            {

                success:
                    false,

                requestId:
                    rid,

                type:
                    "FUNCTION_ERROR",

                message:
                    error?.message ||
                    "Ошибка OLAP Function",

                stack:
                    error?.stack ||
                    null

            },
            502
        );
    }
}
