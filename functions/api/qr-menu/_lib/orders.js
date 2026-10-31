import {loadRequestIikoState} from '../../iiko/_lib/user-state.js';
import {resolveHrRestaurantScope} from '../../hr/_lib/restaurant-scope.js';
import {hasPermission} from '../../access/_lib/access-control.js';

export const clean=(v,n=180)=>String(v??'').trim().slice(0,n);
export const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
}});
export const bad=(status,code,message)=>response({success:false,code,message},status);
export const fail=(code,message,status=400)=>Object.assign(new Error(message),{status,code});
export function token(bytes=24){
  const b=crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map(n=>n.toString(16).padStart(2,'0')).join('');
}
const iso=()=>new Date().toISOString();
const cents=n=>{
  const x=Number(n);
  if(!Number.isFinite(x)||x<0||x>1000000||Math.abs(x*100-Math.round(x*100))>1e-5)
    throw fail('INVALID_MENU_PRICE','Некорректная цена позиции в опубликованном меню',409);
  return Math.round(x*100);
};
export const ALLOWED_ORDER_MODES=new Set(['TABLE','FAST_FOOD']);
const ORDERS_SCHEMA_READY=new WeakMap();
export async function ensureOrders(db){
  if(!db)throw fail('QR_ORDER_DB_UNAVAILABLE','База D1 не подключена',503);
  const cached=ORDERS_SCHEMA_READY.get(db);if(cached)return cached;
  const initialization=db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS qr_order_settings (
      owner_id TEXT NOT NULL,menu_id TEXT NOT NULL,restaurant_id TEXT NOT NULL,
      service_mode TEXT NOT NULL DEFAULT 'TABLE',ordering_enabled INTEGER NOT NULL DEFAULT 0,
      auto_enabled_at TEXT NOT NULL DEFAULT '',
      pos_plugin_id TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      PRIMARY KEY(menu_id),CHECK(service_mode IN ('TABLE','FAST_FOOD'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS qr_order_tables (
      owner_id TEXT NOT NULL,menu_id TEXT NOT NULL,id TEXT NOT NULL,
      table_label TEXT NOT NULL,table_key TEXT NOT NULL,pos_table_id TEXT NOT NULL DEFAULT '',
      active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      PRIMARY KEY(menu_id,id),UNIQUE(menu_id,table_key),UNIQUE(menu_id,table_label)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS qr_pos_table_snapshots (
      restaurant_id TEXT NOT NULL,plugin_id TEXT NOT NULL,table_count INTEGER NOT NULL,
      tables_json TEXT NOT NULL,last_seen_at TEXT NOT NULL,
      PRIMARY KEY(restaurant_id,plugin_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS qr_guest_orders (
      id TEXT PRIMARY KEY,owner_id TEXT NOT NULL,menu_id TEXT NOT NULL,restaurant_id TEXT NOT NULL,
      public_slug TEXT NOT NULL,client_key TEXT NOT NULL,request_digest TEXT NOT NULL,
      receipt_token TEXT UNIQUE NOT NULL,table_id TEXT NOT NULL DEFAULT '',
      table_label TEXT NOT NULL DEFAULT '',pos_table_id TEXT NOT NULL DEFAULT '',
      service_mode TEXT NOT NULL,items_json TEXT NOT NULL,
      total_minor INTEGER NOT NULL,currency TEXT NOT NULL DEFAULT 'AZN',
      guest_note TEXT NOT NULL DEFAULT '',origin_hash TEXT NOT NULL DEFAULT '',state TEXT NOT NULL DEFAULT 'AWAITING_POS',
      kitchen_status TEXT NOT NULL DEFAULT 'NOT_SENT',kitchen_updated_at TEXT NOT NULL DEFAULT '',
      payment_state TEXT NOT NULL DEFAULT 'UNPAID',payment_method TEXT NOT NULL DEFAULT 'PAY_AT_POS',
      payment_intent_id TEXT NOT NULL DEFAULT '',
      pos_plugin_id TEXT NOT NULL DEFAULT '',pos_order_id TEXT NOT NULL DEFAULT '',
      pos_order_number TEXT NOT NULL DEFAULT '',
      pos_receipt_number TEXT NOT NULL DEFAULT '',fiscal_reference TEXT NOT NULL DEFAULT '',
      rrn TEXT NOT NULL DEFAULT '',last_error TEXT NOT NULL DEFAULT '',
      lease_until TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
      UNIQUE(menu_id,client_key)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS qr_pos_bridge_capabilities (
      restaurant_id TEXT NOT NULL,plugin_id TEXT NOT NULL,contract_version INTEGER NOT NULL,
      can_create_order INTEGER NOT NULL DEFAULT 0,can_ack_fiscal INTEGER NOT NULL DEFAULT 0,
      can_print_kitchen INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL,PRIMARY KEY(restaurant_id,plugin_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_qr_orders_restaurant ON qr_guest_orders(owner_id,restaurant_id,created_at DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_qr_orders_pos ON qr_guest_orders(restaurant_id,pos_plugin_id,state,lease_until)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS qr_order_events (
      id TEXT PRIMARY KEY,order_id TEXT NOT NULL,owner_id TEXT NOT NULL,
      event_type TEXT NOT NULL,actor TEXT NOT NULL,details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_qr_order_events_order ON qr_order_events(order_id,created_at)`)
  ]).then(async()=>{
    // Safe additive migration for staging D1 databases created by an earlier draft.
    const columns=async table=>new Set(((await db.prepare('PRAGMA table_info('+table+')').all()).results||[])
      .map(row=>String(row.name)));
    const settingsColumns=await columns('qr_order_settings');
    if(!settingsColumns.has('auto_enabled_at'))
      await db.prepare("ALTER TABLE qr_order_settings ADD COLUMN auto_enabled_at TEXT NOT NULL DEFAULT ''").run();
    const orderColumns=await columns('qr_guest_orders');
    if(!orderColumns.has('payment_intent_id'))
      await db.prepare("ALTER TABLE qr_guest_orders ADD COLUMN payment_intent_id TEXT NOT NULL DEFAULT ''").run();
    // A partial unique index allows legacy PAY_AT_POS rows (empty value) while
    // ensuring a Payriff intent never creates two POS orders.
    await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_one_order_per_paid_intent ON qr_guest_orders(payment_intent_id) WHERE payment_intent_id<>''").run();
    if(!orderColumns.has('kitchen_status'))
      await db.prepare("ALTER TABLE qr_guest_orders ADD COLUMN kitchen_status TEXT NOT NULL DEFAULT 'NOT_SENT'").run();
    if(!orderColumns.has('kitchen_updated_at'))
      await db.prepare("ALTER TABLE qr_guest_orders ADD COLUMN kitchen_updated_at TEXT NOT NULL DEFAULT ''").run();
    const tableColumns=await columns('qr_order_tables');
    if(!tableColumns.has('section_name'))
      await db.prepare("ALTER TABLE qr_order_tables ADD COLUMN section_name TEXT NOT NULL DEFAULT ''").run();
    const bridgeColumns=await columns('qr_pos_bridge_capabilities');
    if(!bridgeColumns.has('can_print_kitchen'))
      await db.prepare("ALTER TABLE qr_pos_bridge_capabilities ADD COLUMN can_print_kitchen INTEGER NOT NULL DEFAULT 0").run();
  }).catch(e=>{ORDERS_SCHEMA_READY.delete(db);throw e});
  ORDERS_SCHEMA_READY.set(db,initialization);
  return initialization;
}
export async function adminContext(request,env){
  const state=await loadRequestIikoState(request,env);
  if(!state?.user)throw fail('AUTH_REQUIRED','Требуется авторизация',401);
  if(!state.access?.allowed||!hasPermission(state.access,'qr.manage'))
    throw fail('QR_MANAGE_FORBIDDEN','Нет разрешения управлять QR Menu',403);
  const ownerId=state.storageUserId||state.user.id;
  const scope=await resolveHrRestaurantScope(request,env,ownerId,state.access);
  if(!scope)throw fail('RESTAURANT_NOT_CONNECTED','Ресторан не настроен',409);
  if(scope.isChain&&scope.selectedDepartmentIds.length!==1)
    throw fail('ONE_RESTAURANT_REQUIRED','Выберите один ресторан CHAIN',409);
  const restaurantId=scope.selectedDepartmentIds?.[0]||
    scope.selectedRestaurants?.[0]?.id||
    state.state?.identity?.organizationId||state.state?.connection?.organizationId;
  if(!restaurantId)throw fail('RESTAURANT_UNRESOLVED','Не удалось определить ресторан',409);
  const menu=await env.DB.prepare(`SELECT id,organization_id,public_slug,restaurant_name
    FROM qr_menus WHERE organization_id=?1 AND is_published=1 LIMIT 1`)
    .bind(restaurantId).first();
  if(!menu)throw fail('QR_MENU_NOT_PUBLISHED','Сначала опубликуйте QR-меню выбранного ресторана',409);
  return {ownerId,restaurantId,menu,scope,state};
}
export async function publishedMenu(db,slug){
  const menu=await db.prepare(`SELECT id,organization_id,public_slug,restaurant_name FROM qr_menus
    WHERE public_slug=?1 AND is_published=1 LIMIT 1`).bind(clean(slug,100)).first();
  if(!menu)throw fail('MENU_NOT_FOUND','Опубликованное меню не найдено',404);
  return menu;
}
export async function settings(db,menuId){
  return db.prepare(`SELECT owner_id,menu_id,restaurant_id,service_mode,ordering_enabled,
    auto_enabled_at,pos_plugin_id
    FROM qr_order_settings WHERE menu_id=?1 LIMIT 1`).bind(menuId).first();
}
export async function validateTable(db,settingsRow,tableKey){
  if(settingsRow.service_mode==='FAST_FOOD'){
    if(tableKey)throw fail('TABLE_NOT_APPLICABLE','Для фастфуда используется общий QR',400);
    return {id:'',table_label:'',pos_table_id:''};
  }
  const key=clean(tableKey,128);
  if(!key)throw fail('TABLE_QR_REQUIRED','Для заказа за столом отсканируйте QR-код на столе',400);
  const row=await db.prepare(`SELECT id,table_label,pos_table_id FROM qr_order_tables
    WHERE menu_id=?1 AND table_key=?2 AND active=1 LIMIT 1`).bind(settingsRow.menu_id,key).first();
  if(!row)throw fail('TABLE_QR_INVALID','QR-код стола недействителен',404);
  return row;
}
export async function priceBasket(db,menuId,raw){
  if(!Array.isArray(raw)||!raw.length||raw.length>40)throw fail('INVALID_BASKET','Выберите от 1 до 40 позиций',400);
  const qty=new Map();
  for(const item of raw){
    const id=clean(item?.dishId,200),count=Number(item?.qty);
    if(!id||!Number.isInteger(count)||count<1||count>99||qty.has(id))
      throw fail('INVALID_BASKET_ITEM','Некорректная строка заказа',400);
    qty.set(id,count);
  }
  const dishes=await db.prepare(`SELECT id,iiko_id,name,price,currency FROM qr_dishes
    WHERE menu_id=?1 AND is_available=1`).bind(menuId).all();
  const lookup=new Map((dishes.results||[]).map(x=>[String(x.id),x]));
  const items=[];let total=0,quantity=0;
  for(const [id,count] of qty){
    const dish=lookup.get(id);
    if(!dish||!clean(dish.iiko_id))throw fail('DISH_UNAVAILABLE','Одна из позиций больше не доступна',409);
    // A manually created QR-only dish cannot be silently sent to iikoFront as a real product.
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean(dish.iiko_id)))
      throw fail('DISH_NOT_MAPPED_TO_POS','Блюдо не сопоставлено с товаром на кассе. Обратитесь к сотруднику ресторана',409);
    if(clean(dish.currency).toUpperCase()!=='AZN')throw fail('CURRENCY_UNSUPPORTED','QR-заказ поддерживает только AZN',409);
    const unitMinor=cents(dish.price),lineMinor=unitMinor*count;
    total+=lineMinor;quantity+=count;
    items.push({dishId:id,productId:String(dish.iiko_id),name:String(dish.name),qty:count,unitMinor,lineMinor});
  }
  if(!total||total>50000000||quantity>199)throw fail('TOTAL_OUT_OF_RANGE','Проверьте сумму и количество блюд',400);
  items.sort((a,b)=>a.dishId.localeCompare(b.dishId));
  return {items,totalMinor:total,currency:'AZN'};
}
export async function sha(text){
  const data=new TextEncoder().encode(text);
  const digest=await crypto.subtle.digest('SHA-256',data);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export const publicState=order=>({
  id:order.id,serviceMode:order.service_mode,tableLabel:order.table_label||'',
  orderNumber:order.id.slice(0,8).toUpperCase(),totalAZN:(order.total_minor/100).toFixed(2),
  currency:order.currency,status:order.state,paymentStatus:order.payment_state,
  posOrderNumber:order.pos_order_number||'',receiptNumber:order.pos_receipt_number||'',
  kitchenStatus:order.kitchen_status||'NOT_SENT',
  createdAt:order.created_at
});
export const eventStmt=(db,row,type,actor,details={})=>
  db.prepare(`INSERT INTO qr_order_events(id,order_id,owner_id,event_type,actor,details_json,created_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7)`)
  .bind(crypto.randomUUID(),row.id,row.owner_id,type,actor,JSON.stringify(details),iso());
