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
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...corsHeaders() }
    });
}

async function sha1(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-1", data);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function parseDate(value) {
    const s = String(value || "").trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? d : null;
}

function isoDate(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function extractList(payload) {
    if (Array.isArray(payload)) return payload;
    for (const key of ["items", "sessions", "cashShifts", "cashSessions", "data", "rows"]) {
        if (Array.isArray(payload?.[key])) return payload[key];
    }
    return [];
}

function sessionId(item) {
    return String(item?.id ?? item?.sessionId ?? item?.sessionID ?? item?.uuid ?? item?.UUID ?? "").trim();
}

function firstValue(item, keys) {
    for (const key of keys) {
        const value = item?.[key];
        if (value !== undefined && value !== null && value !== "") return value;
    }
    return "";
}

function shiftDateKey(item, fallback) {
    const raw = firstValue(item, ["businessDate", "operatingDay", "operationalDay", "date", "openDate", "openedAt", "openTime", "startDate", "startTime"]);
    const match = String(raw || "").match(/(\d{4})[-.](\d{2})[-.](\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : fallback;
}

function normalizeShift(item, requestedDate) {
    if (!item || typeof item !== "object") return null;
    return { ...item, _sessionId: sessionId(item), _dateKey: shiftDateKey(item, requestedDate) };
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
    const response = await fetch(url, { headers: { Accept: "application/json" }, cache: "no-store" });
    const text = (await response.text()).trim();
    let payload = null;
    try { payload = JSON.parse(text || "[]"); } catch {}
    return { response, text, payload };
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
        const from = parseDate(body.from);
        const to = parseDate(body.to);

        if (!ip || !port || !login || !password) return jsonResponse({ success: false, message: "Заполните IP, порт, логин и пароль SH Server" }, 400);
        if (!from || !to) return jsonResponse({ success: false, message: "Укажите корректный период дат" }, 400);
        if (to < from) return jsonResponse({ success: false, message: "Дата окончания не может быть раньше даты начала" }, 400);

        const days = Math.round((to - from) / 86400000) + 1;
        if (days > 62) return jsonResponse({ success: false, message: "Максимальный период для кассовых смен — 62 дня" }, 400);

        const { serverUrl, token } = await getToken(ip, port, login, password);
        const key = encodeURIComponent(token);
        const fromDate = encodeURIComponent(isoDate(from));
        const toDate = encodeURIComponent(isoDate(to));

        // ВАЖНО: один диапазон вместо запроса на каждый день и каждого статуса.
        // Это резко уменьшает число Cloudflare subrequests.
        const urls = [
            `${serverUrl}/resto/api/v2/cashshifts/list?key=${key}&openDateFrom=${fromDate}&openDateTo=${toDate}`,
            `${serverUrl}/resto/api/v2/cashshifts/list?key=${key}&dateFrom=${fromDate}&dateTo=${toDate}`,
            `${serverUrl}/resto/api/v2/cashshifts/list?key=${key}&from=${fromDate}&to=${toDate}`
        ];

        let successful = null;
        const errors = [];

        for (const url of urls) {
            const result = await requestJson(url);
            if (result.response.ok) {
                successful = result;
                break;
            }
            errors.push({ httpStatus: result.response.status, message: result.text.slice(0, 500) });
        }

        if (!successful) {
            return jsonResponse({
                success: false,
                message: "SH Server не принял запрос кассовых смен за диапазон дат",
                errors,
                triedEndpoints: urls.map(x => x.split("?")[0])
            }, 502);
        }

        const all = extractList(successful.payload)
            .map(item => normalizeShift(item, isoDate(from)))
            .filter(Boolean);

        const seen = new Set();
        const shifts = all.filter(shift => {
            const id = shift._sessionId || JSON.stringify(shift);
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });

        return jsonResponse({
            success: true,
            from: body.from,
            to: body.to,
            count: shifts.length,
            shifts,
            errors: [],
            endpoint: "/resto/api/v2/cashshifts/list",
            dateFormat: "YYYY-MM-DD",
            rangeQuery: true
        });
    } catch (error) {
        return jsonResponse({ success: false, message: error?.message || "Ошибка получения кассовых смен" }, 502);
    }
}
