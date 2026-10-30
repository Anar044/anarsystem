// Hosted payment API. Only called with decrypted server-side merchant credentials.
// Exact Payriff Azerbaijan endpoints. Never proxy arbitrary URLs from a guest.
import {fail} from './orders.js';
const API='https://api.payriff.com/api/v3';
const uuid=/^[a-f0-9-]{36}$/i;
const money=x=>{
  const v=String(x??'');
  if(!/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(v))return null;
  const [w,f='']=v.split('.');
  const n=Number(w)*100+Number(f.padEnd(2,'0'));
  return Number.isSafeInteger(n)?n:null;
};
async function requestPayriff(secret,url,{method='GET',body,reference,fetcher=fetch}={}){
  const controller=new AbortController();
  // Payriff's official SDK allows substantial time for bank operations.
  // Never automatically repeat a POST after an uncertain result.
  const kill=setTimeout(()=>controller.abort(),45000);
  try{
    const r=await fetcher(url,{
      // Inspect 3xx rather than classifying a redirect as a network error.
      // Never follow a redirect with merchant credentials.
      method,signal:controller.signal,redirect:'manual',
      headers:{Authorization:secret,Accept:'application/json',
        ...(body?{'Content-Type':'application/json'}:{}),
        ...(reference?{'X-REQUEST-RRN':reference}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    if(r.status>=300&&r.status<400){
      console.warn('[QR Pay] gateway unexpected redirect',{method,httpStatus:r.status});
      throw fail('PAYRIFF_UNEXPECTED_REDIRECT',
        'Payriff перенаправил API-запрос (HTTP '+r.status+'). Нужна проверка адреса API; повторную оплату не создавайте.',502);
    }
    // Read the provider's structured error code even for HTTP 4xx/5xx.
    // Only allow well-formed code/responseId; never expose raw error JSON,
    // which might include request parameters or merchant details.
    const result=await r.json().catch(()=>null);
    if(!r.ok){
      const providerCode=/^[A-Za-z0-9_-]{2,25}$/.test(String(result?.code||''))
        ?String(result.code).toUpperCase():null;
      const responseId=/^[A-Za-z0-9_-]{1,80}$/.test(String(result?.responseId||''))
        ?String(result.responseId):null;
      console.warn('[QR Pay] gateway HTTP error',{
        method,httpStatus:r.status,providerCode,responseId
      });
      const lookupError=fail('PAYRIFF_HTTP_'+r.status+(providerCode?'_CODE_'+providerCode:''),
        'Payriff вернул HTTP '+r.status+
        (providerCode?', код '+providerCode:'')+
        (responseId?', responseId '+responseId:'')+
        '. Это не подтверждает отсутствие операции; проверьте Transactions.',502);
      lookupError.providerResponseId=responseId;
      throw lookupError;
    }
    if(!result||typeof result!=='object')
      throw fail('PAYRIFF_RESPONSE_INVALID',
        'Payriff не вернул читаемый ответ. Проверьте предыдущую попытку.',502);
    if(result.code!=='00000'){
      const providerCode=String(result.code||'UNKNOWN').replace(/[^A-Za-z0-9_-]/g,'').slice(0,25);
      const responseId=String(result.responseId||'').replace(/[^A-Za-z0-9_-]/g,'').slice(0,70);
      console.error('[QR Pay] gateway rejected',{method,providerCode,responseId});
      throw fail('PAYRIFF_REJECTED_'+providerCode,
        'Payriff отклонил запрос (код '+providerCode+'). Сверьте операцию в Payriff.',502);
    }
    return result.payload;
  }catch(e){
    if(e?.status)throw e;
    const timeout=controller.signal.aborted||e?.name==='AbortError';
    const kind=timeout?'PAYRIFF_TIMEOUT':'PAYRIFF_CONNECT_FAILED';
    // Only log a restricted machine-readable cause code. Raw exception
    // messages may contain addresses or sensitive request parameters.
    const knownCauses=new Set(['ENOTFOUND','EAI_AGAIN','ECONNRESET','ECONNREFUSED',
      'ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET',
      'CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE']);
    const rawCode=String(e?.cause?.code||'');
    console.error('[QR Pay] gateway transport uncertain',{
      method,kind,errorType:e?.name||'Error',
      causeCode:knownCauses.has(rawCode)?rawCode:null
    });
    throw fail(kind,
      timeout
        ?'Истекло время ожидания Payriff. Не создавайте повторную оплату до сверки.'
        :'Не удалось установить соединение с Payriff. Проверьте серверную связь; предыдущую оплату не повторяйте.',503);
  }finally{clearTimeout(kill)}
}
export async function createPayriffCheckout({secret,amountMinor,reference,callbackUrl,redirectUrl,fetcher=fetch}){
  if(!Number.isSafeInteger(amountMinor)||amountMinor<1||amountMinor>50000000||
    !/^[a-f0-9-]{36}$/i.test(reference))
    throw fail('PAYMENT_INTENT_INVALID','Неверная сумма или номер платежа',400);
  const payload=await requestPayriff(secret,API+'/orders',{
    method:'POST',fetcher,reference,
    body:{amount:amountMinor/100,currency:'AZN',language:'RU',
      operation:'PURCHASE',description:'Smart Horeca QR '+reference.slice(0,8),
      callbackUrl,redirectUrl,cardSave:false}
  });
  const orderId=String(payload?.orderId||'');
  const paymentUrl=String(payload?.paymentUrl||'');
  let u;try{u=new URL(paymentUrl)}catch{}
  if(!uuid.test(orderId)||!u||u.protocol!=='https:'||
      (u.hostname!=='pay.payriff.com'&&!u.hostname.endsWith('.payriff.com')))
    throw fail('PAYRIFF_CHECKOUT_INVALID','Payriff вернул неподтверждённую платёжную ссылку',502);
  return {orderId,paymentUrl};
}
// Official Payriff SDK supports GET /orders/{requestRRN}/rrn.
// This is READ-ONLY: safe for recovering a timed-out create request.
export async function readPayriffByReference({secret,reference,fetcher=fetch}){
  if(!uuid.test(String(reference||'')))
    throw fail('PAYRIFF_REFERENCE_INVALID','Неверный идентификатор сверки',400);
  return requestPayriff(secret,API+'/orders/'+encodeURIComponent(reference)+'/rrn',{fetcher});
}
export async function readPayriffPayment({secret,orderId,fetcher=fetch}){
  if(!uuid.test(orderId))throw fail('PAYRIFF_ORDER_ID_INVALID','Неверный ID транзакции',400);
  return requestPayriff(secret,API+'/orders/'+encodeURIComponent(orderId),{fetcher});
}
export function classifyPayriffPayment(data,{orderId,amountMinor}){
  if(!data||String(data.orderId||'')!==orderId)return 'MISMATCH';
  if(data.currencyType!=='AZN'||data.operationType!=='PURCHASE'||money(data.amount)!==amountMinor)
    return 'MISMATCH';
  if(data.paidAmount!==undefined&&data.paidAmount!==null&&money(data.paidAmount)!==amountMinor)
    return 'MISMATCH';
  const status=String(data.paymentStatus||'').toUpperCase();
  if(status==='APPROVED')return 'PAID_VERIFIED';
  if(['DECLINED','CANCELED','CANCELLED','EXPIRED','REFUNDED','REVERSED'].includes(status))
    return 'FAILED';
  return 'PENDING';
}
