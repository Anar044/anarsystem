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
            "Cache-Control": "no-store",
            ...corsHeaders()
        }
    });
}

async function sha1(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-1", data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function getToken(ip, port, login, password) {
    const serverUrl = `http://${ip}:${port}`;
    const passwordHash = await sha1(password);
    const authUrl = `${serverUrl}/resto/api/auth?login=${encodeURIComponent(login)}&pass=${passwordHash}`;
    const response = await fetch(authUrl, { cache: "no-store" });
    const token = (await response.text()).trim();
    if (!response.ok || !token) throw new Error(`Ошибка авторизации iiko Server: HTTP ${response.status}`);
    return { serverUrl, token };
}

async function requestJson(url) {
    const response = await fetch(url, {
        method: "GET",
        headers: { "Accept": "application/json" },
        cache: "no-store"
    });
    const text = (await response.text()).trim();
    let payload = null;
    try { payload = JSON.parse(text || "[]"); } catch {}
    return { response, text, payload };
}

function extractList(payload) {
    if (Array.isArray(payload)) return payload;
    for (const key of ["items", "payments", "data", "rows", "sessions", "cashShifts"]) {
        if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const ip = String(body.ip || "").trim();
        const port = String(body.port || "").trim();
        const login = String(body.login || "").trim();
        const password = String(body.password || "");
        const sessionId = String(body.sessionId || body.sessionID || body.id || "").trim();

        if (!ip || !port || !login || !password) {
            return jsonResponse({ success: false, message: "Заполните IP, порт, логин и пароль SH Server" }, 400);
        }
        if (!sessionId) return jsonResponse({ success: false, message: "Не указан ID кассовой смены" }, 400);

        const { serverUrl, token } = await getToken(ip, port, login, password);
        const key = encodeURIComponent(token);
        const sid = encodeURIComponent(sessionId);

        const shiftResult = await requestJson(`${serverUrl}/resto/api/v2/cashshifts/byId/${sid}?key=${key}`);
        if (!shiftResult.response.ok) {
            return jsonResponse({
                success: false,
                message: `Не удалось получить смену: HTTP ${shiftResult.response.status}`,
                details: shiftResult.text.slice(0, 1000)
            }, 502);
        }

        const paymentsResult = await requestJson(`${serverUrl}/resto/api/v2/cashshifts/payments/list/${sid}?key=${key}`);
        const payments = paymentsResult.response.ok ? extractList(paymentsResult.payload) : [];

        return jsonResponse({
            success: true,
            sessionId,
            shift: shiftResult.payload,
            payments,
            paymentsLoaded: paymentsResult.response.ok,
            paymentsStatus: paymentsResult.response.status
        });
    } catch (error) {
        return jsonResponse({ success: false, message: error?.message || "Ошибка получения деталей кассовой смены" }, 502);
    }
}
