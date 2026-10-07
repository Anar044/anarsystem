import { getUser } from '../iiko/_lib/user-state.js';
import { resolveAccessForUser, hasPermission, listAccessAdmin, saveRole, upsertMember, setMemberStatus } from './_lib/access-control.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}

async function ctx(request,env){
  const auth=await getUser(request,env);
  if(!auth?.user)return{error:json({success:false,message:'Требуется авторизация'},401)};
  const access=await resolveAccessForUser(env.DB,auth.user,{claimInvite:true});
  if(!access.allowed)return{error:json({success:false,message:'Доступ к организации не назначен.',reason:access.reason},403)};
  if(!hasPermission(access,'access.manage'))return{error:json({success:false,message:'Недостаточно прав для управления пользователями.'},403)};
  return{auth,access};
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{
    const c=await ctx(request,env);if(c.error)return c.error;
    const data=await listAccessAdmin(env.DB,c.access.ownerUserId);
    return json({success:true,...data,current:{memberId:c.access.memberId,isOwner:c.access.isOwner}});
  }catch(error){console.error('[ACCESS-ADMIN:GET]',error);return json({success:false,message:error?.message||String(error)},error?.status||500)}
}

export async function onRequestPost({request,env}){
  try{
    const c=await ctx(request,env);if(c.error)return c.error;
    const body=await request.json().catch(()=>({})),action=clean(body?.action);
    if(action==='save-role'){
      const id=await saveRole(env.DB,c.access.ownerUserId,body.role||{});
      return json({success:true,id});
    }
    if(action==='save-member'){
      const id=await upsertMember(env.DB,c.access.ownerUserId,body.member||{});
      return json({success:true,id});
    }
    if(action==='set-member-status'){
      await setMemberStatus(env.DB,c.access.ownerUserId,clean(body.memberId),body.status);
      return json({success:true});
    }
    return json({success:false,message:'Неизвестное действие.'},400);
  }catch(error){console.error('[ACCESS-ADMIN:POST]',error);return json({success:false,message:error?.message||String(error)},error?.status||500)}
}
