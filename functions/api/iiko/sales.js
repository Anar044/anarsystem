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
            "Content-Type": "application/json",
            ...corsHeaders()
        }
    });
}

async function sha1(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-1", data);

    return Array.from(new Uint8Array(hash))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

async function getToken(ip, port, login, password) {

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
            `Ошибка авторизации: HTTP ${response.status}`
        );
    }

    return {
        serverUrl,
        token
    };
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: corsHeaders()
    });
}

export async function onRequestPost(context) {

    try {

        const body = await context.request.json();

        const ip = String(body.ip || "").trim();
        const port = String(body.port || "").trim();
        const login = String(body.login || "").trim();
        const password = String(body.password || "");

        const from = String(body.from || "").trim();
        const to = String(body.to || "").trim();

        if (!ip || !port || !login || !password) {
            return jsonResponse({
                success: false,
                message: "Заполните данные подключения"
            }, 400);
        }

        if (!from || !to) {
            return jsonResponse({
                success: false,
                message: "Укажите период отчёта"
            }, 400);
        }

        const { serverUrl, token } =
            await getToken(
                ip,
                port,
                login,
                password
            );

        const reportUrl =
            `${serverUrl}/resto/api/v2/reports/olap` +
            `?key=${encodeURIComponent(token)}`;

        const reportBody = {

            reportType: "SALES",

            buildSummary: true,

            groupByRowFields: [],

            aggregateFields: [
                "DishSumInt",
                "UniqOrderId"
            ],

            filters: {

                "OpenDate.Typed": {

                    filterType: "DateRange",

                    periodType: "CUSTOM",

                    from: `${from}T00:00:00.000`,

                    to: `${to}T23:59:59.999`
                }
            }
        };

        const reportResponse = await fetch(
            reportUrl,
            {
                method: "POST",

                headers: {
                    "Content-Type": "application/json"
                },

                body: JSON.stringify(reportBody)
            }
        );

        const text = await reportResponse.text();

        if (!reportResponse.ok) {

            return jsonResponse({
                success: false,
                message:
                    `iiko Server вернул HTTP ${reportResponse.status}`,
                details: text.substring(0, 1000)
            }, 502);
        }

        let data;

        try {
            data = JSON.parse(text);
        } catch {
            data = text;
        }

        return jsonResponse({
            success: true,
            report: data
        });

    } catch (error) {

        return jsonResponse({
            success: false,
            message: error.message
        }, 502);
    }
}
