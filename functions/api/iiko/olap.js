function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };
}

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

async function sha1(text) {

    const data =
        new TextEncoder()
            .encode(text);

    const hash =
        await crypto.subtle
            .digest(
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

    const token =
        (
            await response.text()
        ).trim();

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

export async function onRequestOptions() {

    return new Response(
        null,
        {
            status: 204,
            headers: corsHeaders()
        }
    );
}


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
                        "Заполните IP, порт, логин и пароль"
                },
                400
            );
        }


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
                : [];


        const groupByColumnFields =
            Array.isArray(
                body.groupByColumnFields
            )
                ? body.groupByColumnFields
                    .filter(Boolean)
                : [];


        const aggregateFields =
            Array.isArray(
                body.aggregateFields
            )
                ? body.aggregateFields
                    .filter(Boolean)
                : [];


        if (
            groupByRowFields.length === 0 &&
            groupByColumnFields.length === 0 &&
            aggregateFields.length === 0
        ) {

            return jsonResponse(
                {
                    success: false,
                    message:
                        "Выберите хотя бы одно поле"
                },
                400
            );
        }


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


        const filters = {
            ...(body.filters &&
            typeof body.filters === "object"
                ? body.filters
                : {})
        };


        /*
         * Если выбраны даты,
         * автоматически создаём фильтр
         * по OpenDate.Typed.
         */

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


        return jsonResponse(
            {

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

            },
            response.ok
                ? 200
                : 502
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
