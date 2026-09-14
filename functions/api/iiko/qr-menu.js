import { clean, iikoFetch, iikoJson } from './_lib/iiko-client.js';

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
            "Cache-Control": "no-store",
            ...corsHeaders()
        }
    });
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
    return { categories: Array.from(categories.values()), products, skippedNoSalePlace };
}

function arrayBufferToDataUrl(buffer, contentType) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    return `data:${contentType || "image/jpeg"};base64,${btoa(binary)}`;
}

const imagePaths = [
    imageId => `/resto/api/v2/images/${encodeURIComponent(imageId)}`,
    imageId => `/resto/api/v2/images/${encodeURIComponent(imageId)}/download`,
    imageId => `/resto/api/images/${encodeURIComponent(imageId)}`,
    imageId => `/resto/api/v2/entities/products/image/${encodeURIComponent(imageId)}`
];

async function fetchImageDataUrl(connection, imageId, imageState) {
    if (!imageId) return null;

    const order = [];
    if (Number.isInteger(imageState.preferredIndex)) order.push(imageState.preferredIndex);
    for (let i = 0; i < imagePaths.length; i += 1) if (!order.includes(i)) order.push(i);

    for (const index of order) {
        try {
            const { response } = await iikoFetch(connection, imagePaths[index](imageId), {
                headers: { Accept: "image/*,*/*;q=0.8" },
                timeoutMs: 15000
            });
            const contentType = response.headers.get("content-type") || "";
            if (!response.ok || !contentType.toLowerCase().startsWith("image/")) continue;
            const buffer = await response.arrayBuffer();
            if (!buffer.byteLength) continue;
            imageState.preferredIndex = index;
            imageState.successfulPath = index;
            return arrayBufferToDataUrl(buffer, contentType.split(";")[0] || "image/jpeg");
        } catch (_) {}
    }
    return null;
}

async function getProducts(connection) {
    const result = await iikoJson(connection, "/resto/api/v2/entities/products/list?includeDeleted=false&types=DISH");
    if (!result.ok) throw new Error(`iiko /entities/products/list: HTTP ${result.status}${result.text ? ` — ${result.text.slice(0, 500)}` : ""}`);
    if (!result.text) return [];
    if (!result.payload) throw new Error("iiko /resto/api/v2/entities/products/list вернул некорректный JSON");
    return asArray(result.payload);
}

async function getGroups(connection) {
    const result = await iikoJson(connection, "/resto/api/v2/entities/products/group/list?includeDeleted=false");
    if (!result.ok) throw new Error(`iiko /entities/products/group/list: HTTP ${result.status}${result.text ? ` — ${result.text.slice(0, 500)}` : ""}`);
    if (!result.text) return [];
    if (!result.payload) throw new Error("iiko /resto/api/v2/entities/products/group/list вернул некорректный JSON");
    return asGroupArray(result.payload);
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const connection = {
            ip: clean(body.ip),
            port: clean(body.port),
            login: clean(body.login),
            password: String(body.password || "")
        };

        if (!connection.ip || !connection.port || !connection.login || !connection.password) {
            return jsonResponse({ success: false, message: "Заполните IP, порт, логин и пароль iiko" }, 400);
        }

        const [rawProducts, rawGroups] = await Promise.all([
            getProducts(connection),
            getGroups(connection)
        ]);

        const groupMap = buildGroupMap(rawGroups);
        const normalized = normalizeProducts(rawProducts, groupMap);

        let imageCount = 0;
        const imageConcurrency = 4;
        const imageState = { preferredIndex: null, successfulPath: null };
        for (let i = 0; i < normalized.products.length; i += imageConcurrency) {
            const batch = normalized.products.slice(i, i + imageConcurrency);
            await Promise.all(batch.map(async product => {
                if (!product.frontImageId) return;
                const originalImageId = product.frontImageId;
                const dataUrl = await fetchImageDataUrl(connection, originalImageId, imageState);
                product.iikoImageId = originalImageId;
                if (dataUrl) {
                    product.frontImageId = dataUrl;
                    product.photo = dataUrl;
                    imageCount += 1;
                }
            }));
        }

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
            imageCount,
            skippedNoSalePlace: normalized.skippedNoSalePlace,
            categories: normalized.categories,
            products: normalized.products,
            meta: {
                imageConcurrency,
                preferredImageEndpointIndex: imageState.successfulPath
            }
        });
    } catch (error) {
        return jsonResponse({ success: false, message: error?.message || "Ошибка загрузки меню iiko" }, 502);
    }
}
