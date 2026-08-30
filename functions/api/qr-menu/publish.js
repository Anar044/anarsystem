const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json"
};
function json(data, status=200){ return new Response(JSON.stringify(data),{status,headers}); }
export async function onRequestOptions(){ return new Response(null,{status:204,headers}); }

export async function onRequestPost({request,env}){
  try{
    if(!env.DB) return json({success:false,code:"QR_MENU_DB_NOT_CONFIGURED",message:"D1 binding DB не настроен."},503);
    const body=await request.json();
    const organizationId=String(body.organizationId||"").trim();
    const restaurantName=String(body.restaurantName||"Мой ресторан").trim()||"Мой ресторан";
    const menu=body.menu;
    if(!organizationId) return json({success:false,message:"Не найден ID организации iiko."},400);
    if(!menu||!Array.isArray(menu.categories)||!Array.isArray(menu.dishes)) return json({success:false,message:"Некорректные данные QR Menu."},400);

    const now=new Date().toISOString();
    const existing=await env.DB.prepare(`SELECT id,public_slug FROM qr_menus WHERE organization_id=?1 LIMIT 1`).bind(organizationId).first();
    const menuId=existing?.id || crypto.randomUUID();
    const publicSlug=existing?.public_slug || crypto.randomUUID();

    await env.DB.prepare(`INSERT INTO qr_menus(id,organization_id,restaurant_name,public_slug,is_published,created_at,updated_at,published_at) VALUES(?1,?2,?3,?4,1,?5,?5,?5) ON CONFLICT(organization_id) DO UPDATE SET restaurant_name=excluded.restaurant_name,public_slug=excluded.public_slug,is_published=1,updated_at=excluded.updated_at,published_at=excluded.published_at`).bind(menuId,organizationId,restaurantName,publicSlug,now).run();
    await env.DB.prepare(`DELETE FROM qr_dishes WHERE menu_id=?1`).bind(menuId).run();
    await env.DB.prepare(`DELETE FROM qr_categories WHERE menu_id=?1`).bind(menuId).run();

    const categories=menu.categories.filter(c=>c&&c.id).map((c,i)=>({
      id:`${menuId}:cat:${String(c.id)}`,
      name:String(c.name||"Без категории"),
      sortOrder:Number(c.sortOrder??c.sort_order??i)
    }));
    const categoryMap=new Map(categories.map(c=>[String(c.id).replace(`${menuId}:cat:`,""),c.id]));

    for(const c of categories){
      await env.DB.prepare(`INSERT INTO qr_categories(id,menu_id,name,sort_order) VALUES(?1,?2,?3,?4)`).bind(c.id,menuId,c.name,c.sortOrder).run();
    }

    for(const [i,d] of menu.dishes.entries()){
      if(!d||!d.name) continue;
      const originalCat=String(d.cat||d.iikoCategoryId||"");
      const categoryId=categoryMap.get(originalCat)||null;
      const dishId=`${menuId}:dish:${String(d.iikoId||d.id||i)}`;
      await env.DB.prepare(`INSERT INTO qr_dishes(id,menu_id,category_id,iiko_id,name,description,composition,price,currency,photo_url,sort_order,is_available,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,1,?12,?12)`).bind(dishId,menuId,categoryId,String(d.iikoId||d.id||""),String(d.name),String(d.desc||d.description||""),String(d.composition||d.desc||""),Number(d.price||0),String(d.currency||"AZN"),String(d.photo||d.photo_url||""),Number(d.sortOrder??i),now).run();
    }

    const origin=new URL(request.url).origin;
    const publicUrl=`${origin}/menu.html?id=${encodeURIComponent(publicSlug)}`;
    return json({success:true,publicId:publicSlug,publicUrl,organizationId,updatedAt:now});
  }catch(error){ return json({success:false,message:error?.message||"Ошибка публикации QR Menu"},500); }
}
