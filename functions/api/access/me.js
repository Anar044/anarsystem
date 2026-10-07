import { getUser } from '../iiko/_lib/user-state.js';
import { resolveAccessForUser } from './_lib/access-control.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){
  try{
    const auth=await getUser(request,env);
    if(!auth?.user)return json({success:false,allowed:false,reason:'UNAUTHENTICATED'},401);
    const access=await resolveAccessForUser(env.DB,auth.user,{claimInvite:true});
    return json({
      success:true,
      allowed:access.allowed,
      reason:access.reason||'',
      user:{id:auth.user.id,email:auth.user.email||''},
      access
    },access.allowed?200:403);
  }catch(error){
    console.error('[ACCESS-ME]',error);
    return json({success:false,allowed:false,message:error?.message||String(error)},500);
  }
}
