// Payriff Development hosted checkout: payment intent only. Never a POS order.
// Public URLs are scoped through a published menu + immutable workspace binding.
import {publishedMenu,settings,validateTable,priceBasket,sha,token,response,bad,fail,clean} from './_lib/orders.js';
import {ensurePaymentSettings,fetchPaymentSettings,decryptPaymentSecret} from './_lib/payment-provider-settings.js';
import {createPayriffCheckout,readPayriffPayment,readPayriffByReference,classifyPayriffPayment} from './_lib/payriff-checkout.js';
import {fetchCheckoutPolicy,isLivePreview} from './_lib/checkout-policy.js';

const error=(e,stage='request')=>{
  // Never expose SQL, credentials, or stack traces to an unauthenticated guest.
  // A stable error code gives an actionable diagnostic in Cloudflare logs.
  if(!e?.status){
    console.error('[QR Pay] '+stage+' failed',{
      code:e?.code||'UNEXPECTED',type:e?.name||'Error'
    });
    const id=stage==='availability'?'QR_PAYMENT_READINESS_ERROR':'QR_PAYMENT_INTERNAL_ERROR';
    return bad(503,id,
      stage==='availability'
        ?'Не удалось проверить готовность Payriff для этого QR. Сообщите администрации код '+id
        :'Не удалось проверить платёж. Не выполняйте повторную оплату до сверки.');
  }
  return bad(e.status,e.code||'QR_PAYMENT_FAILED',e.message);
};
const preview='feature-qr-order-internal-co.smarthoreca.pages.dev';
const checkoutAllowed=request=>new URL(request.url).hostname===preview;
const goodKey=x=>/^[a-f0-9-]{32,40}$/i.test(x);
const amount=x=>(Number(x)/100).toFixed(2);
const now=()=>new Date().toISOString();
const readOnlyStep=async(code,operation)=>{
  try{return await operation()}
  catch(e){
    if(e?.status)throw e;
    // Expose only stable, non-sensitive stage codes, never SQL or credentials.
    console.error('[QR Pay] read-only '+code,{type:e?.name||'Error'});
    throw fail('QR_PAYMENT_'+code+'_UNAVAILABLE',
      'Ошибка проверки QR Pay ('+code+'). Сообщите код администратору ресторана.',503);
  }
};
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
  // Public readiness must remain read-only. Owner-side settings setup creates
  // provider tables; this path only checks the restaurant's existing records.
  const binding=await readOnlyStep('MENU_BINDING',()=>db.prepare(`SELECT b.workspace_id,b.restaurant_id,b.owner_id
    FROM qr_payment_menu_bindings b
    JOIN qr_payment_provider_settings p
    ON p.workspace_id=b.workspace_id AND p.restaurant_id=b.restaurant_id
      AND p.provider='PAYRIFF'
    WHERE b.menu_id=?1 AND b.restaurant_id=?2 LIMIT 1`)
    .bind(menu.id,menu.organization_id).first());
  if(!binding)return null;
  // D1 rows expose snake_case. fetchPaymentSettings accepts camelCase.
  // Passing the raw binding object would bind undefined parameters in D1.
  const cfg=await readOnlyStep('PROVIDER_SETTINGS',()=>fetchPaymentSettings(db,{
    workspaceId:binding.workspace_id,restaurantId:binding.restaurant_id
  }));
  if(!cfg?.merchant_id||!cfg.secret_encrypted)return null;
  const policy=await readOnlyStep('CHECKOUT_POLICY',()=>fetchCheckoutPolicy(db,{
    workspaceId:binding.workspace_id,restaurantId:binding.restaurant_id
  }));
  const live=isLivePreview(policy);
  // The explicit REAL charge is tightly limited to one kopek in Preview.
  // Legacy Development checkout remains available only with separate opt-in.
  if(!live&&!(cfg.environment==='development'&&Number(cfg.enabled)===1))
    return null;
  const orderSettings=await readOnlyStep('TABLE_SETTINGS',()=>settings(db,menu.id));
  if(!orderSettings||orderSettings.restaurant_id!==binding.restaurant_id||
      orderSettings.owner_id!==binding.owner_id)return null;
  return {...binding,cfg,orderSettings,
    checkoutMode:live?'LIVE_PREVIEW_001':'DEVELOPMENT'};
}
function publicIntent(intent){
  return {state:intent.state,amountAZN:amount(intent.total_minor),currency:'AZN',
    tableLabel:intent.table_label,
    paidVerified:intent.state==='PAID_VERIFIED',
    posOrderCreated:false,kitchenPrinted:false,
    notice:intent.state==='PAID_VERIFIED'
      ?'Оплата подтверждена Payriff. Создание заказа на кассе пока отключено.'
      :intent.state==='CHECKOUT'?'Ожидаем оплату Payriff'
      :intent.state==='FAILED'?'Payriff подтвердил отказ или отмену.'
      :intent.state==='UNKNOWN'
        ?'Результат Payriff неизвестен. Проверьте эту попытку; не платите повторно.'
        :'Проверяем статус платежа'};
}
export async function onRequestGet({request,env}){
  try{
    if(!checkoutAllowed(request))throw fail('PAYRIFF_DEVELOPMENT_ONLY','Только тестовая среда',409);
    // Opening a guest menu must not run CREATE TABLE/INDEX on D1. Those
    // objects are prepared by payment creation; GET is strictly read-only
    // until checking an already-issued provider transaction.
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
      if(!cfg||cfg.merchant_id!==intent.merchant_id)
        throw fail('PAYMENT_CONFIG_CHANGED','Реквизиты Payriff изменились. Нужна ручная сверка',409);
      const secret=await decryptPaymentSecret(env,{workspaceId:intent.workspace_id,
        restaurantId:intent.restaurant_id,environment:cfg.environment,
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
    const menu=await readOnlyStep('PUBLISHED_MENU',()=>
      publishedMenu(env.DB,url.searchParams.get('id')));
    const scope=await loadScope(env.DB,menu);
    let tableLabel='';
    if(scope){
      const table=await readOnlyStep('TABLE_LOOKUP',()=>
        validateTable(env.DB,scope.orderSettings,url.searchParams.get('table')));
      tableLabel=table.table_label||'';
      const clientKey=clean(url.searchParams.get('clientKey'),50);
      if(clientKey){
        if(!goodKey(clientKey))throw fail('PAYMENT_CLIENT_KEY_INVALID','Неверный ключ попытки',400);
        const saved=await env.DB.prepare(`SELECT * FROM qr_payment_intents
          WHERE workspace_id=?1 AND restaurant_id=?2 AND menu_id=?3
            AND table_id=?4 AND client_key=?5 LIMIT 1`)
          .bind(scope.workspace_id,scope.restaurant_id,menu.id,table.id,clientKey).first();
        if(!saved)return response({success:true,found:false,
          testCheckoutEnabled:true,tableLabel});
        if(saved.state==='UNKNOWN'&&saved.provider_order_id===null){
          // If create timed out, locate the order by the original request RRN
          // without posting another payment. Never silently retry a charge.
          const previous=Date.parse(saved.last_checked_at||'');
          if(!Number.isFinite(previous)||Date.now()-previous>=20000){
            const claim=await env.DB.prepare(`UPDATE qr_payment_intents
              SET last_checked_at=?1 WHERE id=?2 AND state='UNKNOWN'
                AND provider_order_id IS NULL
                AND (last_checked_at='' OR last_checked_at<?3) RETURNING id`)
              .bind(now(),saved.id,new Date(Date.now()-20000).toISOString()).first();
            if(claim){
              try{
                const secret=await decryptPaymentSecret(env,{
                  workspaceId:scope.workspace_id,restaurantId:scope.restaurant_id,
                  environment:scope.cfg.environment,envelope:scope.cfg.secret_encrypted});
                const data=await readPayriffByReference({secret,reference:saved.id});
                const match=(!data?.merchantId||String(data.merchantId)===saved.merchant_id)
                  &&data?.currencyType==='AZN'
                  &&data?.operationType==='PURCHASE';
                const outcome=match?classifyPayriffPayment(data,{
                  orderId:String(data?.orderId||''),amountMinor:saved.total_minor}):'MISMATCH';
                if(outcome==='PAID_VERIFIED'||outcome==='FAILED'){
                  await env.DB.prepare(`UPDATE qr_payment_intents SET state=?1,
                    provider_order_id=?2,updated_at=?3
                    WHERE id=?4 AND state='UNKNOWN' AND provider_order_id IS NULL`)
                    .bind(outcome,String(data.orderId),now(),saved.id).run();
                  saved.state=outcome;
                }
              }catch(e){
                // Absence of a provider response is NOT evidence of no payment.
                console.warn('[QR Pay] unknown intent reconciliation pending',{
                  kind:e?.code||'PROVIDER_UNREACHABLE'
                });
              }
            }
          }
        }
        return response({success:true,found:true,ticket:saved.receipt_token,
          payment:publicIntent(saved)});
      }
    }
    return response({success:true,testCheckoutEnabled:Boolean(scope),
      checkoutMode:scope?.checkoutMode||'DISABLED',
      livePayment:Boolean(scope?.checkoutMode==='LIVE_PREVIEW_001'),
      maxLiveAmountAZN:'0.01',
      tableLabel,provider:'PAYRIFF',environment:scope?.checkoutMode==='LIVE_PREVIEW_001'?'online':'development',
      ordersEnabled:false,notice:scope?.checkoutMode==='LIVE_PREVIEW_001'
        ?'РЕАЛЬНАЯ оплата 0,01 AZN через действующий Merchant Payriff. Касса и кухня пока не получают заказ.'
        :'Оплата без создания заказа и кухонной печати'});
  }catch(e){return error(e,'availability')}
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
    if(scope.checkoutMode==='LIVE_PREVIEW_001'&&basket.totalMinor!==1)
      throw fail('PAYRIFF_LIVE_AMOUNT_LIMIT',
        'Тест действующей картой ограничен суммой РОВНО 0,01 AZN. Измените состав корзины.',409);
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
      restaurantId:scope.restaurant_id,environment:scope.cfg.environment,
      envelope:scope.cfg.secret_encrypted});
    const origin=new URL(request.url).origin;
    // A dedicated static receipt is rendered BEFORE any API request or menu JS.
    // White screens in a third-party return flow cannot hide the result panel.
    const ret=origin+'/qr-payment-return.html?id='+encodeURIComponent(menu.public_slug)+
      '&table='+encodeURIComponent(body.table||'')+'&qrPaymentTicket='+receipt;
    try{
      const created=await createPayriffCheckout({
        secret,amountMinor:basket.totalMinor,reference:id,
        // Payriff variants may navigate the customer via callbackUrl.
        // GET redirects to the same safe receipt, POST is notification only.
        callbackUrl:origin+'/api/qr-menu/payment-callback?qrPaymentTicket='+receipt+
          '&id='+encodeURIComponent(menu.public_slug)+
          '&table='+encodeURIComponent(body.table||''),
        redirectUrl:ret
      });
      await env.DB.prepare(`UPDATE qr_payment_intents SET state='CHECKOUT',
        provider_order_id=?1,checkout_url=?2,updated_at=?3
        WHERE id=?4 AND state='CREATING'`)
        .bind(created.orderId,created.paymentUrl,now(),id).run();
      return response({success:true,ticket:receipt,paymentUrl:created.paymentUrl,
        checkoutMode:scope.checkoutMode,
        payment:{state:'CHECKOUT',amountAZN:amount(basket.totalMinor),
          tableLabel:table.table_label,
          notice:scope.checkoutMode==='LIVE_PREVIEW_001'
            ?'Оплата с реальной карты: 0,01 AZN. Не повторяйте платёж при ошибке.'
            :'Откройте страницу Payriff. Касса и печать отключены.'}},201);
    }catch(e){
      try{
        await env.DB.prepare(`UPDATE qr_payment_intents SET state='UNKNOWN',
          updated_at=?1 WHERE id=?2 AND state='CREATING'`).bind(now(),id).run();
      }catch(dbError){
        console.error('[QR Pay] uncertain payment intent persistence',{kind:dbError?.name||'Error'});
      }
      // Return the opaque ticket so guests can reconcile this same attempt,
      // instead of creating a second payment when Payriff is unreachable.
      return response({success:false,code:e?.code||'PAYRIFF_UNCONFIRMED',
        message:e?.message||'Неизвестен результат Payriff; проверьте предыдущую попытку.',
        ticket:receipt,payment:publicIntent({...{total_minor:basket.totalMinor,
          table_label:table.table_label},state:'UNKNOWN'})},e?.status||503);
    }
  }catch(e){return error(e)}
}
