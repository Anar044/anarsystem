// Read-only Cloudflare -> Payriff transport probe for an authenticated
// organisation owner/admin. Does NOT create, capture, refund or retry payments.
import {adminContext,response,bad,fail} from './_lib/orders.js';
import {paymentSettingsScope,fetchPaymentSettings,decryptPaymentSecret} from './_lib/payment-provider-settings.js';
import {hasPermission} from '../access/_lib/access-control.js';

const PREVIEW='feature-qr-order-internal-co.smarthoreca.pages.dev';
const ORIGIN='https://api.payriff.com';
const ORDER_PROBE=ORIGIN+'/api/v3/orders/00000000-0000-4000-8000-000000000000/rrn';
const CAUSE_CODES=new Set(['ENOTFOUND','EAI_AGAIN','ETIMEDOUT','ECONNREFUSED',
  'ECONNRESET','EPIPE','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID']);
const failureKind=(e,aborted)=>{
  if(aborted||e?.name==='AbortError')return 'TIMEOUT';
  if(e?.name==='TypeError')return 'FETCH_TYPE_ERROR';
  return 'TRANSPORT_ERROR';
};
const safeCause=e=>{
  const code=String(e?.cause?.code||e?.code||'');
  return CAUSE_CODES.has(code)?code:null;
};
export async function onRequestGet({request,env}){
  try{
    if(new URL(request.url).hostname!==PREVIEW)
      throw fail('PAYRIFF_DIAGNOSTIC_PREVIEW_ONLY','Проверка разрешена только в тестовом Preview',403);
    const ctx=await adminContext(request,env);
    if(ctx?.state?.access?.isOwner!==true&&
        !hasPermission(ctx?.state?.access,'settings.manage'))
      throw fail('PAYRIFF_DIAGNOSTIC_FORBIDDEN','Нет права управлять платёжными настройками',403);
    const scope=paymentSettingsScope(ctx);
    const cfg=await fetchPaymentSettings(env.DB,scope);
    if(!cfg?.secret_encrypted||cfg.environment!=='development')
      throw fail('PAYRIFF_DIAGNOSTIC_NOT_CONFIGURED','Тестовые реквизиты Payriff не настроены',409);
    const secret=await decryptPaymentSecret(env,{...scope,environment:'development',
      envelope:cfg.secret_encrypted});
    const controller=new AbortController();
    const started=Date.now();
    const timeout=setTimeout(()=>controller.abort(),15000);
    try{
      // GET of a fixed, synthetic reference tests TLS, routing and HTTP response.
      // Even HTTP 401, 403 or 404 means an HTTP server responded; these statuses
      // do not prove that the merchant secret or transaction is valid.
      const result=await fetch(ORDER_PROBE,{
        method:'GET',headers:{Authorization:secret,Accept:'application/json'},
        redirect:'manual',cache:'no-store',signal:controller.signal});
      const elapsedMs=Date.now()-started;
      return response({success:true,probe:'READ_ONLY_SYNTHETIC_RRN',
        reachedHttp:true,httpStatus:result.status,redirected:result.status>=300&&result.status<400,
        elapsedMs,
        note:'HTTPS-сервер ответил на тестовый GET. Это не подтверждает существование платежа или правильность Merchant ID; новых списаний нет.'});
    }catch(e){
      const kind=failureKind(e,controller.signal.aborted);
      const causeCode=safeCause(e);
      console.warn('[QR Pay] outbound Payriff probe failed',{kind,causeCode,
        elapsedMs:Date.now()-started});
      return response({success:true,probe:'READ_ONLY_SYNTHETIC_RRN',
        reachedHttp:false,httpStatus:null,kind,causeCode,
        elapsedMs:Date.now()-started,
        note:'Исходящее соединение Cloudflare → Payriff не завершилось HTTP-ответом. Проверьте сетевые логи Cloudflare и доступность адреса API. Это не статус оплаты.'});
    }finally{clearTimeout(timeout)}
  }catch(e){
    return bad(e?.status||503,e?.code||'PAYRIFF_PROBE_UNAVAILABLE',
      e?.status?e.message:'Сервер не смог выполнить проверку связи Payriff');
  }
}
