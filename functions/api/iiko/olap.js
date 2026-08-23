// ============================================================
// ANAR SYSTEM
// IIKO OLAP
// functions/api/iiko/olap.js
//
// ВАЖНО:
//
// iiko /reports/olap/columns возвращает объект примерно такого
// вида:
//
// {
//   "CashRegisterName": {
//      "name": "Касса",
//      ...
//   },
//
//   "DishDiscountSumInt": {
//      "name": "Сумма со скидкой",
//      ...
//   }
// }
//
// Техническое имя = КЛЮЧ объекта.
// Красивое имя = поле "name".
//
// Поэтому:
//     Касса
//       ↓
//     CashRegisterName
//
//     Сумма со скидкой
//       ↓
//     DishDiscountSumInt
//
// ============================================================


// ============================================================
// CORS
// ============================================================

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };
}


// ============================================================
// JSON
// ============================================================

function jsonResponse(
    data,
    status = 200,
    requestId = ""
) {

    const headers = {
        "Content-Type":
            "application/json; charset=utf-8",

        ...corsHeaders()
    };

    if (requestId) {
        headers["X-OLAP-Request-ID"] =
            requestId;
    }

    return new Response(
        JSON.stringify(
            data,
            null,
            2
        ),
        {
            status,
            headers
        }
    );
}


// ============================================================
// REQUEST ID
// ============================================================

function createRequestId() {

    try {

        if (
            typeof crypto !== "undefined" &&
            crypto.randomUUID
        ) {
            return crypto.randomUUID();
        }

    } catch (error) {
        // ignore
    }

    return (
        Date.now().toString(36) +
        "-" +
        Math.random()
            .toString(36)
            .substring(2, 10)
    );
}


// ============================================================
// LOG
// ============================================================

function log(
    requestId,
    message,
    data
) {

    if (
        typeof data ===
        "undefined"
    ) {

        console.log(
            `[OLAP][${requestId}] ${message}`
        );

        return;
    }

    console.log(
        `[OLAP][${requestId}] ${message}`,
        data
    );
}


function logError(
    requestId,
    message,
    data
) {

    if (
        typeof data ===
        "undefined"
    ) {

        console.error(
            `[OLAP][${requestId}] ${message}`
        );

        return;
    }

    console.error(
        `[OLAP][${requestId}] ${message}`,
        data
    );
}


// ============================================================
// SHA-1
// ============================================================

async function sha1(text) {

    const bytes =
        new TextEncoder().encode(
            text
        );

    const hash =
        await crypto.subtle.digest(
            "SHA-1",
            bytes
        );

    return Array
        .from(
            new Uint8Array(hash)
        )
        .map(
            byte =>
                byte
                    .toString(16)
                    .padStart(2, "0")
        )
        .join("");
}


// ============================================================
// IIKO AUTH
// ============================================================

async function authenticate(
    ip,
    port,
    login,
    password,
    requestId
) {

    if (
        !ip ||
        !port ||
        !login ||
        !password
    ) {

        throw new Error(
            "Необходимо указать IP, порт, логин и пароль iiko"
        );
    }


    const serverUrl =
        `http://${ip}:${port}`;


    const passwordHash =
        await sha1(password);


    const url =
        `${serverUrl}/resto/api/auth` +
        `?login=${encodeURIComponent(login)}` +
        `&pass=${passwordHash}`;


    log(
        requestId,
        "AUTH REQUEST",
        {
            serverUrl,
            login
        }
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

        logError(
            requestId,
            "AUTH FETCH ERROR",
            {
                name:
                    error?.name,

                message:
                    error?.message
            }
        );

        throw new Error(
            `Не удалось подключиться к iiko Server: ${
                error?.message || "fetch failed"
            }`
        );
    }


    const text =
        (
            await response.text()
        ).trim();


    log(
        requestId,
        "AUTH RESPONSE",
        {
            status:
                response.status,

            ok:
                response.ok,

            bodyLength:
                text.length
        }
    );


    if (
        !response.ok ||
        !text
    ) {

        logError(
            requestId,
            "AUTH FAILED",
            {
                status:
                    response.status,

                body:
                    text.substring(
                        0,
                        5000
                    )
            }
        );

        throw new Error(
            `Ошибка авторизации iiko: HTTP ${response.status}`
        );
    }


    return {
        serverUrl,
        token: text
    };
}


