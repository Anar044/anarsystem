import { iikoText } from '../iiko/_lib/iiko-client.js';
import { loadRequestIikoState, privateConnection, hasPrivateConnection } from '../iiko/_lib/user-state.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function decodeXml(v){return String(v??'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')}
function tag(xml,name){const m=String(xml||'').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));return m?decodeXml(m[1]).trim():''}
function tags(xml,name){return [...String(xml||'').matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'gi'))].map(m=>decodeXml(m[1]).trim())}
function blocks(xml,name){return [...String(xml||'').matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'gi'))].map(m=>m[1])}
function bool(v){return /^true$/i.test(clean(v))}
function dateOnly(v){const s=clean(v);const m=s.match(/^\d{4}-\d{2}-\d{2}/);return m?m[0]:''}
function now(){return new Date().toISOString()}

function parseEmployees(xml){
  return blocks(xml,'employee').map(x=>({
    id:tag(x,'id'),code:tag(x,'code'),displayName:tag(x,'name'),firstName:tag(x,'firstName'),middleName:tag(x,'middleName'),lastName:tag(x,'lastName'),
    mainRoleCode:tag(x,'mainRoleCode'),roleCodes:tags(x,'roleCodes').filter(Boolean),hireDate:dateOnly(tag(x,'hireDate')),fireDate:dateOnly(tag(x,'fireDate')),
    preferredDepartmentCode:tag(x,'preferredDepartmentCode'),departmentCodes:tags(x,'departmentCodes').filter(Boolean),deleted:bool(tag(x,'deleted')),
    isEmployee:tag(x,'employee')===''?true:bool(tag(x,'employee'))
  })).filter(x=>x.id&&x.isEmployee);
}
function parseRoles(xml){return blocks(xml,'role').map(x=>({id:tag(x,'id'),code:tag(x,'code'),name:tag(x,'name'),deleted:bool(tag(x,'deleted'))})).filter(x=>x.code)}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employees (
      user_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,employee_code TEXT NOT NULL DEFAULT '',first_name TEXT NOT NULL DEFAULT '',middle_name TEXT NOT NULL DEFAULT '',last_name TEXT NOT NULL DEFAULT '',display_name TEXT NOT NULL DEFAULT '',role_code TEXT NOT NULL DEFAULT '',role_name TEXT NOT NULL DEFAULT '',department_code TEXT NOT NULL DEFAULT '',hire_date TEXT NOT NULL DEFAULT '',fire_date TEXT NOT NULL DEFAULT '',is_deleted INTEGER NOT NULL DEFAULT 0,synced_at TEXT NOT NULL,PRIMARY KEY(user_id,iiko_employee_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_employees_user ON hr_employees(user_id,is_deleted,last_name,first_name)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_device_links (
      user_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,provider TEXT NOT NULL DEFAULT '',external_employee_id TEXT NOT NULL DEFAULT '',external_label TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,iiko_employee_id,provider),UNIQUE(user_id,provider,external_employee_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_device_bindings (
      user_id TEXT NOT NULL,device_id TEXT NOT NULL,iiko_employee_id TEXT NOT NULL,provider TEXT NOT NULL DEFAULT 'ZKTECO',external_employee_id TEXT NOT NULL,external_label TEXT NOT NULL DEFAULT '',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,device_id,iiko_employee_id),UNIQUE(user_id,device_id,external_employee_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_bindings_employee ON hr_employee_device_bindings(user_id,iiko_employee_id)`)
  ]);
}

async function syncEmployees(db,userId,employees,roleMap){
  await ensure(db);const syncedAt=now();const statements=[];
  for(const e of employees){
    const role=roleMap.get(e.mainRoleCode)||null;const roleCode=e.mainRoleCode||e.roleCodes[0]||'';const fullName=[e.lastName,e.firstName,e.middleName].filter(Boolean).join(' ')||e.displayName||e.code||e.id;
    statements.push(db.prepare(`INSERT INTO hr_employees(user_id,iiko_employee_id,employee_code,first_name,middle_name,last_name,display_name,role_code,role_name,department_code,hire_date,fire_date,is_deleted,synced_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)
      ON CONFLICT(user_id,iiko_employee_id) DO UPDATE SET employee_code=excluded.employee_code,first_name=excluded.first_name,middle_name=excluded.middle_name,last_name=excluded.last_name,display_name=excluded.display_name,role_code=excluded.role_code,role_name=excluded.role_name,department_code=excluded.department_code,hire_date=excluded.hire_date,fire_date=excluded.fire_date,is_deleted=excluded.is_deleted,synced_at=excluded.synced_at`)
      .bind(userId,e.id,e.code,e.firstName,e.middleName,e.lastName,fullName,roleCode,role?.name||roleCode,e.preferredDepartmentCode||e.departmentCodes[0]||'',e.hireDate,e.fireDate,e.deleted?1:0,syncedAt));
  }
  for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));
  const rows=await db.prepare(`SELECT e.*,
      COALESCE((SELECT b.provider FROM hr_employee_device_bindings b WHERE b.user_id=e.user_id AND b.iiko_employee_id=e.iiko_employee_id ORDER BY b.updated_at DESC LIMIT 1),(SELECT l.provider FROM hr_employee_device_links l WHERE l.user_id=e.user_id AND l.iiko_employee_id=e.iiko_employee_id ORDER BY l.updated_at DESC LIMIT 1),'') AS attendance_provider,
      COALESCE((SELECT b.external_employee_id FROM hr_employee_device_bindings b WHERE b.user_id=e.user_id AND b.iiko_employee_id=e.iiko_employee_id ORDER BY b.updated_at DESC LIMIT 1),(SELECT l.external_employee_id FROM hr_employee_device_links l WHERE l.user_id=e.user_id AND l.iiko_employee_id=e.iiko_employee_id ORDER BY l.updated_at DESC LIMIT 1),'') AS attendance_external_id
    FROM hr_employees e WHERE e.user_id=?1 ORDER BY e.is_deleted ASC,e.last_name COLLATE NOCASE,e.first_name COLLATE NOCASE,e.display_name COLLATE NOCASE`).bind(userId).all();
  return{syncedAt,rows:rows.results||[]};
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);if(!state.found||!hasPrivateConnection(state.state))return json({success:false,message:'Сначала подключите SH Server в настройках.'},409);
    const connection=privateConnection(state.state);const [employeesResult,rolesResult]=await Promise.all([iikoText(connection,'/resto/api/employees?includeDeleted=true'),iikoText(connection,'/resto/api/employees/roles?revisionFrom=-1')]);
    if(!employeesResult.ok)throw new Error(`SH Employees HTTP ${employeesResult.status}: ${employeesResult.text.slice(0,500)}`);if(!rolesResult.ok)throw new Error(`SH Roles HTTP ${rolesResult.status}: ${rolesResult.text.slice(0,500)}`);
    const employees=parseEmployees(employeesResult.text),roles=parseRoles(rolesResult.text),roleMap=new Map(roles.map(r=>[r.code,r]));const synced=await syncEmployees(env.DB,state.user.id,employees,roleMap);
    const items=synced.rows.map(r=>({id:r.iiko_employee_id,code:r.employee_code,firstName:r.first_name,middleName:r.middle_name,lastName:r.last_name,name:r.display_name,roleCode:r.role_code,roleName:r.role_name,departmentCode:r.department_code,hireDate:r.hire_date,fireDate:r.fire_date,deleted:Boolean(r.is_deleted),attendanceProvider:r.attendance_provider||'',attendanceExternalId:r.attendance_external_id||''}));
    return json({success:true,source:'SH_EMPLOYEE_DIRECTORY',attendanceSource:'EXTERNAL_DEVICE',payrollEngine:'SMART_HORECA',syncedAt:synced.syncedAt,items,roles:roles.filter(r=>!r.deleted),counts:{total:items.length,active:items.filter(x=>!x.deleted&&!x.fireDate).length,linkedToAttendance:items.filter(x=>x.attendanceExternalId).length}});
  }catch(error){console.error('[HR-EMPLOYEES]',error);return json({success:false,message:error?.message||String(error)},500)}
}
