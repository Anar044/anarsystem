function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...corsHeaders()
        }
    });
}


// ==========================================
// SHA-1
// ==========================================

async function sha1(text) {
    const data = new TextEncoder().encode(text);

    const hash = await crypto.subtle.digest(
        "SHA-1",
        data
    );

    return Array.from(new Uint8Array(hash))
        .map(byte =>
            byte.toString(16).padStart(2, "0")
        )
        .join("");
}


// ==========================================
// IIKO AUTH
// ==========================================

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
        (await response.text()).trim();

    if (!response.ok || !token) {
        throw new Error(
            `Ошибка авторизации iiko: HTTP ${response.status}`
        );
    }

    return {
        serverUrl,
        token
    };
}


// ==========================================
// OPTIONS
// ==========================================

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: corsHeaders()
    });
}


// ==========================================
// OLAP DIAGNOSTICS
// ==========================================

export async function onRequestPost(context) {

    try {

        const body =
            await context.request.json();


        // ======================================
        // CONNECTION DATA
        // ======================================

        const ip =
            String(body.ip || "").trim();

        const port =
            String(body.port || "").trim();

        const login =
            String(body.login || "").trim();

        const password =
            String(body.password || "");


        if (
            !ip ||
            !port ||
            !login ||
            !password
        ) {

            return jsonResponse({
                success: false,
                message:
                    "Заполните IP, порт, логин и пароль"
            }, 400);
        }


        // ======================================
        // LOGIN
        // ======================================

        const {
            serverUrl,
            token
        } = await getToken(
            ip,
            port,
            login,
            password
        );


        // ======================================
        // ПРОВЕРЯЕМ OLAP API
        // ======================================

        const url =
            `${serverUrl}/resto/api/v2/reports/olap` +
            `?key=${encodeURIComponent(token)}`;


        /*
         * Это диагностический запрос.
         *
         * Мы специально отправляем минимальный
         * OLAP-запрос, чтобы увидеть, какие данные
         * и структуру ответа возвращает именно
         * твой iiko Server.
         */

        const requestBody = {

            reportType: "SALES",

            buildSummary: true,

            groupByRowFields: [
                "OpenDate.Typed"
            ],

            aggregateFields: [
                "DishSumInt",
                "UniqOrderId"
            ],

            filters: {

                "OpenDate.Typed": {

                    filterType: "DateRange",

                    periodType: "CUSTOM",

                    from: "2026-01-01",

                    to: "2026-01-02"
                }
            }
        };


        console.log(
            "IIKO OLAP DIAGNOSTIC REQUEST:",
            JSON.stringify(requestBody)
        );


        // ======================================
        // REQUEST
        // ======================================

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


        console.log(
            "IIKO OLAP DIAGNOSTIC RESPONSE:",
            text
        );


        // ======================================
        // RESPONSE
        // ======================================

        let parsed = null;

        try {

            parsed =
                JSON.parse(text);

        } catch {

            parsed = null;
        }


        return jsonResponse({

            success:
                response.ok,

            iikoHttpStatus:
                response.status,

            endpoint:
                "/resto/api/v2/reports/olap",

            responseType:
                parsed
                    ? "JSON"
                    : "TEXT",

            report:
                parsed,

            rawResponse:
                text.substring(
                    0,
                    10000
                )

        }, response.ok ? 200 : 502);


    } catch (error) {

        console.error(
            "IIKO OLAP ERROR:",
            error
        );


        return jsonResponse({

            success: false,

            message:
                error.message ||
                "Ошибка запроса OLAP"

        }, 502);
    }
}
