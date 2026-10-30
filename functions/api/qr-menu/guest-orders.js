import {ensureOrders,publishedMenu,settings,validateTable,priceBasket,sha,token,response,bad,fail,clean,publicState,eventStmt} from './_lib/orders.js';
import {isSharedD1Test} from './_lib/table-sync-policy.js';

const reply=e=>bad(e.status||500,e.code||'QR_ORDER_ERROR',e.status?e.message:'Не удалось обработать QR-заказ');
async function isPosReady(db,cfg){
  if(!cfg?.pos_plugin_id)return false;
  const row=await db.prepare(`SELECT last_seen_at FROM qr_pos_bridge_capabilities
    WHERE restaurant_id=?1 AND plugin_id=?2 AND contract_version=1
    AND can_create_order=1 AND can_ack_fiscal=1 AND can_print_kitchen=1 LIMIT 1`)
    .bind(cfg.restaurant_id,cfg.pos_plugin_id).first();
  const t=Date.parse(row?.last_seen_at||'');
  return Number.isFinite(t)&&t<=Date.now()&&Date.now()-t<5*60000;
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:{'Allow':'GET,POST,OPTIONS'}})}
export async function onRequestGet({request,env}){
  try{
    await ensureOrders(env.DB);
    const url=new URL(request.url);
    if(url.searchParams.has('ticket')){
      const ticket=clean(url.searchParams.get('ticket'),128);
      if(!/^[0-9a-f]{48,64}$/.test(ticket))return bad(400,'BAD_TICKET','Некорректный номер отслеживания');
      const order=await env.DB.prepare(`SELECT id,service_mode,table_label,total_minor,currency,state,
        payment_state,pos_order_number,pos_receipt_number,kitchen_status,created_at
        FROM qr_guest_orders WHERE receipt_token=?1 LIMIT 1`).bind(ticket).first();
      return order?response({success:true,order:publicState(order)}):bad(404,'NOT_FOUND','Заказ не найден');
    }
    const menu=await publishedMenu(env.DB,url.searchParams.get('id'));
    const configured=await settings(env.DB,menu.id);
    const mode=configured?.service_mode||'TABLE';
    const bridgeReady=!isSharedD1Test(env)&&await isPosReady(env.DB,configured);
    const enabled=!isSharedD1Test(env)&&Boolean(configured?.ordering_enabled)&&bridgeReady;
    let table=null,tableValid=false;
    if(enabled){
      try{table=await validateTable(env.DB,configured,url.searchParams.get('table'));tableValid=true}
      catch(e){if(e.code!=='TABLE_QR_REQUIRED'&&e.code!=='TABLE_QR_INVALID')throw e}
    }
    return response({success:true,orderingEnabled:enabled&&tableValid,
      mode,tableLabel:tableValid?table?.table_label||'':'',
      posBridgeConfigured:Boolean(configured?.pos_plugin_id),posBridgeReady:bridgeReady,
      paymentMethod:'PAY_AT_POS',onlinePaymentEnabled:false,
      hint:!enabled?'QR-заказы временно недоступны: касса не подтвердила готовность':!tableValid?'Нужен действующий QR-код стола':'Заказ будет направлен в Smart Horeca, оплата — на кассе'});
  }catch(e){return reply(e)}
}
export async function onRequestPost({request,env}){
  try{
    if(isSharedD1Test(env))
      throw fail('QR_SHARED_D1_ORDERS_DISABLED',
        'На общей D1 сейчас разрешена только синхронизация столов без приёма заказов',409);
    await ensureOrders(env.DB);
    const body=await request.json().catch(()=>null);
    if(!body||typeof body!=='object'||Array.isArray(body))throw fail('BAD_REQUEST','Некорректный заказ');
    const menu=await publishedMenu(env.DB,body.id);
    const configured=await settings(env.DB,menu.id);
    if(!configured?.ordering_enabled||configured.restaurant_id!==menu.organization_id)
      throw fail('ORDERING_DISABLED','Ресторан пока не принимает QR-заказы',409);
    if(!(await isPosReady(env.DB,configured)))
      throw fail('POS_OFFLINE','Касса сейчас недоступна для новых QR-заказов',503);
    const table=await validateTable(env.DB,configured,body.table||'');
    const clientKey=clean(body.clientKey,100);
    if(!/^[a-f0-9-]{32,40}$/i.test(clientKey))throw fail('BAD_CLIENT_KEY','Неверный идентификатор отправки',400);
    const note=clean(body.note,280);
    if(/[\u0000-\u001f\u007f]/.test(note))throw fail('BAD_NOTE','Недопустимые символы в комментарии');
    const basket=await priceBasket(env.DB,menu.id,body.items);
    const digest=await sha(JSON.stringify({tableId:table.id,note,items:basket.items,totalMinor:basket.totalMinor}));
    const existing=await env.DB.prepare(`SELECT * FROM qr_guest_orders WHERE menu_id=?1 AND client_key=?2 LIMIT 1`)
      .bind(menu.id,clientKey).first();
    if(existing){
      if(existing.request_digest!==digest)throw fail('REPLAY_CONFLICT','Этот идентификатор уже использовался для другого заказа',409);
      return response({success:true,order:publicState(existing),ticket:existing.receipt_token,duplicate:true});
    }
    const secret=clean(env.QR_ORDER_RATE_SECRET,256);
    const ip=clean(request.headers.get('CF-Connecting-IP'),100);
    if(!secret||!ip)throw fail('QR_RATE_PROTECTION_REQUIRED','Защита публичных заказов не настроена',503);
    // Guests share restaurant Wi-Fi. TABLE throttles per table+IP, not the whole restaurant;
    // FAST_FOOD permits higher throughput but should also use edge WAF/Turnstile at scale.
    const originHash=await sha(secret+':'+menu.id+':'+(table.id||'FAST_FOOD')+':'+ip);
    const limit=configured.service_mode==='TABLE'?8:80;
    const cutoff=new Date(Date.now()-20*60000).toISOString();
    const usage=await env.DB.prepare(`SELECT COUNT(*) AS n FROM qr_guest_orders
      WHERE menu_id=?1 AND origin_hash=?2 AND created_at>=?3`)
      .bind(menu.id,originHash,cutoff).first();
    if(Number(usage?.n||0)>=limit)throw fail('ORDER_RATE_LIMIT','Слишком много заказов. Обратитесь к сотруднику ресторана',429);
    const orderId=crypto.randomUUID(),receiptToken=token(32),created=new Date().toISOString();
    const row={id:orderId,owner_id:configured.owner_id};
    // All writes in a D1 batch are atomic; a retry with the same clientKey cannot duplicate items.
    await env.DB.batch([
      env.DB.prepare(`INSERT OR IGNORE INTO qr_guest_orders(
        id,owner_id,menu_id,restaurant_id,public_slug,client_key,request_digest,receipt_token,
        table_id,table_label,pos_table_id,service_mode,items_json,total_minor,currency,guest_note,
        origin_hash,pos_plugin_id,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'AZN',?15,?16,?17,?18,?18)`)
        .bind(orderId,configured.owner_id,menu.id,menu.organization_id,menu.public_slug,clientKey,
          digest,receiptToken,table.id,table.table_label,table.pos_table_id,
          configured.service_mode,JSON.stringify(basket.items),basket.totalMinor,note,
          originHash,configured.pos_plugin_id||'',created),
      env.DB.prepare(`INSERT INTO qr_order_events(id,order_id,owner_id,event_type,actor,details_json,created_at)
        SELECT ?1,?2,?3,'QR_SUBMITTED','GUEST',?4,?5
        WHERE EXISTS (SELECT 1 FROM qr_guest_orders WHERE id=?2)`)
        .bind(crypto.randomUUID(),orderId,configured.owner_id,
          JSON.stringify({serviceMode:configured.service_mode,table:table.table_label,totalMinor:basket.totalMinor}),created)
    ]);
    const stored=await env.DB.prepare(`SELECT * FROM qr_guest_orders
      WHERE menu_id=?1 AND client_key=?2 LIMIT 1`).bind(menu.id,clientKey).first();
    if(stored.request_digest!==digest)throw fail('REPLAY_CONFLICT','Повторный запрос отличается от сохранённого',409);
    return response({success:true,order:publicState(stored),ticket:stored.receipt_token,
      duplicate:stored.id!==orderId,notice:'Заказ зарегистрирован в Smart Horeca. Отправка на кассу подтверждается отдельно.'},201);
  }catch(e){return reply(e)}
}
