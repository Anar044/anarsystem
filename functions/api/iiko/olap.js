// ============================================================
// ANAR SYSTEM — IIKO OLAP API
// functions/api/iiko/olap.js
//
// Версия с подробным серверным логированием.
//
// ВАЖНО:
// - пароль НЕ логируется
// - token НЕ логируется
// - полный OLAP request логируется
// - полный ответ iiko при ошибке логируется
// - каждому запросу присваивается requestId
// ============================================================


// ============================================================
// CORS
// ============================================================

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",

        "Access-Control-Allow-Methods":
            "GET, POST, OPTIONS",

        "Access-Control-Allow-Headers":
            "Content-Type"
    };
}


// ============================================================
// JSON RESPONSE
// ============================================================

function jsonResponse(
    data,
    status = 200
) {
    return new Response(
        JSON.stringify(data),
        {
            status,

            headers: {
                "Content-Type":
                    "application/json; charset=utf-8",

                ...corsHeaders()
            }
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
            .slice(2, 10)
    );
}


// ============================================================
// SAFE LOGGING
// ============================================================

function logInfo(
    requestId,
    message,
    data = null
) {

    if (data === null) {

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
    data = null
) {

    if (data === null) {

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
// SAFE CONNECTION INFO
//
// Пароль и token никогда сюда не попадают.
// ============================================================

function safeConnectionInfo({
    ip,
    port,
    login
}) {

    return {
        ip,
        port,
        login,
        serverUrl:
            `http://${ip}:${port}`
    };
}


// ============================================================
// SHA1
// ============================================================

async function sha1(text) {

    const bytes =
        new TextEncoder()
            .encode(text);

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
            function (byte) {

                return byte
                    .toString(16)
                    .padStart(2, "0");

            }
        )
        .join("");
}


// ============================================================
// GET IIKO TOKEN
// ============================================================

async function getToken(
    ip,
    port,
    login,
    password,
    requestId
) {

    logInfo(
        requestId,
        "AUTH START",
        {
            ip,
            port,
            login
        }
    );


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


    const authUrl =
        `${serverUrl}/resto/api/auth` +
        `?login=${encodeURIComponent(
            login
        )}` +
        `&pass=${passwordHash}`;


    logInfo(
        requestId,
        "AUTH REQUEST",
        {
            url:
                `${serverUrl}/resto/api/auth`,
            login
        }
    );


    let response;

    try {

        response =
            await fetch(
                authUrl,
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

        throw error;
    }


    const text =
        (
            await response.text()
        ).trim();


    logInfo(
        requestId,
        "AUTH RESPONSE",
        {
            httpStatus:
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
                httpStatus:
                    response.status,

                responseBody:
                    text.slice(
                        0,
                        5000
                    )
            }
        );


        throw new Error(
            `Ошибка авторизации iiko: HTTP ${response.status}`
        );
    }


    logInfo(
        requestId,
        "AUTH SUCCESS"
    );


    return {
        serverUrl,
        token: text
    };
}


// ============================================================
// NORMALIZE DATE
// ============================================================

function normalizeDate(
    value,
    end = false
) {

    if (!value) {
        return "";
    }


    const date =
        String(value)
            .slice(0, 10);


    return (
        date +
        (
            end
                ? "T23:59:59.999"
                : "T00:00:00.000"
        )
    );
}


// ============================================================
// NORMALIZE COLUMNS
// ============================================================

function normalizeColumns(
    raw
) {

    if (
        Array.isArray(raw)
    ) {

        return raw;
    }


    if (
        raw &&
        typeof raw ===
            "object"
    ) {

        if (
            Array.isArray(
                raw.columns
            )
        ) {

            return raw.columns;
        }


        if (
            Array.isArray(
                raw.fields
            )
        ) {

            return raw.fields;
        }


        if (
            Array.isArray(
                raw.data
            )
        ) {

            return raw.data;
        }


        return Object
            .entries(raw)
            .map(
                function ([
                    key,
                    value
                ]) {

                    if (
                        value &&
                        typeof value ===
                            "object"
                    ) {

                        return {
                            ...value,

                            name:
                                value.name ||
                                key,

                            id:
                                value.id ||
                                key
                        };
                    }


                    return {
                        name: key,
                        id: key,
                        title: key
                    };

                }
            );
    }


    return [];
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
//
// Получение списка OLAP полей.
//
// /api/iiko/olap
// ?mode=fields
// &reportType=SALES
// &ip=...
// &port=...
// &login=...
// &password=...
// ============================================================

export async function onRequestGet(
    context
) {

    const requestId =
        createRequestId();


    logInfo(
        requestId,
        "GET START"
    );


    try {

        const url =
            new URL(
                context.request.url
            );


        const mode =
            url.searchParams.get(
                "mode"
            ) || "fields";


        logInfo(
            requestId,
            "GET PARAMS",
            {
                mode,
                reportType:
                    url.searchParams.get(
                        "reportType"
                    ) || "SALES"
            }
        );


        if (
            mode !== "fields"
        ) {

            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "Неизвестный режим"
                },
                400
            );
        }


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
                ) || "SALES"
            )
                .trim()
                .toUpperCase();


        if (
            !ip ||
            !port ||
            !login ||
            !password
        ) {

            logError(
                requestId,
                "GET VALIDATION FAILED",
                {
                    hasIp:
                        Boolean(ip),

                    hasPort:
                        Boolean(port),

                    hasLogin:
                        Boolean(login),

                    hasPassword:
                        Boolean(password)
                }
            );


            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "Нужны IP, порт, логин и пароль iiko"
                },
                400
            );
        }


        return await getFields(
            {
                ip,
                port,
                login,
                password,
                reportType,
                requestId
            }
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
                    error.message ||
                    "Ошибка OLAP"
            },
            502
        );
    }
}


