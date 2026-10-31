// A Payriff callback is a HINT, never proof of payment. Verify the existing
// provider order directly using this restaurant's stored merchant secret.
import {fetchPaymentSettings,decryptPaymentSecret} from './_lib/payment-provider-settings.js';
import {readPayriffPayment,classifyPayriffPayment} from './_lib/payriff-checkout.js';

const ack=(verified=false,request=null)=>{
  // In rare Hosted Checkout flows the final browser navigation is a POST.
  // Give navigational requests an actual page instead of a JSON/blank screen.
  const url=request?new URL(request.url):null;
  const ticket=url?.searchParams.get('qrPaymentTicket')||'';
  if(url&&request.headers.get('Accept')?.includes('text/html')&&
      /^[a-f0-9]{64}$/.test(ticket)){
    const dest=new URL('/qr-payment-return.html',url.origin);
    for(const key of ['qrPaymentTicket','id','table']){
      const value=url.searchParams.get(key);
      if(value)dest.searchParams.set(key,value);
    }
    return new Response(null,{status:303,headers:{
      Location:dest.href,'Cache-Control':'no-store',
      'Referrer-Policy':'no-referrer'
    }});
  }
  return new Response(JSON.stringify({accepted:true,verified}),{
    status:202,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
  });
};
export async function onRequestPost({request,env}){
  try{
    const url=new URL(request.url);
    // This secret is only assigned in the creation of a scoped payment intent.
    // Never use a callback-supplied orderId, merchantId, amount or status.
    const ticket=url.searchParams.get('qrPaymentTicket')||'';
    if(!/^[a-f0-9]{64}$/.test(ticket))return ack(false,request);
    const intent=await env.DB.prepare(`SELECT * FROM qr_payment_intents
      WHERE receipt_token=?1 LIMIT 1`).bind(ticket).first();
    if(!intent||intent.state!=='CHECKOUT'||!intent.provider_order_id)return ack(false,request);
    const cfg=await fetchPaymentSettings(env.DB,{
      workspaceId:intent.workspace_id,restaurantId:intent.restaurant_id});
    if(!cfg||cfg.merchant_id!==intent.merchant_id)return ack(false,request);
    const secret=await decryptPaymentSecret(env,{
      workspaceId:intent.workspace_id,restaurantId:intent.restaurant_id,
      environment:cfg.environment,envelope:cfg.secret_encrypted});
    const info=await readPayriffPayment({secret,orderId:intent.provider_order_id});
    if(info?.merchantId&&String(info.merchantId)!==intent.merchant_id)return ack(false,request);
    const result=classifyPayriffPayment(info,{
      orderId:intent.provider_order_id,amountMinor:intent.total_minor});
    if(result!=='PAID_VERIFIED'&&result!=='FAILED')return ack(false,request);
    // Atomic state transition. Duplicate callbacks cannot mark duplicate sales,
    // create a POS order, or generate a second debit.
    const updated=await env.DB.prepare(`UPDATE qr_payment_intents
      SET state=?1,updated_at=?2 WHERE id=?3 AND state='CHECKOUT'
        AND provider_order_id=?4`)
      .bind(result,new Date().toISOString(),intent.id,intent.provider_order_id).run();
    return ack(Boolean(updated?.meta?.changes),request);
  }catch(e){
    console.warn('[QR Pay] callback reconciliation postponed',{
      kind:e?.code||'VERIFY_UNAVAILABLE'
    });
    // A later guest/admin read can re-check the original order.
    return ack(false,request);
  }
}
// Some hosted-checkout flows navigate a browser to the configured
// callbackUrl (GET). An empty 405 page looks like a blank checkout screen.
// Navigation here is NEVER payment verification and cannot mark an order paid.
export async function onRequestGet({request}){
  const url=new URL(request.url);
  const ticket=url.searchParams.get('qrPaymentTicket')||'';
  const id=url.searchParams.get('id')||'',table=url.searchParams.get('table')||'';
  if(!/^[a-f0-9]{64}$/.test(ticket)){
    // Show a visible recovery page, not a white HTTP 405.
    return Response.redirect(url.origin+'/qr-payment-return.html',303);
  }
  const returnUrl=new URL('/qr-payment-return.html',url.origin);
  returnUrl.searchParams.set('qrPaymentTicket',ticket);
  if(id)returnUrl.searchParams.set('id',id);
  if(table)returnUrl.searchParams.set('table',table);
  return new Response(null,{status:303,headers:{
    Location:returnUrl.href,'Cache-Control':'no-store',
    'Referrer-Policy':'no-referrer'
  }});
}
