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
            "Accept": "application/json"
        }
    });

    const text = (await response.text()).trim();

    if (!response.ok) {
        throw new Error(
            `Ошибка получения подразделений iiko: HTTP ${response.status}`
        );
    }

    let payload;

    try {
        payload = text ? JSON.parse(text) : [];
    } catch {
        throw new Error(
            "iiko вернул некорректный ответ при получении подразделений"
        );
    }

    const items = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.items)
            ? payload.items
            : Array.isArray(payload?.departments)
                ? payload.departments
                : [];

    return items
        .filter(item =>
            String(item?.type || "").toUpperCase() === "DEPARTMENT"
        )
        .map(item => ({
            id: String(item.id || ""),
            parentId: item.parentId == null ? null : String(item.parentId),
            code: item.code == null ? "" : String(item.code),
            name: item.name == null ? "" : String(item.name),
            type: String(item.type || "DEPARTMENT")
        }))
        .filter(item => item.id);
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
            message: "iiko Server подключён",
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
