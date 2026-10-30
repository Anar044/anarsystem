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
    const rows=await env.DB.prepare(`SELECT id,created_at,table_label,total_minor,
      state,provider_order_id,last_checked_at FROM qr_payment_intents
      WHERE workspace_id=?1 AND restaurant_id=?2
      ORDER BY created_at DESC LIMIT 25`)
      .bind(scope.workspaceId,scope.restaurantId).all();
    return response({success:true,attempts:(rows.results||[]).map(safe)});
  }catch(e){return err(e)}
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
    const claimed=await env.DB.prepare(`UPDATE qr_payment_intents SET last_checked_at=?1
      WHERE id=?2 AND workspace_id=?3 AND restaurant_id=?4
        AND (last_checked_at='' OR last_checked_at<?5)
      RETURNING id`)
      .bind(new Date().toISOString(),intent.id,scope.workspaceId,scope.restaurantId,expires).first();
    if(!claimed)throw fail('PAYRIFF_CHECK_TOO_SOON','Проверка уже запущена. Повторите позже',429);
    const secret=await decryptPaymentSecret(env,{...scope,environment:'development',
      envelope:cfg.secret_encrypted});
    let info;
    try{
      info=intent.provider_order_id
        ?await readPayriffPayment({secret,orderId:intent.provider_order_id})
        :await readPayriffByReference({secret,reference:intent.id});
    }catch(e){
      console.warn('[QR Pay] admin reconciling uncertain',{kind:e?.code||'NETWORK'});
      return response({success:true,attempt:safe(intent),
        notice:'Payriff не подтвердил статус. Повторную оплату не создавайте. Проверьте Transactions в Payriff.'});
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
      notice:status==='PAID_VERIFIED'
        ?'Оплата подтверждена Payriff. Заказ на кассу не отправлялся.'
        :status==='FAILED'?'Payriff подтвердил отказ/отмену.'
        :'Операция существует, но её оплата ещё не подтверждена. Не создавайте новый платёж.'});
  }catch(e){return err(e)}
}
