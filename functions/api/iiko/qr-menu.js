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
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function stripXml(value) {
    return String(value || "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/<[^>]+>/g, "")
        .trim();
}

function xmlChild(block, name) {
    const m = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
    return m ? stripXml(m[1]) : "";
}

function attr(tag, name) {
    const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i"));
    return m ? stripXml(m[1]) : "";
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

async function requestText(serverUrl, token, path) {
    const url = `${serverUrl}${path}${path.includes("?") ? "&" : "?"}key=${encodeURIComponent(token)}`;
    const r = await fetch(url, { headers: { Accept: "application/json, application/xml, text/xml" } });
    const text = (await r.text()).trim();
    if (!r.ok) throw new Error(`iiko API ${path}: HTTP ${r.status}`);
    return text;
}

function normalizeArray(payload, keys = []) {
    if (Array.isArray(payload)) return payload;
    for (const key of keys) if (Array.isArray(payload?.[key])) return payload[key];
    return [];
}

function isSellable(item) {
    if (!item || typeof item !== "object") return false;
    if (item.deleted === true) return false;
    if (item.active === false) return false;
    if (item.isDeleted === true) return false;
    if (item.isActive === false) return false;
    if (item.available === false) return false;
    if (item.inStopList === true) return false;
    if (item.stopList === true) return false;
    if (item.isStopList === true) return false;
    return true;
}

function normalizeExternalMenuJson(payload) {
    const menus = normalizeArray(payload, ["menus", "externalMenus"]);
    const source = menus.length === 1 ? menus[0] : payload;
    const groups = normalizeArray(source, ["groups", "categories", "items", "menuItems"]);
    const outCategories = [];
    const outProducts = [];

    for (const group of groups) {
        if (!group || typeof group !== "object") continue;
        const categoryId = String(group.id || group.groupId || group.categoryId || crypto.randomUUID());
        const categoryName = String(group.name || group.groupName || group.categoryName || "Без категории");
        const products = normalizeArray(group, ["items", "products", "dishes", "productsAndSizes"]);
        if (!products.length && (group.productId || group.itemId)) {
            products.push(group);
        }
        const sellable = products.filter(isSellable);
        if (!sellable.length) continue;
        outCategories.push({ id: categoryId, name: categoryName, sortOrder: group.order ?? group.sortOrder ?? 0 });
        for (const p of sellable) {
            const id = String(p.id || p.productId || p.itemId || "");
            if (!id) continue;
            const prices = normalizeArray(p, ["prices", "price", "sizePrices"]);
            let price = p.price ?? p.defaultPrice ?? p.cost ?? null;
            if (Array.isArray(p.prices) && p.prices.length) price = p.prices[0]?.price ?? p.prices[0]?.value ?? price;
            outProducts.push({
                id,
                name: String(p.name || p.productName || p.itemName || id),
                description: String(p.description || p.ingredients || p.composition || ""),
                categoryId,
                price: price == null ? null : Number(price),
                image: p.image || p.imageUrl || p.imageURL || null,
                sortOrder: p.order ?? p.sortOrder ?? 0,
                sizes: prices.map(s => ({ id: s?.id || null, name: s?.name || s?.sizeName || "", price: s?.price ?? s?.value ?? null }))
            });
        }
    }

    outCategories.sort((a,b) => Number(a.sortOrder)-Number(b.sortOrder));
    outProducts.sort((a,b) => Number(a.sortOrder)-Number(b.sortOrder));
    return { categories: outCategories, products: outProducts };
}

function normalizeNomenclatureJson(payload) {
    const products = normalizeArray(payload, ["products", "items", "productItems"]);
    const groups = normalizeArray(payload, ["groups", "categories", "productGroups"]);
    const categories = groups.map(g => ({ id:String(g.id || ""), name:String(g.name || "Без категории"), sortOrder:Number(g.order ?? g.sortOrder ?? 0) })).filter(x => x.id);
    const categoryByProduct = new Map();
    for (const p of products) {
        const gid = p.parentGroup || p.groupId || p.productGroupId || p.categoryId;
        if (gid) categoryByProduct.set(String(p.id), String(gid));
    }
    const outProducts = products.filter(isSellable).map(p => {
        const id = String(p.id || "");
        const categoryId = categoryByProduct.get(id) || String(p.parentGroup || p.groupId || p.categoryId || "ungrouped");
        return { id, name:String(p.name || id), description:String(p.description || p.ingredients || p.composition || ""), categoryId, price:p.price == null ? null : Number(p.price), image:p.image || p.imageUrl || null, sortOrder:Number(p.order ?? p.sortOrder ?? 0) };
    }).filter(p => p.id);
    const known = new Set(categories.map(c => c.id));
    for (const p of outProducts) if (!known.has(p.categoryId)) categories.push({id:p.categoryId,name:"Без категории",sortOrder:9999});
    return { categories, products:outProducts, source:"nomenclature" };
}

async function getMenu(serverUrl, token) {
    const candidates = [
        "/resto/api/menus",
        "/resto/api/menu",
        "/resto/api/externalMenu",
        "/resto/api/externalMenus"
    ];
    const errors = [];
    for (const path of candidates) {
        try {
            const text = await requestText(serverUrl, token, path);
            if (!text) continue;
            try {
                const json = JSON.parse(text);
                const normalized = normalizeExternalMenuJson(json);
                if (normalized.products.length || normalized.categories.length) return { ...normalized, endpoint:path };
                const nom = normalizeNomenclatureJson(json);
                if (nom.products.length || nom.categories.length) return { ...nom, endpoint:path };
            } catch {
                const categoryMatches = [...text.matchAll(/<(group|category|item)\\b([^>]*)>([\\s\\S]*?)<\\/\\1>/gi)];
                const products = [];
                for (const m of categoryMatches) {
                    const tag = `<${m[1]} ${m[2]}>`, block = m[3];
                    const cid = attr(tag, "id") || `cat_${products.length}`;
                    const cname = attr(tag, "name") || xmlChild(block, "name") || "Без категории";
                    const itemMatches = [...block.matchAll(/<(product|item)\\b([^>]*)>([\\s\\S]*?)<\\/\\1>/gi)];
                    const catProducts = itemMatches.map(im => {
                        const itag=`<${im[1]} ${im[2]}>`, ib=im[3];
                        const id=attr(itag,"id") || xmlChild(ib,"id");
                        return {id,name:attr(itag,"name")||xmlChild(ib,"name"),description:xmlChild(ib,"description")||xmlChild(ib,"ingredients")||"",categoryId:cid,price:Number(attr(itag,"price")||xmlChild(ib,"price")||0),image:xmlChild(ib,"image")||null,sortOrder:Number(attr(itag,"order")||0)};
                    }).filter(p=>p.id);
                    if (catProducts.length) products.push(...catProducts), errors.push({categoryId:cid,name:cname,count:catProducts.length});
                }
                if (products.length) return {categories:[...new Map(errors.map(x=>[x.categoryId,{id:x.categoryId,name:x.name,sortOrder:0}])).values()],products,endpoint:path};
            }
        } catch (e) { errors.push({ path, error:e.message }); }
    }
    throw new Error("Не удалось получить меню через iiko Server API. Проверьте версию iiko и endpoint внешнего меню.");
}

export async function onRequestOptions() {
    return new Response(null, { status:204, headers:corsHeaders() });
}

export async function onRequestPost(context) {
    try {
        const body = await context.request.json();
        const ip = String(body.ip || "").trim();
        const port = String(body.port || "").trim();
        const login = String(body.login || "").trim();
        const password = String(body.password || "");
        if (!ip || !port || !login || !password) return jsonResponse({success:false,message:"Заполните IP, порт, логин и пароль iiko"},400);
        const {serverUrl,token} = await auth(ip,port,login,password);
        const menu = await getMenu(serverUrl,token);
        return jsonResponse({success:true,source:menu.source || "external-menu",endpoint:menu.endpoint,categoryCount:menu.categories.length,productCount:menu.products.length,categories:menu.categories,products:menu.products});
    } catch (error) {
        return jsonResponse({success:false,message:error.message},502);
    }
}
