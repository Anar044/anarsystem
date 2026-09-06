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
        headers: { "Content-Type": "application/json", ...corsHeaders() }
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
    if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
    return d;
}

function formatIikoDate(date) {
    return `${String(date.getUTCDate()).padStart(2, "0")}.${String(date.getUTCMonth() + 1).padStart(2, "0")}.${date.getUTCFullYear()}`;
}

function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
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

function normalizeShift(item, requestedDate) {
    if (!item || typeof item !== "object") return null;
    return {
        ...item,
        _sessionId: sessionId(item),
        _requestedDate: requestedDate
    };
}

async function getToken(ip, port, login, password) {
    const serverUrl = `http://${ip}:${port}`;
    const passwordHash = await sha1(password);
    const authUrl = `${serverUrl}/resto/api/auth?login=${encodeURIComponent(login)}&pass=${passwordHash}`;
    const response = await fetch(authUrl);
    const token = (await response.text()).trim();
    if (!response.ok || !token) throw new Error(`Ошибка авторизации iiko Server: HTTP ${response.status}`);
    return { serverUrl, token };
}

async function getShiftsForDate(serverUrl, token, date) {
    const url = `${serverUrl}/resto/api/v2/cashshifts/list?key=${encodeURIComponent(token)}&date=${encodeURIComponent(formatIikoDate(date))}`;
    const response = await fetch(url, { headers: { "Accept": "application/json" } });
    const text = (await response.text()).trim();

    if (!response.ok) {
        return { ok: false, status: response.status, text, shifts: [] };
    }

    let payload;
    try { payload = JSON.parse(text || "[]"); }
    catch { return { ok: false, status: 502, text: "iiko вернул некорректный JSON", shifts: [] }; }

    return { ok: true, status: response.status, text, shifts: extractList(payload).map(x => normalizeShift(x, formatIikoDate(date))).filter(Boolean) };
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

        if (!ip || !port || !login || !password) {
            return jsonResponse({ success: false, message: "Заполните IP, порт, логин и пароль iiko Server" }, 400);
        }
        if (!from || !to) return jsonResponse({ success: false, message: "Укажите корректный период дат" }, 400);
        if (to < from) return jsonResponse({ success: false, message: "Дата окончания не может быть раньше даты начала" }, 400);

        const days = Math.round((to - from) / 86400000) + 1;
        if (days > 62) return jsonResponse({ success: false, message: "Максимальный период для кассовых смен — 62 дня" }, 400);

        const { serverUrl, token } = await getToken(ip, port, login, password);
        const all = [];
        const errors = [];

        for (let i = 0; i < days; i++) {
            const date = addDays(from, i);
            const result = await getShiftsForDate(serverUrl, token, date);
            if (result.ok) all.push(...result.shifts);
            else errors.push({ date: formatIikoDate(date), status: result.status, message: result.text.slice(0, 500) });
        }

        const seen = new Set();
        const shifts = all.filter(shift => {
            const id = shift._sessionId;
            const key = id || JSON.stringify(shift);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        return jsonResponse({
            success: true,
            from: body.from,
            to: body.to,
            count: shifts.length,
            shifts,
            errors,
            endpoint: "/resto/api/v2/cashshifts/list"
        });
    } catch (error) {
        return jsonResponse({ success: false, message: error?.message || "Ошибка получения кассовых смен" }, 502);
    }
}
