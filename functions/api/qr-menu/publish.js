import { loadRequestIikoState } from '../iiko/_lib/user-state.js';

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json"
};

function json(data, status=200){
  return new Response(JSON.stringify(data),{status,headers});
}

function clean(value){
  return String(value ?? "").trim();
}

function uniq(values){
  return [...new Set((values || []).map(clean).filter(Boolean))];
}

function restaurantScope(state){
  const identity=state?.identity&&typeof state.identity==='object'?state.identity:{};
  const connection=state?.connection&&typeof state.connection==='object'?state.connection:{};
  const restaurants=[];
  const add=(id,name='')=>{
    id=clean(id);
    if(!id||restaurants.some(x=>x.id===id))return;
    restaurants.push({id,name:clean(name)||id});
  };

  for(const x of Array.isArray(identity.organizations)?identity.organizations:[]) add(x?.id,x?.name||x?.code);
  for(const x of Array.isArray(identity.departments)?identity.departments:[]) add(x?.id,x?.name||x?.code);
  for(const x of Array.isArray(connection.organizations)?connection.organizations:[]) add(x?.id,x?.name||x?.code);
  for(const x of Array.isArray(connection.departments)?connection.departments:[]) add(x?.id,x?.name||x?.code);
  for(const id of Array.isArray(identity.departmentIds)?identity.departmentIds:[]) add(id);
  for(const id of Array.isArray(connection.departmentIds)?connection.departmentIds:[]) add(id);
  add(identity.organizationId,identity.restaurantName||identity.displayName);
  add(connection.organizationId,connection.restaurantName||connection.displayName);

  return {identity,connection,restaurants};
}

function resolveRestaurant(state,requestedIds){
  const scope=restaurantScope(state);
  const allowedIds=new Set(scope.restaurants.map(x=>x.id));
  const requested=uniq(requestedIds);

  if(requested.length){
    const invalid=requested.filter(id=>!allowedIds.has(id));
    if(invalid.length){
      const error=new Error('Выбранный ресторан не принадлежит текущему подключению SH Server.');
      error.status=403;
      throw error;
    }
  }

  const preferred=requested[0]
    || clean(scope.identity.organizationId)
    || clean(scope.connection.organizationId)
    || scope.restaurants[0]?.id
    || '';
  const restaurant=scope.restaurants.find(x=>x.id===preferred)||null;
  return {
    organizationId:preferred,
    restaurantName:restaurant?.name
      || clean(scope.identity.restaurantName)
      || clean(scope.identity.displayName)
      || clean(scope.connection.restaurantName)
      || clean(scope.connection.displayName)
      || 'Мой ресторан',
    allowedIds:[...allowedIds]
  };
}

export async function onRequestOptions(){
  return new Response(null,{status:204,headers});
}

async function runBatch(db, statements, chunkSize=100){
  for(let i=0;i<statements.length;i+=chunkSize){
    const chunk=statements.slice(i,i+chunkSize);
    if(chunk.length) await db.batch(chunk);
  }
}

