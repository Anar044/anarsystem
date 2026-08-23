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

    console.log(
        "IIKO AUTH:",
        `${serverUrl}/resto/api/auth`
    );

    let response;

    try {

        response =
            await fetch(
                authUrl,
                {
                    method: "GET",
                    headers: {
                        "Accept":
                            "text/plain"
                    }
                }
            );

    } catch (error) {

        throw new Error(
            `Не удалось подключиться к iiko Server: ${error.message}`
        );
    }

    const text =
        await response.text();

    const token =
        String(text || "").trim();

    if (
        !response.ok ||
        !token
    ) {

        throw new Error(
            `Ошибка авторизации iiko: HTTP ${response.status}. ${text.slice(0, 1000)}`
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

    const stringValue =
        String(value).trim();

    // Уже полноценная дата
    if (
        stringValue.includes("T")
    ) {
        return stringValue;
    }

    return endOfDay
        ? `${stringValue}T23:59:59.999`
        : `${stringValue}T00:00:00.000`;
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
// SAFE JSON
// ============================================================

function tryParseJson(text) {

    if (
        !text ||
        typeof text !== "string"
    ) {
        return null;
    }

    try {

        return JSON.parse(text);

    } catch {

        return null;
    }
}


// ============================================================
// NORMALIZE FIELD
// ============================================================

function normalizeField(
    fieldName,
    meta = {}
) {

    if (
        typeof meta !== "object" ||
        meta === null
    ) {
        meta = {};
    }

    const name =
        String(
            fieldName ||
            meta.name ||
            meta.field ||
            meta.key ||
            ""
        ).trim();

    if (!name) {
        return null;
    }

    const title =
        String(
            meta.title ||
            meta.caption ||
            meta.displayName ||
            meta.name ||
            name
        );

    const type =
        String(
            meta.type ||
            meta.dataType ||
            meta.valueType ||
            ""
        );

    const aggregationAllowed =
        meta.aggregationAllowed === true;

    const groupingAllowed =
        meta.groupingAllowed === true;

    const filteringAllowed =
        meta.filteringAllowed === true;

    const isMeasure =
        aggregationAllowed === true ||
        meta.isMeasure === true ||
        meta.measure === true;

    return {

        ...meta,

        name,

        title,

        type,

        aggregationAllowed,

        groupingAllowed,

        filteringAllowed,

        isMeasure
    };
}


// ============================================================
// EXTRACT ALL OLAP FIELDS
//
// ВАЖНО:
// iiko v2 обычно возвращает объект:
//
// {
//   "OpenDate.Typed": {
//      "name": "...",
//      "type": "DATETIME",
//      "aggregationAllowed": false,
//      "groupingAllowed": true,
//      "filteringAllowed": true
//   },
//   ...
// }
//
// Мы НЕ ограничиваем список.
// Берём абсолютно все ключи.
// ============================================================

function extractAllOlapFields(columns) {

    const fields = [];

    const seen =
        new Set();

    function add(
        name,
        meta
    ) {

        const field =
            normalizeField(
                name,
                meta
            );

        if (!field) {
            return;
        }

        if (
            seen.has(field.name)
        ) {
            return;
        }

        seen.add(
            field.name
        );

        fields.push(
            field
        );
    }


    // --------------------------------------------------------
    // Object
    // --------------------------------------------------------

    if (
        columns &&
        typeof columns === "object" &&
        !Array.isArray(columns)
    ) {

        Object.entries(
            columns
        ).forEach(
            ([name, meta]) => {

                add(
                    name,
                    meta
                );
            }
        );
    }


    // --------------------------------------------------------
    // Array
    // --------------------------------------------------------

    else if (
        Array.isArray(columns)
    ) {

        columns.forEach(
            (item, index) => {

                if (
                    typeof item === "string"
                ) {

                    add(
                        item,
                        {}
                    );

                    return;
                }

                if (
                    item &&
                    typeof item === "object"
                ) {

                    const name =
                        item.name ||
                        item.field ||
                        item.key ||
                        item.code ||
                        item.uniqueName ||
                        `field_${index}`;

                    add(
                        name,
                        item
                    );
                }
            }
        );
    }

    return fields;
}


// ============================================================
// GET OLAP COLUMNS
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
        "=========================================="
    );

    console.log(
        "IIKO OLAP COLUMNS"
    );

    console.log(
        "URL:",
        url.replace(
            /key=[^&]+/,
            "key=***"
        )
    );

    console.log(
        "=========================================="
    );

    let response;

    try {

        response =
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

    } catch (error) {

        throw new Error(
            `Ошибка подключения к iiko OLAP columns: ${error.message}`
        );
    }

    const text =
        await response.text();

    console.log(
        "IIKO COLUMNS HTTP:",
        response.status
    );

    console.log(
        "IIKO COLUMNS LENGTH:",
        text.length
    );

    if (!response.ok) {

        throw new Error(
            `iiko OLAP columns HTTP ${response.status}: ${text.slice(0, 3000)}`
        );
    }

    const columns =
        tryParseJson(
            text
        );

    if (
        columns === null
    ) {

        throw new Error(
            "iiko вернул некорректный JSON структуры OLAP: " +
            text.slice(0, 2000)
        );
    }

    const fields =
        extractAllOlapFields(
            columns
        );

    console.log(
        "IIKO OLAP TOTAL FIELDS:",
        fields.length
    );

    console.log(
        "IIKO OLAP FIELD NAMES:",
        fields.map(
            field =>
                field.name
        )
    );

    return {

        raw:
            columns,

        fields,

        rawText:
            text
    };
}


