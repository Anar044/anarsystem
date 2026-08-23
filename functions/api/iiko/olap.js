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
                "Content-Type": "application/json; charset=utf-8",
                ...corsHeaders()
            }
        }
    );
}


// ============================================================
// SHA1
// ============================================================

async function sha1(text) {

    const data = new TextEncoder().encode(text);

    const hash = await crypto.subtle.digest(
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

    const response =
        await fetch(authUrl);

    const text =
        await response.text();

    const token =
        String(text || "").trim();

    if (!response.ok || !token) {

        throw new Error(
            `Ошибка авторизации iiko: HTTP ${response.status}: ${text}`
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

    // Уже передали полноценную дату
    if (
        stringValue.includes("T")
    ) {

        return stringValue;
    }

    if (endOfDay) {

        return `${stringValue}T23:59:59.999`;
    }

    return `${stringValue}T00:00:00.000`;
}


// ============================================================
// CREDENTIALS
// ============================================================

function getCredentials(body) {

    const ip =
        String(body.ip || "").trim();

    const port =
        String(body.port || "").trim();

    const login =
        String(body.login || "").trim();

    const password =
        String(body.password || "");

    if (!ip) {
        throw new Error("Не указан IP iiko");
    }

    if (!port) {
        throw new Error("Не указан порт iiko");
    }

    if (!login) {
        throw new Error("Не указан логин iiko");
    }

    if (!password) {
        throw new Error("Не указан пароль iiko");
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
        "IIKO OLAP COLUMNS:",
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
                    "Accept": "application/json"
                }
            }
        );

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
            `iiko OLAP columns HTTP ${response.status}: ${text}`
        );
    }

    let columns;

    try {

        columns =
            JSON.parse(text);

    } catch {

        throw new Error(
            "iiko вернул некорректный JSON OLAP columns"
        );
    }

    const fields = [];

    // --------------------------------------------------------
    // Формат:
    //
    // {
    //   "OpenDate.Typed": {
    //      "name": "...",
    //      "type": "...",
    //      "aggregationAllowed": true,
    //      "groupingAllowed": true
    //   }
    // }
    // --------------------------------------------------------

    if (
        columns &&
        typeof columns === "object" &&
        !Array.isArray(columns)
    ) {

        for (
            const [
                fieldName,
                meta
            ] of Object.entries(columns)
        ) {

            const info =
                meta &&
                typeof meta === "object"
                    ? meta
                    : {};

            fields.push({
                name: fieldName,

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
                    Array.isArray(info.tags)
                        ? info.tags
                        : [],

                isMeasure:
                    info.aggregationAllowed === true
            });
        }
    }

    // --------------------------------------------------------
    // Если вдруг iiko вернул массив
    // --------------------------------------------------------

    else if (
        Array.isArray(columns)
    ) {

        columns.forEach(
            (item, index) => {

                if (
                    typeof item === "string"
                ) {

                    fields.push({
                        name: item,
                        title: item,
                        type: "",
                        aggregationAllowed: false,
                        groupingAllowed: true,
                        filteringAllowed: true,
                        tags: [],
                        isMeasure: false
                    });

                    return;
                }

                const name =
                    item.name ||
                    item.field ||
                    item.key ||
                    item.code ||
                    `field_${index}`;

                fields.push({
                    name,

                    title:
                        item.title ||
                        item.caption ||
                        item.name ||
                        name,

                    type:
                        item.type ||
                        "",

                    aggregationAllowed:
                        item.aggregationAllowed === true,

                    groupingAllowed:
                        item.groupingAllowed === true,

                    filteringAllowed:
                        item.filteringAllowed === true,

                    tags:
                        Array.isArray(item.tags)
                            ? item.tags
                            : [],

                    isMeasure:
                        item.aggregationAllowed === true
                });
            }
        );
    }

    console.log(
        "IIKO OLAP FIELDS:",
        fields.length
    );

    return {
        raw: columns,
        fields
    };
}


// ============================================================
// NORMALIZE ARRAY
// ============================================================

function normalizeFieldArray(value) {

    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map(
            item => {

                if (
                    typeof item === "string"
                ) {

                    return item.trim();
                }

                if (
                    item &&
                    typeof item === "object"
                ) {

                    return String(
                        item.field ||
                        item.name ||
                        item.key ||
                        ""
                    ).trim();
                }

                return "";
            }
        )
        .filter(Boolean);
}