export async function onRequestPost({request,env}){
  try{
    if(!env.DB) return json({success:false,code:"QR_MENU_DB_NOT_CONFIGURED",message:"D1 binding DB не настроен."},503);

    const stored=await loadRequestIikoState(request,env);
    if(!stored?.user?.id) return json({success:false,message:"Требуется авторизация пользователя."},401);
    if(!stored.found||!stored.state) return json({success:false,message:"Подключение SH Server не сохранено в D1."},400);

    const body=await request.json();
    const menu=body.menu;
    if(!menu||!Array.isArray(menu.categories)||!Array.isArray(menu.dishes)){
      return json({success:false,message:"Некорректные данные QR Menu."},400);
    }

    const resolved=resolveRestaurant(stored.state,Array.isArray(body.departmentIds)?body.departmentIds:[]);
    const organizationId=resolved.organizationId;
    if(!organizationId) return json({success:false,message:"Не найден ID ресторана в сохранённом подключении SH Server."},400);
    const restaurantName=clean(body.restaurantName)||resolved.restaurantName||"Мой ресторан";

    const now=new Date().toISOString();
    const existing=await env.DB.prepare(
      `SELECT id,public_slug FROM qr_menus WHERE organization_id=?1 LIMIT 1`
    ).bind(organizationId).first();

    const menuId=existing?.id || crypto.randomUUID();
    const publicSlug=existing?.public_slug || crypto.randomUUID();
    const design=menu.design&&typeof menu.design==='object'?menu.design:{};

    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS qr_menu_settings (menu_id TEXT PRIMARY KEY, design_json TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL)`
    ).run();

    await env.DB.batch([
      env.DB.prepare(`INSERT INTO qr_menus(id,organization_id,restaurant_name,public_slug,is_published,created_at,updated_at,published_at) VALUES(?1,?2,?3,?4,1,?5,?5,?5) ON CONFLICT(organization_id) DO UPDATE SET restaurant_name=excluded.restaurant_name,public_slug=excluded.public_slug,is_published=1,updated_at=excluded.updated_at,published_at=excluded.published_at`).bind(menuId,organizationId,restaurantName,publicSlug,now),
      env.DB.prepare(`INSERT INTO qr_menu_settings(menu_id,design_json,updated_at) VALUES(?1,?2,?3) ON CONFLICT(menu_id) DO UPDATE SET design_json=excluded.design_json,updated_at=excluded.updated_at`).bind(menuId,JSON.stringify(design),now),
      env.DB.prepare(`DELETE FROM qr_dishes WHERE menu_id=?1`).bind(menuId),
      env.DB.prepare(`DELETE FROM qr_categories WHERE menu_id=?1`).bind(menuId)
    ]);

    const categories=menu.categories.filter(c=>c&&c.id).map((c,i)=>({
      id:`${menuId}:cat:${String(c.id)}`,
      originalId:String(c.id),
      name:String(c.name||"Без категории"),
      sortOrder:Number(c.sortOrder??c.sort_order??i)
    }));

    const categoryMap=new Map(categories.map(c=>[c.originalId,c.id]));

    const categoryStatements=categories.map(c=>
      env.DB.prepare(`INSERT INTO qr_categories(id,menu_id,name,sort_order) VALUES(?1,?2,?3,?4)`)
        .bind(c.id,menuId,c.name,c.sortOrder)
    );
    await runBatch(env.DB,categoryStatements,100);

    let photoCount=0;
    const dishStatements=[];

    for(const [i,d] of menu.dishes.entries()){
      if(!d||!d.name) continue;

      const originalCat=String(d.cat||d.iikoCategoryId||"");
      const categoryId=categoryMap.get(originalCat)||null;
      const sourceDishId=String(d.iikoId||d.id||i);
      // qr_dishes.id is an internal row key, not the iiko product identity.
      // Include the current position so duplicated source ids cannot violate
      // the D1 PRIMARY KEY. The real iiko/local id remains in iiko_id below.
      const dishId=`${menuId}:dish:${i}:${sourceDishId}`;
      const imageCandidate=String(d.photo||d.photo_url||"").trim();
      const frontImageCandidate=String(d.frontImageId||"").trim();
      const photoUrl=imageCandidate || (frontImageCandidate.startsWith("data:image/") ? frontImageCandidate : "");
      if(photoUrl) photoCount+=1;

      dishStatements.push(
        env.DB.prepare(`INSERT INTO qr_dishes(id,menu_id,category_id,iiko_id,name,description,composition,price,currency,photo_url,sort_order,is_available,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,1,?12,?12)`)
          .bind(
            dishId,
            menuId,
            categoryId,
            sourceDishId,
            String(d.name),
            String(d.desc||d.description||""),
            String(d.composition||d.desc||""),
            Number(d.price||0),
            String(d.currency||"AZN"),
            photoUrl,
            Number(d.sortOrder??i),
            now
          )
      );
    }

    await runBatch(env.DB,dishStatements,100);

    const origin=new URL(request.url).origin;
    const publicUrl=`${origin}/menu.html?id=${encodeURIComponent(publicSlug)}`;

    return json({
      success:true,
      publicId:publicSlug,
      publicUrl,
      organizationId,
      updatedAt:now,
      photoCount,
      categoryCount:categories.length,
      dishCount:dishStatements.length
    });
  }catch(error){
    return json({success:false,message:error?.message||"Ошибка публикации QR Menu"},Number(error?.status)||500);
  }
}
