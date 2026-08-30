const headers = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
function json(data, status = 200) { return new Response(JSON.stringify(data), { status, headers }); }
export async function onRequestGet({ request, env }) {
  try {
    if (!env.DB) return json({ success:false, message:"QR Menu DB binding DB не настроен." },503);
    const parts = new URL(request.url).pathname.split("/").filter(Boolean);
    const publicId = decodeURIComponent(parts[parts.length - 1] || "").trim();
    if (!publicId || publicId === "public") return json({success:false,message:"Не указан ID меню."},400);
    const menu = await env.DB.prepare(`SELECT id, organization_id, restaurant_name, public_slug, is_published, updated_at, published_at FROM qr_menus WHERE public_slug = ?1 AND is_published = 1 LIMIT 1`).bind(publicId).first();
    if (!menu) return json({success:false,message:"Опубликованное меню не найдено."},404);
    const cats = await env.DB.prepare(`SELECT id,name,sort_order FROM qr_categories WHERE menu_id=?1 ORDER BY sort_order ASC,name ASC`).bind(menu.id).all();
    const dishes = await env.DB.prepare(`SELECT id,category_id,iiko_id,name,description,composition,price,currency,photo_url,sort_order,is_available FROM qr_dishes WHERE menu_id=?1 AND is_available=1 ORDER BY sort_order ASC,name ASC`).bind(menu.id).all();
    return json({
      success:true,
      publicId:menu.public_slug,
      organizationId:menu.organization_id,
      restaurantName:menu.restaurant_name,
      updatedAt:menu.updated_at,
      publishedAt:menu.published_at,
      menu:{
        categories:(cats.results||[]).map(c=>({id:c.id,name:c.name,sortOrder:Number(c.sort_order||0)})),
        dishes:(dishes.results||[]).map(d=>({id:d.id,iikoId:d.iiko_id,cat:d.category_id,name:d.name,desc:d.description||d.composition||"",composition:d.composition||"",price:Number(d.price||0),currency:d.currency||"AZN",photo:d.photo_url||"",sortOrder:Number(d.sort_order||0)}))
      }
    });
  } catch(error) { return json({success:false,message:error?.message||"Ошибка загрузки меню."},500); }
}
