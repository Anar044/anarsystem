// ============================================================
// ANAR SYSTEM
// IIKO OLAP
// functions/api/iiko/olap.js
// ============================================================

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };
}

function jsonResponse(data, status = 200, requestId = "") {
    const headers = {
        "Content-Type": "application/json; charset=utf-8",
        ...corsHeaders()
    };

    if (requestId) {
        headers["X-OLAP-Request-ID"] = requestId;
    }

    return new Response(
        JSON.stringify(data, null, 2),
        {
            status,
            headers
        }
    );
}

function createRequestId() {
    try {
        if (
            typeof crypto !== "undefined" &&
            crypto.randomUUID
        ) {
            return crypto.randomUUID();
        }
    } catch (error) {}

    return (
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).substring(2, 10)
    );
}

function log(requestId, message, data) {
    if (typeof data === "undefined") {
        console.log(`[OLAP][${requestId}] ${message}`);
        return;
    }

    console.log(
        `[OLAP][${requestId}] ${message}`,
        data
    );
}

function logError(requestId, message, data) {
    if (typeof data === "undefined") {
        console.error(`[OLAP][${requestId}] ${message}`);
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
        new TextEncoder().encode(text);

    const hash =
        await crypto.subtle.digest(
            "SHA-1",
            bytes
        );

    return Array
        .from(new Uint8Array(hash))
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
    if (!ip || !port || !login || !password) {
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
                name: error?.name,
                message: error?.message
            }
        );

        throw new Error(
            `Не удалось подключиться к iiko Server: ${
                error?.message || "fetch failed"
            }`
        );
    }

    const text =
        (await response.text()).trim();

    log(
        requestId,
        "AUTH RESPONSE",
        {
            status: response.status,
            ok: response.ok,
            bodyLength: text.length
        }
    );

    if (!response.ok || !text) {
        logError(
            requestId,
            "AUTH FAILED",
            {
                status: response.status,
                body: text.substring(0, 5000)
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
// ============================================================

async function getIikoColumns(
    serverUrl,
    token,
    reportType,
    requestId
) {
    const endpoint =
        `${serverUrl}/resto/api/v2/reports/olap/columns`;

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
                name: error?.name,
                message: error?.message
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
            status: response.status,
            bodyLength: text.length
        }
    );

    if (!response.ok) {
        logError(
            requestId,
            "COLUMNS HTTP ERROR",
            {
                status: response.status,
                body: text.substring(0, 30000)
            }
        );

        throw new Error(
            `iiko OLAP columns вернул HTTP ${response.status}`
        );
    }

    let raw;

    try {
        raw = JSON.parse(text);
    } catch (error) {
        logError(
            requestId,
            "COLUMNS JSON ERROR",
            text.substring(0, 10000)
        );

        throw new Error(
            "iiko вернул некорректный JSON со списком OLAP-полей"
        );
    }

    return raw;
}


// ============================================================
// NORMALIZE COLUMNS
// ============================================================

function normalizeColumns(raw) {
    const result = [];

    if (!raw || typeof raw !== "object") {
        return result;
    }


    // --------------------------------------------------------
    // fields[]
    // --------------------------------------------------------

    if (Array.isArray(raw.fields)) {
        raw.fields.forEach((field, index) => {
            if (typeof field === "string") {
                result.push({
                    technicalName: field,
                    title: field,
                    type: "unknown",
                    aggregationAllowed: false,
                    groupingAllowed: true,
                    filteringAllowed: true,
                    index
                });

                return;
            }

            if (
                field &&
                typeof field === "object"
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

                if (technicalName) {
                    result.push({
                        ...field,
                        technicalName,
                        title,
                        index
                    });
                }
            }
        });

        return result;
    }


    // --------------------------------------------------------
    // dimensions[] + measures[]
    // --------------------------------------------------------

    if (
        Array.isArray(raw.dimensions) ||
        Array.isArray(raw.measures)
    ) {
        const fields = [
            ...(Array.isArray(raw.dimensions)
                ? raw.dimensions
                : []),

            ...(Array.isArray(raw.measures)
                ? raw.measures
                : [])
        ];

        fields.forEach((field, index) => {
            if (typeof field === "string") {
                result.push({
                    technicalName: field,
                    title: field,
                    type: "unknown",
                    index
                });

                return;
            }

            if (
                field &&
                typeof field === "object"
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

                if (technicalName) {
                    result.push({
                        ...field,
                        technicalName,
                        title,
                        index
                    });
                }
            }
        });

        return result;
    }


    // --------------------------------------------------------
    // ОСНОВНОЙ ФОРМАТ IIKO
    //
    // {
    //   "CashRegisterName": {
    //      "name": "Касса"
    //   }
    // }
    // --------------------------------------------------------

    Object.entries(raw).forEach(
        ([technicalName, field], index) => {
            if (
                !field ||
                typeof field !== "object"
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
                technicalName,

                title,

                type:
                    field.type ||
                    "unknown",

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
                    Array.isArray(field.tags)
                        ? field.tags
                        : [],

                original: field,

                index
            });
        }
    );

    return result;
}


