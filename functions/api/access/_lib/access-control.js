const NOW=()=>new Date().toISOString();
const clean=v=>String(v??'').trim();
const emailKey=v=>clean(v).toLowerCase();
const jsonParse=(v,fallback)=>{try{const x=JSON.parse(String(v||''));return x??fallback}catch{return fallback}};
const uid=()=>crypto.randomUUID();
const WORKSPACE_COOKIE='sh_workspace_id';
const inviteToken=()=>{
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  let s='';for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
async function tokenHash(value){
  const raw=new TextEncoder().encode(clean(value));
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',raw));
  return [...digest].map(b=>b.toString(16).padStart(2,'0')).join('');
}
function cookieValue(request,name){
  const raw=request?.headers?.get?.('Cookie')||'';
  for(const part of raw.split(';')){
    const i=part.indexOf('=');if(i<0)continue;
    if(part.slice(0,i).trim()!==name)continue;
    try{return decodeURIComponent(part.slice(i+1).trim())}catch{return part.slice(i+1).trim()}
  }
  return'';
}
export function workspaceCookie(workspaceId,maxAge=31536000){
  return WORKSPACE_COOKIE+'='+encodeURIComponent(clean(workspaceId))+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+Math.max(0,Number(maxAge)||0);
}

export const PERMISSIONS=[
  ['dashboard.view','Главная','Просмотр Dashboard'],
  ['assistant.use','AI','Использование AI Smart Horeca Assistant'],

  ['cash.view','Кассы','Просмотр касс'],
  ['cash.manage','Кассы','Управление кассами'],
  ['cash_shifts.view','Кассовые смены','Просмотр кассовых смен'],

  ['procurement.request.create','Закупки','Создание заявок PR'],
  ['procurement.request.view_own','Закупки','Просмотр своих заявок PR'],
  ['procurement.request.view_all','Закупки','Просмотр всех заявок PR'],
  ['procurement.approve','Закупки','Согласование заявок PR'],
  ['procurement.sourcing','Закупки','Работа с поставщиками и предложениями'],
  ['procurement.prices.view','Закупки','Просмотр закупочных цен'],
  ['procurement.po.manage','Закупки','Создание и отправка PO'],
  ['procurement.receive','Закупки','Приёмка поставок'],
  ['procurement.analytics','Закупки','Аналитика закупок'],
  ['procurement.norms.manage','Закупки','Нормы запаса'],
  ['procurement.settings.manage','Закупки','Настройки закупок'],

  ['inventory.nomenclature.view','Склад','Просмотр номенклатуры'],
  ['inventory.nomenclature.manage','Склад','Изменение номенклатуры и фасовок'],
  ['inventory.stock.view','Склад','Просмотр остатков'],
  ['inventory.movements.view','Склад','Просмотр движения товара'],
  ['inventory.assets.view','Склад','Инвентарь и основные средства'],
  ['inventory.assets.manage','Склад','Управление основными средствами'],
  ['inventory.ai_documents','Склад','AI Документы'],
  ['inventory.incoming.view','Склад','Просмотр приходных накладных'],
  ['inventory.incoming.manage','Склад','Создание/изменение/проведение приходных накладных'],
  ['inventory.outgoing.view','Склад','Просмотр расходных накладных'],
  ['inventory.outgoing.manage','Склад','Управление расходными накладными'],
  ['inventory.writeoff.view','Склад','Просмотр актов списания'],
  ['inventory.writeoff.manage','Склад','Управление актами списания'],
  ['inventory.transfer.view','Склад','Просмотр внутренних перемещений'],
  ['inventory.transfer.manage','Склад','Управление внутренними перемещениями'],

  ['finance.view','Финансы','Просмотр финансов'],
  ['finance.manage','Финансы','Изменение финансовых данных'],
  ['finance.payments','Финансы','Создание и проведение оплат'],

  ['reports.olap','Отчёты','OLAP отчёты'],
  ['reports.abc_xyz','Отчёты','ABC / XYZ анализ'],
  ['reports.menu_engineering','Отчёты','Меню-инжиниринг'],
  ['reports.waiters','Отчёты','Рейтинг официантов'],
  ['reports.supplier_balances','Отчёты','Баланс по поставщикам'],
  ['reports.food_cost','Отчёты','Фудкост'],
  ['reports.labor_cost','Отчёты','Лаборкост'],
  ['reports.pnl','Отчёты','P&L'],

  ['hr.employees.view','HR','Просмотр справочника сотрудников'],
  ['hr.employees.manage','HR','Изменение данных сотрудников Smart Horeca'],
  ['hr.schedules.view','HR','Просмотр графиков'],
  ['hr.schedules.manage','HR','Изменение графиков и должностей'],
  ['hr.attendance.view','HR','Просмотр Face ID / учёта времени'],
  ['hr.attendance.manage','HR','Настройка Face ID / учёта времени'],
  ['hr.timesheet.view','HR','Просмотр табеля'],
  ['hr.timesheet.manage','HR','Изменение и закрытие табеля'],
  ['hr.compensation.view','HR','Просмотр условий оплаты'],
  ['hr.compensation.manage','HR','Изменение условий оплаты'],
  ['hr.payroll.view','HR','Просмотр расчёта зарплаты'],
  ['hr.payroll.calculate','HR','Расчёт зарплаты'],
  ['hr.payroll.approve','HR','Утверждение зарплаты'],
  ['hr.payroll.pay','HR','Выплата зарплаты'],
  ['hr.tax_settings.manage','HR','Налоговые настройки payroll'],

  ['sensitive.salary.view','Конфиденциальные данные','Просмотр зарплат и ставок'],
  ['sensitive.cost.view','Конфиденциальные данные','Просмотр себестоимости и закупочных цен'],

  ['qr.manage','QR Menu','Управление QR Menu'],
  ['audit.view','Система','Просмотр журнала действий'],
  ['settings.view','Система','Просмотр настроек'],
  ['settings.manage','Система','Изменение настроек и подключений'],
  ['access.manage','Система','Пользователи, роли и права доступа']
].map(([code,module,name])=>({code,module,name}));

export const PERMISSION_SET=new Set(PERMISSIONS.map(x=>x.code));

export const ROLE_TEMPLATES=[
  {code:'ADMIN',name:'Администратор',description:'Полный доступ к Smart Horeca, кроме передачи владения.',permissions:['*']},
  {code:'PURCHASE_REQUESTER',name:'Инициатор закупки',description:'Создаёт заявки и видит только свои PR.',permissions:['dashboard.view','procurement.request.create','procurement.request.view_own','inventory.stock.view']},
  {code:'PURCHASE_APPROVER',name:'Согласующий закупок',description:'Просматривает и согласует заявки.',permissions:['dashboard.view','procurement.request.view_all','procurement.approve']},
  {code:'BUYER',name:'Закупщик',description:'Работает с поставщиками, ценами и PO.',permissions:['dashboard.view','procurement.request.view_all','procurement.sourcing','procurement.prices.view','procurement.po.manage','inventory.stock.view','sensitive.cost.view']},
  {code:'WAREHOUSE_RECEIVER',name:'Приёмщик склада',description:'Видит ожидаемые поставки и принимает товар.',permissions:['dashboard.view','procurement.receive','inventory.stock.view','inventory.incoming.view','inventory.incoming.manage']},
  {code:'HR_MANAGER',name:'HR менеджер',description:'Сотрудники, графики, явки и табель без зарплат.',permissions:['dashboard.view','hr.employees.view','hr.employees.manage','hr.schedules.view','hr.schedules.manage','hr.attendance.view','hr.attendance.manage','hr.timesheet.view','hr.timesheet.manage']},
  {code:'PAYROLL',name:'Расчётчик зарплаты',description:'Условия оплаты и payroll.',permissions:['dashboard.view','hr.employees.view','hr.timesheet.view','hr.compensation.view','hr.compensation.manage','hr.payroll.view','hr.payroll.calculate','hr.payroll.approve','sensitive.salary.view']},
  {code:'ACCOUNTANT',name:'Бухгалтер',description:'Финансы, документы, поставщики и выплаты.',permissions:['dashboard.view','finance.view','finance.manage','finance.payments','inventory.incoming.view','inventory.incoming.manage','inventory.outgoing.view','inventory.outgoing.manage','reports.supplier_balances','hr.payroll.view','hr.payroll.pay','sensitive.salary.view','sensitive.cost.view']},
  {code:'ANALYST',name:'Аналитик',description:'Отчёты без права изменения операционных данных.',permissions:['dashboard.view','reports.olap','reports.abc_xyz','reports.menu_engineering','reports.waiters','reports.supplier_balances','reports.food_cost','reports.labor_cost','reports.pnl']},
  {code:'RESTAURANT_MANAGER',name:'Менеджер ресторана',description:'Операционный просмотр и согласования своего ресторана.',permissions:['dashboard.view','cash.view','cash_shifts.view','procurement.request.create','procurement.request.view_all','procurement.approve','inventory.stock.view','inventory.movements.view','reports.olap','reports.pnl','hr.employees.view','hr.schedules.view','hr.attendance.view','hr.timesheet.view']}
];

export async function ensureAccessTables(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sh_workspaces (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL UNIQUE,
      server_owner_user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Smart Horeca',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sh_workspaces_owner ON sh_workspaces(owner_user_id,status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sh_workspace_invites (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL,
      owner_user_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      email TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'PENDING',
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sh_workspace_invites_member ON sh_workspace_invites(owner_user_id,member_id,status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sh_access_members (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      user_id TEXT,
      email TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      scope_mode TEXT NOT NULL DEFAULT 'ALL',
      department_ids_json TEXT NOT NULL DEFAULT '[]',
      department_codes_json TEXT NOT NULL DEFAULT '[]',
      warehouse_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_user_id,email),
      UNIQUE(owner_user_id,user_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sh_access_members_user ON sh_access_members(user_id,status)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sh_access_members_email ON sh_access_members(email,status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sh_access_roles (
      id TEXT PRIMARY KEY,
      owner_user_id TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(owner_user_id,code)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sh_access_role_permissions (
      owner_user_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      PRIMARY KEY(owner_user_id,role_id,permission)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sh_access_member_roles (
      owner_user_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      role_id TEXT NOT NULL,
      PRIMARY KEY(owner_user_id,member_id,role_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sh_access_member_overrides (
      owner_user_id TEXT NOT NULL,
      member_id TEXT NOT NULL,
      permission TEXT NOT NULL,
      effect TEXT NOT NULL,
      PRIMARY KEY(owner_user_id,member_id,permission)
    )`)
  ]);
}

function workspaceNameForUser(user){
  const meta=user?.user_metadata||{};
  return clean(meta.company_name)||clean(meta.restaurant_name)||clean(meta.full_name)||[clean(meta.first_name),clean(meta.last_name)].filter(Boolean).join(' ')||clean(user?.email)||'Smart Horeca';
}
export async function ensureOwnerWorkspace(db,ownerUserId,user=null){
  await ensureAccessTables(db);
  const owner=clean(ownerUserId);if(!owner)return null;

  // Several page APIs can initialize access in parallel (access/me, access/admin,
  // HR, iiko state). The workspace creation therefore must be idempotent.
  const now=NOW(),id=uid(),name=workspaceNameForUser(user);
  await db.prepare(`INSERT INTO sh_workspaces(id,owner_user_id,server_owner_user_id,name,status,created_at,updated_at)
    VALUES(?1,?2,?2,?3,'ACTIVE',?4,?4)
    ON CONFLICT(owner_user_id) DO NOTHING`)
    .bind(id,owner,name,now).run();

  const row=await db.prepare(`SELECT * FROM sh_workspaces WHERE owner_user_id=?1 LIMIT 1`).bind(owner).first();
  if(!row)throw new Error('Не удалось создать или загрузить рабочее пространство Smart Horeca.');
  return row;
}
function workspacePublic(row){
  if(!row)return null;
  return{id:row.id,name:row.name||'Smart Horeca',ownerUserId:row.owner_user_id,storageUserId:row.server_owner_user_id||row.owner_user_id,status:row.status||'ACTIVE'};
}
async function membershipsForUser(db,userId){
  const rows=await db.prepare(`SELECT * FROM sh_access_members WHERE user_id=?1 ORDER BY updated_at DESC`).bind(userId).all();
  return rows.results||[];
}
async function workspaceForMembership(db,row,user=null){
  return ensureOwnerWorkspace(db,row.owner_user_id,row.owner_user_id===clean(user?.id)?user:null);
}
async function claimInviteByToken(db,user,email,token){
  const hash=await tokenHash(token);
  const invite=await db.prepare(`SELECT * FROM sh_workspace_invites WHERE token_hash=?1 AND status='PENDING' LIMIT 1`).bind(hash).first();
  if(!invite)return{ok:false,reason:'INVITE_NOT_FOUND'};
  if(new Date(invite.expires_at).getTime()<Date.now())return{ok:false,reason:'INVITE_EXPIRED'};
  if(emailKey(invite.email)!==emailKey(email))return{ok:false,reason:'INVITE_EMAIL_MISMATCH'};
  const member=await db.prepare(`SELECT * FROM sh_access_members WHERE id=?1 AND owner_user_id=?2 LIMIT 1`).bind(invite.member_id,invite.owner_user_id).first();
  if(!member)return{ok:false,reason:'INVITE_MEMBER_NOT_FOUND'};
  if(clean(member.user_id)&&clean(member.user_id)!==clean(user.id))return{ok:false,reason:'INVITE_ALREADY_USED'};
  const now=NOW();
  await db.batch([
    db.prepare(`UPDATE sh_access_members SET user_id=?2,status='ACTIVE',updated_at=?3 WHERE id=?1`).bind(member.id,user.id,now),
    db.prepare(`UPDATE sh_workspace_invites SET status='ACCEPTED',accepted_at=?2 WHERE id=?1`).bind(invite.id,now)
  ]);
  const workspace=await ensureOwnerWorkspace(db,invite.owner_user_id,null);
  return{ok:true,member:await db.prepare(`SELECT * FROM sh_access_members WHERE id=?1`).bind(member.id).first(),workspace};
}
async function claimLegacyEmailInvite(db,user,email){
  const rows=await db.prepare(`SELECT * FROM sh_access_members WHERE email=?1 AND (user_id IS NULL OR TRIM(user_id)='') AND status IN ('PENDING','ACTIVE') ORDER BY updated_at DESC`).bind(emailKey(email)).all();
  const matches=rows.results||[];
  if(matches.length!==1)return null;
  const row=matches[0],now=NOW();
  await db.prepare(`UPDATE sh_access_members SET user_id=?2,status='ACTIVE',updated_at=?3 WHERE id=?1`).bind(row.id,user.id,now).run();
  return db.prepare(`SELECT * FROM sh_access_members WHERE id=?1`).bind(row.id).first();
}
export async function listUserWorkspaces(db,user){
  await ensureAccessTables(db);
  const userId=clean(user?.id),email=emailKey(user?.email);
  if(!userId)return[];
  await ensureOwnerMembership(db,user);
  const memberships=await membershipsForUser(db,userId);
  const out=[];
  for(const member of memberships){
    const workspace=await workspaceForMembership(db,member,user);
    if(!workspace)continue;
    out.push({...workspacePublic(workspace),memberId:member.id,memberStatus:member.status,isOwner:member.owner_user_id===userId,displayName:member.display_name||'',email:member.email||email});
  }
  return out;
}
export async function updateWorkspaceName(db,workspaceId,name){
  await ensureAccessTables(db);
  const next=clean(name);if(!next)return;
  await db.prepare(`UPDATE sh_workspaces SET name=?2,updated_at=?3 WHERE id=?1`).bind(clean(workspaceId),next,NOW()).run();
}

export async function selectWorkspaceForUser(db,user,workspaceId){
  const list=await listUserWorkspaces(db,user);
  const selected=list.find(x=>clean(x.id)===clean(workspaceId)&&String(x.memberStatus).toUpperCase()==='ACTIVE');
  if(!selected)throw Object.assign(new Error('Рабочее пространство недоступно.'),{status:403,code:'WORKSPACE_FORBIDDEN'});
  return selected;
}
export async function getInvitePreview(db,token){
  await ensureAccessTables(db);
  const raw=clean(token);if(!raw)return null;
  const hash=await tokenHash(raw);
  const row=await db.prepare(`SELECT i.email,i.status,i.expires_at,w.id AS workspace_id,w.name AS workspace_name
    FROM sh_workspace_invites i
    JOIN sh_workspaces w ON w.id=i.workspace_id
    WHERE i.token_hash=?1 LIMIT 1`).bind(hash).first();
  if(!row)return null;
  return{
    email:row.email,
    status:row.status,
    expiresAt:row.expires_at,
    expired:new Date(row.expires_at).getTime()<Date.now(),
    workspace:{id:row.workspace_id,name:row.workspace_name||'Smart Horeca'}
  };
}

export async function createMemberInvite(db,ownerUserId,memberId){
  await ensureAccessTables(db);
  const workspace=await ensureOwnerWorkspace(db,ownerUserId,null);
  const member=await db.prepare(`SELECT * FROM sh_access_members WHERE owner_user_id=?1 AND id=?2 LIMIT 1`).bind(ownerUserId,memberId).first();
  if(!member)throw Object.assign(new Error('Пользователь не найден.'),{status:404});
  if(clean(member.user_id))return{memberId:member.id,inviteToken:'',workspace:workspacePublic(workspace),alreadyRegistered:true};
  const token=inviteToken(),hash=await tokenHash(token),now=NOW(),expires=new Date(Date.now()+7*24*3600*1000).toISOString(),id=uid();
  await db.batch([
    db.prepare(`UPDATE sh_workspace_invites SET status='REVOKED' WHERE owner_user_id=?1 AND member_id=?2 AND status='PENDING'`).bind(ownerUserId,memberId),
    db.prepare(`INSERT INTO sh_workspace_invites(id,workspace_id,owner_user_id,member_id,email,token_hash,status,expires_at,created_at) VALUES(?1,?2,?3,?4,?5,?6,'PENDING',?7,?8)`)
      .bind(id,workspace.id,ownerUserId,memberId,emailKey(member.email),hash,expires,now)
  ]);
  return{memberId:member.id,inviteToken:token,expiresAt:expires,workspace:workspacePublic(workspace),alreadyRegistered:false};
}

async function hasLegacyOwnerData(db,userId){
  try{
    const row=await db.prepare(`SELECT user_id FROM iiko_connections WHERE user_id=?1 LIMIT 1`).bind(userId).first();
    return Boolean(row);
  }catch{return false}
}

async function seedRoles(db,ownerUserId){
  const existing=await db.prepare(`SELECT COUNT(*) AS c FROM sh_access_roles WHERE owner_user_id=?1`).bind(ownerUserId).first();
  if(Number(existing?.c||0)>0)return;
  const now=NOW(),stmts=[];
  for(const t of ROLE_TEMPLATES){
    const id=uid();
    stmts.push(db.prepare(`INSERT INTO sh_access_roles(id,owner_user_id,code,name,description,is_system,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,1,?6,?6)`).bind(id,ownerUserId,t.code,t.name,t.description,now));
    for(const permission of t.permissions)stmts.push(db.prepare(`INSERT INTO sh_access_role_permissions(owner_user_id,role_id,permission) VALUES(?1,?2,?3)`).bind(ownerUserId,id,permission));
  }
  for(let i=0;i<stmts.length;i+=50)await db.batch(stmts.slice(i,i+50));
}

async function ensureOwnerMembership(db,user){
  const userId=clean(user?.id),email=emailKey(user?.email);
  if(!userId)return null;
  const now=NOW();
  let row=await db.prepare(`SELECT * FROM sh_access_members WHERE owner_user_id=?1 AND user_id=?1 LIMIT 1`).bind(userId).first();

  // The workspace owner is a special principal: an old/stale admin edit must never
  // leave the owner's own membership PENDING/DISABLED or scoped to one restaurant.
  if(row){
    if(String(row.status||'').toUpperCase()!=='ACTIVE'||String(row.scope_mode||'').toUpperCase()!=='ALL'){
      await db.prepare(`UPDATE sh_access_members SET status='ACTIVE',scope_mode='ALL',department_ids_json='[]',department_codes_json='[]',warehouse_ids_json='[]',updated_at=?2 WHERE id=?1`)
        .bind(row.id,now).run();
      row=await db.prepare(`SELECT * FROM sh_access_members WHERE id=?1`).bind(row.id).first();
    }
    await seedRoles(db,userId);
    await ensureOwnerWorkspace(db,userId,user);
    return row;
  }

  // Existing workspace ownership is enough to restore a missing owner membership.
  // Legacy iiko data is retained as the migration signal for older accounts.
  const existingWorkspace=await db.prepare(`SELECT id FROM sh_workspaces WHERE owner_user_id=?1 LIMIT 1`).bind(userId).first();
  if(!existingWorkspace&&!await hasLegacyOwnerData(db,userId))return null;

  const id=uid(),name=clean(user?.user_metadata?.full_name)||[clean(user?.user_metadata?.first_name),clean(user?.user_metadata?.last_name)].filter(Boolean).join(' ')||email;
  await db.prepare(`INSERT INTO sh_access_members(id,owner_user_id,user_id,email,display_name,status,scope_mode,created_at,updated_at) VALUES(?1,?2,?2,?3,?4,'ACTIVE','ALL',?5,?5)`)
    .bind(id,userId,email,name,now).run();
  await seedRoles(db,userId);
  await ensureOwnerWorkspace(db,userId,user);
  return db.prepare(`SELECT * FROM sh_access_members WHERE id=?1`).bind(id).first();
}

function memberScope(row){
  return{
    mode:clean(row?.scope_mode)||'ALL',
    departmentIds:jsonParse(row?.department_ids_json,[]),
    departmentCodes:jsonParse(row?.department_codes_json,[]),
    warehouseIds:jsonParse(row?.warehouse_ids_json,[])
  };
}

async function permissionsForMember(db,row){
  if(!row)return[];
  if(row.owner_user_id===row.user_id)return['*'];
  const roleRows=await db.prepare(`SELECT rp.permission FROM sh_access_member_roles mr JOIN sh_access_role_permissions rp ON rp.owner_user_id=mr.owner_user_id AND rp.role_id=mr.role_id WHERE mr.owner_user_id=?1 AND mr.member_id=?2`).bind(row.owner_user_id,row.id).all();
  const set=new Set((roleRows.results||[]).map(x=>clean(x.permission)).filter(Boolean));
  const overrides=await db.prepare(`SELECT permission,effect FROM sh_access_member_overrides WHERE owner_user_id=?1 AND member_id=?2`).bind(row.owner_user_id,row.id).all();
  for(const x of overrides.results||[]){
    const p=clean(x.permission);if(!p)continue;
    if(String(x.effect).toUpperCase()==='DENY')set.delete(p);else set.add(p);
  }
  return[...set];
}

export async function resolveAccessForUser(db,user,{claimInvite=true,request=null,inviteToken:rawInviteToken='',workspaceId:rawWorkspaceId=''}={}){
  await ensureAccessTables(db);
  const userId=clean(user?.id),email=emailKey(user?.email);
  if(!userId)return{allowed:false,reason:'NO_USER'};

  await ensureOwnerMembership(db,user);

  let preferredWorkspaceId=clean(rawWorkspaceId)||cookieValue(request,WORKSPACE_COOKIE);
  const token=clean(rawInviteToken);
  if(claimInvite&&token&&email){
    const claimed=await claimInviteByToken(db,user,email,token);
    if(!claimed.ok)return{allowed:false,reason:claimed.reason,userId,email};
    preferredWorkspaceId=claimed.workspace?.id||preferredWorkspaceId;
  }

  let memberships=await membershipsForUser(db,userId);
  if(!memberships.length&&claimInvite&&email){
    const claimedLegacy=await claimLegacyEmailInvite(db,user,email);
    if(claimedLegacy)memberships=[claimedLegacy];
  }
  if(!memberships.length)return{allowed:false,reason:'NO_MEMBERSHIP',userId,email};

  const options=[];
  for(const member of memberships){
    const workspace=await workspaceForMembership(db,member,user);
    if(!workspace)continue;
    options.push({member,workspace});
  }
  const publicWorkspaces=options.map(x=>({...workspacePublic(x.workspace),memberId:x.member.id,memberStatus:x.member.status,isOwner:x.member.owner_user_id===userId}));

  const ownerOption=options.find(x=>x.member.owner_user_id===userId&&x.member.user_id===userId)||null;
  const activeOptions=options.filter(x=>String(x.member.status||'').toUpperCase()==='ACTIVE');
  let selected=null;
  if(preferredWorkspaceId)selected=options.find(x=>clean(x.workspace.id)===preferredWorkspaceId)||null;

  // A stale workspace cookie can point to a membership that was later disabled.
  // Owners always fall back to their own workspace. Employees fall back when there is
  // exactly one active workspace; with several active workspaces we ask them to choose.
  if(selected&&String(selected.member.status||'').toUpperCase()!=='ACTIVE'){
    if(ownerOption)selected=ownerOption;
    else if(activeOptions.length===1)selected=activeOptions[0];
    else if(activeOptions.length>1)return{allowed:false,reason:'WORKSPACE_SELECTION_REQUIRED',userId,email,workspaces:publicWorkspaces};
  }
  if(!selected&&ownerOption)selected=ownerOption;
  if(!selected&&activeOptions.length===1)selected=activeOptions[0];
  if(!selected&&activeOptions.length>1){
    return{allowed:false,reason:'WORKSPACE_SELECTION_REQUIRED',userId,email,workspaces:publicWorkspaces};
  }
  if(!selected&&options.length===1)selected=options[0];
  if(!selected&&options.length>1){
    return{allowed:false,reason:'WORKSPACE_SELECTION_REQUIRED',userId,email,workspaces:publicWorkspaces};
  }
  if(!selected)return{allowed:false,reason:'WORKSPACE_NOT_FOUND',userId,email,workspaces:publicWorkspaces};

  let row=selected.member,workspace=selected.workspace;
  const isOwner=row.owner_user_id===userId&&row.user_id===userId;
  if(isOwner&&String(row.status||'').toUpperCase()!=='ACTIVE'){
    await db.prepare(`UPDATE sh_access_members SET status='ACTIVE',scope_mode='ALL',department_ids_json='[]',department_codes_json='[]',warehouse_ids_json='[]',updated_at=?2 WHERE id=?1`)
      .bind(row.id,NOW()).run();
    row=await db.prepare(`SELECT * FROM sh_access_members WHERE id=?1`).bind(row.id).first();
  }
  if(String(row.status).toUpperCase()!=='ACTIVE')return{allowed:false,reason:'MEMBERSHIP_'+String(row.status).toUpperCase(),userId,email,ownerUserId:row.owner_user_id,memberId:row.id,workspace:workspacePublic(workspace),workspaces:publicWorkspaces};

  await seedRoles(db,row.owner_user_id);
  const permissions=await permissionsForMember(db,row);
  return{
    allowed:true,
    userId,
    ownerUserId:row.owner_user_id,
    storageUserId:workspace.server_owner_user_id||row.owner_user_id,
    workspace:workspacePublic(workspace),
    workspaces:publicWorkspaces,
    memberId:row.id,
    employeeId:row.iiko_employee_id||'',
    displayName:row.display_name||'',
    email:row.email||email,
    isOwner:row.owner_user_id===userId&&row.user_id===userId,
    permissions,
    scope:memberScope(row)
  };
}
export function hasPermission(access,permission){
  if(!access?.allowed)return false;
  const set=new Set(access.permissions||[]);
  return set.has('*')||set.has(permission);
}

export function requirePermission(access,permission){
  if(hasPermission(access,permission))return;
  const e=new Error('Недостаточно прав: '+permission);e.status=403;e.code='ACCESS_DENIED';throw e;
}

export async function listAccessAdmin(db,ownerUserId){
  await ensureAccessTables(db);await seedRoles(db,ownerUserId);
  const workspace=await ensureOwnerWorkspace(db,ownerUserId,null);
  const [members,roles,rolePerms,memberRoles,overrides]=await Promise.all([
    db.prepare(`SELECT * FROM sh_access_members WHERE owner_user_id=?1 ORDER BY CASE WHEN owner_user_id=user_id THEN 0 ELSE 1 END,display_name COLLATE NOCASE,email COLLATE NOCASE`).bind(ownerUserId).all(),
    db.prepare(`SELECT * FROM sh_access_roles WHERE owner_user_id=?1 ORDER BY is_system DESC,name COLLATE NOCASE`).bind(ownerUserId).all(),
    db.prepare(`SELECT * FROM sh_access_role_permissions WHERE owner_user_id=?1`).bind(ownerUserId).all(),
    db.prepare(`SELECT * FROM sh_access_member_roles WHERE owner_user_id=?1`).bind(ownerUserId).all(),
    db.prepare(`SELECT * FROM sh_access_member_overrides WHERE owner_user_id=?1`).bind(ownerUserId).all()
  ]);
  const rp=new Map();
  for(const x of rolePerms.results||[]){if(!rp.has(x.role_id))rp.set(x.role_id,[]);rp.get(x.role_id).push(x.permission)}
  const mr=new Map();
  for(const x of memberRoles.results||[]){if(!mr.has(x.member_id))mr.set(x.member_id,[]);mr.get(x.member_id).push(x.role_id)}
  const ov=new Map();
  for(const x of overrides.results||[]){if(!ov.has(x.member_id))ov.set(x.member_id,[]);ov.get(x.member_id).push({permission:x.permission,effect:x.effect})}
  return{
    workspace:workspacePublic(workspace),
    permissions:PERMISSIONS,
    roles:(roles.results||[]).map(x=>({id:x.id,code:x.code,name:x.name,description:x.description,isSystem:Boolean(x.is_system),permissions:rp.get(x.id)||[]})),
    members:(members.results||[]).map(x=>({
      id:x.id,userId:x.user_id||'',email:x.email,employeeId:x.iiko_employee_id||'',displayName:x.display_name||'',status:(!clean(x.user_id)&&String(x.status).toUpperCase()==='ACTIVE')?'PENDING':x.status,
      scope:memberScope(x),roleIds:mr.get(x.id)||[],overrides:ov.get(x.id)||[],isOwner:x.owner_user_id===x.user_id
    }))
  };
}

export async function saveRole(db,ownerUserId,input){
  await ensureAccessTables(db);
  const id=clean(input?.id)||uid(),code=clean(input?.code).toUpperCase().replace(/[^A-Z0-9_]+/g,'_'),name=clean(input?.name),description=clean(input?.description);
  if(!code||!name)throw new Error('Укажите код и название роли.');
  const permissions=[...new Set((input?.permissions||[]).map(clean).filter(p=>p==='*'||PERMISSION_SET.has(p)))];
  const now=NOW();
  const old=await db.prepare(`SELECT is_system FROM sh_access_roles WHERE owner_user_id=?1 AND id=?2`).bind(ownerUserId,id).first();
  if(old?.is_system&&input?.allowSystemEdit!==true)throw Object.assign(new Error('Системный шаблон роли нельзя изменять напрямую. Создайте копию.'),{status:409});
  await db.prepare(`INSERT INTO sh_access_roles(id,owner_user_id,code,name,description,is_system,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,0,?6,?6) ON CONFLICT(owner_user_id,code) DO UPDATE SET name=excluded.name,description=excluded.description,updated_at=excluded.updated_at`)
    .bind(id,ownerUserId,code,name,description,now).run();
  const role=await db.prepare(`SELECT id FROM sh_access_roles WHERE owner_user_id=?1 AND code=?2`).bind(ownerUserId,code).first();
  await db.prepare(`DELETE FROM sh_access_role_permissions WHERE owner_user_id=?1 AND role_id=?2`).bind(ownerUserId,role.id).run();
  if(permissions.length)await db.batch(permissions.map(p=>db.prepare(`INSERT INTO sh_access_role_permissions(owner_user_id,role_id,permission) VALUES(?1,?2,?3)`).bind(ownerUserId,role.id,p)));
  return role.id;
}

export async function upsertMember(db,ownerUserId,input){
  await ensureAccessTables(db);await ensureOwnerWorkspace(db,ownerUserId,null);
  const email=emailKey(input?.email),id=clean(input?.id)||uid(),now=NOW();
  if(!email||!email.includes('@'))throw new Error('Укажите email сотрудника.');
  const displayName=clean(input?.displayName),employeeId=clean(input?.employeeId);
  const existing=await db.prepare(`SELECT id,user_id FROM sh_access_members WHERE owner_user_id=?1 AND email=?2 LIMIT 1`).bind(ownerUserId,email).first();
  // Never mutate the owner's own membership through the ordinary employee editor.
  // Previously this guard ran after the UPSERT, so a failed edit could already leave
  // the owner PENDING/DISABLED. That is exactly the kind of accidental lockout we must avoid.
  if(existing?.user_id===ownerUserId)throw Object.assign(new Error('Права владельца изменяются отдельно. Учётная запись владельца не была изменена.'),{status:409,code:'OWNER_PROTECTED'});
  const linkedUserId=clean(existing?.user_id);
  let status=['ACTIVE','PENDING','DISABLED'].includes(String(input?.status||'').toUpperCase())?String(input.status).toUpperCase():'PENDING';
  if(!linkedUserId&&status==='ACTIVE')status='PENDING';
  const scope=input?.scope||{},scopeMode=String(scope.mode||'ALL').toUpperCase()==='SELECTED'?'SELECTED':'ALL';
  await db.prepare(`INSERT INTO sh_access_members(id,owner_user_id,email,iiko_employee_id,display_name,status,scope_mode,department_ids_json,department_codes_json,warehouse_ids_json,created_at,updated_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)
    ON CONFLICT(owner_user_id,email) DO UPDATE SET iiko_employee_id=excluded.iiko_employee_id,display_name=excluded.display_name,status=excluded.status,scope_mode=excluded.scope_mode,department_ids_json=excluded.department_ids_json,department_codes_json=excluded.department_codes_json,warehouse_ids_json=excluded.warehouse_ids_json,updated_at=excluded.updated_at`)
    .bind(id,ownerUserId,email,employeeId,displayName,status,scopeMode,JSON.stringify(scope.departmentIds||[]),JSON.stringify(scope.departmentCodes||[]),JSON.stringify(scope.warehouseIds||[]),now).run();
  const member=await db.prepare(`SELECT id,user_id FROM sh_access_members WHERE owner_user_id=?1 AND email=?2`).bind(ownerUserId,email).first();
  await db.prepare(`DELETE FROM sh_access_member_roles WHERE owner_user_id=?1 AND member_id=?2`).bind(ownerUserId,member.id).run();
  const roleIds=[...new Set((input?.roleIds||[]).map(clean).filter(Boolean))];
  if(roleIds.length){
    const valid=await db.prepare(`SELECT id FROM sh_access_roles WHERE owner_user_id=?1`).bind(ownerUserId).all();
    const allowed=new Set((valid.results||[]).map(x=>x.id));
    const stmts=roleIds.filter(x=>allowed.has(x)).map(roleId=>db.prepare(`INSERT INTO sh_access_member_roles(owner_user_id,member_id,role_id) VALUES(?1,?2,?3)`).bind(ownerUserId,member.id,roleId));
    if(stmts.length)await db.batch(stmts);
  }
  const invite=await createMemberInvite(db,ownerUserId,member.id);
  return{memberId:member.id,...invite};
}
export async function setMemberStatus(db,ownerUserId,memberId,status){
  const next=String(status||'').toUpperCase();
  if(!['ACTIVE','PENDING','DISABLED'].includes(next))throw new Error('Некорректный статус.');
  const row=await db.prepare(`SELECT * FROM sh_access_members WHERE owner_user_id=?1 AND id=?2`).bind(ownerUserId,memberId).first();
  if(!row)throw Object.assign(new Error('Пользователь не найден.'),{status:404});
  if(row.user_id===ownerUserId)throw Object.assign(new Error('Нельзя отключить владельца.'),{status:409});
  await db.prepare(`UPDATE sh_access_members SET status=?3,updated_at=?4 WHERE owner_user_id=?1 AND id=?2`).bind(ownerUserId,memberId,next,NOW()).run();
}
