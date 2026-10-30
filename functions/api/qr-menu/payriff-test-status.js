// Authenticated, read-only readiness check for a single Payriff Development
// merchant on QR Preview. Does not charge cards or expose credentials.
import {adminContext,response,bad} from './_lib/orders.js';
import {payriffTestConfig} from './_lib/payriff-test.js';

export async function onRequestGet({request,env}){
  try{
    const ctx=await adminContext(request,env);
    const cfg=payriffTestConfig(env,request,ctx.restaurantId);
    return response({
      success:true,
      provider:'PAYRIFF',
      environment:cfg.mode,
      scoped:cfg.scoped,
      configured:cfg.configured,
      ordersEnabled:false,
      paymentsEnabled:false,
      note:cfg.configured
        ?'Тестовые ключи доступны серверу. Платёжный checkout пока не включён.'
        :'Добавьте тестовые Merchant ID и Secret Key в Cloudflare Preview Secrets и настройте scope.'
    });
  }catch(e){
    return bad(e.status||500,e.code||'PAYRIFF_TEST_STATUS_ERROR',
      e.status?e.message:'Не удалось проверить тестовое подключение Payriff');
  }
}
