// The POS never receives merchant credentials. A refund may ONLY originate
// from the registered QR Bridge after the built-in iikoFront ReturnPayment
// operation. This never creates a payment or closes an iiko order.
// Refunds cross two independent systems; UNKNOWN is terminal for automatic
// retries and must be reconciled manually to prevent double refunds.
import {fail} from './orders.js';
import {fetchPaymentSettings,decryptPaymentSecret} from './payment-provider-settings.js';

const now=()=>new Date().toISOString();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function ensureRefundLedger(db){
  await db.prepare(`CREATE TABLE IF NOT EXISTS qr_payriff_refunds(
    id TEXT PRIMARY KEY,
    intent_id TEXT NOT NULL,
    external_order_id TEXT NOT NULL,
    provider_order_id TEXT NOT NULL,
    transaction_id TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    state TEXT NOT NULL DEFAULT 'UNKNOWN',
    response_id TEXT NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(intent_id,transaction_id)
  )`).run();
}
export async function requestPosPayriffRefund(env,identity,body){
  const externalOrderId=String(body.externalOrderId||'');
  const posOrderId=String(body.posOrderId||'');
  const transactionId=String(body.transactionId||'');
  const amountMinor=Number(body.amountMinor);
  if(!uuid.test(externalOrderId)||!uuid.test(posOrderId)||!uuid.test(transactionId)||
      !Number.isSafeInteger(amountMinor)||amountMinor<=0)
    throw fail('QR_REFUND_INVALID','Некорректные реквизиты возврата кассы',400);
  await ensureRefundLedger(env.DB);
  const order=await env.DB.prepare(`SELECT o.id,o.menu_id,o.restaurant_id,o.payment_intent_id,
      o.payment_state,o.payment_method,o.total_minor,o.pos_order_id,
      pi.provider_order_id,pi.state AS paid_state,pi.workspace_id,
      pi.merchant_id,pi.total_minor AS paid_minor
    FROM qr_guest_orders o
    JOIN qr_payment_intents pi ON pi.id=o.payment_intent_id
      AND pi.menu_id=o.menu_id AND pi.restaurant_id=o.restaurant_id
    WHERE o.id=?1 AND o.restaurant_id=?2 AND o.pos_plugin_id=?3
      AND o.pos_order_id=?4 LIMIT 1`)
    .bind(externalOrderId,identity.departmentId,identity.pluginId,posOrderId).first();
  if(!order||order.paid_state!=='PAID_VERIFIED'||!order.provider_order_id||
      order.payment_state!=='PAID_ONLINE'||order.payment_method!=='PAYRIFF'||
      Number(order.total_minor)!==Number(order.paid_minor)||
      !uuid.test(order.provider_order_id))
    throw fail('QR_REFUND_PAYMENT_UNVERIFIED',
      'Возврат разрешён только по подтверждённой Payriff-оплате этого заказа',409);
  const existing=await env.DB.prepare(`SELECT * FROM qr_payriff_refunds
      WHERE intent_id=?1 AND transaction_id=?2 LIMIT 1`)
    .bind(order.payment_intent_id,transactionId).first();
  if(existing){
    if(Number(existing.amount_minor)!==amountMinor||existing.external_order_id!==externalOrderId)
      throw fail('QR_REFUND_REPLAY_MISMATCH','Сумма повторного возврата не совпадает',409);
    if(existing.state==='ACCEPTED')
      return {success:true,refundAccepted:true,duplicate:true,refundId:existing.id,
        note:'Возврат ранее принят Payriff, повторная отправка не выполнена.'};
    throw fail('QR_REFUND_UNCERTAIN',
      'Результат старого возврата неопределён. Повторная отправка запрещена; требуется сверка в Payriff.',409);
  }
  // UNKNOWN attempts reserve the amount until reconciled, including after a
  // power loss between the provider request and database confirmation.
  const totals=await env.DB.prepare(`SELECT
      COALESCE(SUM(amount_minor),0) AS reserved_minor,
      SUM(CASE WHEN state='UNKNOWN' THEN 1 ELSE 0 END) AS unknown_count
    FROM qr_payriff_refunds WHERE intent_id=?1`)
    .bind(order.payment_intent_id).first();
  if(Number(totals?.unknown_count||0)>0 ||
      amountMinor+Number(totals?.reserved_minor||0)>Number(order.total_minor))
    throw fail('QR_REFUND_LIMIT',
      'Сумма возврата превышает оплаченный остаток или есть неразрешённый возврат',409);
  const id=crypto.randomUUID(),t=now();
  const claim=await env.DB.prepare(`INSERT OR IGNORE INTO qr_payriff_refunds
    (id,intent_id,external_order_id,provider_order_id,transaction_id,
      amount_minor,state,created_at,updated_at)
    SELECT ?1,?2,?3,?4,?5,?6,'UNKNOWN',?7,?7
    WHERE (SELECT COALESCE(SUM(amount_minor),0) FROM qr_payriff_refunds
      WHERE intent_id=?2)+?6<=?8
      AND NOT EXISTS(SELECT 1 FROM qr_payriff_refunds WHERE intent_id=?2
        AND state='UNKNOWN') RETURNING id`)
    .bind(id,order.payment_intent_id,externalOrderId,order.provider_order_id,
      transactionId,amountMinor,t,order.total_minor).first();
  if(!claim)throw fail('QR_REFUND_CONCURRENT',
    'Другая операция возврата уже обрабатывается, не повторяйте запрос',409);
  const cfg=await fetchPaymentSettings(env.DB,{
    workspaceId:order.workspace_id,restaurantId:order.restaurant_id});
  if(!cfg||cfg.merchant_id!==order.merchant_id||!cfg.secret_encrypted)
    throw fail('QR_REFUND_MERCHANT_MISMATCH',
      'Реквизиты продавца изменились. Нужна сверка возврата',409);
  const secret=await decryptPaymentSecret(env,{
    workspaceId:order.workspace_id,restaurantId:order.restaurant_id,
    environment:cfg.environment,envelope:cfg.secret_encrypted});
  const abort=new AbortController();
  const timer=setTimeout(()=>abort.abort(),25000);
  let result;
  try{
    const rsp=await fetch('https://api.payriff.com/api/v3/refund',{
      method:'POST',signal:abort.signal,redirect:'error',
      headers:{Authorization:secret,'Content-Type':'application/json',
        Accept:'application/json','X-REQUEST-RRN':transactionId},
      body:JSON.stringify({orderId:order.provider_order_id,amount:amountMinor/100,
        refundReason:'iikoFront QR payment return '+transactionId})
    });
    result=await rsp.json().catch(()=>null);
    if(!rsp.ok||result?.code!=='00000')
      throw fail('QR_REFUND_PROVIDER_REJECTED',
        'Payriff не подтвердил возврат (HTTP '+rsp.status+'). Проверьте Transactions.',502);
    const responseId=/^[\w-]{1,80}$/.test(String(result?.responseId||''))
      ?String(result.responseId):'';
    const saved=await env.DB.prepare(`UPDATE qr_payriff_refunds
      SET state='ACCEPTED',response_id=?1,updated_at=?2
      WHERE id=?3 AND state='UNKNOWN' RETURNING id`)
      .bind(responseId,now(),id).first();
    if(!saved)throw fail('QR_REFUND_RECONCILIATION_REQUIRED',
      'Payriff принял возврат, но запись требует сверки. Не повторяйте операцию.',409);
    return {success:true,refundAccepted:true,refundId:id,
      note:'Payriff принял возврат. Зачисление клиенту зависит от банка.'};
  }catch(e){
    console.warn('[QR Pay] Payriff refund uncertain',{
      kind:e?.code||e?.name||'UNKNOWN',refundId:id});
    // Never retry automatically after a POST, even on a timeout.
    throw fail('QR_REFUND_UNCERTAIN',
      'Не удалось достоверно подтвердить возврат. Проверьте операцию Payriff; повторная попытка блокирована.',409);
  }finally{clearTimeout(timer)}
}
