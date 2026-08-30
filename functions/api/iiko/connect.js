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

function xmlDecode(value) {
    return String(value || "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();
}

function xmlChild(block, name) {
    const pattern = `<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`;
    const match = block.match(new RegExp(pattern, "i"));
    return match ? xmlDecode(match[1].replace(/<[^>]+>/g, "")) : "";
}

function parseDepartmentsXml(text) {
    const result = [];
    const seen = new Set();
    const nodeRegex = new RegExp(
        "<(department|corporateItemDto|corporateItem|item|entity)\\b[^>]*>([\\s\\S]*?)<\\/\\1>",
        "gi"
    );

    let match;
    while ((match = nodeRegex.exec(text))) {
        const block = match[2] || "";
        const type = xmlChild(block, "type");
        if (type && type.toUpperCase() !== "DEPARTMENT") continue;

        const id = xmlChild(block, "id");
        if (!id || seen.has(id)) continue;

        result.push({
            id: String(id),
            parentId: xmlChild(block, "parentId") || xmlChild(block, "parentID") || null,
            code: xmlChild(block, "code"),
            name: xmlChild(block, "name") || xmlChild(block, "code") || String(id),
            type: "DEPARTMENT"
        });
        seen.add(id);
    }

    return result;
}

function normalizeDepartmentItem(item) {
    if (!item || typeof item !== "object") return null;

    const rawType = item.type ?? item.Type ?? item.itemType ?? item.entityType ?? "DEPARTMENT";
    const type = String(rawType).toUpperCase();
    const id = item.id ?? item.Id ?? item.ID ?? item.uuid ?? item.UUID;

    if (id == null || String(id).trim() === "") return null;
    if (type && type !== "DEPARTMENT") return null;

    return {
        id: String(id),
        parentId: item.parentId ?? item.parentID ?? item.ParentId ?? null,
        code: String(item.code ?? item.Code ?? ""),
        name: String(item.name ?? item.Name ?? item.code ?? item.Code ?? id),
        type: "DEPARTMENT"
    };
}

function normalizeDepartmentsPayload(payload) {
    let items = [];

    if (Array.isArray(payload)) items = payload;
    else if (Array.isArray(payload?.items)) items = payload.items;
    else if (Array.isArray(payload?.departments)) items = payload.departments;
    else if (Array.isArray(payload?.corporateItems)) items = payload.corporateItems;
    else if (Array.isArray(payload?.corporateItemDtoes)) items = payload.corporateItemDtoes;
    else if (Array.isArray(payload?.corporateItemDtos)) items = payload.corporateItemDtos;
    else if (Array.isArray(payload?.data)) items = payload.data;

    return items.map(normalizeDepartmentItem).filter(Boolean);
}

async function getToken(ip, port, login, password) {
    // ONLY local iiko Server. No iiko Cloud API.
    const serverUrl = `http://${ip}:${port}`;
    const passwordHash = await sha1(password);
    const authUrl =
        `${serverUrl}/resto/api/auth` +
        `?login=${encodeURIComponent(login)}` +
        `&pass=${passwordHash}`;

    const response = await fetch(authUrl);
    const token = (await response.text()).trim();

    if (!response.ok || !token) {
        throw new Error(`Ошибка авторизации iiko Server: HTTP ${response.status}`);
    }

    return { serverUrl, token };
}

async function getDepartments(serverUrl, token) {
    const url =
        `${serverUrl}/resto/api/corporation/departments` +
        `?key=${encodeURIComponent(token)}`;

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Accept": "application/json, application/xml, text/xml"
        }
    });

    const text = (await response.text()).trim();

    if (!response.ok) {
        throw new Error(
            `Ошибка получения подразделений iiko Server: HTTP ${response.status}${text ? ` — ${text.slice(0, 800)}` : ""}`
        );
    }

    if (!text) return { departments: [], rawFormat: "empty", rawPreview: "" };

    try {
        const payload = JSON.parse(text);
        return {
            departments: normalizeDepartmentsPayload(payload),
            rawFormat: "json",
            rawPreview: JSON.stringify(payload).slice(0, 1200)
        };
    } catch {
        return {
            departments: parseDepartmentsXml(text),
            rawFormat: "xml",
            rawPreview: text.slice(0, 1200)
        };
    }
}

async function getDepartmentsFromOlap(serverUrl, token) {
    // Fallback ONLY for local iiko Server identity.
    // IMPORTANT: this query intentionally has NO DATE FILTER.
    // Department ID is identity data and must not depend on a report period.
    const url =
        `${serverUrl}/resto/api/v2/reports/olap` +
        `?key=${encodeURIComponent(token)}`;

    const baseBody = {
        reportType: "SALES",
        buildSummary: false,
        aggregateFields: ["UniqOrderId"]
    };

    const requests = [
        {
            ...baseBody,
            groupByRowFields: ["Department.Id", "Department"]
        },
        {
            ...baseBody,
            groupByRowFields: ["Department.Id"]
        }
    ];

    let lastError = "";

    for (const requestBody of requests) {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            body: JSON.stringify(requestBody)
        });

        const text = (await response.text()).trim();

        if (!response.ok) {
            lastError = `HTTP ${response.status}${text ? ` — ${text.slice(0, 800)}` : ""}`;
            continue;
        }

        let payload;
        try {
            payload = JSON.parse(text || "{}");
        } catch {
            lastError = "iiko OLAP вернул некорректный JSON при определении Department ID";
            continue;
        }

        const rows = Array.isArray(payload?.data)
            ? payload.data
            : Array.isArray(payload?.rows)
                ? payload.rows
                : [];

        const departments = [];
        const seen = new Set();

        for (const row of rows) {
            const id =
                row?.["Department.Id"] ??
                row?.DepartmentId ??
                row?.departmentId ??
                row?.["Department.id"];

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

        if (departments.length) {
            return {
                departments,
                rawFormat: "olap",
                rawPreview: JSON.stringify(payload).slice(0, 1600)
            };
        }

        lastError = "OLAP успешно ответил, но Department.Id не найден в data";
    }

    throw new Error(`iiko OLAP Department.Id: ${lastError || "не удалось получить Department ID"}`);
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

        if (!ip || !port || !login || !password) {
            return jsonResponse({
                success: false,
                message: "Заполните IP, порт, логин и пароль iiko Server"
            }, 400);
        }

        const auth = await getToken(ip, port, login, password);

        let departmentResult;
        try {
            departmentResult = await getDepartments(auth.serverUrl, auth.token);
        } catch (classicError) {
            departmentResult = {
                departments: [],
                rawFormat: "classic-error",
                rawPreview: classicError?.message || ""
            };
        }

        let departments = departmentResult.departments;

        if (!departments.length) {
            try {
                departmentResult = await getDepartmentsFromOlap(auth.serverUrl, auth.token);
                departments = departmentResult.departments;
            } catch (olapError) {
                return jsonResponse({
                    success: false,
                    message:
                        "iiko Server подключён, но не удалось получить реальный Department ID. " +
                        `Classic: ${departmentResult.rawPreview || "нет данных"}. ` +
                        `OLAP: ${olapError?.message || "ошибка"}`
                }, 502);
            }
        }

        if (!departments.length) {
            return jsonResponse({
                success: false,
                message:
                    "iiko Server подключён, но реальный Department ID не найден. " +
                    "Проверьте список подразделений в iiko Server.",
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
            identitySource: departmentResult.rawFormat
        });

    } catch (error) {
        return jsonResponse({
            success: false,
            message: error?.message || "Ошибка подключения к iiko Server"
        }, 502);
    }
}
