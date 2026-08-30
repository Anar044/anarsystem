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
    const match = block.match(
        new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i")
    );
    return match ? xmlDecode(match[1].replace(/<[^>]+>/g, "")) : "";
}

function parseDepartmentsXml(text) {
    const result = [];
    const seen = new Set();
    const nodeRegex = /<(department|corporateItemDto|corporateItem|item|entity)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
    let match;

    while ((match = nodeRegex.exec(text))) {
        const block = match[3] || "";
        const type = xmlChild(block, "type");
        if (type && type.toUpperCase() !== "DEPARTMENT") continue;

        const id = xmlChild(block, "id");
        if (!id || seen.has(id)) continue;

        const parentId = xmlChild(block, "parentId") || xmlChild(block, "parentID");
        const code = xmlChild(block, "code");
        const name = xmlChild(block, "name");

        result.push({
            id: String(id),
            parentId: parentId ? String(parentId) : null,
            code: String(code || ""),
            name: String(name || code || id),
            type: "DEPARTMENT"
        });
        seen.add(id);
    }

    return result;
}

function normalizeDepartmentsPayload(payload) {
    // Локальный iiko Server в разных версиях может возвращать
    // подразделения под разными именами. Cloud API здесь не используется.
    let items = [];

    if (Array.isArray(payload)) {
        items = payload;
    } else if (Array.isArray(payload?.items)) {
        items = payload.items;
    } else if (Array.isArray(payload?.departments)) {
        items = payload.departments;
    } else if (Array.isArray(payload?.corporateItems)) {
        items = payload.corporateItems;
    } else if (Array.isArray(payload?.corporateItemDtoes)) {
        items = payload.corporateItemDtoes;
    } else if (Array.isArray(payload?.corporateItemDtos)) {
        items = payload.corporateItemDtos;
    } else if (Array.isArray(payload?.data)) {
        items = payload.data;
    }

    return items
        .filter(item => String(item?.type || "").toUpperCase() === "DEPARTMENT")
        .map(item => ({
            id: String(item.id || ""),
            parentId: item.parentId == null ? null : String(item.parentId),
            code: item.code == null ? "" : String(item.code),
            name: item.name == null
                ? String(item.code || item.id || "Подразделение")
                : String(item.name),
            type: "DEPARTMENT"
        }))
        .filter(item => item.id);
}

async function getToken(ip, port, login, password) {
    // ТОЛЬКО локальный iiko Server.
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
    // ТОЛЬКО локальный iiko Server API.
    const url =
        `${serverUrl}/resto/api/corporation/departments/` +
        `?key=${encodeURIComponent(token)}`;

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Accept": "application/json, application/xml, text/xml"
        }
    });

    const text = (await response.text()).trim();

    if (!response.ok) {
        throw new Error(`Ошибка получения подразделений iiko Server: HTTP ${response.status}`);
    }

    if (!text) return [];

    // Основной вариант — JSON.
    try {
        const payload = JSON.parse(text);
        const departments = normalizeDepartmentsPayload(payload);
        if (departments.length) return departments;
    } catch {
        // Ответ не JSON — пробуем XML ниже.
    }

    // Резервный вариант — XML.
    return parseDepartmentsXml(text);
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
        const departments = await getDepartments(auth.serverUrl, auth.token);

        if (!departments.length) {
            return jsonResponse({
                success: false,
                message: "iiko Server подключён, но подразделения типа DEPARTMENT не найдены в /resto/api/corporation/departments/"
            }, 502);
        }

        // Для локального iiko Server ID ресторана берём из DEPARTMENT.
        // Cloud API /api/1/organizations НЕ используется.
        const organizations = departments.map(item => ({
            id: item.id,
            name: item.name,
            code: item.code,
            address: "",
            type: "DEPARTMENT"
        }));

        // Оставляем organizationId для совместимости с QR Menu.
        const organizationId = departments[0].id;

        return jsonResponse({
            success: true,
            message: "iiko Server подключён. ID ресторана получен из локального DEPARTMENT.",
            organizationId,
            organizations,
            departmentIds: departments.map(item => item.id),
            departments,
            source: "iiko-server-local",
            identityType: "DEPARTMENT"
        });

    } catch (error) {
        return jsonResponse({
            success: false,
            message: error?.message || "Ошибка подключения к iiko Server"
        }, 502);
    }
}
