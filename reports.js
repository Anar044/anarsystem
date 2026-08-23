// ============================================================
// ANAR SYSTEM — IIKO REPORTS
// functions/api/iiko/reports.js
// ============================================================

// ============================================================
// CORS
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
// EXTRACT OLAP FIELDS
// ============================================================

function extractOlapFields(data) {

    const result = [];

    const seen =
        new Set();

    function addField(
        field,
        fallbackName = ""
    ) {

        if (!field) {
            return;
        }

        let name = "";
        let title = "";
        let type = "";

        if (
            typeof field === "string"
        ) {

            name =
                field;

            title =
                field;

        } else if (
            typeof field === "object"
        ) {

            name =
                field.name ||
                field.field ||
                field.key ||
                field.id ||
                field.code ||
                field.technicalName ||
                fallbackName ||
                "";

            title =
                field.title ||
                field.caption ||
                field.label ||
                field.displayName ||
                field.name ||
                name;

            type =
                field.type ||
                field.dataType ||
                field.kind ||
                "";
        }

        name =
            String(
                name || ""
            ).trim();

        if (!name) {
            return;
        }

        const key =
            name.toLowerCase();

        if (
            seen.has(key)
        ) {
            return;
        }

        seen.add(key);

        const objectField =
            field &&
            typeof field === "object"
                ? field
                : {};

        result.push({

            ...objectField,

            name,

            field:
                name,

            key:
                name,

            title:
                String(
                    title ||
                    name
                ),

            type:
                String(
                    type ||
                    ""
                ),

            isMeasure:
                objectField.isMeasure === true ||
                objectField.measure === true ||
                objectField.aggregationAllowed === true,

            aggregationAllowed:
                objectField.aggregationAllowed === true ||
                objectField.allowAggregation === true ||
                objectField.canAggregate === true,

            groupingAllowed:
                objectField.groupingAllowed !== false,

            filteringAllowed:
                objectField.filteringAllowed !== false
        });
    }


    function parseArray(array) {

        if (!Array.isArray(array)) {
            return;
        }

        array.forEach(
            item => {

                if (
                    typeof item === "string"
                ) {

                    addField(item);

                    return;
                }

                if (
                    item &&
                    typeof item === "object"
                ) {

                    addField(item);
                }
            }
        );
    }


    function parseObject(object) {

        if (
            !object ||
            typeof object !== "object" ||
            Array.isArray(object)
        ) {
            return;
        }

        Object.entries(object)
            .forEach(
                ([key, value]) => {

                    // Контейнеры.
                    //
                    // Их отдельно разбираем ниже.
                    if (
                        [
                            "fields",
                            "columns",
                            "items",
                            "data",
                            "dimensions",
                            "measures",
                            "fieldDefinitions"
                        ].includes(
                            key
                        )
                    ) {
                        return;
                    }

                    // Формат:
                    //
                    // {
                    //   "DishName": {...},
                    //   "DishSumInt": {...}
                    // }
                    //
                    // Ключ объекта = техническое имя.

                    if (
                        value &&
                        typeof value === "object" &&
                        !Array.isArray(value)
                    ) {

                        addField(
                            value,
                            key
                        );
                    }
                }
            );
    }


    function parseContainer(
        container
    ) {

        if (!container) {
            return;
        }

        if (
            Array.isArray(container)
        ) {

            parseArray(
                container
            );

            return;
        }

        if (
            typeof container === "object"
        ) {

            parseObject(
                container
            );
        }
    }


    if (!data) {
        return [];
    }


    // ========================================================
    // backend fields
    // ========================================================

    if (
        Array.isArray(data.fields)
    ) {

        parseArray(
            data.fields
        );

    } else if (
        data.fields &&
        typeof data.fields === "object"
    ) {

        parseObject(
            data.fields
        );
    }


    // ========================================================
    // RAW
    // ========================================================

    if (
        data.raw
    ) {

        parseContainer(
            data.raw
        );
    }


    // ========================================================
    // DIRECT RESPONSE
    // ========================================================

    if (
        !result.length
    ) {

        if (
            Array.isArray(data)
        ) {

            parseArray(
                data
            );

        } else if (
            typeof data === "object"
        ) {

            parseObject(
                data
            );
        }
    }


    return result;
}


// ============================================================
// NORMALIZE REPORT ROWS
// ============================================================

function normalizeRows(data) {

    if (!data) {
        return [];
    }


    // Самые распространённые варианты iiko.

    if (
        Array.isArray(data)
    ) {
        return data;
    }


    if (
        Array.isArray(data.rows)
    ) {
        return data.rows;
    }


    if (
        Array.isArray(data.data)
    ) {
        return data.data;
    }


    if (
        Array.isArray(data.result)
    ) {
        return data.result;
    }


    if (
        Array.isArray(data.records)
    ) {
        return data.records;
    }


    return [];
}


// ============================================================
// NORMALIZE OLAP RESPONSE
// ============================================================

function normalizeOlapResponse(
    report
) {

    if (!report) {

        return {
            rows: [],
            columns: [],
            fields: []
        };
    }


    const rows =
        normalizeRows(
            report
        );


    const fields =
        extractOlapFields(
            report
        );


    let columns = [];


    if (
        Array.isArray(report.columns)
    ) {

        columns =
            report.columns;
    }


    return {

        ...(
            typeof report === "object"
                ? report
                : {}
        ),

        rows,

        columns,

        fields
    };
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

    const text =
        String(value).trim();

    if (!text) {
        return "";
    }

    // Уже ISO.

    if (
        text.includes("T")
    ) {
        return text;
    }

    return endOfDay
        ? `${text}T23:59:59.999`
        : `${text}T00:00:00.000`;
}


