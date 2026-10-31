// Owner-facing Payriff attempt reconciliation. READ-ONLY with respect to
// payments: no POST to Payriff; never creates or repeats a charge.
import {adminContext,response,bad,fail,clean} from './_lib/orders.js';
import {paymentSettingsScope,fetchPaymentSettings,decryptPaymentSecret} from './_lib/payment-provider-settings.js';
import {readPayriffByReference,readPayriffPayment,classifyPayriffPayment} from './_lib/payriff-checkout.js';
import {hasPermission} from '../access/_lib/access-control.js';

const err=e=>bad(e?.status||503,e?.code||'PAYRIFF_HISTORY_UNAVAILABLE',
  e?.status?e.message:'Не удалось проверить предыдущую попытку Payriff');
const canManage=ctx=>ctx?.state?.access?.isOwner===true||
  hasPermission(ctx?.state?.access,'settings.manage');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const safe=row=>({
  id:row.id,createdAt:row.created_at,table:row.table_label,
  amountAZN:(row.total_minor/100).toFixed(2),state:row.state,
  providerOrderKnown:Boolean(row.provider_order_id),
  lastCheckedAt:row.last_checked_at||null,
});
async function context(request,env){
  const ctx=await adminContext(request,env);
  if(!canManage(ctx))throw fail('PAYRIFF_HISTORY_FORBIDDEN',
    'Проверка платёжных операций доступна владельцу или администратору настроек',403);
  return {ctx,scope:paymentSettingsScope(ctx)};
}
export async function onRequestGet({request,env}){
  try{
    const {scope}=await context(request,env);
    // A missing table means no local payment-intent store was initialised.
    // Do not create D1 tables as a side effect of viewing payment history.
    const table=await env.DB.prepare(`SELECT name FROM sqlite_master
      WHERE type='table' AND name='qr_payment_intents' LIMIT 1`).first();
    if(!table)return response({success:true,storageReady:false,attempts:[],
      notice:'Журнал платёжных попыток в этом окружении ещё не создан. Это не доказывает отсутствия операции у Payriff: проверьте Transactions в Payriff до новой попытки.'});
    const rows=await env.DB.prepare(`SELECT id,created_at,table_label,total_minor,
      state,provider_order_id,last_checked_at FROM qr_payment_intents
      WHERE workspace_id=?1 AND restaurant_id=?2
      ORDER BY created_at DESC LIMIT 25`)
      .bind(scope.workspaceId,scope.restaurantId).all();
    const attempts=(rows.results||[]).map(safe);
    // Refund details are read-only and still restricted to the authenticated
    // restaurant scope; they do not trigger or retry a bank refund.
    const refundsTable=await env.DB.prepare(`SELECT name FROM sqlite_master
      WHERE type='table' AND name='qr_payriff_refunds' LIMIT 1`).first();
    if(refundsTable){
      const refunds=await env.DB.prepare(`SELECT r.intent_id,
        COALESCE(SUM(CASE WHEN r.state='ACCEPTED' THEN r.amount_minor ELSE 0 END),0) AS accepted_minor,
        COALESCE(SUM(CASE WHEN r.state='UNKNOWN' THEN 1 ELSE 0 END),0) AS unknown_count
        FROM qr_payriff_refunds r JOIN qr_payment_intents p ON p.id=r.intent_id
        WHERE p.workspace_id=?1 AND p.restaurant_id=?2
        GROUP BY r.intent_id`)
        .bind(scope.workspaceId,scope.restaurantId).all();
      const byId=new Map((refunds.results||[]).map(x=>[x.intent_id,x]));
      for(const item of attempts){
        const summary=byId.get(item.id);
        if(summary)item.refund={
          acceptedAZN:(Number(summary.accepted_minor||0)/100).toFixed(2),
          needsReconciliation:Number(summary.unknown_count||0)>0
        };
      }
    }
    return response({success:true,storageReady:true,attempts,
      notice:attempts.length
        ?'Найдены платёжные попытки для выбранного ресторана.'
        :'В журнале этого ресторана нет записей. Если вы уже пробовали оплатить, проверьте Transactions в Payriff перед новой попыткой.'});
  }catch(e){
    if(!e?.status)console.error('[QR Pay] history lookup failed',{type:e?.name||'Error'});
    return err(e);
  }
}
export async function onRequestPost({request,env}){
  try{
    const origin=request.headers.get('Origin');
    if(origin&&origin!==new URL(request.url).origin)
      throw fail('PAYRIFF_ORIGIN_REJECTED','Чужой сайт не может проверять операции',403);
    const {scope}=await context(request,env);
    const body=await request.json().catch(()=>null);
    if(!body||body.action!=='reconcile'||!UUID.test(String(body.intentId||''))||
       body.expectedRestaurantId!==scope.restaurantId)
      throw fail('PAYRIFF_ATTEMPT_INVALID','Неверный номер попытки или ресторан',400);
    const intent=await env.DB.prepare(`SELECT * FROM qr_payment_intents
      WHERE id=?1 AND workspace_id=?2 AND restaurant_id=?3 LIMIT 1`)
      .bind(body.intentId,scope.workspaceId,scope.restaurantId).first();
    if(!intent)throw fail('PAYRIFF_ATTEMPT_NOT_FOUND','Попытка не найдена',404);
    if(['PAID_VERIFIED','FAILED'].includes(intent.state))
      return response({success:true,attempt:safe(intent),
        notice:'Это уже окончательно подтверждённый статус операции.'});
    if(!['CREATING','UNKNOWN','CHECKOUT'].includes(intent.state))
      throw fail('PAYRIFF_ATTEMPT_UNSUPPORTED','Операцию нужно сверить вручную',409);
    const cfg=await fetchPaymentSettings(env.DB,scope);
    if(!cfg||cfg.environment!=='development'||cfg.merchant_id!==intent.merchant_id)
      throw fail('PAYRIFF_CONFIG_CHANGED','Ключи приложения изменены. Сверьте операцию в Payriff вручную',409);
    const expires=new Date(Date.now()-15000).toISOString();
    const checkedAt=new Date().toISOString();
    const claimed=await env.DB.prepare(`UPDATE qr_payment_intents SET last_checked_at=?1
      WHERE id=?2 AND workspace_id=?3 AND restaurant_id=?4
        AND (last_checked_at='' OR last_checked_at<?5)
      RETURNING id`)
      .bind(checkedAt,intent.id,scope.workspaceId,scope.restaurantId,expires).first();
    if(!claimed)throw fail('PAYRIFF_CHECK_TOO_SOON','Проверка уже запущена. Повторите позже',429);
    intent.last_checked_at=checkedAt;
    const secret=await decryptPaymentSecret(env,{...scope,environment:'development',
      envelope:cfg.secret_encrypted});
    let info;
    try{
      info=intent.provider_order_id
        ?await readPayriffPayment({secret,orderId:intent.provider_order_id})
        :await readPayriffByReference({secret,reference:intent.id});
    }catch(e){
      // A failed GET /orders/{RRN}/rrn is NOT evidence that the payment
      // failed or never existed. Return a safe, precise lookup code.
      const lookupCode=/^PAYRIFF_[A-Z0-9_]{1,55}$/.test(String(e?.code||''))
        ?e.code:'PAYRIFF_STATUS_UNAVAILABLE';
      const responseId=/^[A-Za-z0-9_-]{1,80}$/.test(String(e?.providerResponseId||''))
        ?String(e.providerResponseId):null;
      const providerRejected=lookupCode==='PAYRIFF_HTTP_400_CODE_01000';
      console.warn('[QR Pay] admin reconciliation unresolved',{kind:lookupCode,responseId});
      const notice=providerRejected
        ?'Payriff отклонил ЗАПРОС ПРОВЕРКИ (HTTP 400, код 01000). '+
          'Возможны ограничения приложения/ключа или отсутствие RRN у старой попытки. '+
          'Это НЕ означает отмену оплаты. Проверьте статус приложения и соответствие ключей в Payriff Applications, '+
          'обе операции в Transactions и сообщите поддержке responseId '+
          (responseId||'(не предоставлен)')+'. Повторный платёж не создавайте.'
        :'Статус не подтверждён Payriff ('+lookupCode+
          (responseId?', responseId '+responseId:'')+
          '). Это не означает отказ или отсутствие платежа. Проверьте Transactions в Payriff; не создавайте вторую оплату.';
      return response({success:true,attempt:safe(intent),
        reconciliation:{outcome:'UNCONFIRMED',code:lookupCode,checkedAt,responseId,
          providerRequestRejected:providerRejected},
        notice});
    }
    const providerOrderId=String(info?.orderId||'');
    const consistent=UUID.test(providerOrderId)&&
      (!info.merchantId||String(info.merchantId)===intent.merchant_id)&&
      info.currencyType==='AZN'&&info.operationType==='PURCHASE'&&
      (!intent.provider_order_id||intent.provider_order_id===providerOrderId);
    const status=consistent?classifyPayriffPayment(info,{
      orderId:providerOrderId,amountMinor:intent.total_minor}):'MISMATCH';
    if(status==='MISMATCH')
      throw fail('PAYRIFF_PAYMENT_MISMATCH',
        'Данные Payriff не совпадают с заказом. Остановите тесты и проверьте операцию вручную',409);
    if(['PAID_VERIFIED','FAILED'].includes(status)){
      await env.DB.prepare(`UPDATE qr_payment_intents SET state=?1,
        provider_order_id=?2,updated_at=?3
        WHERE id=?4 AND workspace_id=?5 AND restaurant_id=?6
          AND state IN ('UNKNOWN','CREATING','CHECKOUT')`)
        .bind(status,providerOrderId,new Date().toISOString(),intent.id,
          scope.workspaceId,scope.restaurantId).run();
      intent.state=status;intent.provider_order_id=providerOrderId;
    }
    return response({success:true,attempt:safe(intent),
      reconciliation:{outcome:status,code:status==='PENDING'
        ?'PAYRIFF_PENDING':'PAYRIFF_'+status,checkedAt},
      notice:status==='PAID_VERIFIED'
        ?'Оплата подтверждена Payriff. Заказ на кассу не отправлялся.'
        :status==='FAILED'?'Payriff подтвердил отказ/отмену.'
        :'Операция существует, но её оплата ещё не подтверждена. Не создавайте новый платёж.'});
  }catch(e){return err(e)}
}
