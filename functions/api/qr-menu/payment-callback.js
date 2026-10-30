// Untrusted notifications from Payriff. They are never evidence of payment.
// Guests/admin can only progress via server-to-server GET with stored merchant key.
export async function onRequestPost(){
  return new Response(JSON.stringify({accepted:true,verified:false}),{
    status:202,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}
  });
}
export async function onRequestGet(){
  return new Response(null,{status:405,headers:{Allow:'POST'}});
}
