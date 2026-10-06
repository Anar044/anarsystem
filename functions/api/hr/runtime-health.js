function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({env}){
  const out={
    success:true,
    marker:'HR_RUNTIME_HEALTH_V1',
    hasDb:Boolean(env?.DB),
    hasSupabaseUrl:Boolean(env?.SUPABASE_URL),
    hasSupabasePublishableKey:Boolean(env?.SUPABASE_PUBLISHABLE_KEY),
    d1:{ok:false,error:''}
  };
  if(!env?.DB){
    out.success=false;
    out.d1.error='DB binding missing';
    return json(out,503);
  }
  try{
    const row=await env.DB.prepare('SELECT 1 AS ok').first();
    out.d1.ok=Number(row?.ok||0)===1;
    return json(out,out.d1.ok?200:503);
  }catch(error){
    out.success=false;
    out.d1.error=String(error?.message||error||'D1 error').slice(0,500);
    return json(out,503);
  }
}
