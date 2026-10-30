import {adminContext,response,bad,fail,clean} from './_lib/orders.js';
import {
  ensurePaymentSettings,paymentSettingsScope,fetchPaymentSettings,
  encryptPaymentSecret,decryptPaymentSecret,safePaymentSettings
} from './_lib/payment-provider-settings.js';

const error=e=>bad(e?.status||500,e?.code||'PAYMENT_SETTINGS_ERROR',
  e?.status?e.message:'Не удалось обработать настройки Payriff');
const isManager=ctx=>ctx?.state?.access?.isOwner===true;
const validateMerchant=v=>{
  const s=clean(v,100);
  if(!/^[A-Za-z0-9][A-Za-z0-9._-]{3,79}$/.test(s))
    throw fail('PAYRIFF_MERCHANT_INVALID','Укажите действующий Merchant ID из Payriff Applications',400);
  return s;
};
function checkSameOrigin(request){
  const requestOrigin=new URL(request.url).origin;
  const origin=request.headers.get('Origin');
  if(origin&&origin!==requestOrigin)
    throw fail('PAYMENT_ORIGIN_MISMATCH','Запрос из другого источника запрещён',403);
}
export async function onRequestGet({request,env}){
  try{
    const ctx=await adminContext(request,env);
    const scope=paymentSettingsScope(ctx);
    await ensurePaymentSettings(env.DB);
    const row=await fetchPaymentSettings(env.DB,scope);
    return response({success:true,restaurantId:scope.restaurantId,
      workspaceId:scope.workspaceId,...safePaymentSettings(row,isManager(ctx))});
  }catch(e){return error(e)}
}
export async function onRequestPost({request,env}){
  try{
    checkSameOrigin(request);
    const ctx=await adminContext(request,env);
    if(!isManager(ctx))
      throw fail('PAYMENT_CONFIG_OWNER_REQUIRED',
        'Платёжные реквизиты может менять только владелец организации',403);
    const scope=paymentSettingsScope(ctx);
    if(!String(request.headers.get('Content-Type')||'').toLowerCase().includes('application/json'))
      throw fail('PAYMENT_JSON_REQUIRED','Требуется JSON',415);
    const raw=await request.text();
    if(raw.length>4096)throw fail('PAYMENT_CONFIG_TOO_LARGE','Слишком большой запрос',413);
    const body=JSON.parse(raw||'null');
    if(!body||typeof body!=='object'||Array.isArray(body))
      throw fail('PAYMENT_BAD_BODY','Некорректные настройки',400);
    // Browser may never choose the tenant or POS scope.
    if(body.workspaceId!==undefined||body.restaurantId!==undefined||body.ownerId!==undefined)
      throw fail('PAYMENT_SCOPE_FORGED','Контекст ресторана определяется только сервером',403);
    const action=clean(body.action,30),at=new Date().toISOString();
    await ensurePaymentSettings(env.DB);
    const existing=await fetchPaymentSettings(env.DB,scope);
    if(action==='disconnect'){
      if(body.confirm!==true)throw fail('PAYMENT_CONFIRM_REQUIRED','Подтвердите отключение провайдера',400);
      await env.DB.batch([
        env.DB.prepare(`DELETE FROM qr_payment_provider_settings
          WHERE workspace_id=?1 AND restaurant_id=?2 AND provider='PAYRIFF'`)
          .bind(scope.workspaceId,scope.restaurantId),
        env.DB.prepare(`INSERT INTO qr_payment_provider_audit
          (id,workspace_id,restaurant_id,actor_user_id,action,created_at)
          VALUES(?1,?2,?3,?4,'DISCONNECTED',?5)`)
          .bind(crypto.randomUUID(),scope.workspaceId,scope.restaurantId,
            ctx.state.user.id,at)
      ]);
      return response({success:true,notice:'Payriff отключён только для выбранного ресторана.',
        ...safePaymentSettings(null,true)});
    }
    if(action!=='save')throw fail('PAYMENT_ACTION_UNKNOWN','Неизвестная операция',400);
    const environment=clean(body.environment,30);
    if(environment!=='development')
      throw fail('PAYMENT_PRODUCTION_LOCKED',
        'Рабочие платежи недоступны до полной проверки оплаты и фискализации',409);
    const merchantId=validateMerchant(body.merchantId);
    const supplied=typeof body.secretKey==='string'?body.secretKey:'';
    let cipher='';
    if(supplied.trim()){
      cipher=await encryptPaymentSecret(env,{...scope,environment,secret:supplied});
    }else{
      if(!existing?.secret_encrypted||existing.merchant_id!==merchantId||
        existing.environment!==environment)
        throw fail('PAYRIFF_SECRET_REQUIRED',
          'Введите Secret Key для нового приложения или изменённого Merchant ID',400);
      // An unreadable existing secret must not silently pass validation.
      await decryptPaymentSecret(env,{...scope,environment,envelope:existing.secret_encrypted});
      cipher=existing.secret_encrypted;
    }
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO qr_payment_provider_settings
        (workspace_id,restaurant_id,provider,environment,merchant_id,secret_encrypted,enabled,created_at,updated_at)
        VALUES(?1,?2,'PAYRIFF',?3,?4,?5,0,?6,?6)
        ON CONFLICT(workspace_id,restaurant_id,provider) DO UPDATE SET
          environment=excluded.environment,merchant_id=excluded.merchant_id,
          secret_encrypted=excluded.secret_encrypted,enabled=0,updated_at=excluded.updated_at`)
        .bind(scope.workspaceId,scope.restaurantId,environment,merchantId,cipher,at),
      env.DB.prepare(`INSERT INTO qr_payment_provider_audit
        (id,workspace_id,restaurant_id,actor_user_id,action,created_at)
        VALUES(?1,?2,?3,?4,'CONFIG_SAVED',?5)`)
        .bind(crypto.randomUUID(),scope.workspaceId,scope.restaurantId,ctx.state.user.id,at)
    ]);
    return response({success:true,
      notice:'Настройки Payriff сохранены зашифрованными. Оплата и POS-заказы пока выключены.',
      ...safePaymentSettings({environment,merchant_id:merchantId,secret_encrypted:cipher,updated_at:at},true)});
  }catch(e){return error(e)}
}
