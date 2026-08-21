function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type"
    };
}

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status: status,
        headers: {
            "Content-Type": "application/json",
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
// ПОЛУЧЕНИЕ TOKEN IIKO
// ==========================================

async function getToken(
    ip,
    port,
    login,
    password
) {
    const serverUrl = `http://${ip}:${port}`;

    const passwordHash = await sha1(password);

    const authUrl =
        `${serverUrl}/resto/api/auth` +
        `?login=${encodeURIComponent(login)}` +
        `&pass=${passwordHash}`;

    const response = await fetch(authUrl);

    const token = (await response.text()).trim();

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
// SALES REPORT
// ==========================================

export async function onRequestPost(context) {

    try {

        const body = await context.request.json();


        // ======================================
        // ДАННЫЕ ПОДКЛЮЧЕНИЯ
        // ======================================

        const ip =
            String(body.ip || "").trim();

        const port =
            String(body.port || "").trim();

        const login =
            String(body.login || "").trim();

        const password =
            String(body.password || "");


        // ======================================
        // ПЕРИОД
        // ======================================

        const from =
            String(body.from || "").trim();

        const to =
            String(body.to || "").trim();


        // ======================================
        // ПРОВЕРКИ
        // ======================================

        if (
            !ip ||
            !port ||
            !login ||
            !password
        ) {

            return jsonResponse({
                success: false,
                message:
                    "Заполните данные подключения"
            }, 400);
        }


        if (!from || !to) {

            return jsonResponse({
                success: false,
                message:
                    "Укажите период отчёта"
            }, 400);
        }


        if (from > to) {

            return jsonResponse({
                success: false,
                message:
                    "Дата начала больше даты окончания"
            }, 400);
        }


        // ======================================
        // ПОДКЛЮЧАЕМСЯ К IIKO
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
        // URL OLAP
        // ======================================

        const reportUrl =
            `${serverUrl}/resto/api/v2/reports/olap` +
            `?key=${encodeURIComponent(token)}`;


        // ======================================
        // СЛЕДУЮЩИЙ ДЕНЬ
        // ======================================

        const endDate = new Date(
            `${to}T00:00:00`
        );

        endDate.setDate(
            endDate.getDate() + 1
        );


        const endYear =
            endDate.getFullYear();

        const endMonth =
            String(
                endDate.getMonth() + 1
            ).padStart(2, "0");

        const endDay =
            String(
                endDate.getDate()
            ).padStart(2, "0");


        const endDateString =
            `${endYear}-${endMonth}-${endDay}`;


        // ======================================
        // OLAP QUERY
        // ======================================

        const reportBody = {

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

                    from: from,

                    to: endDateString
                }
            }
        };


        console.log(
            "IIKO OLAP REQUEST:",
            JSON.stringify(reportBody)
        );


        // ======================================
        // ЗАПРОС К IIKO
        // ======================================

        const reportResponse =
            await fetch(
                reportUrl,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json"
                    },

                    body:
                        JSON.stringify(
                            reportBody
                        )
                }
            );


        const text =
            await reportResponse.text();


        console.log(
            "IIKO OLAP RESPONSE:",
            text
        );


        // ======================================
        // ОШИБКА IIKO
        // ======================================

        if (!reportResponse.ok) {

            return jsonResponse({

                success: false,

                message:
                    `iiko Server вернул HTTP ${reportResponse.status}`,

                details:
                    text.substring(
                        0,
                        3000
                    )

            }, 502);
        }


        // ======================================
        // JSON
        // ======================================

        let data;

        try {

            data = JSON.parse(text);

        } catch {

            data = text;
        }


        // ======================================
        // ОТВЕТ
        // ======================================

        return jsonResponse({

            success: true,

            report: data

        });


    } catch (error) {

        console.error(
            "IIKO SALES ERROR:",
            error
        );


        return jsonResponse({

            success: false,

            message:
                error.message ||
                "Ошибка получения отчёта"

        }, 502);
    }
}
