// Smart Horeca Platform Administration; D1 V1.
// The existing env.DB is shared physically; all tenant operational rows continue
// to be scoped by the existing owner_user_id/workspace mechanism. No new DB.
import {ensureOwnerWorkspace, listAccessAdmin, upsertMember} from '../../access/_lib/access-control.js';
const clean=x=>String(x??'').trim();
export class PlatformError extends Error{
  constructor(message,status=400,code='PLATFORM_ERROR'){super(message);this.status=status;this.code=code}
}
export function isPlatformAdmin(env,user){
  // Never use email, a request-supplied role, or a wildcard. No configured
  // Supabase user IDs means no access, including to the platform owner.
  const ids=String(env?.PLATFORM_ADMIN_USER_IDS||'').split(/[\s,;]+/).map(clean).filter(Boolean);
  return Boolean(user?.id&&ids.includes(String(user.id)));
}
export function platformDatabase(env){
  if(!env?.DB?.prepare)throw new PlatformError('Основная Cloudflare D1 (DB) не подключена.',503,'DB_MISSING');
  return env.DB;
}
export function requirePlatformAdmin(env,user){
  if(!user?.id)throw new PlatformError('Требуется авторизация.',401,'UNAUTHENTICATED');
  if(!isPlatformAdmin(env,user))throw new PlatformError('Нет прав администратора платформы.',403,'PLATFORM_FORBIDDEN');
  return platformDatabase(env);
}
export async function ensurePlatformTables(db){
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS sh_platform_organizations (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL UNIQUE, storage_owner_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, server_mode TEXT NOT NULL CHECK(server_mode IN ('RMS','CHAIN')), status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','SUSPENDED')), contact_email TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sh_platform_org_status ON sh_platform_organizations(status,created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sh_platform_audit (id TEXT PRIMARY KEY, actor_user_id TEXT NOT NULL, organization_id TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, created_at TEXT NOT NULL)")
  ]);
}
export function validateDraft(input){
  const name=clean(input?.name),serverMode=clean(input?.serverMode).toUpperCase();
  const contactEmail=clean(input?.contactEmail).toLowerCase();
  if(!name||name.length>120)throw new PlatformError('Название организации: 1–120 символов.',400,'INVALID_NAME');
  if(!['RMS','CHAIN'].includes(serverMode))throw new PlatformError('Выберите RMS или CHAIN.',400,'INVALID_SERVER_MODE');
  if(contactEmail&&(contactEmail.length>254||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(contactEmail))){
    throw new PlatformError('Некорректный контактный email.',400,'INVALID_CONTACT_EMAIL');
  }
  return{name,serverMode,contactEmail};
}
async function audit(db,actorId,id,action){
  await db.prepare("INSERT INTO sh_platform_audit(id,actor_user_id,organization_id,action,created_at) VALUES(?1,?2,?3,?4,?5)")
    .bind(crypto.randomUUID(),String(actorId),String(id),action,new Date().toISOString()).run();
}
export async function createDraft(db,input,actorId){
  const org=validateDraft(input),id=crypto.randomUUID(),date=new Date().toISOString();
  // Synthetic owner is not a Supabase Auth user. It is a permanent logical
  // storage key so org admins can change without migrating historic documents.
  const ownerKey='platform-org:'+id;
  const workspace=await ensureOwnerWorkspace(db,ownerKey,null);
  await db.prepare("UPDATE sh_workspaces SET name=?2,status='DRAFT',updated_at=?3 WHERE id=?1").bind(workspace.id,org.name,date).run();
  await db.prepare("INSERT INTO sh_platform_organizations(id,workspace_id,storage_owner_id,name,server_mode,status,contact_email,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,'DRAFT',?6,?7,?7)")
    .bind(id,workspace.id,ownerKey,org.name,org.serverMode,org.contactEmail,date).run();
  await audit(db,actorId,id,'ORGANIZATION_CREATED');
  return{id,workspaceId:workspace.id,...org,status:'DRAFT',createdAt:date};
}
export async function listOrganizations(db){
  const rows=await db.prepare("SELECT p.*, (SELECT COUNT(*) FROM sh_access_members m WHERE m.owner_user_id=p.storage_owner_id AND m.user_id IS NOT NULL AND m.status='ACTIVE') AS active_members, (SELECT COUNT(*) FROM sh_access_members m WHERE m.owner_user_id=p.storage_owner_id AND m.status='PENDING') AS pending_members FROM sh_platform_organizations p ORDER BY p.created_at DESC LIMIT 500").all();
  return(rows.results||[]).map(row=>({
    id:row.id,workspaceId:row.workspace_id,name:row.name,serverMode:row.server_mode,
    status:row.status,contactEmail:row.contact_email,activeMembers:Number(row.active_members)||0,
    pendingMembers:Number(row.pending_members)||0,createdAt:row.created_at,updatedAt:row.updated_at
  }));
}
async function getOrg(db,orgId){
  const row=await db.prepare("SELECT * FROM sh_platform_organizations WHERE id=?1 LIMIT 1").bind(clean(orgId)).first();
  if(!row)throw new PlatformError('Организация не найдена.',404,'ORG_NOT_FOUND');
  return row;
}
export async function inviteSysAdmin(db,orgId,email,displayName,actorId,origin){
  const org=await getOrg(db,orgId);
  if(org.status!=='ACTIVE')throw new PlatformError('Сначала активируйте организацию, затем отправьте приглашение.',409,'ORG_INACTIVE');
  const address=clean(email).toLowerCase();
  if(!address||address.length>254||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(address)){
    throw new PlatformError('Укажите email системного администратора.',400,'INVALID_EMAIL');
  }
  // A real organization sysadmin is an ordinary active membership with the
  // template ADMIN role (all org permissions). They are NEVER platform admins.
  const existing=await db.prepare("SELECT user_id FROM sh_access_members WHERE owner_user_id=?1 AND email=?2 LIMIT 1").bind(org.storage_owner_id,address).first();
  if(existing?.user_id)throw new PlatformError('Пользователь уже принял приглашение в эту организацию.',409,'MEMBER_ALREADY_LINKED');
  const data=await listAccessAdmin(db,org.storage_owner_id);
  const admin=data.roles.find(x=>x.code==='ADMIN');
  if(!admin)throw new PlatformError('Системная роль ADMIN не найдена.',500,'ADMIN_ROLE_MISSING');
  const result=await upsertMember(db,org.storage_owner_id,{
    email:address,displayName:clean(displayName)||'Системный администратор',
    status:'PENDING',roleIds:[admin.id],scope:{mode:'ALL',departmentIds:[],departmentCodes:[],warehouseIds:[]}
  });
  await audit(db,actorId,org.id,'SYSADMIN_INVITED');
  const token=result.inviteToken||'';
  return{organizationId:org.id,email:address,alreadyRegistered:result.alreadyRegistered||false,
    // Invite links are issued only to platform admins; no token is persisted here.
    inviteLink:token?new URL('/register.html?invite='+encodeURIComponent(token),origin).toString():''};
}
export async function changeOrganizationStatus(db,orgId,nextStatus,actorId){
  const next=clean(nextStatus).toUpperCase();
  if(!['ACTIVE','SUSPENDED'].includes(next))throw new PlatformError('Допустимы только ACTIVE или SUSPENDED.',400,'INVALID_STATUS');
  const org=await getOrg(db,orgId),date=new Date().toISOString();
  // Atomic: both user-facing Workspace and platform registry change together.
  await db.batch([
    db.prepare("UPDATE sh_platform_organizations SET status=?2,updated_at=?3 WHERE id=?1").bind(org.id,next,date),
    db.prepare("UPDATE sh_workspaces SET status=?2,updated_at=?3 WHERE id=?1").bind(org.workspace_id,next,date)
  ]);
  await audit(db,actorId,org.id,'ORGANIZATION_'+next);
  return{organizationId:org.id,status:next};
}