// ============================================================
// NORMALIZE MEASURE
// ============================================================
//
// Frontend:
//
// measures: [
//   {
//      field: "DishSumInt",
//      aggregation: "SUM"
//   }
// ]
//
// iiko v2:
//
// aggregateFields: [
//   "DishSumInt"
// ]
//
// ВАЖНО:
// aggregation НЕ передаём как объект.
// ============================================================

function normalizeMeasures(body) {

    const source =
        Array.isArray(
            body.measures
        )
            ? body.measures
            : Array.isArray(
                body.aggregateFields
            )
                ? body.aggregateFields
                : [];

    const result = [];

    const seen =
        new Set();

    source.forEach(
        item => {

            let field = "";

            if (
                typeof item === "string"
            ) {

                field =
                    item.trim();

            } else if (
                item &&
                typeof item === "object"
            ) {

                field =
                    String(
                        item.field ||
                        item.name ||
                        item.code ||
                        ""
                    ).trim();
            }

            if (!field) {
                return;
            }

            if (
                seen.has(field)
            ) {
                return;
            }

            seen.add(
                field
            );

            result.push(
                field
            );
        }
    );

    return result;
}


// ============================================================
// NORMALIZE GROUP FIELDS
// ============================================================

function normalizeGroupFields(
    primary,
    secondary
) {

    const result = [];

    const seen =
        new Set();

    function add(value) {

        if (
            typeof value !== "string"
        ) {
            return;
        }

        const field =
            value.trim();

        if (!field) {
            return;
        }

        if (
            seen.has(field)
        ) {
            return;
        }

        seen.add(field);

        result.push(
            field
        );
    }

    if (
        Array.isArray(primary)
    ) {

        primary.forEach(add);
    }

    if (
        Array.isArray(secondary)
    ) {

        secondary.forEach(add);
    }

    return result;
}


// ============================================================
// NORMALIZE FILTERS
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
    // Date
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
                    body.from,
                    false
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

    return filters;
}