// ============================================================
// IIKO COLUMNS
//
// ГЛАВНОЕ ИСПРАВЛЕНИЕ.
//
// Мы НЕ используем:
//
//     field.id
//
// потому что твой frontend уже получил:
//
//     id: "Касса"
//
// Но настоящий iiko field:
//
//     CashRegisterName
//
// находится в КЛЮЧЕ исходного объекта.
//
// ============================================================

async function getIikoColumns(
    serverUrl,
    token,
    reportType,
    requestId
) {

    const endpoint =
        `${serverUrl}` +
        `/resto/api/v2/reports/olap/columns`;


    const url =
        endpoint +
        `?key=${encodeURIComponent(token)}` +
        `&reportType=${encodeURIComponent(reportType)}`;


    log(
        requestId,
        "COLUMNS REQUEST",
        {
            endpoint,
            reportType
        }
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

        logError(
            requestId,
            "COLUMNS FETCH ERROR",
            {
                name:
                    error?.name,

                message:
                    error?.message
            }
        );

        throw new Error(
            `Ошибка соединения с iiko при получении OLAP-полей: ${
                error?.message || "fetch failed"
            }`
        );
    }


    const text =
        await response.text();


    log(
        requestId,
        "COLUMNS RESPONSE",
        {
            status:
                response.status,

            bodyLength:
                text.length
        }
    );


    if (
        !response.ok
    ) {

        logError(
            requestId,
            "COLUMNS HTTP ERROR",
            {
                status:
                    response.status,

                body:
                    text.substring(
                        0,
                        30000
                    )
            }
        );

        throw new Error(
            `iiko OLAP columns вернул HTTP ${response.status}`
        );
    }


    let raw;

    try {

        raw =
            JSON.parse(text);

    } catch (error) {

        logError(
            requestId,
            "COLUMNS JSON ERROR",
            text.substring(
                0,
                10000
            )
        );

        throw new Error(
            "iiko вернул некорректный JSON со списком OLAP-полей"
        );
    }


    return raw;
}


// ============================================================
// NORMALIZE COLUMNS
//
// Превращаем:
//
// {
//   "CashRegisterName": {
//      "name": "Касса"
//   }
// }
//
// в:
//
// {
//   technicalName: "CashRegisterName",
//   title: "Касса"
// }
//
// ============================================================

