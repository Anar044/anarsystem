// Manual, owner-approved bridge from a confirmed Payriff payment to ONE
// pending POS order. Never creates a Payriff payment and never trusts the
// client to assert paid status or choose another restaurant/plugin.
import {adminContext,ensureOrders,settings,response,bad,fail,clean} from './_lib/orders.js';
import {paymentSettingsScope} from './_lib/payment-provider-settings.js';
import {fetchCheckoutPolicy,isLivePreview} from './_lib/checkout-policy.js';
import {requireTableSyncScope} from './_lib/table-sync-policy.js';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const error=e=>bad(e?.status||503,e?.code||'QR_PAID_QUEUE_ERROR',
  e?.status?e.message:'Не удалось подготовить оплаченный заказ. Проверьте историю; повторная оплата не требуется.');
const preview='feature-qr-order-internal-co.smarthoreca.pages.dev';
const paidToOrder=row=>({
  id:row.id,state:row.state,amountAZN:(row.total_minor/100).toFixed(2),
  posOrderNumber:row.pos_order_number||'',kitchenStatus:row.kitchen_status||'NOT_SENT'
});
async function scoped(request,env){
  if(new URL(request.url).hostname!==preview)
    throw fail('QR_PAID_QUEUE_PREVIEW_ONLY','Этот этап разрешён только в QR Preview',403);
  const ctx=await adminContext(request,env);
  if(ctx?.state?.access?.isOwner!==true)
    throw fail('QR_PAID_QUEUE_OWNER_ONLY','Передать оплаченный заказ может только владелец организации',403);
  const scope=paymentSettingsScope(ctx);
  const cfg=await settings(env.DB,ctx.menu.id);
  if(!cfg||cfg.owner_id!==ctx.ownerId||cfg.restaurant_id!==ctx.restaurantId||
      !cfg.pos_plugin_id)
    throw fail('QR_PAID_QUEUE_POS_NOT_SELECTED','Сначала выберите и сохраните тестовую кассу для ресторана',409);
  requireTableSyncScope(request,env,{
    departmentId:ctx.restaurantId,pluginId:cfg.pos_plugin_id
  });
  const policy=await fetchCheckoutPolicy(env.DB,scope);
  if(!isLivePreview(policy))
    throw fail('QR_PAID_QUEUE_REAL_MODE_OFF','Реальная оплата 0,01 AZN должна быть включена владельцем',409);
  return {ctx,scope,cfg};
}
async function eligible(request,env,id,{requireReady=false}={}){
  const {ctx,scope,cfg}=await scoped(request,env);
  if(!UUID.test(String(id||'')))
    throw fail('QR_PAID_QUEUE_ID_INVALID','Неверный идентификатор платёжной попытки',400);
  const intent=await env.DB.prepare(`SELECT * FROM qr_payment_intents
    WHERE id=?1 AND workspace_id=?2 AND restaurant_id=?3
      AND menu_id=?4 LIMIT 1`)
    .bind(id,scope.workspaceId,ctx.restaurantId,ctx.menu.id).first();
  if(!intent)throw fail('QR_PAID_QUEUE_NOT_FOUND','Платёж не принадлежит выбранному ресторану',404);
  if(intent.state!=='PAID_VERIFIED'||!intent.provider_order_id||
      intent.currency!=='AZN'||Number(intent.total_minor)!==1)
    throw fail('QR_PAID_QUEUE_NOT_VERIFIED',
      'Можно передавать только сервером подтверждённую оплату 0,01 AZN; UNKNOWN запрещён',409);
  const table=await env.DB.prepare(`SELECT id,pos_table_id,active
    FROM qr_order_tables WHERE menu_id=?1 AND id=?2 LIMIT 1`)
    .bind(ctx.menu.id,intent.table_id).first();
  if(!table||Number(table.active)!==1||!table.pos_table_id||
      table.pos_table_id!==intent.pos_table_id)
    throw fail('QR_PAID_QUEUE_TABLE_CHANGED',
      'Стол кассы изменился после оплаты. Требуется ручная сверка',409);
  let items;
  try{items=JSON.parse(intent.items_json)}catch{items=null}
  if(!Array.isArray(items)||!items.length||items.length>40||
      !items.every(x=>UUID.test(String(x.productId||''))&&
        Number.isInteger(x.qty)&&x.qty>0&&Number.isSafeInteger(x.lineMinor)&&
        Number.isSafeInteger(x.unitMinor)&&x.unitMinor>0&&
        x.lineMinor===x.unitMinor*x.qty)||
      items.reduce((s,x)=>s+x.lineMinor,0)!==1)
    throw fail('QR_PAID_QUEUE_ITEMS_INVALID',
      'Состав оплаченной корзины не соответствует POS-контракту. Нужна проверка',409);
  if(requireReady){
    if(Number(cfg.ordering_enabled)!==1)
      throw fail('QR_PAID_QUEUE_DISABLED','Сначала разрешите QR-заказы для тестовой кассы',409);
    const cap=await env.DB.prepare(`SELECT can_create_order,can_ack_fiscal,can_print_kitchen,
      last_seen_at FROM qr_pos_bridge_capabilities
      WHERE restaurant_id=?1 AND plugin_id=?2 AND contract_version=1 LIMIT 1`)
      .bind(ctx.restaurantId,cfg.pos_plugin_id).first();
    const age=Date.now()-Date.parse(cap?.last_seen_at||'');
    if(!cap||Number(cap.can_create_order)!==1||
        Number(cap.can_ack_fiscal)!==1||Number(cap.can_print_kitchen)!==1||
        !Number.isFinite(age)||age<0||age>=300000)
      throw fail('QR_PAID_QUEUE_PLUGIN_NOT_READY',
        'Плагин не подтвердил готовность создавать оплаченные заказы и печатать кухню',409);
  }
  return {ctx,cfg,intent};
}
export async function onRequestGet({request,env}){
  try{
    const id=new URL(request.url).searchParams.get('intentId');
    const {intent,ctx}=await eligible(request,env,id);
    const order=await env.DB.prepare(`SELECT * FROM qr_guest_orders
      WHERE payment_intent_id=?1 AND owner_id=?2 AND restaurant_id=?3 LIMIT 1`)
      .bind(intent.id,ctx.ownerId,ctx.restaurantId).first();
    return response({success:true,paidVerified:true,alreadyQueued:Boolean(order),
      order:order?paidToOrder(order):null,
      notice:order?'Этот платёж уже связан с одним QR-заказом.'
        :'Оплата проверена. Для передачи нужна включённая касса и отдельное подтверждение владельца.'});
  }catch(e){return error(e)}
}
export async function onRequestPost({request,env}){
  try{
    const url=new URL(request.url);
    if(request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)
      throw fail('QR_PAID_QUEUE_ORIGIN','Запрос с другого сайта запрещён',403);
    const body=await request.json().catch(()=>null);
    if(!body||body.action!=='queueVerified'||body.confirmCreate!==true||
        body.expectedRestaurantId===undefined)
      throw fail('QR_PAID_QUEUE_CONFIRM_REQUIRED','Подтвердите передачу оплаченного заказа на кассу',400);
    const {ctx,cfg,intent}=await eligible(request,env,body.intentId,{requireReady:true});
    if(body.expectedRestaurantId!==ctx.restaurantId)
      throw fail('QR_PAID_QUEUE_RESTAURANT_CHANGED','Выбран другой ресторан',403);
    await ensureOrders(env.DB);
    const time=new Date().toISOString(),orderId=crypto.randomUUID();
    const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO qr_guest_orders(
      id,owner_id,menu_id,restaurant_id,public_slug,client_key,request_digest,
      receipt_token,table_id,table_label,pos_table_id,service_mode,items_json,
      total_minor,currency,guest_note,state,payment_state,payment_method,
      payment_intent_id,pos_plugin_id,created_at,updated_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,
        ?14,'AZN',?15,'AWAITING_POS','PAID_ONLINE','PAYRIFF',?16,?17,?18,?18)
      RETURNING id`)
      .bind(orderId,ctx.ownerId,ctx.menu.id,ctx.restaurantId,ctx.menu.public_slug,
        intent.client_key,intent.basket_digest,intent.receipt_token,
        intent.table_id,intent.table_label,intent.pos_table_id,cfg.service_mode,
        intent.items_json,intent.total_minor,intent.guest_note,
        intent.id,cfg.pos_plugin_id,time).first();
    const row=await env.DB.prepare(`SELECT * FROM qr_guest_orders
      WHERE payment_intent_id=?1 AND owner_id=?2 AND restaurant_id=?3 LIMIT 1`)
      .bind(intent.id,ctx.ownerId,ctx.restaurantId).first();
    if(!row||row.payment_state!=='PAID_ONLINE'||row.payment_method!=='PAYRIFF')
      throw fail('QR_PAID_QUEUE_CONFLICT','Не удалось подтвердить единственный кассовый заказ',409);
    if(inserted)await env.DB.prepare(`INSERT INTO qr_order_events
      (id,order_id,owner_id,event_type,actor,details_json,created_at)
      VALUES(?1,?2,?3,'ONLINE_PAID_QUEUED','OWNER',?4,?5)`)
      .bind(crypto.randomUUID(),row.id,ctx.ownerId,
        JSON.stringify({paymentIntentId:intent.id,providerOrderKnown:true}),time).run();
    return response({success:true,duplicate:!inserted,order:paidToOrder(row),
      notice:inserted?'Подтверждённый оплаченный заказ направлен в очередь тестовой кассы.'
        :'Заказ уже был создан для этой оплаты. Второй не создавался.'});
  }catch(e){return error(e)}
}
