import { iikoText } from "./_lib/iiko-client.js";
import {normalizeDepartmentsPayload,parseDepartmentsXml,safeDepartmentDiagnostic} from "./_lib/departments.js";

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

export async function getDepartments(connection) {
    const result = await iikoText(
        connection,
        "/resto/api/corporation/departments",
        {
            method: "GET",
            headers: { "Accept": "application/json, application/xml, text/xml" }
        }
    );

    const text = result.text;
    if (!result.ok) {
        throw new Error(
            `Ошибка получения подразделений iiko Server: HTTP ${result.status}${text ? ` — ${text.slice(0, 800)}` : ""}`
        );
    }

    if (!text) {
        return {
            departments: [],
            rawFormat: "empty",
            rawPreview: "",
            diagnostic:{format:"empty",candidates:0,types:[]},
            authCacheHit: result.auth?.cacheHit === true
        };
    }

    try {
        const payload = JSON.parse(text);
        return {
            departments: normalizeDepartmentsPayload(payload),
            rawFormat: "json",
            rawPreview: JSON.stringify(payload).slice(0, 1200),
            diagnostic: safeDepartmentDiagnostic(payload, "json"),
            authCacheHit: result.auth?.cacheHit === true
        };
    } catch {
        return {
            departments: parseDepartmentsXml(text),
            rawFormat: "xml",
            rawPreview: text.slice(0, 1200),
            diagnostic: safeDepartmentDiagnostic(text, "xml"),
            authCacheHit: result.auth?.cacheHit === true
        };
    }
}

// iiko OLAP requires OpenDate.Typed as a DATE filter.
// IMPORTANT: send YYYY-MM-DD only, without time or milliseconds.
function isoDateDaysAgo(days) {
    const date = new Date(Date.now() - days * 86400000);
    return date.toISOString().slice(0, 10);
}

function localIsoNow() {
    return new Date().toISOString().slice(0, 10);
}

export async function getDepartmentsFromOlap(connection) {
    // Fallback ONLY for local iiko Server identity.
    // This does not change the main OLAP reports implementation.
    const baseBody = {
        reportType: "SALES",
        buildSummary: false,
        aggregateFields: ["UniqOrderId"],
        filters: {
            "OpenDate.Typed": {
                filterType: "DateRange",
                periodType: "CUSTOM",
                from: isoDateDaysAgo(90),
                to: localIsoNow()
            }
        }
    };

    const run = groupByRowFields => iikoText(
        connection,
        "/resto/api/v2/reports/olap",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify({ ...baseBody, groupByRowFields })
        }
    );

    let result = await run(["Department.Id", "Department"]);
    if (!result.ok) result = await run(["Department.Id"]);

    const text = result.text;
    if (!result.ok) {
        throw new Error(
            `iiko OLAP Department.Id: HTTP ${result.status}${text ? ` — ${text.slice(0, 800)}` : ""}`
        );
    }

    let payload;
    try {
        payload = JSON.parse(text || "{}");
    } catch {
        throw new Error("iiko OLAP вернул некорректный JSON при определении Department ID");
    }

    const rows = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.rows)
            ? payload.rows
            : [];

    const departments = [];
    const seen = new Set();

    for (const row of rows) {
        const id = row?.["Department.Id"] ?? row?.DepartmentId ?? row?.departmentId;
        if (id == null || String(id).trim() === "") continue;

        const idString = String(id).trim();
        if (seen.has(idString)) continue;

        const name =
            row?.Department ??
            row?.["Department.Name"] ??
            row?.DepartmentName ??
            `Подразделение ${idString}`;

        departments.push({
            id: idString,
            parentId: null,
            code: "",
            name: String(name),
            type: "DEPARTMENT",
            source: "iiko-server-olap"
        });
        seen.add(idString);
    }

    return {
        departments,
        rawFormat: "olap",
        rawPreview: JSON.stringify(payload).slice(0, 1600),
        diagnostic:{format:"olap",candidates:rows.length,types:[]},
        authCacheHit: result.auth?.cacheHit === true
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
        const connection = {
            ip: String(body.ip || "").trim(),
            port: String(body.port || "").trim(),
            login: String(body.login || "").trim(),
            password: String(body.password || "")
        };

        if (!connection.ip || !connection.port || !connection.login || !connection.password) {
            return jsonResponse({
                success: false,
                message: "Заполните IP, порт, логин и пароль iiko Server"
            }, 400);
        }

        let departmentResult = await getDepartments(connection);
        let departments = departmentResult.departments;

        if (!departments.length) {
            try {
                departmentResult = await getDepartmentsFromOlap(connection);
                departments = departmentResult.departments;
            } catch (olapError) {
                return jsonResponse({
                    success: false,
                    message:
                        "iiko Server подключён, но не удалось получить реальный Department ID. " +
                        `Classic departments: ${departmentResult.rawPreview || "[]"}. ` +
                        `OLAP: ${olapError?.message || "ошибка"}`
                }, 502);
            }
        }

        if (!departments.length) {
            return jsonResponse({
                success: false,
                message:
                    "iiko Server подключён, но реальный Department ID не найден. " +
                    "Проверьте, что в iiko есть продажи за последние 90 дней или доступен список подразделений.",
                source: departmentResult.rawFormat,
                rawPreview: departmentResult.rawPreview
            }, 502);
        }

        const organizations = departments.map(item => ({
            id: item.id,
            name: item.name,
            code: item.code,
            address: "",
            type: "DEPARTMENT"
        }));

        const organizationId = departments[0].id;

        return jsonResponse({
            success: true,
            message: "iiko Server подключён. Реальный Department ID получен из локального iiko API.",
            organizationId,
            organizations,
            departmentIds: departments.map(item => item.id),
            departments,
            source: "iiko-server-local",
            identityType: "DEPARTMENT",
            identitySource: departmentResult.rawFormat,
            meta: {
                sharedIikoClient: true,
                authCacheHit: departmentResult.authCacheHit === true
            }
        });

    } catch (error) {
        return jsonResponse({
            success: false,
            message: error?.message || "Ошибка подключения к iiko Server"
        }, 502);
    }
}