// ============================================================
// GET FIELDS
//
// iiko endpoint:
//
// /resto/api/v2/reports/olap/columns
// ============================================================

async function getFields({
    ip,
    port,
    login,
    password,
    reportType = "SALES",
    requestId
}) {

    logInfo(
        requestId,
        "GET FIELDS START",
        {
            reportType,

            connection:
                safeConnectionInfo({
                    ip,
                    port,
                    login
                })
        }
    );


    const {
        serverUrl,
        token
    } =
        await getToken(
            ip,
            port,
            login,
            password,
            requestId
        );


    const url =
        `${serverUrl}` +
        `/resto/api/v2/reports/olap/columns` +
        `?key=${encodeURIComponent(
            token
        )}` +
        `&reportType=${encodeURIComponent(
            reportType
        )}`;


    logInfo(
        requestId,
        "IIKO COLUMNS REQUEST",
        {
            endpoint:
                `${serverUrl}/resto/api/v2/reports/olap/columns`,

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
            "IIKO COLUMNS FETCH ERROR",
            {
                name:
                    error?.name,

                message:
                    error?.message
            }
        );

        throw error;
    }


    const text =
        await response.text();


    logInfo(
        requestId,
        "IIKO COLUMNS RESPONSE",
        {
            httpStatus:
                response.status,

            ok:
                response.ok,

            bodyLength:
                text.length
        }
    );


    let raw = null;


    try {

        raw =
            JSON.parse(text);

    } catch (error) {

        raw = null;
    }


    if (!response.ok) {

        logError(
            requestId,
            "IIKO COLUMNS HTTP ERROR",
            {
                httpStatus:
                    response.status,

                responseBody:
                    text.slice(
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

                message:
                    `iiko не вернул список полей: HTTP ${response.status}`,

                rawResponse:
                    text.slice(
                        0,
                        30000
                    )
            },
            502
        );
    }


    const fields =
        normalizeColumns(
            raw
        );


    logInfo(
        requestId,
        "IIKO COLUMNS SUCCESS",
        {
            count:
                fields.length,

            firstFields:
                fields
                    .slice(0, 20)
                    .map(
                        function (field) {

                            return {
                                name:
                                    field?.name,

                                id:
                                    field?.id,

                                title:
                                    field?.title
                            };

                        }
                    )
        }
    );


    return jsonResponse(
        {
            success: true,

            requestId,

            fields,

            count:
                fields.length,

            reportType,

            endpoint:
                "/resto/api/v2/reports/olap/columns"
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


    logInfo(
        requestId,
        "POST START"
    );


    try {

        const body =
            await context.request.json();


        logInfo(
            requestId,
            "POST BODY RECEIVED",
            {
                action:
                    body.action,

                reportType:
                    body.reportType,

                from:
                    body.from,

                to:
                    body.to,

                buildSummary:
                    body.buildSummary
            }
        );


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

            logError(
                requestId,
                "POST VALIDATION FAILED",
                {
                    hasIp:
                        Boolean(ip),

                    hasPort:
                        Boolean(port),

                    hasLogin:
                        Boolean(login),

                    hasPassword:
                        Boolean(password)
                }
            );


            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "Заполните IP, порт, логин и пароль iiko"
                },
                400
            );
        }


        // ========================================================
        // ACTION: FIELDS
        // ========================================================

        if (
            body.action ===
            "fields"
        ) {

            logInfo(
                requestId,
                "ACTION = FIELDS"
            );


            return await getFields(
                {
                    ip,
                    port,
                    login,
                    password,

                    reportType:
                        body.reportType ||
                        "SALES",

                    requestId
                }
            );
        }


        // ========================================================
        // REPORT SETTINGS
        // ========================================================

        const reportType =
            String(
                body.reportType ||
                "SALES"
            )
                .trim()
                .toUpperCase();


        // ========================================================
        // ROW FIELDS
        // ========================================================

        let groupByRowFields = [];


        if (
            Array.isArray(
                body.groupByRowFields
            )
        ) {

            groupByRowFields =
                body.groupByRowFields
                    .filter(Boolean)
                    .map(String);

        } else if (
            Array.isArray(
                body.rows
            )
        ) {

            groupByRowFields =
                body.rows
                    .filter(Boolean)
                    .map(String);
        }


        // ========================================================
        // COLUMN FIELDS
        // ========================================================

        let groupByColFields = [];


        if (
            Array.isArray(
                body.groupByColFields
            )
        ) {

            groupByColFields =
                body.groupByColFields
                    .filter(Boolean)
                    .map(String);

        } else if (
            Array.isArray(
                body.groupByColumnFields
            )
        ) {

            groupByColFields =
                body.groupByColumnFields
                    .filter(Boolean)
                    .map(String);

        } else if (
            Array.isArray(
                body.columns
            )
        ) {

            groupByColFields =
                body.columns
                    .filter(Boolean)
                    .map(String);
        }


        // ========================================================
        // MEASURES
        // ========================================================

        let aggregateFields = [];


        if (
            Array.isArray(
                body.aggregateFields
            )
        ) {

            aggregateFields =
                body.aggregateFields
                    .filter(Boolean)
                    .map(
                        function (item) {

                            if (
                                typeof item ===
                                "string"
                            ) {

                                return item;
                            }


                            if (
                                item &&
                                typeof item ===
                                "object"
                            ) {

                                return (
                                    item.field ||
                                    item.name ||
                                    ""
                                );
                            }


                            return "";

                        }
                    )
                    .filter(Boolean);

        } else if (
            Array.isArray(
                body.measures
            )
        ) {

            aggregateFields =
                body.measures
                    .map(
                        function (item) {

                            if (
                                typeof item ===
                                "string"
                            ) {

                                return item;
                            }


                            if (
                                item &&
                                typeof item ===
                                "object"
                            ) {

                                return (
                                    item.field ||
                                    item.name ||
                                    ""
                                );
                            }


                            return "";

                        }
                    )
                    .filter(Boolean);
        }


        // ========================================================
        // DETAILED DEBUG OF SELECTED FIELDS
        // ========================================================

        logInfo(
            requestId,
            "OLAP BUILDER FIELDS",
            {
                reportType,

                rows:
                    groupByRowFields,

                columns:
                    groupByColFields,

                measures:
                    aggregateFields
            }
        );


        // ========================================================
        // VALIDATION
        // ========================================================

        if (
            !groupByRowFields.length &&
            !groupByColFields.length &&
            !aggregateFields.length
        ) {

            logError(
                requestId,
                "OLAP VALIDATION FAILED: NO FIELDS"
            );


            return jsonResponse(
                {
                    success: false,

                    requestId,

                    message:
                        "Перетащите хотя бы одно поле в конструктор"
                },
                400
            );
        }


        // ========================================================
        // IIKO AUTH
        // ========================================================

        const {
            serverUrl,
            token
        } =
            await getToken(
                ip,
                port,
                login,
                password,
                requestId
            );


        // ========================================================
        // FILTERS
        // ========================================================

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


        // ========================================================
        // PERIOD FILTER
        // ========================================================

        if (
            body.from ||
            body.to
        ) {

            const from =
                normalizeDate(
                    body.from
                );


            const to =
                normalizeDate(
                    body.to,
                    true
                );


            filters[
                "OpenDate.Typed"
            ] = {

                filterType:
                    "DateRange",

                periodType:
                    "CUSTOM",

                from,

                to,

                includeLow:
                    true,

                includeHigh:
                    true
            };
        }


        // ========================================================
        // IIKO OLAP REQUEST BODY
        // ========================================================

        const requestBody = {

            reportType,

            buildSummary:
                body.buildSummary !==
                false,

            groupByRowFields,

            groupByColFields,

            aggregateFields,

            filters
        };


        // ========================================================
        // SERVER DEBUG LOG
        // ========================================================

        logInfo(
            requestId,
            "IIKO OLAP REQUEST BODY",
            JSON.stringify(
                requestBody,
                null,
                2
            )
        );


        logInfo(
            requestId,
            "IIKO OLAP REQUEST SUMMARY",
            {
                reportType,

                rowsCount:
                    groupByRowFields.length,

                columnsCount:
                    groupByColFields.length,

                measuresCount:
                    aggregateFields.length,

                filtersCount:
                    Object.keys(
                        filters
                    ).length,

                rows:
                    groupByRowFields,

                columns:
                    groupByColFields,

                measures:
                    aggregateFields,

                filters
            }
        );


        // ========================================================
        // IIKO OLAP ENDPOINT
        // ========================================================

        const olapEndpoint =
            `${serverUrl}` +
            `/resto/api/v2/reports/olap`;


        const url =
            olapEndpoint +
            `?key=${encodeURIComponent(
                token
            )}`;


        logInfo(
            requestId,
            "IIKO OLAP REQUEST START",
            {
                endpoint:
                    olapEndpoint,

                method:
                    "POST"
            }
        );


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
                                requestBody
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
                        "Ошибка соединения с iiko",

                    endpoint:
                        "/resto/api/v2/reports/olap"
                },
                502
            );
        }


        // ========================================================
        // READ RESPONSE
        // ========================================================

        const text =
            await response.text();


        // ========================================================
        // RESPONSE HEADERS
        // ========================================================

        const responseHeaders = {};


        try {

            response.headers.forEach(
                function (
                    value,
                    key
                ) {

                    responseHeaders[
                        key
                    ] = value;

                }
            );

        } catch (error) {
            // ignore
        }


        // ========================================================
        // PARSE JSON
        // ========================================================

        let report = null;


        try {

            report =
                JSON.parse(text);

        } catch (error) {

            report = null;
        }


        // ========================================================
        // RESPONSE LOG
        // ========================================================

        logInfo(
            requestId,
            "IIKO OLAP RESPONSE",
            {
                httpStatus:
                    response.status,

                ok:
                    response.ok,

                bodyLength:
                    text.length,

                contentType:
                    response.headers.get(
                        "content-type"
                    )
            }
        );


        // ========================================================
        // SUCCESS
        // ========================================================

        if (
            response.ok
        ) {

            logInfo(
                requestId,
                "IIKO OLAP SUCCESS",
                {
                    httpStatus:
                        response.status,

                    responsePreview:
                        text.slice(
                            0,
                            5000
                        )
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
                        requestBody,

                    report,

                    rawResponse:
                        text.slice(
                            0,
                            30000
                        )
                }
            );
        }


        // ========================================================
        // IIKO ERROR
        //
        // ЗДЕСЬ МЫ ПОЛУЧИМ НАСТОЯЩУЮ ПРИЧИНУ 400
        // ========================================================

        logError(
            requestId,
            "IIKO OLAP HTTP ERROR",
            {
                httpStatus:
                    response.status,

                statusText:
                    response.statusText,

                endpoint:
                    olapEndpoint,

                responseHeaders,

                responseBody:
                    text.slice(
                        0,
                        30000
                    )
            }
        );


        // Отдельно логируем тело запроса,
        // чтобы его можно было сравнить
        // с требованиями iiko.

        logError(
            requestId,
            "IIKO OLAP FAILED REQUEST BODY",
            JSON.stringify(
                requestBody,
                null,
                2
            )
        );


        return jsonResponse(
            {
                success: false,

                requestId,

                iikoHttpStatus:
                    response.status,

                endpoint:
                    "/resto/api/v2/reports/olap",

                message:
                    `iiko OLAP вернул HTTP ${response.status}`,

                request:
                    requestBody,

                rawResponse:
                    text.slice(
                        0,
                        30000
                    ),

                report
            },
            502
        );


    } catch (error) {

        logError(
            requestId,
            "IIKO OLAP UNHANDLED ERROR",
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
            502
        );
    }
}
