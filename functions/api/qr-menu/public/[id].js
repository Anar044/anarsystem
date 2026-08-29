const headers = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json"
};

export async function onRequestGet({ params, env }) {
  try {
    if (!env.DB) {
      return new Response(JSON.stringify({ success: false, message: "QR Menu storage не настроено." }), { status: 503, headers });
    }

    const id = String(params.id || "").trim();
    if (!id) return new Response(JSON.stringify({ success: false, message: "Не указан publicId." }), { status: 400, headers });

    const row = await env.DB.prepare(
      "SELECT organization_id, public_id, restaurant_name, menu_json, version, updated_at FROM qr_menus WHERE public_id = ?1"
    ).bind(id).first();

    if (!row) {
      return new Response(JSON.stringify({ success: false, message: "Публичное меню не найдено." }), { status: 404, headers });
    }

    let menu;
    try { menu = JSON.parse(row.menu_json); }
    catch { menu = { categories: [], dishes: [] }; }

    return new Response(JSON.stringify({
      success: true,
      restaurantName: row.restaurant_name,
      publicId: row.public_id,
      version: row.version,
      updatedAt: row.updated_at,
      menu
    }), { status: 200, headers });
  } catch (error) {
    return new Response(JSON.stringify({ success: false, message: error?.message || "Ошибка загрузки меню" }), { status: 500, headers });
  }
}
