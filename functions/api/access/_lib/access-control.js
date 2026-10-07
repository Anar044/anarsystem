const NOW=()=>new Date().toISOString();
const clean=v=>String(v??'').trim();
const emailKey=v=>clean(v).toLowerCase();
const jsonParse=(v,fallback)=>{try{const x=JSON.parse(String(v||''));return x??fallback}catch{return fallback}};
const uid=()=>crypto.randomUUID();

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
  if(row)return row;
  if(!await hasLegacyOwnerData(db,userId))return null;
  const id=uid(),name=clean(user?.user_metadata?.full_name)||[clean(user?.user_metadata?.first_name),clean(user?.user_metadata?.last_name)].filter(Boolean).join(' ')||email;
  await db.prepare(`INSERT INTO sh_access_members(id,owner_user_id,user_id,email,display_name,status,scope_mode,created_at,updated_at) VALUES(?1,?2,?2,?3,?4,'ACTIVE','ALL',?5,?5)`)
    .bind(id,userId,email,name,now).run();
  await seedRoles(db,userId);
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

export async function resolveAccessForUser(db,user,{claimInvite=true}={}){
  await ensureAccessTables(db);
  const userId=clean(user?.id),email=emailKey(user?.email);
  if(!userId)return{allowed:false,reason:'NO_USER'};
  let row=await db.prepare(`SELECT * FROM sh_access_members WHERE user_id=?1 ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END,updated_at DESC LIMIT 1`).bind(userId).first();

  if(!row&&claimInvite&&email){
    const invite=await db.prepare(`SELECT * FROM sh_access_members WHERE email=?1 AND (user_id IS NULL OR TRIM(user_id)='') AND status IN ('PENDING','ACTIVE') ORDER BY updated_at DESC LIMIT 1`).bind(email).first();
    if(invite){
      await db.prepare(`UPDATE sh_access_members SET user_id=?2,status='ACTIVE',updated_at=?3 WHERE id=?1`).bind(invite.id,userId,NOW()).run();
      row=await db.prepare(`SELECT * FROM sh_access_members WHERE id=?1`).bind(invite.id).first();
    }
  }

  if(!row)row=await ensureOwnerMembership(db,user);
  if(!row)return{allowed:false,reason:'NO_MEMBERSHIP',userId,email};
  if(String(row.status).toUpperCase()!=='ACTIVE')return{allowed:false,reason:'MEMBERSHIP_'+String(row.status).toUpperCase(),userId,email,ownerUserId:row.owner_user_id,memberId:row.id};

  await seedRoles(db,row.owner_user_id);
  const permissions=await permissionsForMember(db,row);
  return{
    allowed:true,
    userId,
    ownerUserId:row.owner_user_id,
    memberId:row.id,
    employeeId:row.iiko_employee_id||'',
    displayName:row.display_name||'',
    email:row.email||email,
    isOwner:row.owner_user_id===userId,
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
    permissions:PERMISSIONS,
    roles:(roles.results||[]).map(x=>({id:x.id,code:x.code,name:x.name,description:x.description,isSystem:Boolean(x.is_system),permissions:rp.get(x.id)||[]})),
    members:(members.results||[]).map(x=>({
      id:x.id,userId:x.user_id||'',email:x.email,employeeId:x.iiko_employee_id||'',displayName:x.display_name||'',status:x.status,
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
  await ensureAccessTables(db);
  const email=emailKey(input?.email),id=clean(input?.id)||uid(),now=NOW();
  if(!email||!email.includes('@'))throw new Error('Укажите email сотрудника.');
  const displayName=clean(input?.displayName),employeeId=clean(input?.employeeId),status=['ACTIVE','PENDING','DISABLED'].includes(String(input?.status||'').toUpperCase())?String(input.status).toUpperCase():'PENDING';
  const scope=input?.scope||{},scopeMode=String(scope.mode||'ALL').toUpperCase()==='SELECTED'?'SELECTED':'ALL';
  await db.prepare(`INSERT INTO sh_access_members(id,owner_user_id,email,iiko_employee_id,display_name,status,scope_mode,department_ids_json,department_codes_json,warehouse_ids_json,created_at,updated_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)
    ON CONFLICT(owner_user_id,email) DO UPDATE SET iiko_employee_id=excluded.iiko_employee_id,display_name=excluded.display_name,status=excluded.status,scope_mode=excluded.scope_mode,department_ids_json=excluded.department_ids_json,department_codes_json=excluded.department_codes_json,warehouse_ids_json=excluded.warehouse_ids_json,updated_at=excluded.updated_at`)
    .bind(id,ownerUserId,email,employeeId,displayName,status,scopeMode,JSON.stringify(scope.departmentIds||[]),JSON.stringify(scope.departmentCodes||[]),JSON.stringify(scope.warehouseIds||[]),now).run();
  const member=await db.prepare(`SELECT id,user_id FROM sh_access_members WHERE owner_user_id=?1 AND email=?2`).bind(ownerUserId,email).first();
  if(member?.user_id===ownerUserId)throw Object.assign(new Error('Права владельца изменяются отдельно.'),{status:409});
  await db.prepare(`DELETE FROM sh_access_member_roles WHERE owner_user_id=?1 AND member_id=?2`).bind(ownerUserId,member.id).run();
  const roleIds=[...new Set((input?.roleIds||[]).map(clean).filter(Boolean))];
  if(roleIds.length){
    const valid=await db.prepare(`SELECT id FROM sh_access_roles WHERE owner_user_id=?1`).bind(ownerUserId).all();
    const allowed=new Set((valid.results||[]).map(x=>x.id));
    const stmts=roleIds.filter(x=>allowed.has(x)).map(roleId=>db.prepare(`INSERT INTO sh_access_member_roles(owner_user_id,member_id,role_id) VALUES(?1,?2,?3)`).bind(ownerUserId,member.id,roleId));
    if(stmts.length)await db.batch(stmts);
  }
  return member.id;
}

export async function setMemberStatus(db,ownerUserId,memberId,status){
  const next=String(status||'').toUpperCase();
  if(!['ACTIVE','PENDING','DISABLED'].includes(next))throw new Error('Некорректный статус.');
  const row=await db.prepare(`SELECT * FROM sh_access_members WHERE owner_user_id=?1 AND id=?2`).bind(ownerUserId,memberId).first();
  if(!row)throw Object.assign(new Error('Пользователь не найден.'),{status:404});
  if(row.user_id===ownerUserId)throw Object.assign(new Error('Нельзя отключить владельца.'),{status:409});
  await db.prepare(`UPDATE sh_access_members SET status=?3,updated_at=?4 WHERE owner_user_id=?1 AND id=?2`).bind(ownerUserId,memberId,next,NOW()).run();
}
