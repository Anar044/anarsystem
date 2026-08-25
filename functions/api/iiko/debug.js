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

function addTrace(trace, level, message, detail = "") {
    trace.push({
        level,
        message,
        detail,
        at: new Date().toISOString()
    });
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

    return items
        .filter(item => String(item?.type || "DEPARTMENT").toUpperCase() === "DEPARTMENT")
        .map(item => ({
            id: String(item.id || ""),
            name: String(item.name || item.code || item.id || ""),
            code: String(item.code || ""),
            type: String(item.type || "DEPARTMENT")
        }))
        .filter(item => item.id);
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

function xmlAttribute(tag, name) {
    const match = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
    return match ? xmlDecode(match[1]) : "";
}

function xmlChild(block, name) {
    const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
    return match ? xmlDecode(match[1].replace(/<[^>]+>/g, "")) : "";
}

function parseDepartmentsXml(text) {
    const result = [];
    const seen = new Set();
    const nodeRegex = /<(department|corporateItem|corporateItemDto|item|entity)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let match;

    while ((match = nodeRegex.exec(text))) {
        const openingTag = `<${match[1]} ${match[2]}>`;
        const block = match[3] || "";
        const type = xmlAttribute(openingTag, "type") || xmlChild(block, "type");
        if (type && type.toUpperCase() !== "DEPARTMENT") continue;

        const id = xmlAttribute(openingTag, "id") || xmlChild(block, "id");
        if (!id || seen.has(id)) continue;

        const name = xmlAttribute(openingTag, "name") || xmlChild(block, "name");
        const code = xmlAttribute(openingTag, "code") || xmlChild(block, "code");

        result.push({
            id: String(id),
            name: String(name || code || id),
            code: String(code || ""),
            type: "DEPARTMENT"
        });
        seen.add(id);
    }

    return result;
}

async function readBody(response) {
    const text = await response.text();
    return {
        text,
        bytes: new TextEncoder().encode(text).length,
        contentType: response.headers.get("content-type") || ""
    };
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
    const trace = [];
    const started = Date.now();

    try {
        const body = await context.request.json();
        const ip = String(body.ip || "").trim();
        const port = String(body.port || "").trim();
        const login = String(body.login || "").trim();
        const password = String(body.password || "");

        if (!ip || !port || !login || !password) {
            addTrace(trace, "err", "Входные данные не заполнены");
            return jsonResponse({ success: false, message: "Заполните все поля", trace }, 400);
        }

        const serverUrl = `http://${ip}:${port}`;
        addTrace(trace, "info", "Начинаем диагностику", `server=${serverUrl}`);

        const passwordHash = await sha1(password);
        const authUrl = `${serverUrl}/resto/api/auth?login=${encodeURIComponent(login)}&pass=${passwordHash}`;
        addTrace(trace, "info", "→ iiko /resto/api/auth", `method=GET\nlogin=${login}\npassword=*** (скрыт)`);

        const authResponse = await fetch(authUrl);
        const authBody = await readBody(authResponse);
        const token = authBody.text.trim();

        addTrace(
            trace,
            authResponse.ok && token ? "ok" : "err",
            "← ответ iiko /resto/api/auth",
            `HTTP ${authResponse.status}\ncontent-type=${authBody.contentType}\nbytes=${authBody.bytes}\ntoken=${token ? `получен, длина ${token.length}` : "не получен"}`
        );

        if (!authResponse.ok || !token) {
            return jsonResponse({ success: false, message: `Ошибка авторизации iiko: HTTP ${authResponse.status}`, trace }, 502);
        }

        const departmentsUrl = `${serverUrl}/resto/api/corporation/departments/?key=${encodeURIComponent(token)}`;
        addTrace(trace, "info", "→ iiko /resto/api/corporation/departments/", "method=GET\nkey=*** (токен скрыт)");

        const departmentsResponse = await fetch(departmentsUrl, {
            method: "GET",
            headers: { "Accept": "application/json, application/xml, text/xml" }
        });
        const departmentsBody = await readBody(departmentsResponse);

        addTrace(
            trace,
            departmentsResponse.ok ? "ok" : "err",
            "← ответ iiko /resto/api/corporation/departments/",
            `HTTP ${departmentsResponse.status}\ncontent-type=${departmentsBody.contentType}\nbytes=${departmentsBody.bytes}`
        );

        if (!departmentsResponse.ok) {
            return jsonResponse({ success: false, message: `Ошибка получения подразделений iiko: HTTP ${departmentsResponse.status}`, trace }, 502);
        }

        let departments = [];
        let format = "empty";

        if (departmentsBody.text) {
            try {
                departments = normalizeDepartments(JSON.parse(departmentsBody.text));
                format = "JSON";
            } catch {
                departments = parseDepartmentsXml(departmentsBody.text);
                format = "XML";
            }
        }

        addTrace(
            trace,
            departments.length ? "ok" : "err",
            "Разбор ответа подразделений",
            `format=${format}\nDEPARTMENT=${departments.length}\n${departments.slice(0, 5).map(item => `${item.name} | ${item.id}`).join("\n") || "DEPARTMENT не найден"}`
        );

        addTrace(trace, "ok", "Диагностика завершена", `duration=${Date.now() - started} ms`);

        return jsonResponse({
            success: true,
            message: departments.length
                ? `Найдено подразделений: ${departments.length}`
                : "iiko подключён, но DEPARTMENT не найден в ответе",
            departments,
            departmentIds: departments.map(item => item.id),
            trace
        });
    } catch (error) {
        addTrace(trace, "err", "Исключение на сервере", error?.message || String(error));
        return jsonResponse({ success: false, message: error?.message || "Неизвестная ошибка", trace }, 502);
    }
}
