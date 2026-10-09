// Platform metadata is stored in a dedicated D1 binding: PLATFORM_DB.
// No restaurant financial, HR, stock or server credentials belong in this DB.
const clean=x=>String(x??'').trim();
export class PlatformError extends Error{
  constructor(message,status=400,code='PLATFORM_ERROR'){super(message);this.status=status;this.code=code}
}
export function isPlatformAdmin(env,user){
  const ids=String(env?.PLATFORM_ADMIN_USER_IDS||'').split(/[\s,;]+/).map(clean).filter(Boolean);
  return !!user?.id&&ids.includes(String(user.id));
}
export function platformDatabase(env){
  if(!env?.PLATFORM_DB?.prepare)throw new PlatformError('Привяжите отдельную D1 базу PLATFORM_DB.',503,'PLATFORM_DB_MISSING');
  return env.PLATFORM_DB;
}
export function requirePlatformAdmin(env,user){
  if(!user?.id)throw new PlatformError('Требуется вход.',401,'UNAUTHENTICATED');
  if(!isPlatformAdmin(env,user))throw new PlatformError('Нет прав администратора платформы.',403,'PLATFORM_FORBIDDEN');
  return platformDatabase(env);
}
export async function ensurePlatformTables(db){
  const ddl=[
    "CREATE TABLE IF NOT EXISTS sh_platform_organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL, server_mode TEXT NOT NULL CHECK(server_mode IN ('RMS','CHAIN')), status TEXT NOT NULL DEFAULT 'DRAFT' CHECK(status IN ('DRAFT','ACTIVE','SUSPENDED','ARCHIVED')), contact_email TEXT NOT NULL DEFAULT '', tenant_db_binding TEXT NOT NULL DEFAULT '', tenant_db_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
    "CREATE INDEX IF NOT EXISTS idx_sh_platform_org_status ON sh_platform_organizations(status,created_at)",
    "CREATE TABLE IF NOT EXISTS sh_platform_memberships (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, user_id TEXT, email TEXT NOT NULL, org_role TEXT NOT NULL CHECK(org_role IN ('OWNER','SYSADMIN','MEMBER')), status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','ACTIVE','DISABLED')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(organization_id,email))",
    "CREATE INDEX IF NOT EXISTS idx_sh_platform_members_user ON sh_platform_memberships(user_id,status)",
    "CREATE TABLE IF NOT EXISTS sh_platform_audit (id TEXT PRIMARY KEY, actor_user_id TEXT NOT NULL, organization_id TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, created_at TEXT NOT NULL)"
  ];
  await db.batch(ddl.map(sql=>db.prepare(sql)));
}
export function validateDraft(input){
  const name=clean(input?.name),serverMode=clean(input?.serverMode).toUpperCase(),contactEmail=clean(input?.contactEmail).toLowerCase();
  if(!name||name.length>120)throw new PlatformError('Название организации: от 1 до 120 символов.',400,'INVALID_NAME');
  if(!['RMS','CHAIN'].includes(serverMode))throw new PlatformError('Выберите RMS или CHAIN.',400,'INVALID_SERVER_MODE');
  if(contactEmail&&(contactEmail.length>254||!(/^[^\s@]+@[^\s@]+\.[^\s@]+$/).test(contactEmail)))throw new PlatformError('Некорректный email.',400,'INVALID_CONTACT_EMAIL');
  return{name,serverMode,contactEmail};
}
export async function createDraft(db,input,actorId){
  const org=validateDraft(input),id=crypto.randomUUID(),date=new Date().toISOString();
  await db.prepare("INSERT INTO sh_platform_organizations (id,name,server_mode,status,contact_email,created_at,updated_at) VALUES(?1,?2,?3,'DRAFT',?4,?5,?5)").bind(id,org.name,org.serverMode,org.contactEmail,date).run();
  await db.prepare("INSERT INTO sh_platform_audit (id,actor_user_id,organization_id,action,created_at) VALUES(?1,?2,?3,'ORGANIZATION_DRAFT_CREATED',?4)").bind(crypto.randomUUID(),String(actorId),id,date).run();
  return{id,...org,status:'DRAFT',dbProvisioned:false,ownerInvited:false,createdAt:date};
}
export async function listOrganizations(db){
  const rows=await db.prepare("SELECT id,name,server_mode,status,contact_email,CASE WHEN tenant_db_id<>'' AND tenant_db_binding<>'' THEN 1 ELSE 0 END AS provisioned,created_at,updated_at FROM sh_platform_organizations ORDER BY created_at DESC LIMIT 500").all();
  return(rows.results||[]).map(x=>({id:x.id,name:x.name,serverMode:x.server_mode,status:x.status,contactEmail:x.contact_email,dbProvisioned:Boolean(x.provisioned),createdAt:x.created_at,updatedAt:x.updated_at}));
}
// The binding comes ONLY from a trusted platform registry row (never from the client).
// Each tenant D1 must be provisioned and bound explicitly before activation.
export function requireTenantDatabase(env,org){
  if(!org||org.status!=='ACTIVE')throw new PlatformError('Организация не активна.',403,'ORGANIZATION_INACTIVE');
  const binding=clean(org.tenant_db_binding);
  if(!/^TENANT_DB_[A-Z0-9_]+$/.test(binding))throw new PlatformError('База организации не подключена.',503,'TENANT_DB_NOT_READY');
  const db=env?.[binding];
  if(!db?.prepare)throw new PlatformError('Нет привязки базы организации.',503,'TENANT_DB_MISSING');
  return db;
}
export async function resolveAuthorizedTenantDatabase(env,platformDb,user,organizationId){
  if(!user?.id)throw new PlatformError('Требуется авторизация.',401,'UNAUTHENTICATED');
  const id=clean(organizationId);
  if(!id)throw new PlatformError('Организация не указана.',400,'ORGANIZATION_REQUIRED');
  const org=await platformDb.prepare("SELECT o.* FROM sh_platform_organizations o JOIN sh_platform_memberships m ON o.id=m.organization_id WHERE o.id=?1 AND m.user_id=?2 AND m.status='ACTIVE' LIMIT 1").bind(id,String(user.id)).first();
  if(!org)throw new PlatformError('Нет доступа к организации.',403,'ORGANIZATION_FORBIDDEN');
  return{organization:org,db:requireTenantDatabase(env,org)};
}