// ============================================================
// RUN OLAP
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


    // --------------------------------------------------------
    // Rows
    // --------------------------------------------------------

    const rows =
        normalizeGroupFields(
            body.groupByRowFields,
            body.rows
        );


    // --------------------------------------------------------
    // Columns
    // --------------------------------------------------------

    const columns =
        normalizeGroupFields(
            body.groupByColumnFields,
            body.groupByColFields
        );

    const columnFields =
        normalizeGroupFields(
            columns,
            body.columns
        );


    // --------------------------------------------------------
    // Measures
    // --------------------------------------------------------

    const aggregateFields =
        normalizeMeasures(
            body
        );


    // --------------------------------------------------------
    // Validation
    // --------------------------------------------------------

    if (
        rows.length === 0 &&
        columnFields.length === 0 &&
        aggregateFields.length === 0
    ) {

        throw new Error(
            "Выберите хотя бы одно поле"
        );
    }


    // --------------------------------------------------------
    // Filters
    // --------------------------------------------------------

    const filters =
        buildFilters(
            body
        );


    // ========================================================
    // IIKO V2 REQUEST
    // ========================================================
    //
    // Именно такой формат ожидает:
    //
    // POST /resto/api/v2/reports/olap
    //
    // aggregateFields = strings
    //
    // ========================================================

    const requestBody = {

        reportType,

        buildSummary:
            body.buildSummary === true,

        groupByRowFields:
            rows,

        groupByColFields:
            columnFields,

        aggregateFields:
            aggregateFields,

        filters:
            filters
    };


    console.log(
        "=========================================="
    );

    console.log(
        "IIKO OLAP QUERY REQUEST"
    );

    console.log(
        JSON.stringify(
            requestBody,
            null,
            2
        )
    );

    console.log(
        "=========================================="
    );


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

                        "Accept":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            requestBody
                        )
                }
            );

    } catch (error) {

        throw new Error(
            `Не удалось выполнить OLAP-запрос к iiko Server: ${error.message}`
        );
    }


    const text =
        await response.text();

    const report =
        tryParseJson(
            text
        );


    console.log(
        "=========================================="
    );

    console.log(
        "IIKO OLAP RESPONSE"
    );

    console.log(
        "HTTP:",
        response.status
    );

    console.log(
        "BODY:",
        text.slice(
            0,
            10000
        )
    );

    console.log(
        "=========================================="
    );


    // ========================================================
    // SUCCESS
    // ========================================================

    if (
        response.ok
    ) {

        return {

            success: true,

            message:
                "OLAP отчёт успешно получен",

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
                    50000
                )
        };
    }


    // ========================================================
    // ERROR
    // ========================================================

    return {

        success: false,

        message:
            `iiko OLAP вернул HTTP ${response.status}`,

        iikoHttpStatus:
            response.status,

        endpoint:
            "/resto/api/v2/reports/olap",

        request:
            requestBody,

        iikoResponse:
            report,

        rawResponse:
            text.slice(
                0,
                50000
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

        // ====================================================
        // BODY
        // ====================================================

        let body;

        try {

            body =
                await context.request.json();

        } catch {

            return jsonResponse(
                {
                    success: false,

                    message:
                        "Некорректный JSON запроса"
                },
                400
            );
        }


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


        console.log(
            "=========================================="
        );

        console.log(
            "ANAR SYSTEM OLAP"
        );

        console.log(
            "ACTION:",
            action
        );

        console.log(
            "REPORT TYPE:",
            reportType
        );

        console.log(
            "SERVER:",
            `http://${ip}:${port}`
        );

        console.log(
            "=========================================="
        );


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
        // ====================================================

        if (
            action === "fields"
        ) {

            const result =
                await getOlapFields(
                    serverUrl,
                    token,
                    reportType
                );


            return jsonResponse(
                {

                    success: true,

                    action:
                        "fields",

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
                await runOlapReport(
                    body,
                    serverUrl,
                    token
                );


            // ------------------------------------------------
            // ВАЖНО:
            //
            // Если iiko вернул 400/401/500,
            // НЕ прячем ошибку.
            //
            // Возвращаем 200 нашему frontend,
            // чтобы frontend смог показать
            // iikoResponse/rawResponse.
            // ------------------------------------------------

            if (
                result.success === false
            ) {

                return jsonResponse(
                    result,
                    200
                );
            }


            return jsonResponse(
                result,
                200
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
            "=========================================="
        );

        console.error(
            "ANAR SYSTEM OLAP ERROR"
        );

        console.error(
            error
        );

        console.error(
            "=========================================="
        );


        return jsonResponse(
            {

                success: false,

                message:
                    error.message ||
                    "Ошибка OLAP",

                error:
                    String(
                        error.stack ||
                        ""
                    ).slice(
                        0,
                        5000
                    )

            },
            200
        );
    }
}
