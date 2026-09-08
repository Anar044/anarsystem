// ============================================================
// ANAR SYSTEM — IIKO ABC REPORT
// Dedicated lightweight endpoint for ABC analysis.
// It does NOT change /api/iiko/olap.
// ============================================================

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

async function sha1(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-1", data);
    return Array.from(new Uint8Array(hash))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");
}

function clean(value) {
    return String(value ?? "").trim();
}

function number(value) {
    if (typeof value === "number") return Number.isFinite(value) ? value : 0;
    const s = String(value ?? "")
        .replace(/\s/g, "")
        .replace(/,/g, ".");
    const n = Number(s);
    return Number.isFinite(n) ? n : 0;
}

function endDate(from, to) {
    const d = new Date(`${to}T00:00:00`);
    d.setDate(d.getDate() + 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        return await fetch(url, {
            ...options,
            signal: controller.signal
        });
    } catch (error) {
        if (error?.name === "AbortError") {
            throw new Error("iiko не ответил за 20 секунд");
        }
        throw error;
    } finally {
        clearTimeout(timer);
    }
}

async function fetchTextWithTimeout(url, options = {}, timeoutMs = 20000) {
    const response = await fetchWithTimeout(url, options, timeoutMs);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        // The initial fetch can finish while the response body is still being read.
        // Keep a separate timeout for the body as well.
        const text = await Promise.race([
            response.text(),
            new Promise((_, reject) => {
                const t = setTimeout(() => reject(new Error("iiko не завершил ответ за 20 секунд")), timeoutMs);
                controller.signal.addEventListener("abort", () => {
                    clearTimeout(t);
                    reject(new Error("iiko не завершил ответ за 20 секунд"));
                }, { once: true });
            })
        ]);
        return { response, text };
    } finally {
        clearTimeout(timer);
        controller.abort();
    }
}

function rowObject(row, columns) {
    if (!Array.isArray(row)) return row && typeof row === "object" ? row : {};
    const out = {};
    row.forEach((value, index) => {
        const col = columns?.[index];
        const name = typeof col === "string"
            ? col
            : col?.name || col?.field || col?.key || `col${index}`;
        out[name] = value;
    });
    return out;
}

function extractRows(payload) {
    const candidates = [];

    function walk(value, columns = [], depth = 0) {
        if (!value || depth > 6) return;

        if (Array.isArray(value)) {
            if (value.length && (Array.isArray(value[0]) || typeof value[0] === "object")) {
                for (const item of value) candidates.push(rowObject(item, columns));
            }
            return;
        }

        if (typeof value !== "object") return;

        const cols = value.columns || value.columnNames || value.headers || columns;

        for (const key of ["data", "rows", "items", "result"]) {
            if (Array.isArray(value[key])) {
                for (const item of value[key]) candidates.push(rowObject(item, cols));
            } else if (value[key] && typeof value[key] === "object") {
                walk(value[key], cols, depth + 1);
            }
        }
    }

    walk(payload);
    return candidates;
}

function pick(row, names) {
    for (const name of names) {
        if (row?.[name] !== undefined && row?.[name] !== null) return row[name];
        const hit = Object.keys(row || {}).find(k => k.toLowerCase() === name.toLowerCase());
        if (hit) return row[hit];
    }
    return "";
}

function normalizeRows(payload) {
    const rows = extractRows(payload);
    return rows
        .map(row => ({
            name: clean(pick(row, ["DishName", "Product.Name", "Name"])) || "Без названия",
            revenue: number(pick(row, ["DishSumInt", "Sales"])),
            quantity: number(pick(row, ["DishAmountInt", "Quantity"])),
            profit: number(pick(row, ["ProductCostBase.Profit", "Profit"]))
        }))
        .filter(row => row.name && (row.revenue !== 0 || row.quantity !== 0 || row.profit !== 0));
}

function mergeRows(rows) {
    const map = new Map();
    for (const row of rows) {
        const key = row.name;
        if (!map.has(key)) {
            map.set(key, { ...row });
            continue;
        }
        const old = map.get(key);
        old.revenue += row.revenue;
        old.quantity += row.quantity;
        old.profit += row.profit;
    }
    return [...map.values()];
}