// ============================================================
// SPECIAL IIKO FIELD ALIASES
//
// Эти алиасы нужны независимо от того,
// что вернул frontend.
// ============================================================

const FIELD_ALIASES = {
    "касса": "CashRegisterName",
    "cash register": "CashRegisterName",
    "cashregister": "CashRegisterName",
    "cashregistername": "CashRegisterName",

    "сумма со скидкой": "DishDiscountSumInt",
    "dishdiscountsumint": "DishDiscountSumInt",

    "учетный день": "OpenDate.Typed",
    "учётный день": "OpenDate.Typed",
    "open date": "OpenDate.Typed",
    "opendate.typed": "OpenDate.Typed"
};


// ============================================================
// FIND FIELD
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
        String(requested).trim();

    if (!value) {
        return null;
    }

    const normalized =
        value
            .toLowerCase()
            .trim();

    // --------------------------------------------------------
    // 1. Специальный alias
    // --------------------------------------------------------

    const alias =
        FIELD_ALIASES[normalized];

    if (alias) {
        const aliasField =
            columns.find(
                field =>
                    String(
                        field.technicalName
                    ).toLowerCase() ===
                    alias.toLowerCase()
            );

        if (aliasField) {
            return {
                requested: value,
                resolved: aliasField.technicalName,
                title: aliasField.title,
                source: "alias"
            };
        }

        // Если поля нет в columns,
        // всё равно возвращаем техническое имя
        // для известных iiko-полей.
        if (
            alias === "CashRegisterName" ||
            alias === "DishDiscountSumInt"
        ) {
            return {
                requested: value,
                resolved: alias,
                title: value,
                source: "known-iiko-alias"
            };
        }
    }


    // --------------------------------------------------------
    // 2. Technical name
    // --------------------------------------------------------

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

    if (byTechnical) {
        return {
            requested: value,
            resolved: byTechnical.technicalName,
            title: byTechnical.title,
            source: "technical-name"
        };
    }


    // --------------------------------------------------------
    // 3. Display name
    // --------------------------------------------------------

    const byTitle =
        columns.find(
            field =>
                String(field.title)
                    .toLowerCase()
                    .trim() ===
                normalized
        );

    if (byTitle) {
        return {
            requested: value,
            resolved: byTitle.technicalName,
            title: byTitle.title,
            source: "display-name"
        };
    }


    // --------------------------------------------------------
    // 4. original.name
    // --------------------------------------------------------

    const byOriginalName =
        columns.find(
            field =>
                field.original &&
                String(
                    field.original.name || ""
                )
                    .toLowerCase()
                    .trim() ===
                normalized
        );

    if (byOriginalName) {
        return {
            requested: value,
            resolved:
                byOriginalName.technicalName,
            title:
                byOriginalName.title,
            source: "original-name"
        };
    }

    return null;
}


// ============================================================
// EXTRACT FIELD NAME
//
// Поддерживает:
//
// "Касса"
//
// {
//    field: "Касса",
//    aggregation: "SUM"
// }
//
// {
//    name: "Касса"
// }
//
// {
//    id: "Касса"
// }
// ============================================================

function extractFieldName(item) {
    if (
        typeof item === "string" ||
        typeof item === "number"
    ) {
        return String(item).trim();
    }

    if (
        !item ||
        typeof item !== "object"
    ) {
        return "";
    }

    return String(
        item.field ||
        item.name ||
        item.key ||
        item.id ||
        item.title ||
        item.label ||
        ""
    ).trim();
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

    input.forEach(item => {
        const requested =
            extractFieldName(item);

        if (!requested) {
            return;
        }

        const result =
            resolveField(
                requested,
                columns
            );

        if (result) {
            if (
                !resolved.includes(
                    result.resolved
                )
            ) {
                resolved.push(
                    result.resolved
                );
            }

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
            unresolved.push(requested);

            mapping.push({
                type,
                requested,
                resolved: null,
                title: null,
                source: "NOT_FOUND"
            });
        }
    });

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
// DATE HELPERS
// ============================================================

function getTodayString() {
    const now = new Date();

    return (
        now.getFullYear() +
        "-" +
        String(
            now.getMonth() + 1
        ).padStart(2, "0") +
        "-" +
        String(
            now.getDate()
        ).padStart(2, "0")
    );
}

function normalizeDate(value) {
    if (!value) {
        return "";
    }

    const text =
        String(value).trim();

    if (!text) {
        return "";
    }

    // YYYY-MM-DD
    const match =
        text.match(
            /^(\d{4}-\d{2}-\d{2})/
        );

    if (match) {
        return match[1];
    }

    const date =
        new Date(text);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return "";
    }

    return (
        date.getFullYear() +
        "-" +
        String(
            date.getMonth() + 1
        ).padStart(2, "0") +
        "-" +
        String(
            date.getDate()
        ).padStart(2, "0")
    );
}


// ============================================================
// BUILD FILTERS
//
// ГЛАВНОЕ:
//
// OpenDate.Typed ВСЕГДА должен быть.
//
// Если frontend не прислал дату,
// берём сегодняшний день.
// ============================================================

