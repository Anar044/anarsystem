import { getInvitePreview } from './_lib/access-control.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){
  try{
    const token=new URL(request.url).searchParams.get('token')||'';
    if(!token)return json({success:false,message:'Приглашение не указано.'},400);
    const invite=await getInvitePreview(env.DB,token);
    if(!invite)return json({success:false,message:'Приглашение не найдено.'},404);
    if(invite.status!=='PENDING')return json({success:false,message:'Приглашение уже использовано или отозвано.',invite},410);
    if(invite.expired)return json({success:false,message:'Срок действия приглашения истёк.',invite},410);
    return json({success:true,invite});
  }catch(error){
    console.error('[ACCESS-INVITE]',error);
    return json({success:false,message:error?.message||String(error)},500);
  }
}