function classify(rows, metric, aLimit, bLimit) {
    const total = rows.reduce((sum, row) => sum + Math.max(0, number(row[metric])), 0);
    let cumulative = 0;

    const sorted = [...rows].sort((a, b) => number(b[metric]) - number(a[metric]));

    for (const row of sorted) {
        cumulative += Math.max(0, number(row[metric]));
        const share = total > 0 ? cumulative / total * 100 : 100;
        row[`abc_${metric}`] = share <= aLimit ? "A" : share <= bLimit ? "B" : "C";
        row[`share_${metric}`] = total > 0 ? Math.max(0, number(row[metric])) / total * 100 : 0;
        row[`cumulative_${metric}`] = share;
    }

    return total;
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
    const rid = crypto.randomUUID?.() || Date.now().toString(36);

    try {
        const body = await context.request.json();

        const ip = clean(body.ip);
        const port = clean(body.port);
        const login = clean(body.login);
        const password = String(body.password ?? "");
        const from = clean(body.from);
        const to = clean(body.to);
        const aLimit = number(body.abcA || 80);
        const bLimit = number(body.abcB || 95);

        if (!ip || !port || !login || !password) {
            return jsonResponse({ success: false, message: "Заполните данные подключения iiko" }, 400);
        }
        if (!from || !to) {
            return jsonResponse({ success: false, message: "Укажите период отчёта" }, 400);
        }
        if (from > to) {
            return jsonResponse({ success: false, message: "Дата начала больше даты окончания" }, 400);
        }
        if (!(aLimit > 0 && aLimit < bLimit && bLimit <= 100)) {
            return jsonResponse({ success: false, message: "Пороги ABC должны быть: A < B <= 100" }, 400);
        }

        const serverUrl = `http://${ip}:${port}`;
        const pass = await sha1(password);
        const authUrl = `${serverUrl}/resto/api/auth?login=${encodeURIComponent(login)}&pass=${pass}`;

        console.log(`[ABC][${rid}] AUTH ${serverUrl}`);
        const auth = await fetchTextWithTimeout(authUrl, { method: "GET" });
        const token = auth.text.trim();

        if (!auth.response.ok || !token) {
            return jsonResponse({
                success: false,
                message: `Ошибка авторизации iiko: HTTP ${auth.response.status}`
            }, 502);
        }

        const reportUrl = `${serverUrl}/resto/api/v2/reports/olap?key=${encodeURIComponent(token)}`;
        const reportBody = {
            reportType: "SALES",
            buildSummary: false,
            groupByRowFields: ["DishName"],
            groupByColFields: [],
            aggregateFields: ["DishSumInt", "DishAmountInt", "ProductCostBase.Profit"],
            filters: {
                "OpenDate.Typed": {
                    filterType: "DateRange",
                    periodType: "CUSTOM",
                    from,
                    to: endDate(from, to)
                },
                "DishType": {
                    filterType: "IncludeValues",
                    values: ["DISH"]
                },
                "DeletedWithWriteoff": {
                    filterType: "ExcludeValues",
                    values: ["DELETED_WITHOUT_WRITEOFF"]
                }
            }
        };

        console.log(`[ABC][${rid}] OLAP REQUEST`, JSON.stringify(reportBody));
        const report = await fetchTextWithTimeout(reportUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Accept": "application/json" },
            body: JSON.stringify(reportBody)
        });

        if (!report.response.ok) {
            return jsonResponse({
                success: false,
                message: `iiko Server вернул HTTP ${report.response.status}`,
                details: report.text.slice(0, 3000)
            }, 502);
        }

        let payload;
        try {
            payload = JSON.parse(report.text);
        } catch {
            return jsonResponse({ success: false, message: "iiko вернул некорректный JSON", details: report.text.slice(0, 3000) }, 502);
        }

        const rows = mergeRows(normalizeRows(payload));

        if (!rows.length) {
            return jsonResponse({
                success: true,
                rows: [],
                totals: { revenue: 0, quantity: 0, profit: 0 },
                count: 0,
                requestId: rid
            });
        }

        const totals = {
            revenue: classify(rows, "revenue", aLimit, bLimit),
            quantity: classify(rows, "quantity", aLimit, bLimit),
            profit: classify(rows, "profit", aLimit, bLimit)
        };

        rows.sort((a, b) => b.revenue - a.revenue);

        return jsonResponse({
            success: true,
            rows,
            totals,
            count: rows.length,
            requestId: rid,
            period: { from, to }
        });

    } catch (error) {
        console.error(`[ABC][${rid}] ERROR`, error);
        return jsonResponse({
            success: false,
            message: error?.message || "Ошибка получения ABC отчёта",
            requestId: rid
        }, 502);
    }
}