function normalizeColumns(raw) {

    const result = [];


    if (
        !raw ||
        typeof raw !== "object"
    ) {

        return result;
    }


    // --------------------------------------------------------
    // Вариант 1:
    //
    // {
    //   fields: [...]
    // }
    // --------------------------------------------------------

    if (
        Array.isArray(
            raw.fields
        )
    ) {

        raw.fields.forEach(
            (field, index) => {

                if (
                    typeof field ===
                    "string"
                ) {

                    result.push({
                        technicalName:
                            field,

                        title:
                            field,

                        type:
                            "unknown",

                        aggregationAllowed:
                            false,

                        groupingAllowed:
                            true,

                        filteringAllowed:
                            true,

                        index
                    });

                    return;
                }


                if (
                    field &&
                    typeof field ===
                    "object"
                ) {

                    const technicalName =
                        field.field ||
                        field.key ||
                        field.code ||
                        field.id ||
                        field.name ||
                        "";


                    const title =
                        field.title ||
                        field.caption ||
                        field.label ||
                        field.name ||
                        technicalName;


                    if (
                        technicalName
                    ) {

                        result.push({
                            ...field,

                            technicalName,

                            title,

                            index
                        });
                    }
                }
            }
        );

        return result;
    }


    // --------------------------------------------------------
    // Вариант 2:
    //
    // {
    //   dimensions: [],
    //   measures: []
    // }
    // --------------------------------------------------------

    if (
        Array.isArray(
            raw.dimensions
        ) ||
        Array.isArray(
            raw.measures
        )
    ) {

        const fields = [
            ...(
                Array.isArray(
                    raw.dimensions
                )
                    ? raw.dimensions
                    : []
            ),

            ...(
                Array.isArray(
                    raw.measures
                )
                    ? raw.measures
                    : []
            )
        ];


        fields.forEach(
            (field, index) => {

                if (
                    typeof field ===
                    "string"
                ) {

                    result.push({
                        technicalName:
                            field,

                        title:
                            field,

                        type:
                            "unknown",

                        index
                    });

                    return;
                }


                if (
                    field &&
                    typeof field ===
                    "object"
                ) {

                    const technicalName =
                        field.field ||
                        field.key ||
                        field.code ||
                        field.id ||
                        field.name ||
                        "";


                    const title =
                        field.title ||
                        field.caption ||
                        field.label ||
                        field.name ||
                        technicalName;


                    if (
                        technicalName
                    ) {

                        result.push({
                            ...field,

                            technicalName,

                            title,

                            index
                        });
                    }
                }
            }
        );


        return result;
    }


    // --------------------------------------------------------
    // Вариант 3 — ГЛАВНЫЙ ДЛЯ ТВОЕГО IIKO
    //
    // {
    //
    //   "CashRegisterName": {
    //      "name": "Касса"
    //   },
    //
    //   "DishDiscountSumInt": {
    //      "name": "Сумма со скидкой"
    //   }
    //
    // }
    //
    // КЛЮЧ является настоящим technical field.
    // --------------------------------------------------------

    Object.entries(
        raw
    ).forEach(
        (
            [technicalName, field],
            index
        ) => {

            if (
                !field ||
                typeof field !==
                "object"
            ) {

                return;
            }


            const title =
                field.name ||
                field.title ||
                field.caption ||
                field.label ||
                technicalName;


            result.push({

                // ==========================================
                // Самое важное поле
                // ==========================================

                technicalName,


                // ==========================================
                // Красивое имя
                // ==========================================

                title,


                // ==========================================
                // Тип
                // ==========================================

                type:
                    field.type ||
                    "unknown",


                // ==========================================
                // Разрешения
                // ==========================================

                aggregationAllowed:
                    Boolean(
                        field.aggregationAllowed
                    ),

                groupingAllowed:
                    Boolean(
                        field.groupingAllowed
                    ),

                filteringAllowed:
                    Boolean(
                        field.filteringAllowed
                    ),


                tags:
                    Array.isArray(
                        field.tags
                    )
                        ? field.tags
                        : [],


                // Оставляем оригинал
                // для диагностики.

                original:
                    field,


                index
            });
        }
    );


    return result;
}


// ============================================================
// FIND FIELD
//
// Пользователь отправил:
//
//     Касса
//
// Находим:
//
//     CashRegisterName
//
// ============================================================

function resolveField(
    requested,
    columns
) {

    if (
        requested === null ||
        requested === undefined
    ) {

        return null;
    }


    const value =
        String(
            requested
        ).trim();


    if (!value) {
        return null;
    }


    const normalized =
        value
            .toLowerCase()
            .trim();


    // ========================================================
    // 1. Уже техническое имя
    //
    // Например frontend уже отправил:
    //
    // CashRegisterName
    // ========================================================

    const byTechnical =
        columns.find(
            field =>
                String(
                    field.technicalName
                )
                    .toLowerCase()
                    .trim() ===
                normalized
        );


    if (
        byTechnical
    ) {

        return {
            requested:
                value,

            resolved:
                byTechnical.technicalName,

            title:
                byTechnical.title,

            source:
                "technical-name"
        };
    }


    // ========================================================
    // 2. Красивое имя
    //
    // Касса
    // ↓
    // CashRegisterName
    // ========================================================

    const byTitle =
        columns.find(
            field =>
                String(
                    field.title
                )
                    .toLowerCase()
                    .trim() ===
                normalized
        );


    if (
        byTitle
    ) {

        return {
            requested:
                value,

            resolved:
                byTitle.technicalName,

            title:
                byTitle.title,

            source:
                "display-name"
        };
    }


    // ========================================================
    // 3. name внутри original
    // ========================================================

    const byOriginalName =
        columns.find(
            field =>
                field.original &&
                String(
                    field.original.name ||
                    ""
                )
                    .toLowerCase()
                    .trim() ===
                normalized
        );


    if (
        byOriginalName
    ) {

        return {
            requested:
                value,

            resolved:
                byOriginalName.technicalName,

            title:
                byOriginalName.title,

            source:
                "original-name"
        };
    }


    return null;
}


