// Payriff development-only configuration and authoritative order verification.
// This module never creates a charge and must not be used as a payment-status
// shortcut in the browser. Merchant credentials remain Cloudflare Secrets.
const str=(v,max=256)=>String(v??'').trim().slice(0,max);
const ORDER_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ALLOWED_HOST=/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/i;

export function payriffTestConfig(env,request,restaurantId){
  const mode=str(env?.PAYRIFF_TEST_MODE,32).toLowerCase();
  const merchantId=str(env?.PAYRIFF_TEST_MERCHANT_ID,80);
  const secretKey=str(env?.PAYRIFF_TEST_SECRET_KEY,256);
  const scopedRestaurant=str(env?.PAYRIFF_TEST_RESTAURANT_ID,100);
  const scopedHost=str(env?.PAYRIFF_TEST_HOST,255).toLowerCase();
  const host=new URL(request.url).hostname.toLowerCase();
  // Never enable using an unscoped, production, or wildcard environment.
  const scoped=mode==='development'&&Boolean(scopedRestaurant&&scopedHost)&&
    Boolean(restaurantId)&&restaurantId===scopedRestaurant&&host===scopedHost&&
    ALLOWED_HOST.test(scopedHost)&&
    scopedHost.endsWith('.smarthoreca.pages.dev')&&
    scopedHost!=='smarthoreca.pages.dev';
  return {scoped,configured:scoped&&Boolean(merchantId&&secretKey),
    mode:mode==='development'?'development':'disabled',
    merchantId,secretKey};
}
function parseAmountMinor(value){
  // The gateway reports amounts in AZN major units. Avoid float tolerance
  // that could permit a mismatched purchase amount.
  if(typeof value!=='number'&&typeof value!=='string')return null;
  const v=String(value).trim();
  if(!/^(?:0|[1-9]\d{0,10})(?:\.\d{1,2})?$/.test(v))return null;
  const [major,fraction='']=v.split('.');
  const n=Number(major)*100+Number(fraction.padEnd(2,'0'));
  return Number.isSafeInteger(n)?n:null;
}
export function verifyPaidPayriffOrder(raw,expected){
  const data=raw?.payload;
  if(raw?.code!=='00000'||!data||typeof data!=='object'||Array.isArray(data))
    return {verified:false,reason:'PAYRIFF_RESPONSE_INVALID'};
  const orderId=str(data.orderId,100);
  if(!orderId||orderId!==expected.orderId)return {verified:false,reason:'PAYRIFF_ORDER_MISMATCH'};
  if(data.paymentStatus!=='APPROVED')
    return {verified:false,reason:'PAYRIFF_NOT_CAPTURED'};
  if(data.operationType!=='PURCHASE')
    return {verified:false,reason:'PAYRIFF_NOT_PURCHASE'};
  if(data.currencyType!=='AZN'||expected.currency!=='AZN')
    return {verified:false,reason:'PAYRIFF_CURRENCY_MISMATCH'};
  if(parseAmountMinor(data.amount)!==expected.amountMinor||
    parseAmountMinor(data.paidAmount)!==expected.amountMinor)
    return {verified:false,reason:'PAYRIFF_AMOUNT_MISMATCH'};
  if(data.merchantId&&str(data.merchantId,80)!==expected.merchantId)
    return {verified:false,reason:'PAYRIFF_MERCHANT_MISMATCH'};
  // The API may not return merchantId, so only use order IDs previously
  // issued by our own scoped account and associated in our payment-intent DB.
  if(!expected.providerOrderBound||!expected.merchantId)
    return {verified:false,reason:'PAYRIFF_INTENT_NOT_BOUND'};
  return {verified:true,orderId,transactionId:str(data.externalTransactionId,100)};
}
export async function getPayriffOrderTest(config,orderId,fetcher=fetch){
  if(!config?.configured||!ORDER_UUID.test(String(orderId||'')))
    throw new Error('PAYRIFF_TEST_NOT_CONFIGURED');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9000);
  try{
    const url='https://api.payriff.com/api/v3/orders/'+encodeURIComponent(orderId);
    const response=await fetcher(url,{
      method:'GET',headers:{Authorization:config.secretKey,Accept:'application/json'},
      signal:controller.signal,redirect:'error'
    });
    if(!response.ok)throw new Error('PAYRIFF_LOOKUP_UNAVAILABLE');
    const json=await response.json();
    if(!json||typeof json!=='object')throw new Error('PAYRIFF_LOOKUP_INVALID');
    return json;
  }finally{clearTimeout(timeout)}
}
