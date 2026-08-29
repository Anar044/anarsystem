const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers });
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.DB) {
      return json({
        success: false,
        code: "QR_MENU_DB_NOT_CONFIGURED",
        message: "QR Menu server storage не настроено. В Cloudflare Pages подключите D1 binding с именем DB."
      }, 503);
    }

    const body = await request.json();
    const organizationId = String(body.organizationId || "").trim();
    const restaurantName = String(body.restaurantName || "Мой ресторан").trim() || "Мой ресторан";
    const menu = body.menu;

    if (!organizationId) {
      return json({ success: false, message: "Не найден ID организации iiko." }, 400);
    }
    if (!menu || !Array.isArray(menu.categories) || !Array.isArray(menu.dishes)) {
      return json({ success: false, message: "Некорректные данные QR Menu." }, 400);
    }

    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS qr_menus (
        organization_id TEXT PRIMARY KEY,
        public_id TEXT UNIQUE NOT NULL,
        restaurant_name TEXT NOT NULL,
        menu_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL
      )
    `).run();

    const existing = await env.DB.prepare(
      "SELECT public_id, version FROM qr_menus WHERE organization_id = ?1"
    ).bind(organizationId).first();

    const publicId = existing?.public_id || crypto.randomUUID();
    const version = Number(existing?.version || 0) + 1;
    const updatedAt = new Date().toISOString();

    await env.DB.prepare(`
      INSERT INTO qr_menus (organization_id, public_id, restaurant_name, menu_json, version, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(organization_id) DO UPDATE SET
        public_id=excluded.public_id,
        restaurant_name=excluded.restaurant_name,
        menu_json=excluded.menu_json,
        version=excluded.version,
        updated_at=excluded.updated_at
    `).bind(
      organizationId,
      publicId,
      restaurantName,
      JSON.stringify(menu),
      version,
      updatedAt
    ).run();

    const origin = new URL(request.url).origin;
    const publicUrl = `${origin}/menu.html?id=${encodeURIComponent(publicId)}`;

    return json({
      success: true,
      publicId,
      publicUrl,
      version,
      updatedAt
    });
  } catch (error) {
    return json({
      success: false,
      message: error?.message || "Ошибка публикации QR Menu"
    }, 500);
  }
}
