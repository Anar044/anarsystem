import {getUser} from '../iiko/_lib/user-state.js';
import {requirePlatformAdmin,ensurePlatformTables,createDraft,listOrganizations,inviteSysAdmin,changeOrganizationStatus} from './_lib/organizations.js';
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type'};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
async function context(request,env){
  const auth=await getUser(request,env);
  const db=requirePlatformAdmin(env,auth?.user);
  await ensurePlatformTables(db);
  return{db,user:auth.user};
}
function handleError(error){
  // Do not echo unexpected error details from D1 or Supabase to public callers.
  if(!error?.status)console.error('[PLATFORM-ORGANIZATIONS]',error);
  return json({success:false,message:error?.status?error.message:'Внутренняя ошибка.',code:error?.code||'INTERNAL_ERROR'},error?.status||500);
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:cors})}
export async function onRequestGet({request,env}){
  try{
    const {db}=await context(request,env);
    return json({success:true,organizations:await listOrganizations(db)});
  }catch(error){return handleError(error)}
}
export async function onRequestPost({request,env}){
  try{
    const {db,user}=await context(request,env);
    const body=await request.json().catch(()=>({}));
    switch(String(body?.action||'')){
      case 'create':
        return json({success:true,organization:await createDraft(db,body,user.id)},201);
      case 'invite-sysadmin':
        return json({success:true,invitation:await inviteSysAdmin(db,body.organizationId,body.email,body.displayName,user.id,new URL(request.url).origin)});
      case 'set-status':
        return json({success:true,organization:await changeOrganizationStatus(db,body.organizationId,body.status,user.id)});
      default:
        return json({success:false,message:'Неизвестная операция.'},400);
    }
  }catch(error){return handleError(error)}
}
