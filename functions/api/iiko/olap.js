// ============================================================
// ANAR SYSTEM — IIKO OLAP API
// functions/api/iiko/olap.js
// ============================================================

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };
}


// ============================================================
// JSON RESPONSE
// ============================================================

function jsonResponse(data, status = 200) {

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
// SHA1
// ============================================================

async function sha1(text) {

    const data =
        new TextEncoder().encode(text);

    const hash =
        await crypto.subtle.digest(
            "SHA-1",
            data
        );

    return Array.from(
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

async function getToken(
    ip,
    port,
    login,
    password
) {

    const serverUrl =
        `http://${ip}:${port}`;

    const passwordHash =
        await sha1(password);

    const authUrl =
        `${serverUrl}/resto/api/auth` +
        `?login=${encodeURIComponent(login)}` +
        `&pass=${passwordHash}`;

    const response =
        await fetch(authUrl);

    const text =
        await response.text();

    const token =
        String(text || "").trim();

    if (
        !response.ok ||
        !token
    ) {

        throw new Error(
            `Ошибка авторизации iiko: HTTP ${response.status}`
        );
    }

    return {
        serverUrl,
        token
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
            headers: corsHeaders()
        }
    );
}


// ============================================================
// DATE
// ============================================================

function normalizeDate(
    value,
    endOfDay = false
) {

    if (!value) {
        return "";
    }

    return endOfDay

        ? `${value}T23:59:59.999`

        : `${value}T00:00:00.000`;
}


// ============================================================
// READ CREDENTIALS
// ============================================================

function getCredentials(body) {

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

        throw new Error(
            "Заполните IP, порт, логин и пароль"
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
// OLAP FIELDS
//
// ВАЖНО:
//
// iiko предоставляет отдельный endpoint:
//
// GET
// /resto/api/v2/reports/olap/columns
//
// Он возвращает ВСЮ доступную схему OLAP.
// ============================================================

async function getOlapFields(
    serverUrl,
    token,
    reportType
) {

    const url =
        `${serverUrl}/resto/api/v2/reports/olap/columns` +
        `?key=${encodeURIComponent(token)}` +
        `&reportType=${encodeURIComponent(reportType)}`;

    console.log(
        "IIKO OLAP COLUMNS URL:",
        url.replace(
            /key=[^&]+/,
            "key=***"
        )
    );

    const response =
        await fetch(
            url,
            {
                method: "GET",
                headers: {
                    "Accept":
                        "application/json"
                }
            }
        );

    const text =
        await response.text();

    console.log(
        "IIKO OLAP COLUMNS HTTP:",
        response.status
    );

    console.log(
        "IIKO OLAP COLUMNS RAW LENGTH:",
        text.length
    );

    if (!response.ok) {

        throw new Error(
            `iiko OLAP columns: HTTP ${response.status}: ${text.slice(0, 2000)}`
        );
    }

    let columns;

    try {

        columns =
            JSON.parse(text);

    } catch (error) {

        throw new Error(
            "iiko вернул некорректный JSON списка OLAP-полей"
        );
    }

    // --------------------------------------------------------
    // Обычно iiko возвращает объект:
    //
    // {
    //   "OpenDate.Typed": {...},
    //   "DishName": {...},
    //   ...
    // }
    //
    // Поэтому НЕ превращаем его в искусственный список.
    // Передаём ВСЕ поля клиенту.
    // --------------------------------------------------------

    let fields = [];

    if (
        columns &&
        typeof columns === "object" &&
        !Array.isArray(columns)
    ) {

        fields =
            Object.entries(
                columns
            ).map(
                ([fieldName, meta]) => {

                    const info =
                        meta &&
                        typeof meta === "object"
                            ? meta
                            : {};

                    return {
                        name:
                            fieldName,

                        title:
                            info.name ||
                            fieldName,

                        type:
                            info.type ||
                            "",

                        aggregationAllowed:
                            info.aggregationAllowed === true,

                        groupingAllowed:
                            info.groupingAllowed === true,

                        filteringAllowed:
                            info.filteringAllowed === true,

                        tags:
                            Array.isArray(
                                info.tags
                            )
                                ? info.tags
                                : [],

                        isMeasure:
                            info.aggregationAllowed === true
                    };
                }
            );

    } else if (
        Array.isArray(columns)
    ) {

        fields =
            columns.map(
                (item, index) => {

                    if (
                        typeof item === "string"
                    ) {

                        return {
                            name: item,
                            title: item,
                            type: "",
                            aggregationAllowed:
                                false,
                            groupingAllowed:
                                true,
                            filteringAllowed:
                                true,
                            tags: [],
                            isMeasure: false
                        };
                    }

                    const name =
                        item.name ||
                        item.field ||
                        item.key ||
                        item.code ||
                        `field_${index}`;

                    return {
                        ...item,

                        name,

                        title:
                            item.title ||
                            item.caption ||
                            item.name ||
                            name,

                        aggregationAllowed:
                            item.aggregationAllowed === true,

                        groupingAllowed:
                            item.groupingAllowed === true,

                        filteringAllowed:
                            item.filteringAllowed === true,

                        tags:
                            Array.isArray(
                                item.tags
                            )
                                ? item.tags
                                : [],

                        isMeasure:
                            item.aggregationAllowed === true
                    };
                }
            );
    }

    console.log(
        "IIKO OLAP TOTAL FIELDS:",
        fields.length
    );

    return {
        raw: columns,
        fields
    };
}


// ============================================================
// RUN OLAP REPORT
// ============================================================

async function runOlapReport(
    body,
    serverUrl,
    token
) {

    const reportType =
        String(
            body.reportType ||
            "SALES"
        )
            .trim()
            .toUpperCase();

    const groupByRowFields =
        Array.isArray(
            body.groupByRowFields
        )
            ? body.groupByRowFields
                .filter(Boolean)
            : (
                Array.isArray(body.rows)
                    ? body.rows.filter(Boolean)
                    : []
            );

    const groupByColumnFields =
        Array.isArray(
            body.groupByColumnFields
        )
            ? body.groupByColumnFields
                .filter(Boolean)
            : (
                Array.isArray(body.columns)
                    ? body.columns.filter(Boolean)
                    : []
            );

    // --------------------------------------------------------
    // measures
    //
    // Поддерживаем новый frontend:
    //
    // measures: [
    //   {
    //      field: "DishSumInt",
    //      aggregation: "SUM"
    //   }
    // ]
    //
    // И старый формат:
    //
    // aggregateFields: [...]
    // --------------------------------------------------------

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
                    item => {

                        if (
                            typeof item === "string"
                        ) {
                            return item;
                        }

                        return (
                            item.field ||
                            item.name ||
                            ""
                        );
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
                    item => {

                        if (
                            typeof item === "string"
                        ) {

                            return item;
                        }

                        return (
                            item.field ||
                            item.name ||
                            ""
                        );
                    }
                )
                .filter(Boolean);
    }

    if (
        groupByRowFields.length === 0 &&
        groupByColumnFields.length === 0 &&
        aggregateFields.length === 0
    ) {

        throw new Error(
            "Выберите хотя бы одно поле"
        );
    }

    // ========================================================
    // FILTERS
    // ========================================================

    const filters = {

        ...(
            body.filters &&
            typeof body.filters === "object"

                ? body.filters

                : {}
        )
    };

    // --------------------------------------------------------
    // Date filter
    // --------------------------------------------------------

    if (
        body.from ||
        body.to
    ) {

        filters[
            "OpenDate.Typed"
        ] = {

            filterType:
                "DateRange",

            periodType:
                "CUSTOM",

            from:
                normalizeDate(
                    body.from
                ),

            to:
                normalizeDate(
                    body.to,
                    true
                ),

            includeLow:
                true,

            includeHigh:
                true
        };
    }

    // ========================================================
    // IIKO REQUEST
    // ========================================================

    const requestBody = {

        reportType,

        buildSummary:
            body.buildSummary !== false,

        groupByRowFields,

        groupByColFields:
            groupByColumnFields,

        aggregateFields,

        filters
    };

    console.log(
        "========================================"
    );

    console.log(
        "IIKO OLAP REQUEST"
    );

    console.log(
        JSON.stringify(
            requestBody,
            null,
            2
        )
    );

    console.log(
        "========================================"
    );

    const url =
        `${serverUrl}/resto/api/v2/reports/olap` +
        `?key=${encodeURIComponent(token)}`;

    const response =
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
                        requestBody
                    )
            }
        );

    const text =
        await response.text();

    let report = null;

    try {

        report =
            JSON.parse(text);

    } catch {

        report = null;
    }

    return {
        success:
            response.ok,

        iikoHttpStatus:
            response.status,

        endpoint:
            "/resto/api/v2/reports/olap",

        request:
            requestBody,

        report,

        rawResponse:
            text.substring(
                0,
                30000
            )
    };
}