// ============================================================
// MEASURES
// ============================================================

function getAggregateFields(body) {

    // Новый frontend
    if (
        Array.isArray(body.measures)
    ) {

        return body.measures
            .map(
                item => {

                    if (
                        typeof item === "string"
                    ) {

                        return item.trim();
                    }

                    if (
                        item &&
                        typeof item === "object"
                    ) {

                        return String(
                            item.field ||
                            item.name ||
                            ""
                        ).trim();
                    }

                    return "";
                }
            )
            .filter(Boolean);
    }

    // Старый frontend
    return normalizeFieldArray(
        body.aggregateFields
    );
}


// ============================================================
// FILTERS
// ============================================================

function buildFilters(body) {

    const filters = {};

    // --------------------------------------------------------
    // Existing frontend filters
    // --------------------------------------------------------

    if (
        body.filters &&
        typeof body.filters === "object" &&
        !Array.isArray(body.filters)
    ) {

        Object.assign(
            filters,
            body.filters
        );
    }

    // --------------------------------------------------------
    // Date filter
    // --------------------------------------------------------

    if (
        body.from ||
        body.to
    ) {

        const from =
            normalizeDate(
                body.from,
                false
            );

        const to =
            normalizeDate(
                body.to,
                true
            );

        filters["OpenDate.Typed"] = {
            filterType: "DateRange",
            periodType: "CUSTOM",
            from,
            to,
            includeLow: true,
            includeHigh: true
        };
    }

    return filters;
}


// ============================================================
// BUILD OLAP BODY
// ============================================================

function buildOlapRequest(body) {

    const reportType =
        String(
            body.reportType ||
            "SALES"
        )
            .trim()
            .toUpperCase();

    const rows =
        normalizeFieldArray(
            body.groupByRowFields ||
            body.rows
        );

    const columns =
        normalizeFieldArray(
            body.groupByColumnFields ||
            body.groupByColFields ||
            body.columns
        );

    const aggregateFields =
        getAggregateFields(body);

    if (
        rows.length === 0 &&
        columns.length === 0 &&
        aggregateFields.length === 0
    ) {

        throw new Error(
            "Выберите хотя бы одно поле для OLAP"
        );
    }

    // ========================================================
    // ВАЖНО
    //
    // iiko ожидает:
    //
    // reportType
    // buildSummary
    // groupByRowFields
    // groupByColFields
    // aggregateFields
    // filters
    //
    // ========================================================

    const requestBody = {
        reportType,

        buildSummary:
            body.buildSummary === true,

        groupByRowFields:
            rows,

        groupByColFields:
            columns,

        aggregateFields:
            aggregateFields,

        filters:
            buildFilters(body)
    };

    return requestBody;
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
        buildOlapRequest(body);

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
        "========================================"
    );

    console.log(
        "IIKO OLAP HTTP:",
        response.status
    );

    console.log(
        "IIKO OLAP RESPONSE:"
    );

    console.log(
        text.substring(0, 30000)
    );

    console.log(
        "========================================"
    );

    let report = null;

    try {

        report =
            JSON.parse(text);

    } catch {

        report = null;
    }

    // ========================================================
    // SUCCESS
    // ========================================================

    if (response.ok) {

        return {
            success: true,

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

    // ========================================================
    // ERROR
    // ========================================================

    return {
        success: false,

        iikoHttpStatus:
            response.status,

        endpoint:
            "/resto/api/v2/reports/olap",

        request:
            requestBody,

        // Очень важно:
        // теперь frontend увидит реальную
        // ошибку iiko
        iikoError:
            report ||
            text ||
            `HTTP ${response.status}`,

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

        console.log(
            "========================================"
        );

        console.log(
            "ANAR SYSTEM IIKO OLAP"
        );

        console.log(
            "ACTION:",
            body.action
        );

        console.log(
            "REPORT TYPE:",
            body.reportType
        );

        console.log(
            "========================================"
        );

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

                    action: "fields",

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
            "========================================"
        );

        console.error(
            "IIKO OLAP ERROR"
        );

        console.error(
            error
        );

        console.error(
            "========================================"
        );

        return jsonResponse(
            {
                success: false,

                message:
                    error.message ||
                    "Ошибка OLAP",

                error:
                    String(error)
            },
            502
        );
    }
}
