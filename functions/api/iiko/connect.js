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

function xmlAttribute(tag, name) {
    const match = tag.match(
        new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i")
    );

    return match ? xmlDecode(match[1]) : "";
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

    // iiko Server may return the corporate structure as XML. Different
    // versions use slightly different item names, so support the common
    // department/corporateItem/item forms and read both attributes and
    // child elements.
    const nodeRegex = /<(department|corporateItem|item|entity)\\b([^>]*)>([\\s\\S]*?)<\\/\\1>/gi;
    let match;

    while ((match = nodeRegex.exec(text))) {
        const openingTag = `<${match[1]} ${match[2]}>`;
        const attributes = match[2] || "";
        const block = match[3] || "";

        const type =
            xmlAttribute(openingTag, "type") ||
            xmlChild(block, "type");

        if (type && type.toUpperCase() !== "DEPARTMENT") {
            continue;
        }

        const id =
            xmlAttribute(openingTag, "id") ||
            xmlChild(block, "id");

        if (!id || seen.has(id)) {
            continue;
        }

        const parentId =
            xmlAttribute(openingTag, "parentId") ||
            xmlAttribute(openingTag, "parentID") ||
            xmlChild(block, "parentId") ||
            xmlChild(block, "parentID");

        const code =
            xmlAttribute(openingTag, "code") ||
            xmlChild(block, "code");

        const name =
            xmlAttribute(openingTag, "name") ||
            xmlChild(block, "name");

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
        .filter(item => {
            const type = String(item?.type || "DEPARTMENT").toUpperCase();
            return type === "DEPARTMENT";
        })
        .map(item => ({
            id: String(item.id || ""),
            parentId: item.parentId == null ? null : String(item.parentId),
            code: item.code == null ? "" : String(item.code),
            name: item.name == null ? String(item.code || item.id || "Подразделение") : String(item.name),
            type: String(item.type || "DEPARTMENT")
        }))
        .filter(item => item.id);
}

async function getToken(ip, port, login, password) {
    const serverUrl = `http://${ip}:${port}`;
    const passwordHash = await sha1(password);

    const authUrl =
        `${serverUrl}/resto/api/auth` +
        `?login=${encodeURIComponent(login)}` +
        `&pass=${passwordHash}`;

    const response = await fetch(authUrl);

    const token = (await response.text()).trim();

    if (!response.ok || !token) {
        throw new Error(
            `Ошибка авторизации iiko: HTTP ${response.status}`
        );
    }

    return {
        serverUrl,
        token
    };
}

async function getDepartments(serverUrl, token) {
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
        throw new Error(
            `Ошибка получения подразделений iiko: HTTP ${response.status}`
        );
    }

    if (!text) {
        return [];
    }

    try {
        return normalizeDepartmentsPayload(JSON.parse(text));
    } catch {
        // iiko Server REST API can return the corporate structure as XML.
        // Parse that response instead of treating it as an invalid payload.
        return parseDepartmentsXml(text);
    }
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
                message: "Заполните все поля"
            }, 400);
        }

        const auth = await getToken(ip, port, login, password);
        const departments = await getDepartments(
            auth.serverUrl,
            auth.token
        );

        return jsonResponse({
            success: true,
            message: departments.length
                ? "iiko Server подключён"
                : "iiko Server подключён, но подразделения не найдены",
            departmentIds: departments.map(item => item.id),
            departments
        });

    } catch (error) {
        return jsonResponse({
            success: false,
            message: error.message
        }, 502);
    }
}
