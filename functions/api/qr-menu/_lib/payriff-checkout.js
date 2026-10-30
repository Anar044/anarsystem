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
      method,signal:controller.signal,redirect:'error',
      headers:{Authorization:secret,Accept:'application/json',
        ...(body?{'Content-Type':'application/json'}:{}),
        ...(reference?{'X-REQUEST-RRN':reference}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    if(!r.ok){
      // Safe diagnostics: never log the auth header or the response body.
      console.error('[QR Pay] gateway HTTP error',{method,httpStatus:r.status});
      throw fail('PAYRIFF_HTTP_'+r.status,
        'Payriff вернул HTTP '+r.status+'. Проверьте приложение и ключи в настройках QR Pay.',502);
    }
    const result=await r.json().catch(()=>null);
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
    console.error('[QR Pay] gateway transport uncertain',
      {method,type:e?.name||'Error'});
    throw fail('PAYRIFF_NETWORK_UNKNOWN',
      'Нет ответа Payriff (возможен тайм-аут). Не запускайте новый платёж до проверки предыдущего.',503);
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