function buildFilters(body) {
    let filters = {};

    if (
        body.filters &&
        typeof body.filters === "object" &&
        !Array.isArray(body.filters)
    ) {
        filters = {
            ...body.filters
        };
    }


    // --------------------------------------------------------
    // Получаем даты
    // --------------------------------------------------------

    let from =
        normalizeDate(
            body.from
        );

    let to =
        normalizeDate(
            body.to
        );


    // --------------------------------------------------------
    // Проверяем возможные вложенные варианты
    // --------------------------------------------------------

    if (
        !from &&
        body.dateFrom
    ) {
        from =
            normalizeDate(
                body.dateFrom
            );
    }

    if (
        !to &&
        body.dateTo
    ) {
        to =
            normalizeDate(
                body.dateTo
            );
    }


    // --------------------------------------------------------
    // Если дата вообще не пришла —
    // сегодняшний день
    // --------------------------------------------------------

    if (!from && !to) {
        from = getTodayString();
        to = from;
    } else if (!from) {
        from = to;
    } else if (!to) {
        to = from;
    }


    // --------------------------------------------------------
    // Всегда ставим OpenDate.Typed
    //
    // Даже если frontend передал старый фильтр.
    // --------------------------------------------------------

    filters["OpenDate.Typed"] = {
        filterType: "DateRange",

        periodType: "CUSTOM",

        from:
            `${from}T00:00:00.000`,

        to:
            `${to}T23:59:59.999`,

        includeLow: true,

        includeHigh: true
    };


    return filters;
}


// ============================================================
// GET
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
                url.searchParams.get("ip") ||
                ""
            ).trim();

        const port =
            (
                url.searchParams.get("port") ||
                ""
            ).trim();

        const login =
            (
                url.searchParams.get("login") ||
                ""
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

        log(
            requestId,
            "NORMALIZED COLUMNS",
            {
                count:
                    columns.length,

                sample:
                    columns
                        .slice(0, 20)
                        .map(field => ({
                            technicalName:
                                field.technicalName,

                            title:
                                field.title
                        }))
            }
        );

        return jsonResponse(
            {
                success: true,

                requestId,

                reportType,

                count:
                    columns.length,

                fields:
                    columns.map(field => ({
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

                        field:
                            field.technicalName,

                        key:
                            field.technicalName,

                        id:
                            field.technicalName
                    }))
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
// POST
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
        // GET REAL IIKO FIELDS
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
        // INPUT ROWS
        // ======================================================

        const rowsInput =
            Array.isArray(body.rows)
                ? body.rows
                : (
                    Array.isArray(
                        body.groupByRowFields
                    )
                        ? body.groupByRowFields
                        : []
                );


        // ======================================================
        // INPUT COLUMNS
        // ======================================================

        const columnsInput =
            Array.isArray(body.columns)
                ? body.columns
                : (
                    Array.isArray(
                        body.groupByColFields
                    )
                        ? body.groupByColFields
                        : []
                );


        // ======================================================
        // INPUT MEASURES
        // ======================================================

        const measuresInput =
            Array.isArray(body.measures)
                ? body.measures
                : (
                    Array.isArray(
                        body.aggregateFields
                    )
                        ? body.aggregateFields
                        : []
                );


        log(
            requestId,
            "RAW OLAP FIELDS FROM FRONTEND",
            {
                rows:
                    rowsInput,

                columns:
                    columnsInput,

                measures:
                    measuresInput
            }
        );


        // ======================================================
        // RESOLVE ROWS
        // ======================================================

        const resolvedRows =
            resolveFieldArray(
                rowsInput,
                columns,
                requestId,
                "row"
            );


        // ======================================================
        // RESOLVE COLUMNS
        // ======================================================

        const resolvedColumns =
            resolveFieldArray(
                columnsInput,
                columns,
                requestId,
                "column"
            );


        // ======================================================
        // RESOLVE MEASURES
        // ======================================================

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
            unresolved.length > 0
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
        // ПРОВЕРКА НА ПУСТОЙ ЗАПРОС
        //
        // iiko требует хотя бы показатель или поле группировки.
        // ======================================================

        if (
            resolvedRows.resolved.length === 0 &&
            resolvedColumns.resolved.length === 0 &&
            resolvedMeasures.resolved.length === 0
        ) {
            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "Конструктор не содержит полей. Перетащите хотя бы одно поле в Строки, Колонки или Показатели.",

                    hint:
                        "Например: Касса → Строки и Сумма со скидкой → Показатели.",

                    mapping: {
                        rows: [],
                        columns: [],
                        measures: []
                    }
                },
                400,
                requestId
            );
        }


        // ======================================================
        // FILTERS
        //
        // OpenDate.Typed ВСЕГДА
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
            `${serverUrl}/resto/api/v2/reports/olap`;

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
                                "application/json",

                            "Accept":
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
        // RESPONSE
        // ======================================================

        const text =
            await response.text();

        let report = null;

        try {
            report =
                text
                    ? JSON.parse(text)
                    : null;
        } catch (error) {
            report = null;
        }


        // ======================================================
        // SUCCESS
        // ======================================================

        if (response.ok) {
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
