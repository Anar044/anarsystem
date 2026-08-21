const ALLOWED_ORIGIN = "*";

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
    };
}

function response(body, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            ...corsHeaders(),
        },
    });
}

async function sha1(text) {
    const data = new TextEncoder().encode(text);

    const hash = await crypto.subtle.digest("SHA-1", data);

    return [...new Uint8Array(hash)]
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: corsHeaders(),
    });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();

        const ip = String(body.ip || "").trim();
        const port = String(body.port || "").trim();
        const login = String(body.login || "").trim();
        const password = String(body.password || "");

        if (!ip || !port || !login || !password) {
            return response({
                success: false,
                message: "Заполните все поля"
            }, 400);
        }

        const serverUrl = `https://${ip}:${port}`;

        const passwordHash = await sha1(password);

        const authUrl =
            `${serverUrl}/resto/api/auth` +
            `?login=${encodeURIComponent(login)}` +
            `&pass=${passwordHash}`;

        const iikoResponse = await fetch(authUrl, {
            method: "GET",
        });

        const text = await iikoResponse.text();

        if (!iikoResponse.ok) {
            return response({
                success: false,
                message: `iiko Server вернул HTTP ${iikoResponse.status}`,
                details: text.substring(0, 500)
            }, 502);
        }

        const token = text.trim();

        if (!token) {
            return response({
                success: false,
                message: "iiko Server не вернул токен"
            }, 502);
        }

        return response({
            success: true,
            message: "Подключение успешно",
            token: token
        });

    } catch (error) {
        return response({
            success: false,
            message: "Не удалось подключиться к iiko Server",
            details: error.message
        }, 502);
    }
}
