function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };
}

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

async function sha1(text) {
    const data = new TextEncoder().encode(text);

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

        const reportType =
            String(
                body.reportType ||
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
                    message:
                        "Заполните IP, порт, логин и пароль"
                },
                400
            );
        }


        const allowedReports = [
            "SALES",
            "TRANSACTIONS",
            "DELIVERIES"
        ];

        if (
            !allowedReports.includes(
                reportType
            )
        ) {
            return jsonResponse(
                {
                    success: false,
                    message:
                        `Неподдерживаемый тип отчёта: ${reportType}`
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


        /*
         * iiko:
         *
         * GET
         * /resto/api/v2/reports/olap/columns
         *
         * Возвращает описание доступных
         * полей OLAP.
         */

        const url =
            `${serverUrl}/resto/api/v2/reports/olap/columns` +
            `?key=${encodeURIComponent(token)}` +
            `&reportType=${encodeURIComponent(reportType)}`;


        const response =
            await fetch(url);


        const text =
            await response.text();


        let columns = null;

        try {

            columns =
                JSON.parse(text);

        } catch {

            columns = null;

        }


        if (
            !response.ok
        ) {
            return jsonResponse(
                {
                    success: false,
                    iikoHttpStatus:
                        response.status,
                    message:
                        "iiko вернул ошибку при получении OLAP-полей",
                    rawResponse:
                        text.substring(
                            0,
                            20000
                        )
                },
                502
            );
        }


        return jsonResponse(
            {
                success: true,

                iikoHttpStatus:
                    response.status,

                endpoint:
                    "/resto/api/v2/reports/olap/columns",

                reportType,

                columns,

                rawResponse:
                    text.substring(
                        0,
                        20000
                    )
            }
        );

    } catch (error) {

        console.error(
            "IIKO OLAP FIELDS ERROR:",
            error
        );

        return jsonResponse(
            {
                success: false,

                message:
                    error.message ||
                    "Ошибка получения OLAP-полей"
            },
            502
        );
    }
}
