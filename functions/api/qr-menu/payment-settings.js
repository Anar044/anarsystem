import {adminContext,response,bad,fail,clean} from './_lib/orders.js';
import {hasPermission} from '../access/_lib/access-control.js';
import {
  ensurePaymentSettings,paymentSettingsScope,fetchPaymentSettings,
  encryptPaymentSecret,decryptPaymentSecret,safePaymentSettings
} from './_lib/payment-provider-settings.js';

const error=e=>bad(e?.status||500,e?.code||'PAYMENT_SETTINGS_ERROR',
  e?.status?e.message:'Не удалось обработать настройки Payriff');
// Owners and authorised organization administrators may configure payments
// only inside the restaurant scope resolved by adminContext.
const isManager=ctx=>ctx?.state?.access?.isOwner===true||
  hasPermission(ctx?.state?.access,'settings.manage');
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
    // Diagnostic reflects the exact same immutable restaurant/menu binding
    // that guest checkout requires. 'Enabled' alone is not checkout readiness.
    const [binding,qrMode]=await Promise.all([
      env.DB.prepare(`SELECT workspace_id,restaurant_id,owner_id FROM qr_payment_menu_bindings
        WHERE menu_id=?1 LIMIT 1`).bind(ctx.menu.id).first(),
      env.DB.prepare(`SELECT owner_id,restaurant_id,service_mode FROM qr_order_settings
        WHERE menu_id=?1 LIMIT 1`).bind(ctx.menu.id).first()
    ]);
    const scopeReady=Boolean(binding&&qrMode&&
      binding.workspace_id===scope.workspaceId&&
      binding.restaurant_id===scope.restaurantId&&
      binding.owner_id===ctx.ownerId&&
      qrMode.owner_id===ctx.ownerId&&
      qrMode.restaurant_id===scope.restaurantId);
    const previewReady=new URL(request.url).hostname===
      'feature-qr-order-internal-co.smarthoreca.pages.dev';
    const guestCheckoutReady=Boolean(row?.enabled===1&&
      row.environment==='development'&&row.secret_encrypted&&scopeReady&&previewReady);
    return response({success:true,restaurantId:scope.restaurantId,
      workspaceId:scope.workspaceId,guestCheckoutReady,
      testQrHost:'feature-qr-order-internal-co.smarthoreca.pages.dev',
      testQrScopeReady:scopeReady,
      encryptionReady:String(env.SMART_HORECA_STATE_ENCRYPTION_KEY||'').trim().length>=24,
      ...safePaymentSettings(row,isManager(ctx))});
  }catch(e){return error(e)}
}
export async function onRequestPost({request,env}){
  try{
    checkSameOrigin(request);
    const ctx=await adminContext(request,env);
    if(!isManager(ctx))
      throw fail('PAYMENT_CONFIG_OWNER_REQUIRED',
        'Платёжные реквизиты может менять только владелец или администратор с правом настройки',403);
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
    if(clean(body.expectedRestaurantId,128)!==scope.restaurantId)
      throw fail('PAYMENT_RESTAURANT_CHANGED','Ресторан изменился во время сохранения. Обновите страницу и повторите.',409);
    const action=clean(body.action,30),at=new Date().toISOString();
    await ensurePaymentSettings(env.DB);
    const existing=await fetchPaymentSettings(env.DB,scope);
    // A published QR menu is bound to exactly one workspace, regardless of
    // duplicate restaurant names or IDs in other organisations.
    const bound=await env.DB.prepare(`SELECT workspace_id,restaurant_id
      FROM qr_payment_menu_bindings WHERE menu_id=?1 LIMIT 1`)
      .bind(ctx.menu.id).first();
    if(bound&&(bound.workspace_id!==scope.workspaceId||
       bound.restaurant_id!==scope.restaurantId))
      throw fail('PAYMENT_MENU_ALREADY_BOUND','QR-меню уже закреплено за другой организацией',409);
    if(action==='setTestCheckout'){
      if(!existing?.secret_encrypted||!existing?.merchant_id||
          existing.environment!=='development')
        throw fail('PAYRIFF_NOT_CONFIGURED','Сначала сохраните тестовые ключи Payriff',409);
      await decryptPaymentSecret(env,{...scope,environment:'development',
        envelope:existing.secret_encrypted});
      const enabled=body.enabled===true?1:0;
      if(!['feature-qr-order-internal-co.smarthoreca.pages.dev'].includes(
        new URL(request.url).hostname))
        throw fail('PAYRIFF_TEST_PREVIEW_ONLY',
          'Тестовые платежи доступны только в выделенной Preview-ветке',409);
      await env.DB.batch([
        env.DB.prepare(`UPDATE qr_payment_provider_settings SET enabled=?1,updated_at=?2
          WHERE workspace_id=?3 AND restaurant_id=?4 AND provider='PAYRIFF'
            AND environment='development'`)
          .bind(enabled,at,scope.workspaceId,scope.restaurantId),
        env.DB.prepare(`INSERT INTO qr_payment_provider_audit
          (id,workspace_id,restaurant_id,actor_user_id,action,created_at)
          VALUES(?1,?2,?3,?4,?5,?6)`)
          .bind(crypto.randomUUID(),scope.workspaceId,scope.restaurantId,
            ctx.state.user.id,enabled?'TEST_CHECKOUT_ENABLED':'TEST_CHECKOUT_DISABLED',at)
      ]);
      return response({success:true,checkoutEnabled:Boolean(enabled),
        notice:enabled?'Тестовая оплата Payriff включена только для выбранного ресторана. Касса и печать заблокированы.':'Тестовая оплата выключена. Ранее созданные платежи можно сверить.'});
    }
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
      env.DB.prepare(`INSERT OR IGNORE INTO qr_payment_menu_bindings
        (menu_id,workspace_id,restaurant_id,owner_id,created_at)
        VALUES(?1,?2,?3,?4,?5)`)
        .bind(ctx.menu.id,scope.workspaceId,scope.restaurantId,ctx.ownerId,at),
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