// ============================================================
// RESOLVE FIELD ARRAY
// ============================================================

function resolveFieldArray(
    fields,
    columns,
    requestId,
    type
) {

    const input =
        Array.isArray(fields)
            ? fields
            : [];


    const resolved = [];
    const mapping = [];
    const unresolved = [];


    input.forEach(
        item => {

            let requested = "";


            if (
                typeof item ===
                "string"
            ) {

                requested =
                    item;

            } else if (
                item &&
                typeof item ===
                "object"
            ) {

                requested =
                    item.field ||
                    item.name ||
                    item.key ||
                    item.id ||
                    item.title ||
                    "";
            }


            if (
                !requested
            ) {
                return;
            }


            const result =
                resolveField(
                    requested,
                    columns
                );


            if (
                result
            ) {

                resolved.push(
                    result.resolved
                );


                mapping.push({
                    type,

                    requested:
                        result.requested,

                    resolved:
                        result.resolved,

                    title:
                        result.title,

                    source:
                        result.source
                });

            } else {

                unresolved.push(
                    String(
                        requested
                    )
                );


                mapping.push({
                    type,

                    requested:
                        String(
                            requested
                        ),

                    resolved:
                        null,

                    title:
                        null,

                    source:
                        "NOT_FOUND"
                });
            }
        }
    );


    log(
        requestId,
        `FIELD MAPPING: ${type}`,
        {
            resolved,
            unresolved,
            mapping
        }
    );


    return {
        resolved,
        mapping,
        unresolved
    };
}


// ============================================================
// BUILD FILTERS
// ============================================================

function buildFilters(
    body
) {

    let filters = {};


    if (
        body.filters &&
        typeof body.filters ===
            "object" &&
        !Array.isArray(
            body.filters
        )
    ) {

        filters = {
            ...body.filters
        };
    }


    if (
        body.from ||
        body.to
    ) {

        const from =
            String(
                body.from || ""
            ).slice(
                0,
                10
            );


        const to =
            String(
                body.to ||
                body.from ||
                ""
            ).slice(
                0,
                10
            );


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


    return filters;
}


// ============================================================
// GET /api/iiko/olap
// ============================================================

export async function onRequestGet(
    context
) {

    const requestId =
        createRequestId();


    try {

        const url =
            new URL(
                context.request.url
            );


        const ip =
            (
                url.searchParams.get(
                    "ip"
                ) || ""
            ).trim();


        const port =
            (
                url.searchParams.get(
                    "port"
                ) || ""
            ).trim();


        const login =
            (
                url.searchParams.get(
                    "login"
                ) || ""
            ).trim();


        const password =
            url.searchParams.get(
                "password"
            ) || "";


        const reportType =
            (
                url.searchParams.get(
                    "reportType"
                ) ||
                "SALES"
            )
                .trim()
                .toUpperCase();


        if (
            !ip ||
            !port ||
            !login ||
            !password
        ) {

            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "Необходимо указать IP, порт, логин и пароль iiko"
                },
                400,
                requestId
            );
        }


        const {
            serverUrl,
            token
        } =
            await authenticate(
                ip,
                port,
                login,
                password,
                requestId
            );


        const rawColumns =
            await getIikoColumns(
                serverUrl,
                token,
                reportType,
                requestId
            );


        const columns =
            normalizeColumns(
                rawColumns
            );


        return jsonResponse(
            {
                success: true,

                requestId,

                reportType,

                count:
                    columns.length,

                fields:
                    columns.map(
                        field => ({

                            // ==================================
                            // ВАЖНО:
                            // name = техническое поле
                            // title = красивое имя
                            // ==================================

                            name:
                                field.technicalName,

                            title:
                                field.title,

                            type:
                                field.type,

                            aggregationAllowed:
                                field.aggregationAllowed,

                            groupingAllowed:
                                field.groupingAllowed,

                            filteringAllowed:
                                field.filteringAllowed,

                            tags:
                                field.tags,

                            // Дополнительно
                            // для совместимости

                            field:
                                field.technicalName,

                            key:
                                field.technicalName,

                            id:
                                field.technicalName
                        })
                    )
            },
            200,
            requestId
        );

    } catch (error) {

        logError(
            requestId,
            "GET ERROR",
            {
                name:
                    error?.name,

                message:
                    error?.message,

                stack:
                    error?.stack
            }
        );


        return jsonResponse(
            {
                success: false,

                requestId,

                message:
                    error?.message ||
                    "Ошибка OLAP"
            },
            502,
            requestId
        );
    }
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
// POST /api/iiko/olap
// ============================================================

