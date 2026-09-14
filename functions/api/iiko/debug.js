import { getIikoAuth, iikoText } from "./_lib/iiko-client.js";

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

function addTrace(trace, level, message, detail = "") {
    trace.push({ level, message, detail, at: new Date().toISOString() });
}

function normalizeDepartments(payload) {
    const items = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
            ? payload.items
            : Array.isArray(payload?.departments)
                ? payload.departments
                : Array.isArray(payload?.corporateItems)
                    ? payload.corporateItems
                    : [];

    return items.map(item => ({
        id: String(item?.id || ""),
        parentId: item?.parentId == null ? null : String(item.parentId),
        code: String(item?.code || ""),
        name: String(item?.name || item?.code || item?.id || ""),
        type: String(item?.type || "")
    })).filter(item => item.id);
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
    const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
    return match ? xmlDecode(match[1].replace(/<[^>]+>/g, "")) : "";
}

function parseDepartmentsXml(text) {
    const result = [];
    const nodeRegex = /<corporateItemDto\b[^>]*>([\s\S]*?)<\/corporateItemDto>/gi;
    let match;

    while ((match = nodeRegex.exec(text))) {
        const block = match[1] || "";
        const id = xmlChild(block, "id");
        const type = xmlChild(block, "type");
        if (!id) continue;
        result.push({
            id,
            parentId: xmlChild(block, "parentId") || null,
            code: xmlChild(block, "code"),
            name: xmlChild(block, "name") || id,
            type: type || "DEPARTMENT"
        });
    }

    return result;
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
    const trace = [];
    const started = Date.now();

    try {
        const body = await context.request.json();
        const connection = {
            ip: String(body.ip || "").trim(),
            port: String(body.port || "").trim(),
            login: String(body.login || "").trim(),
            password: String(body.password || "")
        };

        if (!connection.ip || !connection.port || !connection.login || !connection.password) {
            addTrace(trace, "err", "Входные данные не заполнены");
            return jsonResponse({ success: false, message: "Заполните все поля", trace }, 400);
        }

        const serverUrl = `http://${connection.ip}:${connection.port}`;
        addTrace(trace, "info", "Начинаем диагностику", `server=${serverUrl}`);
        addTrace(trace, "info", "→ общий iiko auth", `login=${connection.login}\npassword=*** (скрыт)`);

        const auth = await getIikoAuth(connection);
        addTrace(
            trace,
            "ok",
            "← авторизация iiko успешна",
            `token=получен, длина ${auth.token.length}\ncache=${auth.cacheHit ? "hit" : "miss"}`
        );

        addTrace(trace, "info", "→ iiko /resto/api/corporation/departments/", "method=GET\nAccept=application/xml\nkey=*** (токен скрыт)");

        const departmentsResponse = await iikoText(
            connection,
            "/resto/api/corporation/departments/",
            {
                method: "GET",
                headers: { "Accept": "application/xml, text/xml" }
            }
        );
        const text = departmentsResponse.text;
        const bytes = new TextEncoder().encode(text).length;

        addTrace(
            trace,
            departmentsResponse.ok ? "ok" : "err",
            "← ответ iiko /resto/api/corporation/departments/",
            `HTTP ${departmentsResponse.status}\ncontent-type=${departmentsResponse.contentType}\nbytes=${bytes}\nauth-cache=${departmentsResponse.auth?.cacheHit ? "hit" : "miss"}`
        );

        if (!departmentsResponse.ok) {
            return jsonResponse({ success: false, message: `Ошибка получения подразделений iiko: HTTP ${departmentsResponse.status}`, trace }, 502);
        }

        const preview = text.slice(0, 3000);
        addTrace(trace, "info", "Сырой ответ iiko", `length=${text.length}\n${preview || "<пусто>"}`);

        let departments = [];
        let format = "empty";
        if (text) {
            try {
                const payload = JSON.parse(text);
                departments = normalizeDepartments(payload);
                format = "JSON";
                addTrace(trace, "info", "Структура JSON", Array.isArray(payload)
                    ? `array length=${payload.length}`
                    : `object keys=${Object.keys(payload || {}).join(", ")}`);
            } catch {
                departments = parseDepartmentsXml(text);
                format = "XML";
            }
        }

        const onlyDepartments = departments.filter(item => item.type.toUpperCase() === "DEPARTMENT");
        addTrace(trace, onlyDepartments.length ? "ok" : "err", "Разбор ответа подразделений",
            `format=${format}\nitems=${departments.length}\nDEPARTMENT=${onlyDepartments.length}\n${onlyDepartments.slice(0, 10).map(item => `${item.name} | ${item.id}`).join("\n") || "DEPARTMENT не найден"}`);

        addTrace(trace, "ok", "Диагностика завершена", `duration=${Date.now() - started} ms`);

        return jsonResponse({
            success: true,
            message: onlyDepartments.length ? `Найдено подразделений: ${onlyDepartments.length}` : "iiko подключён, но DEPARTMENT не найден в ответе",
            departments: onlyDepartments,
            departmentIds: onlyDepartments.map(item => item.id),
            trace,
            meta: {
                sharedIikoClient: true,
                authCacheHit: auth.cacheHit === true
            }
        });
    } catch (error) {
        addTrace(trace, "err", "Исключение на сервере", error?.message || String(error));
        return jsonResponse({ success: false, message: error?.message || "Неизвестная ошибка", trace }, 502);
    }
}
