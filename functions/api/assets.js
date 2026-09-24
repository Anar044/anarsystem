import { getUser, loadPrivateIikoState } from './iiko/_lib/user-state.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function num(v){const n=Number(v);return Number.isFinite(n)?n:0}
function int(v){const n=Math.trunc(Number(v));return Number.isFinite(n)?n:0}
function dateOnly(v){const s=clean(v).slice(0,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''}
function monthKey(v){const d=dateOnly(v);return d?d.slice(0,7):''}
function monthIndex(key){const [y,m]=String(key).split('-').map(Number);return Number.isFinite(y)&&Number.isFinite(m)?y*12+(m-1):null}
function monthFromIndex(i){const y=Math.floor(i/12),m=i-y*12+1;return`${y}-${String(m).padStart(2,'0')}`}
function isoNow(){return new Date().toISOString()}
function uuid(){return crypto.randomUUID()}

async function ensureTables(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS fixed_assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      restaurant_id TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT '',
      inventory_number TEXT NOT NULL DEFAULT '',
      serial_number TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      purchase_date TEXT NOT NULL DEFAULT '',
      in_service_date TEXT NOT NULL,
      purchase_cost REAL NOT NULL DEFAULT 0,
      salvage_value REAL NOT NULL DEFAULT 0,
      useful_life_months INTEGER NOT NULL,
      depreciation_method TEXT NOT NULL DEFAULT 'LINEAR',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      disposed_at TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fixed_assets_user_restaurant ON fixed_assets(user_id, restaurant_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fixed_asset_events (
      id TEXT PRIMARY KEY,
      asset_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_date TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      cost REAL NOT NULL DEFAULT 0,
      vendor TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY(asset_id) REFERENCES fixed_assets(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_fixed_asset_events_asset ON fixed_asset_events(user_id, asset_id, event_date)`)
  ]);
}

function collectRestaurantIds(state){
  const identity=state?.identity||{},connection=state?.connection||{};
  const values=[
    ...(Array.isArray(identity.departments)?identity.departments.map(x=>x?.id):[]),
    ...(Array.isArray(identity.organizations)?identity.organizations.map(x=>x?.id):[]),
    ...(Array.isArray(identity.departmentIds)?identity.departmentIds:[]),
    ...(Array.isArray(connection.departments)?connection.departments.map(x=>x?.id):[]),
    ...(Array.isArray(connection.organizations)?connection.organizations.map(x=>x?.id):[]),
    ...(Array.isArray(connection.departmentIds)?connection.departmentIds:[]),
    identity.organizationId,connection.organizationId
  ];
  return [...new Set(values.map(v=>clean(v)).filter(Boolean))];
}

async function allowedRestaurantIds(env,userId){
  if(!env?.DB)return[];
  const stored=await loadPrivateIikoState(env.DB,userId,env);
  return stored.found?collectRestaurantIds(stored.state):[];
}

function assetMath(asset,asOf=new Date().toISOString().slice(0,10)){
  const cost=Math.max(0,num(asset.purchase_cost));
  const salvage=Math.max(0,Math.min(cost,num(asset.salvage_value)));
  const life=Math.max(1,int(asset.useful_life_months));
  const base=Math.max(0,cost-salvage);
  const monthly=base/life;
  const start=monthIndex(monthKey(asset.in_service_date));
  const current=monthIndex(monthKey(asOf));
  const disposed=asset.disposed_at?monthIndex(monthKey(asset.disposed_at)):null;
  let months=0;
  if(start!==null&&current!==null&&current>=start){
    const lastByLife=start+life-1;
    const last=Math.min(current,lastByLife,disposed===null?lastByLife:disposed);
    months=Math.max(0,last-start+1);
  }
  const accumulated=Math.min(base,monthly*months);
  return{
    depreciableBase:base,
    monthlyDepreciation:monthly,
    accumulatedDepreciation:accumulated,
    bookValue:Math.max(salvage,cost-accumulated),
    depreciatedMonths:months,
    depreciationEndMonth:start===null?'':monthFromIndex(start+life-1)
  };
}

function depreciationForPeriod(asset,from,to){
  const start=monthIndex(monthKey(asset.in_service_date));
  const fromM=monthIndex(monthKey(from));
  const toM=monthIndex(monthKey(to));
  if(start===null||fromM===null||toM===null||toM<fromM)return 0;
  const life=Math.max(1,int(asset.useful_life_months));
  const end=start+life-1;
  const disposed=asset.disposed_at?monthIndex(monthKey(asset.disposed_at)):null;
  const effectiveEnd=Math.min(end,disposed===null?end:disposed);
  const first=Math.max(start,fromM),last=Math.min(effectiveEnd,toM);
  if(last<first)return 0;
  return assetMath(asset,to).monthlyDepreciation*(last-first+1);
}

function normalizeAsset(row){return{...row,...assetMath(row)}}

async function authContext(request,env){
  const auth=await getUser(request,env);
  if(!auth)return null;
  await ensureTables(env.DB);
  return auth;
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{
    const auth=await authContext(request,env);if(!auth)return json({success:false,message:'Требуется авторизация'},401);
    const assetsResult=await env.DB.prepare(`SELECT * FROM fixed_assets WHERE user_id=?1 ORDER BY status='ACTIVE' DESC, name COLLATE NOCASE`).bind(auth.user.id).all();
    const eventsResult=await env.DB.prepare(`SELECT * FROM fixed_asset_events WHERE user_id=?1 ORDER BY event_date DESC, created_at DESC`).bind(auth.user.id).all();
    return json({success:true,assets:(assetsResult.results||[]).map(normalizeAsset),events:eventsResult.results||[]});
  }catch(error){return json({success:false,message:error.message||String(error)},500)}
}

export async function onRequestPost({request,env}){
  try{
    const auth=await authContext(request,env);if(!auth)return json({success:false,message:'Требуется авторизация'},401);
    const b=await request.json().catch(()=>({}));
    const action=clean(b.action||'saveAsset');
    const userId=auth.user.id;
    const allowedRestaurants=await allowedRestaurantIds(env,userId);
    const allowedRestaurantSet=new Set(allowedRestaurants);

    if(action==='depreciation'){
      const from=dateOnly(b.from),to=dateOnly(b.to||b.from);
      if(!from||!to||from>to)return json({success:false,message:'Укажите корректный период'},400);
      const requested=Array.isArray(b.restaurantIds)?[...new Set(b.restaurantIds.map(clean).filter(Boolean))]:[];
      if(!allowedRestaurants.length)return json({success:false,message:'Для аккаунта не настроены доступные рестораны.'},403);
      const invalid=requested.filter(id=>!allowedRestaurantSet.has(id));
      if(invalid.length)return json({success:false,message:'Запрошен ресторан, который не принадлежит текущему аккаунту.'},403);
      const effective=requested.length?requested:allowedRestaurants;
      let sql=`SELECT * FROM fixed_assets WHERE user_id=?1 AND status<>'DRAFT'`;
      const binds=[userId];
      if(effective.length){sql+=` AND restaurant_id IN (${effective.map((_,i)=>`?${i+2}`).join(',')})`;binds.push(...effective)}
      const result=await env.DB.prepare(sql).bind(...binds).all();
      const items=(result.results||[]).map(asset=>{const amount=depreciationForPeriod(asset,from,to);return{id:asset.id,name:asset.name,restaurantId:asset.restaurant_id,amount,monthlyDepreciation:assetMath(asset,to).monthlyDepreciation}}).filter(x=>x.amount>0.000001);
      return json({success:true,from,to,total:items.reduce((s,x)=>s+x.amount,0),items});
    }

    if(action==='saveAsset'){
      const id=clean(b.id)||uuid();
      const restaurantId=clean(b.restaurantId);
      const name=clean(b.name);
      const purchaseCost=Math.max(0,num(b.purchaseCost));
      const salvageValue=Math.max(0,num(b.salvageValue));
      const life=Math.max(1,int(b.usefulLifeMonths));
      const inService=dateOnly(b.inServiceDate);
      if(!restaurantId||!name||!inService)return json({success:false,message:'Укажите ресторан, название и дату ввода в эксплуатацию'},400);
      if(!allowedRestaurants.length)return json({success:false,message:'Для аккаунта не настроены доступные рестораны.'},403);
      if(!allowedRestaurantSet.has(restaurantId))return json({success:false,message:'Выбранный ресторан не принадлежит текущему аккаунту.'},403);
      if(salvageValue>purchaseCost)return json({success:false,message:'Ликвидационная стоимость не может быть выше стоимости покупки'},400);
      const existing=await env.DB.prepare(`SELECT id FROM fixed_assets WHERE id=?1 AND user_id=?2`).bind(id,userId).first();
      const now=isoNow();
      const values={
        id,userId,restaurantId,name,category:clean(b.category),inventoryNumber:clean(b.inventoryNumber),serialNumber:clean(b.serialNumber),location:clean(b.location),
        purchaseDate:dateOnly(b.purchaseDate),inServiceDate:inService,purchaseCost,salvageValue,usefulLifeMonths:life,depreciationMethod:'LINEAR',
        status:['ACTIVE','REPAIR','DISPOSED','SOLD'].includes(clean(b.status).toUpperCase())?clean(b.status).toUpperCase():'ACTIVE',disposedAt:dateOnly(b.disposedAt),notes:clean(b.notes)
      };
      if(existing){
        await env.DB.prepare(`UPDATE fixed_assets SET restaurant_id=?1,name=?2,category=?3,inventory_number=?4,serial_number=?5,location=?6,purchase_date=?7,in_service_date=?8,purchase_cost=?9,salvage_value=?10,useful_life_months=?11,depreciation_method='LINEAR',status=?12,disposed_at=?13,notes=?14,updated_at=?15 WHERE id=?16 AND user_id=?17`)
          .bind(values.restaurantId,values.name,values.category,values.inventoryNumber,values.serialNumber,values.location,values.purchaseDate,values.inServiceDate,values.purchaseCost,values.salvageValue,values.usefulLifeMonths,values.status,values.disposedAt,values.notes,now,id,userId).run();
      }else{
        await env.DB.prepare(`INSERT INTO fixed_assets(id,user_id,restaurant_id,name,category,inventory_number,serial_number,location,purchase_date,in_service_date,purchase_cost,salvage_value,useful_life_months,depreciation_method,status,disposed_at,notes,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,'LINEAR',?14,?15,?16,?17,?17)`)
          .bind(id,userId,values.restaurantId,values.name,values.category,values.inventoryNumber,values.serialNumber,values.location,values.purchaseDate,values.inServiceDate,values.purchaseCost,values.salvageValue,values.usefulLifeMonths,values.status,values.disposedAt,values.notes,now).run();
      }
      const row=await env.DB.prepare(`SELECT * FROM fixed_assets WHERE id=?1 AND user_id=?2`).bind(id,userId).first();
      return json({success:true,asset:normalizeAsset(row)});
    }

    if(action==='deleteAsset'){
      const id=clean(b.id);if(!id)return json({success:false,message:'Не указан актив'},400);
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM fixed_asset_events WHERE asset_id=?1 AND user_id=?2`).bind(id,userId),
        env.DB.prepare(`DELETE FROM fixed_assets WHERE id=?1 AND user_id=?2`).bind(id,userId)
      ]);
      return json({success:true});
    }

    if(action==='addEvent'){
      const assetId=clean(b.assetId),eventDate=dateOnly(b.eventDate),eventType=clean(b.eventType).toUpperCase();
      if(!assetId||!eventDate)return json({success:false,message:'Укажите актив и дату события'},400);
      const asset=await env.DB.prepare(`SELECT id FROM fixed_assets WHERE id=?1 AND user_id=?2`).bind(assetId,userId).first();
      if(!asset)return json({success:false,message:'Актив не найден'},404);
      const id=uuid();
      await env.DB.prepare(`INSERT INTO fixed_asset_events(id,asset_id,user_id,event_type,event_date,title,description,cost,vendor,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`)
        .bind(id,assetId,userId,eventType||'NOTE',eventDate,clean(b.title),clean(b.description),Math.max(0,num(b.cost)),clean(b.vendor),isoNow()).run();
      const event=await env.DB.prepare(`SELECT * FROM fixed_asset_events WHERE id=?1 AND user_id=?2`).bind(id,userId).first();
      return json({success:true,event});
    }

    if(action==='deleteEvent'){
      const id=clean(b.id);if(!id)return json({success:false,message:'Не указано событие'},400);
      await env.DB.prepare(`DELETE FROM fixed_asset_events WHERE id=?1 AND user_id=?2`).bind(id,userId).run();
      return json({success:true});
    }

    return json({success:false,message:'Неизвестное действие'},400);
  }catch(error){return json({success:false,message:error.message||String(error)},500)}
}
