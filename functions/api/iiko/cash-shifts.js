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
    const input = String(raw).trim();
    const iso = input.match(/(\d{4})[-.](\d{2})[-.](\d{2})/);
    // Older servers can return the Azerbaijan/Russian dd.MM.yyyy format.
    const local = input.match(/^(\d{2})\.(\d{2})\.(\d{4})(?:[ T]|$)/);
    const candidate = iso ? `${iso[1]}-${iso[2]}-${iso[3]}`
        : local ? `${local[3]}-${local[2]}-${local[1]}` : "";
    return candidate && parseDate(candidate) ? candidate : fallback;
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
function shiftDepartmentId(item) {
    for (const value of [
        item?.departmentId,item?.departmentID,item?.department?.id,item?.department?.uuid,item?.department?.guid,item?.departmentGuid,
        item?.organizationId,item?.organisationId,item?.restaurantId,item?.organization?.id,item?.organisation?.id,item?.restaurant?.id
    ]) {
        const id=String(value??"").trim();
        if(id)return id;
    }
    return "";
}

// iiko's standard CashShiftSessionDto does not necessarily contain
// departmentId, but /cashshifts/list supports an authoritative departmentId
// filter. Only label a missing department when it came from that scoped query;
// do not guess from the user's CHAIN selection on an unscoped response.
export function normalizeDepartmentCashShifts(payload, from, to, status, departmentId) {
    const list = extractList(payload);
    const validEnvelope = Array.isArray(payload) ||
        ["items", "sessions", "cashShifts", "cashSessions", "data", "rows"]
            .some(key => Array.isArray(payload?.[key]));
    if (!validEnvelope || payload?.success === false || payload?.result === "ERROR" ||
        payload?.error || payload?.errorCode) {
        throw new Error("SH Server не вернул список кассовых смен в ожидаемом формате.");
    }
    const fromDay = isoDate(from), toDay = isoDate(to);
    const result = [];
    for (const [index, row] of list.entries()) {
        const normalized = normalizeShift(row, "", status);
        if (!normalized) continue;
        const explicitDepartment = shiftDepartmentId(row);
        if (explicitDepartment && explicitDepartment !== departmentId) {
            throw new Error("SH Server вернул чужую кассовую смену несмотря на фильтр departmentId.");
        }
        // The filter is by physical OPEN DATE, but the business date can
        // belong to an earlier operating day when a shift crosses midnight.
        // Never use the requested date to invent an unverified open date.
        const businessDate = normalized._dateKey;
        const rawOpen = firstValue(row, [
            "openDate", "openedAt", "openTime", "startDate", "startTime"
        ]);
        const openedDate = rawOpen
            ? shiftDateKey({openDate: rawOpen}, "")
            : businessDate;
        const rowLabel = ` (запись ${index + 1}, статус ${status})`;
        if (!normalized._sessionId) {
            throw new Error("SH Server не передал ID кассовой смены" + rowLabel + ".");
        }
        if (!businessDate || !openedDate) {
            throw new Error("SH Server не передал распознаваемую дату кассовой смены" + rowLabel + ".");
        }
        if (openedDate < fromDay || openedDate > toDay) {
            // Some SH Server versions return CLOSED sessions outside the
            // requested open-date range. Do not let unrelated old closed
            // sessions block today's operational dashboard or enter OLAP.
            // OPEN sessions must never be discarded: an old active register
            // can still hold current sales. All foreign-department and
            // malformed-ID/date checks above remain fail-closed.
            if (status === "CLOSED") continue;
            throw new Error("Дата открытия кассовой смены вне запрошенного диапазона" + rowLabel + ".");
        }
        if (status === "OPEN" && (row.closeDate || row.closedAt || row.closeTime)) {
            throw new Error("SH Server вернул закрытую смену при фильтре OPEN.");
        }
        result.push({
            ...normalized,
            departmentId: explicitDepartment || departmentId,
            _scopedDepartmentId: departmentId,
            _departmentScopeSource: "cashshifts.departmentId"
        });
    }
    return result;
}

export async function getShiftsForDateAndStatus(connection, date, status, options = {}) {
    const departmentId = String(options?.departmentId || "").trim();
    if (departmentId) {
        // For operating-day calculations use one bounded date range per
        // restaurant and status instead of one unscoped request per day.
        const to = options.toDate instanceof Date ? options.toDate : date;
        const fromParam = encodeURIComponent(isoDate(date));
        const toParam = encodeURIComponent(isoDate(to));
        const departmentParam = encodeURIComponent(departmentId);
        const statusParam = encodeURIComponent(status);
        const scoped = await iikoJson(connection,
            `/resto/api/v2/cashshifts/list?openDateFrom=${fromParam}&openDateTo=${toParam}&status=${statusParam}&departmentId=${departmentParam}`);
        try {
            if (!scoped.ok) throw new Error("HTTP " + scoped.status);
            const shifts = normalizeDepartmentCashShifts(scoped.payload, date, to, status, departmentId);
            return {
                ok: true, status: scoped.status, shifts,
                format: "GET openDateFrom/openDateTo + status + departmentId",
                authCacheHit: scoped.auth?.cacheHit === true
            };
        } catch (e) {
            return {
                ok: false, status: scoped.status,
                text: String(e?.message || "Не подтверждён фильтр кассовых смен."),
                shifts: [], formatsTried: ["GET scoped cashshifts/list"],
                authCacheHit: scoped.auth?.cacheHit === true
            };
        }
    }

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

        const departmentIds=Array.isArray(body.departmentIds)?[...new Set(body.departmentIds.map(String).filter(Boolean))]:[];
        const allowedDepartmentIds=Array.isArray(body?.chainScope?.allowedDepartmentIds)?body.chainScope.allowedDepartmentIds.map(String).filter(Boolean):[];
        const subsetRequested=String(body?.chainScope?.mode||"").toUpperCase()==="CHAIN"&&departmentIds.length>0&&allowedDepartmentIds.length>departmentIds.length;

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
        let shifts = all.filter(shift => {
            const key = shift._sessionId || JSON.stringify(shift);
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });

        const detectedDepartmentIds=[...new Set(shifts.map(shiftDepartmentId).filter(Boolean))];
        let departmentScopeApplied=false;
        if(departmentIds.length&&detectedDepartmentIds.length){
            const wanted=new Set(departmentIds);
            shifts=shifts.filter(shift=>wanted.has(shiftDepartmentId(shift)));
            departmentScopeApplied=true;
        }else if(subsetRequested&&shifts.length){
            return jsonResponse({
                success:false,
                code:"CASH_SHIFT_SCOPE_UNAVAILABLE",
                message:"SH Server не вернул идентификатор подразделения в кассовых сменах. Нельзя безопасно показать только выбранный ресторан.",
                meta:{departmentIds,allowedDepartmentIds,detectedDepartmentIds}
            },409);
        }

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
                concurrency: 6,
                departmentIds,
                detectedDepartmentIds,
                departmentScopeApplied,
                subsetRequested
            }
        });
    } catch (error) {
        return jsonResponse({ success: false, message: error?.message || "Ошибка получения кассовых смен" }, 502);
    }
}
