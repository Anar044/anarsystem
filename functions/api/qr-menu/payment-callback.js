// Untrusted notifications from Payriff. They are never evidence of payment.
// Guests/admin can only progress via server-to-server GET with stored merchant key.
export async function onRequestPost(){
  return new Response(JSON.stringify({accepted:true,verified:false}),{
    status:202,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
  });
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