export async function onRequestPost(
    context
) {

    const requestId =
        createRequestId();


    try {

        const body =
            await context.request.json();


        log(
            requestId,
            "OLAP POST BODY",
            body
        );


        // ======================================================
        // CONNECTION
        // ======================================================

        const ip =
            String(
                body.ip || ""
            ).trim();


        const port =
            String(
                body.port || ""
            ).trim();


        const login =
            String(
                body.login || ""
            ).trim();


        const password =
            String(
                body.password || ""
            );


        if (
            !ip ||
            !port ||
            !login ||
            !password
        ) {

            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "Заполните IP, порт, логин и пароль iiko"
                },
                400,
                requestId
            );
        }


        // ======================================================
        // REPORT TYPE
        // ======================================================

        const reportType =
            String(
                body.reportType ||
                "SALES"
            )
                .trim()
                .toUpperCase();


        // ======================================================
        // AUTH
        // ======================================================

        const {
            serverUrl,
            token
        } =
            await authenticate(
                ip,
                port,
                login,
                password,
                requestId
            );


        // ======================================================
        // GET REAL IIKO FIELD DEFINITIONS
        // ======================================================

        const rawColumns =
            await getIikoColumns(
                serverUrl,
                token,
                reportType,
                requestId
            );


        const columns =
            normalizeColumns(
                rawColumns
            );


        if (
            columns.length === 0
        ) {

            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "iiko не вернул ни одного OLAP-поля",

                    rawColumns:
                        rawColumns
                },
                502,
                requestId
            );
        }


        log(
            requestId,
            "IIKO FIELDS COUNT",
            columns.length
        );


        // ======================================================
        // ROWS
        //
        // reports.js отправляет:
        //
        // rows: ["Касса"]
        //
        // Мы превращаем:
        //
        // "Касса"
        // ↓
        // "CashRegisterName"
        // ======================================================

        const rowsInput =
            Array.isArray(
                body.rows
            )
                ? body.rows
                : (
                    Array.isArray(
                        body.groupByRowFields
                    )
                        ? body.groupByRowFields
                        : []
                );


        // ======================================================
        // COLUMNS
        // ======================================================

        const columnsInput =
            Array.isArray(
                body.columns
            )
                ? body.columns
                : (
                    Array.isArray(
                        body.groupByColFields
                    )
                        ? body.groupByColFields
                        : []
                );


        // ======================================================
        // MEASURES
        //
        // reports.js отправляет:
        //
        // measures: [
        //   {
        //      field: "Сумма со скидкой",
        //      aggregation: "SUM"
        //   }
        // ]
        // ======================================================

        const measuresInput =
            Array.isArray(
                body.measures
            )
                ? body.measures
                : (
                    Array.isArray(
                        body.aggregateFields
                    )
                        ? body.aggregateFields
                        : []
                );


        // ======================================================
        // RESOLVE
        // ======================================================

        const resolvedRows =
            resolveFieldArray(
                rowsInput,
                columns,
                requestId,
                "row"
            );


        const resolvedColumns =
            resolveFieldArray(
                columnsInput,
                columns,
                requestId,
                "column"
            );


        const resolvedMeasures =
            resolveFieldArray(
                measuresInput,
                columns,
                requestId,
                "measure"
            );


        // ======================================================
        // UNRESOLVED
        // ======================================================

        const unresolved = [
            ...resolvedRows.unresolved,
            ...resolvedColumns.unresolved,
            ...resolvedMeasures.unresolved
        ];


        if (
            unresolved.length
        ) {

            logError(
                requestId,
                "UNRESOLVED FIELDS",
                unresolved
            );


            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "Не удалось найти некоторые OLAP-поля iiko",

                    unresolved,

                    mapping: {
                        rows:
                            resolvedRows.mapping,

                        columns:
                            resolvedColumns.mapping,

                        measures:
                            resolvedMeasures.mapping
                    },

                    availableFields:
                        columns.map(
                            field => ({
                                name:
                                    field.technicalName,

                                title:
                                    field.title,

                                type:
                                    field.type
                            })
                        )
                },
                400,
                requestId
            );
        }


        // ======================================================
        // FILTERS
        // ======================================================

        const filters =
            buildFilters(
                body
            );


        // ======================================================
        // FINAL IIKO REQUEST
        // ======================================================

        const olapRequest = {

            reportType,

            buildSummary:
                body.buildSummary !== false,

            groupByRowFields:
                resolvedRows.resolved,

            groupByColFields:
                resolvedColumns.resolved,

            aggregateFields:
                resolvedMeasures.resolved,

            filters
        };


        // ======================================================
        // LOG FINAL REQUEST
        // ======================================================

        log(
            requestId,
            "FINAL IIKO REQUEST",
            JSON.stringify(
                olapRequest,
                null,
                2
            )
        );


        // ======================================================
        // IIKO OLAP
        // ======================================================

        const endpoint =
            `${serverUrl}` +
            `/resto/api/v2/reports/olap`;


        const url =
            endpoint +
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
                                "application/json"
                        },

                        body:
                            JSON.stringify(
                                olapRequest
                            )
                    }
                );

        } catch (error) {

            logError(
                requestId,
                "IIKO OLAP FETCH ERROR",
                {
                    name:
                        error?.name,

                    message:
                        error?.message
                }
            );


            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        `Ошибка соединения с iiko OLAP: ${
                            error?.message ||
                            "fetch failed"
                        }`,

                    request:
                        olapRequest
                },
                502,
                requestId
            );
        }


        // ======================================================
        // IIKO RESPONSE
        // ======================================================

        const text =
            await response.text();


        let report = null;


        try {

            report =
                JSON.parse(
                    text
                );

        } catch (error) {

            report = null;
        }


        // ======================================================
        // SUCCESS
        // ======================================================

        if (
            response.ok
        ) {

            log(
                requestId,
                "IIKO OLAP SUCCESS",
                {
                    status:
                        response.status,

                    responseLength:
                        text.length
                }
            );


            return jsonResponse(
                {
                    success: true,

                    requestId,

                    iikoHttpStatus:
                        response.status,

                    endpoint:
                        "/resto/api/v2/reports/olap",

                    request:
                        olapRequest,

                    mapping: {
                        rows:
                            resolvedRows.mapping,

                        columns:
                            resolvedColumns.mapping,

                        measures:
                            resolvedMeasures.mapping
                    },

                    report,

                    rawResponse:
                        text
                },
                200,
                requestId
            );
        }


        // ======================================================
        // IIKO ERROR
        // ======================================================

        logError(
            requestId,
            "IIKO OLAP ERROR",
            {
                status:
                    response.status,

                statusText:
                    response.statusText,

                response:
                    text.substring(
                        0,
                        30000
                    )
            }
        );


        return jsonResponse(
            {
                success: false,

                requestId,

                iikoHttpStatus:
                    response.status,

                iikoStatusText:
                    response.statusText,

                endpoint:
                    "/resto/api/v2/reports/olap",

                message:
                    `iiko OLAP вернул HTTP ${response.status}`,

                request:
                    olapRequest,

                mapping: {
                    rows:
                        resolvedRows.mapping,

                    columns:
                        resolvedColumns.mapping,

                    measures:
                        resolvedMeasures.mapping
                },

                rawResponse:
                    text,

                report
            },
            502,
            requestId
        );

    } catch (error) {

        logError(
            requestId,
            "UNHANDLED OLAP ERROR",
            {
                name:
                    error?.name,

                message:
                    error?.message,

                stack:
                    error?.stack
            }
        );


        return jsonResponse(
            {
                success: false,

                requestId,

                message:
                    error?.message ||
                    "Неизвестная ошибка OLAP"
            },
            502,
            requestId
        );
    }
}
