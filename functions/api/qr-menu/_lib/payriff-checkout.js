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
async function requestPayriff(secret,url,{method='GET',body,fetcher=fetch}={}){
  const controller=new AbortController();
  const kill=setTimeout(()=>controller.abort(),12000);
  try{
    const r=await fetcher(url,{
      method,signal:controller.signal,redirect:'error',
      headers:{Authorization:secret,Accept:'application/json',
        ...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})
    });
    if(!r.ok)throw fail('PAYRIFF_GATEWAY_UNAVAILABLE',
      'Payriff не подтвердил запрос. Не повторяйте оплату до сверки',502);
    const result=await r.json().catch(()=>null);
    if(!result||typeof result!=='object'||result.code!=='00000')
      throw fail('PAYRIFF_GATEWAY_REJECTED','Payriff отклонил запрос',502);
    return result.payload;
  }catch(e){
    if(e?.status)throw e;
    throw fail('PAYRIFF_NETWORK_UNKNOWN',
      'Нет подтверждения от Payriff. Проверьте предыдущую попытку, не создавайте повторную оплату',503);
  }finally{clearTimeout(kill)}
}
export async function createPayriffCheckout({secret,amountMinor,reference,callbackUrl,redirectUrl,fetcher=fetch}){
  if(!Number.isSafeInteger(amountMinor)||amountMinor<1||amountMinor>50000000||
    !/^[a-f0-9-]{36}$/i.test(reference))
    throw fail('PAYMENT_INTENT_INVALID','Неверная сумма или номер платежа',400);
  const payload=await requestPayriff(secret,API+'/orders',{
    method:'POST',fetcher,
    body:{amount:amountMinor/100,currency:'AZN',language:'RU',
      operation:'PURCHASE',description:'Smart Horeca QR '+reference.slice(0,8),
      requestRRN:reference,callbackUrl,redirectUrl,cardSave:false}
  });
  const orderId=String(payload?.orderId||'');
  const paymentUrl=String(payload?.paymentUrl||'');
  let u;try{u=new URL(paymentUrl)}catch{}
  if(!uuid.test(orderId)||!u||u.protocol!=='https:'||
      (u.hostname!=='pay.payriff.com'&&!u.hostname.endsWith('.payriff.com')))
    throw fail('PAYRIFF_CHECKOUT_INVALID','Payriff вернул неподтверждённую платёжную ссылку',502);
  return {orderId,paymentUrl};
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
