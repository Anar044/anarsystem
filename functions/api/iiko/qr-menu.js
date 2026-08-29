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
        headers: { "Content-Type": "application/json", ...corsHeaders() }
    });
}

async function sha1(text) {
    const data = new TextEncoder().encode(text);
    const hash = await crypto.subtle.digest("SHA-1", data);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

async function auth(ip, port, login, password) {
    const serverUrl = `http://${ip}:${port}`;
    const hash = await sha1(password);
    const url = `${serverUrl}/resto/api/auth?login=${encodeURIComponent(login)}&pass=${hash}`;
    const r = await fetch(url);
    const token = (await r.text()).trim();
    if (!r.ok || !token) throw new Error(`Ошибка авторизации iiko: HTTP ${r.status}`);
    return { serverUrl, token };
}

async function apiPost(serverUrl, path, token, body = {}) {
    const r = await fetch(`${serverUrl}${path}?key=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
        },
        body: JSON.stringify(body)
    });

    const text = (await r.text()).trim();
    let data;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = text;
    }

    if (!r.ok) {
        throw new Error(
            `iiko API ${path}: HTTP ${r.status}${text ? ` — ${text.slice(0, 500)}` : ""}`
        );
    }

    return data;
}

function arr(v, keys) {
    if (Array.isArray(v)) return v;
    for (const k of keys) {
        if (Array.isArray(v?.[k])) return v[k];
    }
    return [];
}

function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
}

function normalizeOrganizations(payload) {
    const items = Array.isArray(payload)
        ? payload
        : Array.isArray(payload?.organizations)
            ? payload.organizations
            : Array.isArray(payload?.items)
                ? payload.items
                : [];

    return items
        .filter(x => x && x.id && x.isDeleted !== true)
        .map(x => ({
            id: String(x.id),
            name: String(x.name || x.organizationName || x.id),
            code: x.code == null ? "" : String(x.code),
            address: String(x.restaurantAddress || x.address || "")
        }));
}

async function getOrganizations(serverUrl, token) {
    const data = await apiPost(serverUrl, "/api/1/organizations", token, {
        returnAdditionalInfo: true,
        includeDisabled: false
    });

    return normalizeOrganizations(data);
}

async function resolveOrganization(serverUrl, token, requestedOrganizationId) {
    const organizations = await getOrganizations(serverUrl, token);

    if (!organizations.length) {
        throw new Error(
            "iiko подключён, но /api/1/organizations не вернул ни одной организации. Проверьте API-доступ пользователя iiko."
        );
    }

    const requested = String(requestedOrganizationId || "").trim();

    // Use an explicitly supplied organization only when it really belongs
    // to the organizations returned by iiko. Never use departmentId as a fallback.
    if (requested) {
        const found = organizations.find(x => x.id === requested);
        if (found) return { organization: found, organizations };
    }

    // Most iiko Server installations used by one restaurant expose one API organization.
    if (organizations.length === 1) {
        return { organization: organizations[0], organizations };
    }

    const list = organizations
        .slice(0, 10)
        .map(x => `${x.name} (${x.id})`)
        .join(", ");

    throw new Error(
        `iiko вернул несколько организаций. Выберите Organization ID в настройках. Доступные: ${list}`
    );
}

function normalizeMenu(menu) {
    const categories = arr(menu, [
        "itemCategories",
        "categories",
        "groups",
        "productCategories"
    ])
        .filter(x => x && x.isDeleted !== true)
        .map((x, i) => ({
            id: String(x.id || x.categoryId || `category-${i}`),
            name: String(x.name || x.categoryName || "Без категории"),
            sortOrder: num(x.order) ?? num(x.sortOrder) ?? i
        }));

    const products = [];
    const seen = new Set();

    function addProduct(p, categoryId, order) {
        if (!p || typeof p !== "object") return;
        if (p.isDeleted === true || p.deleted === true || p.isHidden === true) return;

        const id = String(p.id || p.productId || p.itemId || "");
        if (!id || seen.has(id)) return;

        const sizes = arr(p, ["itemSizes", "sizes", "sizePrices", "prices"]);
        let price = p.price;

        if (price == null && p.defaultPrice != null) price = p.defaultPrice;

        if (price == null && sizes.length) {
            const s = sizes.find(x => x && (x.price != null || x.currentPrice != null));
            price = s?.price ?? s?.currentPrice ?? s?.price?.currentPrice;
        }

        products.push({
            id,
            name: String(p.name || p.productName || p.itemName || id),
            description: String(p.description || p.ingredients || p.composition || ""),
            categoryId: categoryId || String(
                p.productCategoryId || p.categoryId || p.itemCategoryId || p.groupId || "ungrouped"
            ),
            price: num(price),
            image: p.imageUrl || p.imageURL || p.image || null,
            sortOrder: num(p.order) ?? num(p.sortOrder) ?? order ?? 0,
            sizes: sizes.map(s => ({
                id: s?.id || null,
                name: s?.name || s?.sizeName || "",
                price: num(s?.price?.currentPrice ?? s?.price ?? s?.currentPrice)
            }))
        });

        seen.add(id);
    }

    for (const [i, category] of categories.entries()) {
        const items = arr(category, ["items", "products", "dishes", "menuItems"]);
        items.forEach((p, j) => addProduct(p, category.id, j));
    }

    const topProducts = arr(menu, ["items", "products", "menuItems"]);
    for (const [i, p] of topProducts.entries()) {
        const categoryId =
            p?.itemCategoryId ||
            p?.categoryId ||
            p?.productCategoryId ||
            p?.groupId;

        addProduct(p, categoryId, i);
    }

    const known = new Set(categories.map(c => c.id));
    for (const p of products) {
        if (!known.has(p.categoryId)) {
            categories.push({
                id: p.categoryId,
                name: "Без категории",
                sortOrder: 999999
            });
            known.add(p.categoryId);
        }
    }

    categories.sort((a, b) => a.sortOrder - b.sortOrder);
    products.sort((a, b) => a.sortOrder - b.sortOrder);

    return { categories, products };
}

async function getExternalMenu(
    serverUrl,
    token,
    organizationId,
    externalMenuId,
    priceCategoryId
) {
    const list = await apiPost(serverUrl, "/api/2/menu", token, {});
    const menus = arr(list, ["externalMenus", "menus"]);

    if (!menus.length) {
        throw new Error(
            "В iiko не найдено внешнее меню. Сначала создайте меню в iiko для выгрузки через API."
        );
    }

    const selected = externalMenuId
        ? menus.find(m => String(m.id) === String(externalMenuId))
        : menus[0];

    if (!selected) {
        throw new Error("Указанное внешнее меню iiko не найдено.");
    }

    const menu = await apiPost(serverUrl, "/api/2/menu/by_id", token, {
        externalMenuId: selected.id,
        organizationIds: [organizationId],
        priceCategoryId: priceCategoryId || null,
        version: 2
    });

    return { menu, externalMenu: selected };
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

        // IMPORTANT:
        // departmentId is deliberately ignored. A department UUID is not
        // automatically an organization UUID for the external-menu API.
        const requestedOrganizationId = String(body.organizationId || "").trim();
        const externalMenuId = body.externalMenuId ? String(body.externalMenuId) : "";
        const priceCategoryId = body.priceCategoryId ? String(body.priceCategoryId) : "";

        if (!ip || !port || !login || !password) {
            return jsonResponse({
                success: false,
                message: "Заполните IP, порт, логин и пароль iiko"
            }, 400);
        }

        const { serverUrl, token } = await auth(ip, port, login, password);

        const { organization, organizations } = await resolveOrganization(
            serverUrl,
            token,
            requestedOrganizationId
        );

        const { menu, externalMenu } = await getExternalMenu(
            serverUrl,
            token,
            organization.id,
            externalMenuId,
            priceCategoryId
        );

        const normalized = normalizeMenu(menu);

        return jsonResponse({
            success: true,
            source: "iiko-external-menu-v2",
            endpoint: "/api/2/menu/by_id",
            organizationId: organization.id,
            organization: {
                id: organization.id,
                name: organization.name,
                address: organization.address
            },
            organizations,
            externalMenu: {
                id: String(externalMenu.id),
                name: externalMenu.name || ""
            },
            categoryCount: normalized.categories.length,
            productCount: normalized.products.length,
            categories: normalized.categories,
            products: normalized.products,
            raw: menu
        });
    } catch (error) {
        return jsonResponse({
            success: false,
            message: error?.message || "Ошибка загрузки меню iiko"
        }, 502);
    }
}
