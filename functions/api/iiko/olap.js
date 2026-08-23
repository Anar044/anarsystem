// ============================================================
// ANAR SYSTEM — IIKO OLAP API
// functions/api/iiko/olap.js
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
    password
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

    const authUrl =
        `${serverUrl}/resto/api/auth` +
        `?login=${encodeURIComponent(
            login
        )}` +
        `&pass=${passwordHash}`;

    const response =
        await fetch(
            authUrl,
            {
                method: "GET"
            }
        );

    const text =
        (
            await response.text()
        ).trim();

    if (
        !response.ok ||
        !text
    ) {

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
        typeof raw === "object"
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
// Example:
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

    try {

        const url =
            new URL(
                context.request.url
            );

        const mode =
            url.searchParams.get(
                "mode"
            ) || "fields";

        if (
            mode !== "fields"
        ) {

            return jsonResponse(
                {
                    success: false,

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

            return jsonResponse(
                {
                    success: false,

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

                reportType
            }
        );

    } catch (error) {

        console.error(
            "IIKO OLAP GET ERROR:",
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
    reportType = "SALES"
}) {

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

    const url =
        `${serverUrl}` +
        `/resto/api/v2/reports/olap/columns` +
        `?key=${encodeURIComponent(
            token
        )}` +
        `&reportType=${encodeURIComponent(
            reportType
        )}`;

    console.log(
        "IIKO OLAP COLUMNS:",
        url.replace(
            token,
            "***"
        )
    );

    const response =
        await fetch(
            url,
            {
                method: "GET"
            }
        );

    const text =
        await response.text();

    let raw = null;

    try {

        raw =
            JSON.parse(text);

    } catch (error) {

        raw = null;
    }

    if (!response.ok) {

        return jsonResponse(
            {
                success: false,

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

    return jsonResponse(
        {
            success: true,

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

    try {

        const body =
            await context.request.json();

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

                    message:
                        "Заполните IP, порт, логин и пароль iiko"
                },
                400
            );
        }


        // ========================================================
        // ACTION: FIELDS
        //
        // Именно это теперь вызывает reports.js.
        //
        // POST /api/iiko/olap
        // {
        //     action: "fields",
        //     ...
        // }
        // ========================================================

        if (
            body.action ===
            "fields"
        ) {

            return await getFields(
                {
                    ip,

                    port,

                    login,

                    password,

                    reportType:
                        body.reportType ||
                        "SALES"
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
                    .map(function (item) {

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
                    })
                    .filter(Boolean);

        } else if (
            Array.isArray(
                body.measures
            )
        ) {

            aggregateFields =
                body.measures
                    .map(function (item) {

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
                    })
                    .filter(Boolean);
        }


        // ========================================================
        // VALIDATION
        // ========================================================

        if (
            !groupByRowFields.length &&
            !groupByColFields.length &&
            !aggregateFields.length
        ) {

            return jsonResponse(
                {
                    success: false,

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
                password
            );


        // ========================================================
        // FILTERS
        // ========================================================

        let filters = {};


        // Если frontend уже прислал
        // готовый объект фильтров.

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
        // IIKO OLAP REQUEST
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


        console.log(
            "IIKO OLAP REQUEST:",
            JSON.stringify(
                requestBody,
                null,
                2
            )
        );


        // ========================================================
        // IIKO OLAP ENDPOINT
        // ========================================================

        const url =
            `${serverUrl}` +
            `/resto/api/v2/reports/olap` +
            `?key=${encodeURIComponent(
                token
            )}`;


        const response =
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


        const text =
            await response.text();


        let report = null;

        try {

            report =
                JSON.parse(text);

        } catch (error) {

            report = null;
        }


        // ========================================================
        // IIKO ERROR
        // ========================================================

        if (!response.ok) {

            console.error(
                "IIKO OLAP HTTP ERROR:",
                response.status,
                text
            );

            return jsonResponse(
                {
                    success: false,

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
        }


        // ========================================================
        // SUCCESS
        // ========================================================

        return jsonResponse(
            {
                success: true,

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
