// ============================================================
// ANAR SYSTEM — IIKO OLAP API
// functions/api/iiko/olap.js
// DIAGNOSTIC VERSION
// ============================================================

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };
}

function jsonResponse(data, status = 200) {
    return new Response(
        JSON.stringify(data, null, 2),
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
            b =>
                b
                    .toString(16)
                    .padStart(2, "0")
        )
        .join("");
}


// ============================================================
// AUTH
// ============================================================

async function getToken(
    ip,
    port,
    login,
    password
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
        "IIKO AUTH:",
        `${serverUrl}/resto/api/auth`
    );

    const response =
        await fetch(url);

    const text =
        await response.text();

    console.log(
        "IIKO AUTH HTTP:",
        response.status
    );

    console.log(
        "IIKO AUTH RESPONSE:",
        text.substring(0, 5000)
    );

    if (!response.ok) {

        throw new Error(
            `AUTH HTTP ${response.status}: ${text}`
        );
    }

    const token =
        String(text || "").trim();

    if (!token) {

        throw new Error(
            "iiko не вернул token"
        );
    }

    return {
        serverUrl,
        token
    };
}


// ============================================================
// FIELDS
// ============================================================

async function getFields(
    serverUrl,
    token,
    reportType
) {

    const url =
        `${serverUrl}/resto/api/v2/reports/olap/columns` +
        `?key=${encodeURIComponent(token)}` +
        `&reportType=${encodeURIComponent(reportType)}`;

    console.log(
        "IIKO COLUMNS URL:",
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
        "IIKO COLUMNS HTTP:",
        response.status
    );

    console.log(
        "IIKO COLUMNS RESPONSE:",
        text.substring(0, 10000)
    );

    if (!response.ok) {

        return {
            success: false,
            status: response.status,
            raw: text
        };
    }

    let data;

    try {
        data = JSON.parse(text);
    } catch {
        data = text;
    }

    return {
        success: true,
        status: response.status,
        data
    };
}


// ============================================================
// GET ARRAY
// ============================================================

function arr(value) {

    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map(x => {

            if (
                typeof x === "string"
            ) {
                return x.trim();
            }

            if (
                x &&
                typeof x === "object"
            ) {
                return String(
                    x.field ||
                    x.name ||
                    x.key ||
                    ""
                ).trim();
            }

            return "";
        })
        .filter(Boolean);
}


// ============================================================
// BUILD REQUEST
// ============================================================

function buildRequest(body) {

    const reportType =
        String(
            body.reportType ||
            "SALES"
        )
            .trim()
            .toUpperCase();


    const rows =
        arr(
            body.groupByRowFields ||
            body.rows
        );


    const cols =
        arr(
            body.groupByColumnFields ||
            body.groupByColFields ||
            body.columns
        );


    let measures = [];


    if (
        Array.isArray(body.measures)
    ) {

        measures =
            body.measures
                .map(x => {

                    if (
                        typeof x === "string"
                    ) {
                        return x.trim();
                    }

                    if (
                        x &&
                        typeof x === "object"
                    ) {
                        return String(
                            x.field ||
                            x.name ||
                            ""
                        ).trim();
                    }

                    return "";
                })
                .filter(Boolean);

    } else {

        measures =
            arr(
                body.aggregateFields
            );
    }


    // ========================================================
    // FILTERS
    // ========================================================

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


    // ========================================================
    // DATE
    // ========================================================

    if (
        body.from ||
        body.to
    ) {

        const from =
            body.from
                ? `${body.from}T00:00:00.000`
                : "";

        const to =
            body.to
                ? `${body.to}T23:59:59.999`
                : "";

        filters["OpenDate.Typed"] = {
            filterType: "DateRange",
            periodType: "CUSTOM",
            from,
            to,
            includeLow: true,
            includeHigh: true
        };
    }


    // ========================================================
    // EXACT BODY
    // ========================================================

    return {

        reportType,

        buildSummary:
            body.buildSummary !== false,

        groupByRowFields:
            rows,

        groupByColFields:
            cols,

        aggregateFields:
            measures,

        filters
    };
}


// ============================================================
// OLAP QUERY
// ============================================================

