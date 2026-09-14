import { iikoJson } from "./_lib/iiko-client.js";

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

function parseDate(value) {
    const s = String(value || "").trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
    return d;
}

function isoDate(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
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

function firstValue(item, keys) {
    for (const key of keys) {
        const value = item?.[key];
        if (value !== undefined && value !== null && value !== "") return value;
    }
    return "";
}

function shiftDateKey(item, fallback) {
    const raw = firstValue(item, [
        "businessDate", "operatingDay", "operationalDay", "date",
        "openDate", "openedAt", "openTime", "startDate", "startTime"
    ]);
    if (!raw) return fallback;
    const match = String(raw).match(/(\d{4})[-.](\d{2})[-.](\d{2})/);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : fallback;
}

function normalizeShift(item, requestedDate, requestedStatus) {
    if (!item || typeof item !== "object") return null;
    return {
        ...item,
        _sessionId: sessionId(item),
        _dateKey: shiftDateKey(item, requestedDate),
        _requestedStatus: requestedStatus
    };
}

async function getShiftsForDateAndStatus(connection, date, status) {
    const requestedDate = isoDate(date);
    const dateParam = encodeURIComponent(requestedDate);
    const statusParam = encodeURIComponent(status);

    const primary = await iikoJson(
        connection,
        `/resto/api/v2/cashshifts/list?date=${dateParam}&status=${statusParam}`
    );

    if (primary.ok) {
        return {
            ok: true,
            status: primary.status,
            shifts: extractList(primary.payload).map(item => normalizeShift(item, requestedDate, status)).filter(Boolean),
            format: `GET date + status=${status}`,
            authCacheHit: primary.auth?.cacheHit === true
        };
    }

    const fallback = await iikoJson(
        connection,
        `/resto/api/v2/cashshifts/list?openDateFrom=${dateParam}&openDateTo=${dateParam}&status=${statusParam}`
    );

    if (fallback.ok) {
        return {
            ok: true,
            status: fallback.status,
            shifts: extractList(fallback.payload).map(item => normalizeShift(item, requestedDate, status)).filter(Boolean),
            format: `GET openDateFrom/openDateTo + status=${status}`,
            authCacheHit: fallback.auth?.cacheHit === true
        };
    }

    return {
        ok: false,
        status: primary.status,
        text: primary.text || "iiko Server не вернул текст ошибки",
        fallbackStatus: fallback.status,
        fallbackText: fallback.text,
        shifts: [],
        formatsTried: [
            `GET date + status=${status}`,
            `GET openDateFrom/openDateTo + status=${status}`
        ],
        authCacheHit: primary.auth?.cacheHit === true || fallback.auth?.cacheHit === true
    };
}

async function mapLimit(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const run = async () => {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
    return results;
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const connection = {
            ip: String(body.ip || "").trim(),
            port: String(body.port || "").trim(),
            login: String(body.login || "").trim(),
            password: String(body.password || "")
        };
        const from = parseDate(body.from);
        const to = parseDate(body.to);

        if (!connection.ip || !connection.port || !connection.login || !connection.password) {
            return jsonResponse({ success: false, message: "Заполните IP, порт, логин и пароль SH Server" }, 400);
        }
        if (!from || !to) return jsonResponse({ success: false, message: "Укажите корректный период дат" }, 400);
        if (to < from) return jsonResponse({ success: false, message: "Дата окончания не может быть раньше даты начала" }, 400);

        const days = Math.round((to - from) / 86400000) + 1;
        if (days > 62) return jsonResponse({ success: false, message: "Максимальный период для кассовых смен — 62 дня" }, 400);

        const tasks = [];
        for (let i = 0; i < days; i++) {
            const date = addDays(from, i);
            for (const status of ["OPEN", "CLOSED"]) tasks.push({ date, status });
        }

        const results = await mapLimit(tasks, 6, task => getShiftsForDateAndStatus(connection, task.date, task.status));
        const all = [];
        const errors = [];
        const formatsTried = new Set();
        let authCacheHit = false;

        results.forEach((result, index) => {
            const task = tasks[index];
            authCacheHit = authCacheHit || result.authCacheHit === true;
            if (result.ok) {
                all.push(...result.shifts);
                formatsTried.add(result.format);
            } else {
                for (const fmt of result.formatsTried || []) formatsTried.add(fmt);
                errors.push({
                    date: isoDate(task.date),
                    status: task.status,
                    httpStatus: result.status,
                    message: result.text.slice(0, 500),
                    fallbackStatus: result.fallbackStatus,
                    fallbackText: result.fallbackText ? result.fallbackText.slice(0, 500) : ""
                });
            }
        });

        const seen = new Set();
        const shifts = all.filter(shift => {
            const key = shift._sessionId || JSON.stringify(shift);
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
            dateFormatsTried: Array.from(formatsTried),
            statusesTried: ["OPEN", "CLOSED"],
            endpoint: "/resto/api/v2/cashshifts/list",
            dateFormat: "YYYY-MM-DD",
            meta: {
                sharedIikoClient: true,
                authCacheHit,
                concurrency: 6
            }
        });
    } catch (error) {
        return jsonResponse({ success: false, message: error?.message || "Ошибка получения кассовых смен" }, 502);
    }
}