// ============================================================
// CREDENTIALS
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
// GET OLAP FIELDS
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
            `iiko OLAP columns: HTTP ${response.status}: ${text.slice(0, 5000)}`
        );
    }


    let raw;


    try {

        raw =
            JSON.parse(text);

    } catch {

        throw new Error(
            "iiko вернул некорректный JSON списка OLAP-полей"
        );
    }


    const fields =
        extractOlapFields(
            {
                raw
            }
        );


    console.log(
        "IIKO OLAP TOTAL FIELDS:",
        fields.length
    );


    return {
        raw,
        fields
    };
}


// ============================================================
// BUILD FILTERS
// ============================================================

function buildFilters(
    body
) {

    const filters = {

        ...(
            body.filters &&
            typeof body.filters === "object"
                ? body.filters
                : {}
        )
    };


    // --------------------------------------------------------
    // DATE
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


    return filters;
}


// ============================================================
// GET ROW FIELDS
// ============================================================

function getRowFields(body) {

    if (
        Array.isArray(
            body.groupByRowFields
        )
    ) {

        return body.groupByRowFields
            .filter(Boolean)
            .map(String);
    }


    if (
        Array.isArray(body.rows)
    ) {

        return body.rows
            .filter(Boolean)
            .map(String);
    }


    return [];
}


// ============================================================
// GET COLUMN FIELDS
// ============================================================

function getColumnFields(body) {

    if (
        Array.isArray(
            body.groupByColumnFields
        )
    ) {

        return body.groupByColumnFields
            .filter(Boolean)
            .map(String);
    }


    if (
        Array.isArray(
            body.columns
        )
    ) {

        return body.columns
            .filter(Boolean)
            .map(String);
    }


    if (
        Array.isArray(
            body.groupByColFields
        )
    ) {

        return body.groupByColFields
            .filter(Boolean)
            .map(String);
    }


    return [];
}


// ============================================================
// GET AGGREGATES
// ============================================================

function getAggregateFields(body) {

    let source = [];


    if (
        Array.isArray(
            body.aggregateFields
        )
    ) {

        source =
            body.aggregateFields;

    } else if (
        Array.isArray(
            body.measures
        )
    ) {

        source =
            body.measures;
    }


    return source
        .map(
            item => {

                if (
                    typeof item === "string"
                ) {

                    return item;
                }


                if (
                    item &&
                    typeof item === "object"
                ) {

                    return (
                        item.field ||
                        item.name ||
                        item.key ||
                        ""
                    );
                }


                return "";
            }
        )
        .filter(Boolean)
        .map(String);
}


// ============================================================
// BUILD OLAP REQUEST
// ============================================================

function buildOlapRequest(
    body
) {

    const reportType =
        String(
            body.reportType ||
            "SALES"
        )
            .trim()
            .toUpperCase();


    const groupByRowFields =
        getRowFields(
            body
        );


    const groupByColFields =
        getColumnFields(
            body
        );


    const aggregateFields =
        getAggregateFields(
            body
        );


    const filters =
        buildFilters(
            body
        );


    return {

        reportType,

        buildSummary:
            body.buildSummary !== false,

        groupByRowFields,

        groupByColFields,

        aggregateFields,

        filters
    };
}


// ============================================================
// RUN OLAP
// ============================================================

async function runOlapReport(
    body,
    serverUrl,
    token
) {

    const requestBody =
        buildOlapRequest(
            body
        );


    if (
        requestBody.groupByRowFields.length === 0 &&
        requestBody.groupByColFields.length === 0 &&
        requestBody.aggregateFields.length === 0
    ) {

        throw new Error(
            "Выберите хотя бы одно поле для строк, колонок или показателей"
        );
    }


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


    console.log(
        "IIKO OLAP HTTP:",
        response.status
    );


    console.log(
        "IIKO OLAP RESPONSE LENGTH:",
        text.length
    );


    let report = null;


    try {

        report =
            JSON.parse(text);

    } catch {

        report = null;
    }


    // --------------------------------------------------------
    // ВАЖНО
    //
    // HTTP 200 ещё не означает, что report корректный.
    // Поэтому возвращаем полный ответ iiko.
    // --------------------------------------------------------

    const normalized =
        report
            ? normalizeOlapResponse(
                report
            )
            : null;


    return {

        success:
            response.ok,

        iikoHttpStatus:
            response.status,

        endpoint:
            "/resto/api/v2/reports/olap",

        request:
            requestBody,

        report:
            normalized,

        rawResponse:
            text.substring(
                0,
                50000
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
// POST
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
                    success:
                        false,

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
        } =
            credentials;


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
        // ====================================================

        if (
            action === "fields"
        ) {

            console.log(
                "IIKO REPORTS ACTION: FIELDS"
            );


            const result =
                await getOlapFields(
                    serverUrl,
                    token,
                    reportType
                );


            return jsonResponse(
                {
                    success:
                        true,

                    action:
                        "fields",

                    reportType,

                    count:
                        result.fields.length,

                    fields:
                        result.fields,

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
                success:
                    false,

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
            "IIKO REPORTS ERROR:",
            error
        );


        return jsonResponse(
            {
                success:
                    false,

                message:
                    error &&
                    error.message
                        ? error.message
                        : "Ошибка iiko Reports"
            },
            502
        );
    }
}
