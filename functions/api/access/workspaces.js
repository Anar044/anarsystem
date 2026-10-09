import { getUser } from '../iiko/_lib/user-state.js';
import { listUserWorkspaces, selectWorkspaceForUser, workspaceCookie } from './_lib/access-control.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200,extra={}){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors(),...extra}})}
function clean(v){return String(v??'').trim()}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{
    const auth=await getUser(request,env);
    if(!auth?.user)return json({success:false,message:'Требуется авторизация.'},401);
    const workspaces=await listUserWorkspaces(env.DB,auth.user);
    return json({success:true,workspaces});
  }catch(error){
    console.error('[ACCESS-WORKSPACES:GET]',error);
    return json({success:false,message:error?.message||String(error)},error?.status||500);
  }
}

export async function onRequestPost({request,env}){
  try{
    const auth=await getUser(request,env);
    if(!auth?.user)return json({success:false,message:'Требуется авторизация.'},401);
    const body=await request.json().catch(()=>({}));
    if(body?.action==='clear-selection')return json({success:true},200,{'Set-Cookie':workspaceCookie('',0)});
    const workspaceId=clean(body?.workspaceId);
    if(!workspaceId)return json({success:false,message:'Выберите рабочее пространство.'},400);
    const workspace=await selectWorkspaceForUser(env.DB,auth.user,workspaceId);
    return json({success:true,workspace},200,{'Set-Cookie':workspaceCookie(workspace.id)});
  }catch(error){
    console.error('[ACCESS-WORKSPACES:POST]',error);
    return json({success:false,message:error?.message||String(error),code:error?.code||''},error?.status||500);
  }
}