async function query(
    serverUrl,
    token,
    body
) {

    const requestBody =
        buildRequest(body);


    console.log(
        "============================================"
    );

    console.log(
        "IIKO OLAP REQUEST BODY"
    );

    console.log(
        JSON.stringify(
            requestBody,
            null,
            2
        )
    );

    console.log(
        "============================================"
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

        console.error(
            "FETCH ERROR:",
            error
        );

        return {
            success: false,

            type:
                "FETCH_ERROR",

            message:
                error.message,

            error:
                String(error)
        };
    }


    const text =
        await response.text();


    console.log(
        "============================================"
    );

    console.log(
        "IIKO OLAP RESPONSE"
    );

    console.log(
        "HTTP:",
        response.status
    );

    console.log(
        text.substring(
            0,
            30000
        )
    );

    console.log(
        "============================================"
    );


    let parsed = null;

    try {

        parsed =
            JSON.parse(text);

    } catch {

        parsed = null;
    }


    // ========================================================
    // IMPORTANT:
    // НЕ превращаем ошибку в исключение.
    // Возвращаем реальный ответ iiko.
    // ========================================================

    return {

        success:
            response.ok,

        type:
            response.ok
                ? "SUCCESS"
                : "IIKO_ERROR",

        iikoHttpStatus:
            response.status,

        iikoStatusText:
            response.statusText,

        request:
            requestBody,

        response:
            parsed,

        rawResponse:
            text.substring(
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
            headers: corsHeaders()
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
                    type: "INVALID_JSON",
                    message:
                        "Request body не является JSON"
                },
                400
            );
        }


        // ====================================================
        // CREDENTIALS
        // ====================================================

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
                    type: "CREDENTIALS",
                    message:
                        "Необходимо указать IP, порт, логин и пароль"
                },
                400
            );
        }


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

        let auth;

        try {

            auth =
                await getToken(
                    ip,
                    port,
                    login,
                    password
                );

        } catch (error) {

            return jsonResponse(
                {
                    success: false,

                    type:
                        "AUTH_ERROR",

                    message:
                        error.message,

                    error:
                        String(error)
                },
                502
            );
        }


        const {
            serverUrl,
            token
        } = auth;


        // ====================================================
        // FIELDS
        // ====================================================

        if (
            action === "fields"
        ) {

            const result =
                await getFields(
                    serverUrl,
                    token,
                    reportType
                );


            return jsonResponse(
                {
                    success:
                        result.success,

                    action:
                        "fields",

                    reportType,

                    count:
                        result.data &&
                        typeof result.data === "object"
                            ? Object.keys(
                                result.data
                            ).length
                            : 0,

                    fields:
                        result.data,

                    raw:
                        result.raw ||
                        null,

                    iikoHttpStatus:
                        result.status
                },

                result.success
                    ? 200
                    : 502
            );
        }


        // ====================================================
        // QUERY
        // ====================================================

        if (
            action === "query"
        ) {

            const result =
                await query(
                    serverUrl,
                    token,
                    body
                );


            // ==================================================
            // КРИТИЧЕСКИ ВАЖНО:
            //
            // HTTP 400 iiko возвращаем как 200 нашей функции,
            // чтобы frontend получил JSON с реальной ошибкой.
            // ==================================================

            return jsonResponse(
                result,
                200
            );
        }


        // ====================================================
        // UNKNOWN
        // ====================================================

        return jsonResponse(
            {
                success: false,

                type:
                    "UNKNOWN_ACTION",

                message:
                    `Неизвестное действие: ${action}`,

                availableActions: [
                    "fields",
                    "query"
                ]
            },
            400
        );

    } catch (error) {

        console.error(
            "============================================"
        );

        console.error(
            "UNEXPECTED OLAP ERROR"
        );

        console.error(
            error
        );

        console.error(
            "============================================"
        );


        return jsonResponse(
            {
                success: false,

                type:
                    "FUNCTION_ERROR",

                message:
                    error.message ||
                    "Ошибка OLAP Function",

                error:
                    String(error),

                stack:
                    error.stack ||
                    null
            },
            500
        );
    }
}
