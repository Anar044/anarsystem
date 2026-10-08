import { getUser } from '../iiko/_lib/user-state.js';
import { resolveAccessForUser, workspaceCookie } from './_lib/access-control.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors(),...extra}})}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){
  try{
    const auth=await getUser(request,env);
    if(!auth?.user)return json({success:false,allowed:false,reason:'UNAUTHENTICATED'},401);
    const url=new URL(request.url),invite=url.searchParams.get('invite')||'';
    const access=await resolveAccessForUser(env.DB,auth.user,{claimInvite:true,request,inviteToken:invite});
    const status=access.allowed?200:(access.reason==='WORKSPACE_SELECTION_REQUIRED'?409:403);
    const headers=access?.workspace?.id?{'Set-Cookie':workspaceCookie(access.workspace.id)}:{};
    return json({
      success:true,
      allowed:access.allowed,
      reason:access.reason||'',
      user:{id:auth.user.id,email:auth.user.email||''},
      access
    },status,headers);
  }catch(error){
    console.error('[ACCESS-ME]',error);
    return json({success:false,allowed:false,message:error?.message||String(error)},500);
  }
}
