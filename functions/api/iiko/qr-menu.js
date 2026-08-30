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
    return Array.from(new Uint8Array(hash)).map(byte => byte.toString(16).padStart(2, "0")).join("");
}

async function auth(ip, port, login, password) {
    const serverUrl = `http://${ip}:${port}`;
    const passwordHash = await sha1(password);
    const url = `${serverUrl}/resto/api/auth?login=${encodeURIComponent(login)}&pass=${passwordHash}`;
    const response = await fetch(url);
    const token = (await response.text()).trim();
    if (!response.ok || !token) throw new Error(`Ошибка авторизации iiko: HTTP ${response.status}`);
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

function asGroupArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.items)) return payload.items;
    if (Array.isArray(payload?.groups)) return payload.groups;
    return [];
}

async function getProducts(serverUrl, token) {
    const url = `${serverUrl}/resto/api/v2/entities/products/list?includeDeleted=false&types=DISH&key=${encodeURIComponent(token)}`;
    const response = await fetch(url, { method: "GET", headers: { "Accept": "application/json" } });
    const text = (await response.text()).trim();
    if (!response.ok) throw new Error(`iiko /entities/products/list: HTTP ${response.status}${text ? ` — ${text.slice(0, 500)}` : ""}`);
    if (!text) return [];
    try { return asArray(JSON.parse(text)); }
    catch { throw new Error("iiko /resto/api/v2/entities/products/list вернул некорректный JSON"); }
}

async function getGroups(serverUrl, token) {
    const url = `${serverUrl}/resto/api/v2/entities/products/group/list?includeDeleted=false&key=${encodeURIComponent(token)}`;
    const response = await fetch(url, { method: "GET", headers: { "Accept": "application/json" } });
    const text = (await response.text()).trim();
    if (!response.ok) throw new Error(`iiko /entities/products/group/list: HTTP ${response.status}${text ? ` — ${text.slice(0, 500)}` : ""}`);
    if (!text) return [];
    try { return asGroupArray(JSON.parse(text)); }
    catch { throw new Error("iiko /resto/api/v2/entities/products/group/list вернул некорректный JSON"); }
}

function buildGroupMap(groups) {
    const map = new Map();
    for (const group of groups) {
        if (!group || group.deleted === true || !group.id) continue;
        map.set(String(group.id), {
            id: String(group.id),
            name: String(group.name || "Без категории"),
            parent: group.parent ? String(group.parent) : null,
            position: toNumber(group.position),
            visibilityFilter: group.visibilityFilter || null
        });
    }
    return map;
}

function resolveGroupName(groupId, groupMap) {
    if (!groupId || groupId === "root") return "Без категории";
    return groupMap.get(String(groupId))?.name || "Без категории";
}

// iiko Server exposes the branches where an item is NOT available through
// excludedSections. null/[] means the item is available everywhere.
// We intentionally keep this rule server-local and do not call iiko Cloud.
function hasSalePlace(item) {
    const excluded = item?.excludedSections;
    if (excluded == null) return true;
    if (Array.isArray(excluded)) return excluded.length === 0;
    return String(excluded).trim() === "";
}

function normalizeProducts(items, groupMap) {
    const products = [];
    const categories = new Map();
    let skippedNoSalePlace = 0;

    for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        if (!item || item.deleted === true) continue;
        if (String(item.type || "").toUpperCase() !== "DISH") continue;
        if (item.defaultIncludedInMenu !== true) continue;

        // A dish with no sales place is not part of the QR Menu mirror.
        if (!hasSalePlace(item)) {
            skippedNoSalePlace += 1;
            continue;
        }

        const id = String(item.id || "").trim();
        if (!id) continue;

        const parentId = item.parent == null || item.parent === "" ? "root" : String(item.parent);
        const group = groupMap.get(parentId);
        const categoryName = resolveGroupName(parentId, groupMap);

        if (!categories.has(parentId)) {
            categories.set(parentId, {
                id: parentId,
                iikoId: parentId,
                name: categoryName,
                parentId: group?.parent || null,
                sortOrder: group?.position ?? categories.size,
                source: "iiko"
            });
        }

        products.push({
            id,
            iikoId: id,
            source: "iiko",
            name: String(item.name || id),
            description: String(item.description || ""),
            categoryId: parentId,
            categoryName,
            price: toNumber(item.defaultSalePrice),
            defaultIncludedInMenu: true,
            salePlaceAvailable: true,
            deleted: false,
            type: "DISH",
            code: String(item.code || ""),
            num: String(item.num || ""),
            mainUnit: item.mainUnit || null,
            position: toNumber(item.position),
            frontImageId: item.frontImageId || null,
            excludedSections: Array.isArray(item.excludedSections) ? item.excludedSections : null,
            sortOrder: toNumber(item.position) ?? index
        });
    }

    products.sort((a, b) => a.sortOrder - b.sortOrder);

    return {
        categories: Array.from(categories.values()),
        products,
        skippedNoSalePlace
    };
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const ip = String(body.ip || "").trim();
        const port = String(body.port || "").trim();
        const login = String(body.login || "").trim();
        const password = String(body.password || "");

        if (!ip || !port || !login || !password) {
            return jsonResponse({ success: false, message: "Заполните IP, порт, логин и пароль iiko" }, 400);
        }

        const { serverUrl, token } = await auth(ip, port, login, password);
        const [rawProducts, rawGroups] = await Promise.all([
            getProducts(serverUrl, token),
            getGroups(serverUrl, token)
        ]);

        const groupMap = buildGroupMap(rawGroups);
        const normalized = normalizeProducts(rawProducts, groupMap);

        return jsonResponse({
            success: true,
            source: "iiko-local-server",
            mirror: "iiko -> QR Menu",
            endpoints: [
                "/resto/api/v2/entities/products/list",
                "/resto/api/v2/entities/products/group/list"
            ],
            filter: "DISH + defaultIncludedInMenu=true + sale place available",
            categoryCount: normalized.categories.length,
            productCount: normalized.products.length,
            skippedNoSalePlace: normalized.skippedNoSalePlace,
            categories: normalized.categories,
            products: normalized.products
        });
    } catch (error) {
        return jsonResponse({ success: false, message: error?.message || "Ошибка загрузки меню iiko" }, 502);
    }
}
