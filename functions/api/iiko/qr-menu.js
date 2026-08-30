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

async function auth(ip, port, login, password) {
    const serverUrl = `http://${ip}:${port}`;
    const passwordHash = await sha1(password);

    const url =
        `${serverUrl}/resto/api/auth` +
        `?login=${encodeURIComponent(login)}` +
        `&pass=${passwordHash}`;

    const response = await fetch(url);
    const token = (await response.text()).trim();

    if (!response.ok || !token) {
        throw new Error(`Ошибка авторизации iiko: HTTP ${response.status}`);
    }

    return { serverUrl, token };
}

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function asArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.products)) return payload.products;
    return [];
}

function normalizeCategoryMap(value) {
    if (!Array.isArray(value)) return new Map();

    return new Map(
        value
            .filter(x => x && (x.iikoId || x.id))
            .map(x => [
                String(x.iikoId || x.id),
                String(x.name || "Без категории")
            ])
    );
}

async function getProducts(serverUrl, token) {
    const url =
        `${serverUrl}/resto/api/v2/entities/products/list` +
        `?includeDeleted=false&types=DISH&key=${encodeURIComponent(token)}`;

    const response = await fetch(url, {
        method: "GET",
        headers: {
            "Accept": "application/json"
        }
    });

    const text = (await response.text()).trim();

    if (!response.ok) {
        throw new Error(
            `iiko /entities/products/list: HTTP ${response.status}` +
            `${text ? ` — ${text.slice(0, 500)}` : ""}`
        );
    }

    if (!text) return [];

    try {
        return asArray(JSON.parse(text));
    } catch {
        throw new Error(
            "iiko /resto/api/v2/entities/products/list вернул некорректный JSON"
        );
    }
}

function normalizeProducts(items, categoryMap) {
    const products = [];
    const categories = new Map();

    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];

        if (!item || item.deleted === true) continue;
        if (String(item.type || "").toUpperCase() !== "DISH") continue;

        // IMPORTANT:
        // QR Menu must contain only dishes that iiko marks as included
        // in the menu/sale. Everything else is ignored.
        if (item.defaultIncludedInMenu !== true) continue;

        const id = String(item.id || "").trim();
        if (!id) continue;

        const parentId =
            item.parent == null || item.parent === ""
                ? "root"
                : String(item.parent);

        const categoryName =
            categoryMap.get(parentId) ||
            (parentId === "root" ? "Без категории" : "Группа iiko");

        if (!categories.has(parentId)) {
            categories.set(parentId, {
                id: parentId,
                iikoId: parentId,
                name: categoryName,
                sortOrder: parentId === "root" ? 999999 : categories.size
            });
        }

        products.push({
            id,
            name: String(item.name || id),
            description: String(item.description || ""),
            categoryId: parentId,
            price: toNumber(item.defaultSalePrice),
            defaultIncludedInMenu: true,
            deleted: false,
            type: "DISH",
            code: String(item.code || ""),
            num: String(item.num || ""),
            mainUnit: item.mainUnit || null,
            position: toNumber(item.position),
            frontImageId: item.frontImageId || null,
            excludedSections: Array.isArray(item.excludedSections)
                ? item.excludedSections
                : null,
            sortOrder: toNumber(item.position) ?? index
        });
    }

    products.sort((a, b) => a.sortOrder - b.sortOrder);

    return {
        categories: Array.from(categories.values()),
        products
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

        const ip = String(body.ip || "").trim();
        const port = String(body.port || "").trim();
        const login = String(body.login || "").trim();
        const password = String(body.password || "");

        if (!ip || !port || !login || !password) {
            return jsonResponse({
                success: false,
                message: "Заполните IP, порт, логин и пароль iiko"
            }, 400);
        }

        const categoryMap = normalizeCategoryMap(body.categories);
        const { serverUrl, token } = await auth(ip, port, login, password);
        const rawProducts = await getProducts(serverUrl, token);
        const normalized = normalizeProducts(rawProducts, categoryMap);

        return jsonResponse({
            success: true,
            source: "iiko-local-server",
            endpoint: "/resto/api/v2/entities/products/list",
            filter: "DISH + defaultIncludedInMenu=true",
            categoryCount: normalized.categories.length,
            productCount: normalized.products.length,
            categories: normalized.categories,
            products: normalized.products
        });
    } catch (error) {
        return jsonResponse({
            success: false,
            message: error?.message || "Ошибка загрузки меню iiko"
        }, 502);
    }
}