// ============================================================
// MAIN POST
// ============================================================

export async function onRequestPost(
    context
) {

    try {

        const body =
            await context.request.json();

        // ====================================================
        // CREDENTIALS
        // ====================================================

        let credentials;

        try {

            credentials =
                getCredentials(
                    body
                );

        } catch (error) {

            return jsonResponse(
                {
                    success: false,
                    message:
                        error.message
                },
                400
            );
        }

        const {
            ip,
            port,
            login,
            password
        } = credentials;

        // ====================================================
        // ACTION
        // ====================================================

        const action =
            String(
                body.action ||
                "query"
            )
                .trim()
                .toLowerCase();

        const reportType =
            String(
                body.reportType ||
                "SALES"
            )
                .trim()
                .toUpperCase();

        // ====================================================
        // AUTH
        // ====================================================

        const {
            serverUrl,
            token
        } =
            await getToken(
                ip,
                port,
                login,
                password
            );

        // ====================================================
        // FIELDS
        //
        // ЭТО ГЛАВНОЕ ИСПРАВЛЕНИЕ.
        // ====================================================

        if (
            action === "fields"
        ) {

            console.log(
                "IIKO OLAP ACTION: FIELDS"
            );

            const result =
                await getOlapFields(
                    serverUrl,
                    token,
                    reportType
                );

            return jsonResponse(
                {
                    success: true,

                    action: "fields",

                    reportType,

                    count:
                        result.fields.length,

                    fields:
                        result.fields,

                    // Полный оригинальный ответ iiko.
                    // Ничего не обрезаем.
                    raw:
                        result.raw
                }
            );
        }

        // ====================================================
        // QUERY
        // ====================================================

        if (
            action === "query"
        ) {

            const result =
                await runOlapReport(
                    body,
                    serverUrl,
                    token
                );

            return jsonResponse(
                result,
                result.success
                    ? 200
                    : 502
            );
        }

        // ====================================================
        // UNKNOWN ACTION
        // ====================================================

        return jsonResponse(
            {
                success: false,

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
            "IIKO OLAP ERROR:",
            error
        );

        return jsonResponse(
            {
                success: false,

                message:
                    error.message ||
                    "Ошибка OLAP"
            },
            502
        );
    }
}
