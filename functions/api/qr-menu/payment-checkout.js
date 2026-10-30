// Payriff Development hosted checkout: payment intent only. Never a POS order.
// Public URLs are scoped through a published menu + immutable workspace binding.
import {publishedMenu,settings,validateTable,priceBasket,sha,token,response,bad,fail,clean} from './_lib/orders.js';
import {ensurePaymentSettings,fetchPaymentSettings,decryptPaymentSecret} from './_lib/payment-provider-settings.js';
import {createPayriffCheckout,readPayriffPayment,classifyPayriffPayment} from './_lib/payriff-checkout.js';

const error=e=>bad(e.status||500,e.code||'QR_PAYMENT_FAILED',
  e.status?e.message:'Платёж временно недоступен. Не оплачивайте повторно до сверки.');
const preview='feature-qr-order-internal-co.smarthoreca.pages.dev';
const checkoutAllowed=request=>new URL(request.url).hostname===preview;
const goodKey=x=>/^[a-f0-9-]{32,40}$/i.test(x);
const amount=x=>(Number(x)/100).toFixed(2);
const now=()=>new Date().toISOString();
async function ensureIntents(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS qr_payment_intents (
    id TEXT PRIMARY KEY,receipt_token TEXT NOT NULL UNIQUE,
    workspace_id TEXT NOT NULL,restaurant_id TEXT NOT NULL,menu_id TEXT NOT NULL,
    client_key TEXT NOT NULL,basket_digest TEXT NOT NULL,table_id TEXT NOT NULL,
    table_label TEXT NOT NULL,pos_table_id TEXT NOT NULL,
    items_json TEXT NOT NULL,guest_note TEXT NOT NULL DEFAULT '',
    total_minor INTEGER NOT NULL,currency TEXT NOT NULL DEFAULT 'AZN',
    merchant_id TEXT NOT NULL,provider_order_id TEXT UNIQUE,
    checkout_url TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'CREATING',origin_hash TEXT NOT NULL DEFAULT '',
    last_checked_at TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,expires_at TEXT NOT NULL,
    UNIQUE(workspace_id,restaurant_id,menu_id,client_key)
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_qr_payment_intents_scope
    ON qr_payment_intents(workspace_id,restaurant_id,created_at)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS qr_payment_events (
    id TEXT PRIMARY KEY,intent_id TEXT NOT NULL,event_type TEXT NOT NULL,
    created_at TEXT NOT NULL,details_json TEXT NOT NULL DEFAULT '{}'
  )`).run();
}
async function loadScope(db,menu){
  await ensurePaymentSettings(db);
  const binding=await db.prepare(`SELECT b.workspace_id,b.restaurant_id,b.owner_id
    FROM qr_payment_menu_bindings b
    JOIN qr_payment_provider_settings p
    ON p.workspace_id=b.workspace_id AND p.restaurant_id=b.restaurant_id
      AND p.provider='PAYRIFF'
    WHERE b.menu_id=?1 AND b.restaurant_id=?2 LIMIT 1`)
    .bind(menu.id,menu.organization_id).first();
  if(!binding)return null;
  const cfg=await fetchPaymentSettings(db,binding);
  if(!cfg||cfg.environment!=='development'||cfg.enabled!==1||
      !cfg.merchant_id||!cfg.secret_encrypted)return null;
  const orderSettings=await settings(db,menu.id);
  if(!orderSettings||orderSettings.restaurant_id!==binding.restaurant_id||
      orderSettings.owner_id!==binding.owner_id)return null;
  return {...binding,cfg,orderSettings};
}
function publicIntent(intent){
  return {state:intent.state,amountAZN:amount(intent.total_minor),currency:'AZN',
    tableLabel:intent.table_label,
    paidVerified:intent.state==='PAID_VERIFIED',
    posOrderCreated:false,kitchenPrinted:false,
    notice:intent.state==='PAID_VERIFIED'
      ?'Тестовая оплата подтверждена Payriff. Создание заказа на кассе пока отключено.'
      :intent.state==='CHECKOUT'?'Ожидаем оплату Payriff'
      :intent.state==='FAILED'?'Оплата не подтверждена'
      :'Проверяем статус платежа'};
}
export async function onRequestGet({request,env}){
  try{
    if(!checkoutAllowed(request))throw fail('PAYRIFF_DEVELOPMENT_ONLY','Только тестовая среда',409);
    await ensureIntents(env.DB);
    const url=new URL(request.url),ticket=clean(url.searchParams.get('ticket'),140);
    if(ticket){
      if(!/^[a-f0-9]{64}$/.test(ticket))
        throw fail('PAYMENT_TICKET_INVALID','Неверный идентификатор проверки',400);
      const intent=await env.DB.prepare(`SELECT * FROM qr_payment_intents
        WHERE receipt_token=?1 LIMIT 1`).bind(ticket).first();
      if(!intent)throw fail('PAYMENT_NOT_FOUND','Платёж не найден',404);
      // Never allow a browser to mark a payment paid by sending its own state.
      if(['PAID_VERIFIED','FAILED'].includes(intent.state))
        return response({success:true,payment:publicIntent(intent)});
      if(intent.state!=='CHECKOUT'||!intent.provider_order_id)
        return response({success:true,payment:publicIntent(intent)});
      const checked=Date.parse(intent.last_checked_at||'');
      if(Number.isFinite(checked)&&Date.now()-checked<10000)
        return response({success:true,payment:publicIntent(intent)});
      const reserved=await env.DB.prepare(`UPDATE qr_payment_intents SET last_checked_at=?1
        WHERE id=?2 AND state='CHECKOUT'
          AND (last_checked_at='' OR last_checked_at<?3)
        RETURNING id`).bind(now(),intent.id,new Date(Date.now()-10000).toISOString()).first();
      if(!reserved)return response({success:true,payment:publicIntent(intent)});
      // Retain immutable intent scope even if the published menu changes.
      const cfg=await fetchPaymentSettings(env.DB,{workspaceId:intent.workspace_id,
        restaurantId:intent.restaurant_id});
      if(!cfg||cfg.merchant_id!==intent.merchant_id||cfg.environment!=='development')
        throw fail('PAYMENT_CONFIG_CHANGED','Реквизиты Payriff изменились. Нужна ручная сверка',409);
      const secret=await decryptPaymentSecret(env,{workspaceId:intent.workspace_id,
        restaurantId:intent.restaurant_id,environment:'development',
        envelope:cfg.secret_encrypted});
      const data=await readPayriffPayment({secret,orderId:intent.provider_order_id});
      const outcome=data.merchantId&&String(data.merchantId)!==intent.merchant_id
        ?'MISMATCH'
        :classifyPayriffPayment(data,{
          orderId:intent.provider_order_id,amountMinor:intent.total_minor});
      if(outcome==='MISMATCH')
        throw fail('PAYMENT_RECONCILIATION_REQUIRED','Payriff вернул несовпадающие реквизиты. Требуется сверка',409);
      if(outcome!=='PENDING'){
        await env.DB.prepare(`UPDATE qr_payment_intents SET state=?1,updated_at=?2
          WHERE id=?3 AND state='CHECKOUT' AND provider_order_id=?4`)
          .bind(outcome,now(),intent.id,intent.provider_order_id).run();
        await env.DB.prepare(`INSERT INTO qr_payment_events
          (id,intent_id,event_type,created_at) VALUES(?1,?2,?3,?4)`)
          .bind(crypto.randomUUID(),intent.id,outcome,now()).run();
        intent.state=outcome;
      }
      return response({success:true,payment:publicIntent(intent)});
    }
    const menu=await publishedMenu(env.DB,url.searchParams.get('id'));
    const scope=await loadScope(env.DB,menu);
    let tableLabel='';
    if(scope){
      const table=await validateTable(env.DB,scope.orderSettings,url.searchParams.get('table'));
      tableLabel=table.table_label||'';
    }
    return response({success:true,testCheckoutEnabled:Boolean(scope),
      tableLabel,provider:'PAYRIFF',environment:'development',
      ordersEnabled:false,notice:'Тестовая оплата без создания заказа и кухонной печати'});
  }catch(e){return error(e)}
}
export async function onRequestPost({request,env}){
  try{
    if(!checkoutAllowed(request))throw fail('PAYRIFF_DEVELOPMENT_ONLY','Платежи разрешены только в тестовом Preview',409);
    if(!String(request.headers.get('Content-Type')||'').includes('application/json'))
      throw fail('PAYMENT_JSON_REQUIRED','Ожидается JSON',415);
    const originHeader=request.headers.get('Origin');
    if(originHeader&&originHeader!==new URL(request.url).origin)
      throw fail('PAYMENT_ORIGIN_INVALID','Запрос из другого сайта запрещён',403);
    if(Number(request.headers.get('Content-Length')||0)>12000)
      throw fail('PAYMENT_BODY_TOO_LARGE','Слишком большой запрос',413);
    const raw=await request.text();
    if(raw.length>12000)throw fail('PAYMENT_BODY_TOO_LARGE','Слишком большой запрос',413);
    const body=JSON.parse(raw||'null');
    if(!body||typeof body!=='object'||Array.isArray(body))
      throw fail('PAYMENT_BODY_INVALID','Некорректный платёж',400);
    const clientKey=clean(body.clientKey,50);
    if(!goodKey(clientKey))throw fail('PAYMENT_CLIENT_KEY_INVALID','Неверный идентификатор попытки',400);
    await ensureIntents(env.DB);
    const menu=await publishedMenu(env.DB,body.id);
    const scope=await loadScope(env.DB,menu);
    if(!scope)throw fail('PAYRIFF_TEST_DISABLED','Тестовая оплата пока не включена владельцем ресторана',409);
    const table=await validateTable(env.DB,scope.orderSettings,body.table||'');
    const basket=await priceBasket(env.DB,menu.id,body.items);
    const note=clean(body.note,280);
    if(/[\u0000-\u001f\u007f]/.test(note))
      throw fail('PAYMENT_NOTE_INVALID','Некорректный комментарий',400);
    const digest=await sha(JSON.stringify({menuId:menu.id,restaurantId:scope.restaurant_id,
      tableId:table.id,items:basket.items,total:basket.totalMinor,note}));
    const existing=await env.DB.prepare(`SELECT * FROM qr_payment_intents
      WHERE workspace_id=?1 AND restaurant_id=?2 AND menu_id=?3 AND client_key=?4
      LIMIT 1`).bind(scope.workspace_id,scope.restaurant_id,menu.id,clientKey).first();
    if(existing){
      if(existing.basket_digest!==digest)
        throw fail('PAYMENT_REPLAY_CONFLICT','Предыдущая попытка относится к другой корзине',409);
      if(existing.state==='CHECKOUT'||existing.state==='PAID_VERIFIED')
        return response({success:true,payment:publicIntent(existing),
          ticket:existing.receipt_token,
          paymentUrl:existing.state==='CHECKOUT'?existing.checkout_url:null,duplicate:true});
      throw fail('PAYMENT_ATTEMPT_UNCERTAIN',
        'Предыдущая попытка ещё проверяется. Не оплачивайте повторно; обратитесь к сотруднику',409);
    }
    const ip=clean(request.headers.get('CF-Connecting-IP'),100);
    if(!ip)throw fail('PAYMENT_RATE_UNAVAILABLE','Не удалось проверить защиту от повторных платежей',503);
    const secretRoot=clean(env.SMART_HORECA_STATE_ENCRYPTION_KEY,512);
    if(!secretRoot)throw fail('PAYMENT_SECURITY_UNAVAILABLE','Защита платёжного сервера не настроена',503);
    const originHash=await sha(secretRoot+':'+scope.workspace_id+':'+table.id+':'+ip);
    const n=await env.DB.prepare(`SELECT COUNT(*) AS count FROM qr_payment_intents
      WHERE workspace_id=?1 AND restaurant_id=?2 AND origin_hash=?3 AND created_at>=?4`)
      .bind(scope.workspace_id,scope.restaurant_id,originHash,
        new Date(Date.now()-20*60000).toISOString()).first();
    if(Number(n?.count||0)>=5)
      throw fail('PAYMENT_RATE_LIMIT','Слишком много попыток оплаты. Обратитесь к сотруднику',429);
    const at=now(),id=crypto.randomUUID(),receipt=token(32);
    const expires=new Date(Date.now()+20*60000).toISOString();
    const inserted=await env.DB.prepare(`INSERT OR IGNORE INTO qr_payment_intents
      (id,receipt_token,workspace_id,restaurant_id,menu_id,client_key,basket_digest,
        table_id,table_label,pos_table_id,items_json,guest_note,total_minor,currency,
        merchant_id,state,origin_hash,created_at,updated_at,expires_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,'AZN',?14,'CREATING',?15,?16,?16,?17)
      RETURNING id`).bind(id,receipt,scope.workspace_id,scope.restaurant_id,menu.id,
      clientKey,digest,table.id,table.table_label,table.pos_table_id,
      JSON.stringify(basket.items),note,basket.totalMinor,scope.cfg.merchant_id,
      originHash,at,expires).first();
    if(!inserted)throw fail('PAYMENT_ALREADY_STARTING',
      'Платёжная попытка уже существует. Проверьте статус, не платите повторно',409);
    const secret=await decryptPaymentSecret(env,{workspaceId:scope.workspace_id,
      restaurantId:scope.restaurant_id,environment:'development',
      envelope:scope.cfg.secret_encrypted});
    const origin=new URL(request.url).origin;
    const ret=origin+'/menu.html?id='+encodeURIComponent(menu.public_slug)+
      '&table='+encodeURIComponent(body.table||'')+'&qrPaymentTicket='+receipt;
    try{
      const created=await createPayriffCheckout({
        secret,amountMinor:basket.totalMinor,reference:id,
        callbackUrl:origin+'/api/qr-menu/payment-callback',
        redirectUrl:ret
      });
      await env.DB.prepare(`UPDATE qr_payment_intents SET state='CHECKOUT',
        provider_order_id=?1,checkout_url=?2,updated_at=?3
        WHERE id=?4 AND state='CREATING'`)
        .bind(created.orderId,created.paymentUrl,now(),id).run();
      return response({success:true,ticket:receipt,paymentUrl:created.paymentUrl,
        payment:{state:'CHECKOUT',amountAZN:amount(basket.totalMinor),
          tableLabel:table.table_label,
          notice:'Откройте тестовую оплату Payriff. Касса и печать отключены.'}},201);
    }catch(e){
      await env.DB.prepare(`UPDATE qr_payment_intents SET state='UNKNOWN',
        updated_at=?1 WHERE id=?2 AND state='CREATING'`).bind(now(),id).run();
      throw e;
    }
  }catch(e){return error(e)}
}
