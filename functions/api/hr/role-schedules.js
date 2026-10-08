import { iikoText } from '../iiko/_lib/iiko-client.js';
import { getUser, loadRequestIikoState, privateConnection, hasPrivateConnection } from '../iiko/_lib/user-state.js';
import { resolveHrRestaurantScope, filterEmployeesByScope, isHrSubsetScope } from './_lib/restaurant-scope.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function now(){return new Date().toISOString()}
function decodeXml(v){return String(v??'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')}
function tag(xml,name){const m=String(xml||'').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));return m?decodeXml(m[1]).trim():''}
function blocks(xml,name){return [...String(xml||'').matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'gi'))].map(m=>m[1])}
function bool(v){return /^true$/i.test(clean(v))}
function int(v,min,max,fallback=0){const n=Number.parseInt(String(v??''),10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback}
function parseRoles(xml){return blocks(xml,'role').map(x=>({id:tag(x,'id'),code:tag(x,'code'),name:tag(x,'name'),deleted:bool(tag(x,'deleted'))})).filter(x=>x.code)}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_roles (
      user_id TEXT NOT NULL,iiko_role_id TEXT NOT NULL DEFAULT '',role_code TEXT NOT NULL,role_name TEXT NOT NULL DEFAULT '',
      is_deleted INTEGER NOT NULL DEFAULT 0,synced_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(user_id,role_code)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_roles_user ON hr_roles(user_id,is_deleted,role_name)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_attendance_rules (
      user_id TEXT NOT NULL,role_code TEXT NOT NULL,daily_norm_minutes INTEGER NOT NULL DEFAULT 480,
      shift_type TEXT NOT NULL DEFAULT 'DAY',updated_at TEXT NOT NULL DEFAULT '',PRIMARY KEY(user_id,role_code)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_role_attendance_rules_user ON hr_role_attendance_rules(user_id,role_code)`)
  ]);
}
async function seedRolesFromEmployees(db,userId){
  const rows=await db.prepare(`SELECT role_code,MAX(role_name) AS role_name FROM hr_employees WHERE user_id=?1 AND TRIM(role_code)<>'' GROUP BY role_code`).bind(userId).all().catch(()=>({results:[]}));
  const t=now(),stm=[];
  for(const r of rows.results||[])stm.push(db.prepare(`INSERT OR IGNORE INTO hr_roles(user_id,iiko_role_id,role_code,role_name,is_deleted,synced_at) VALUES(?1,'',?2,?3,0,?4)`).bind(userId,clean(r.role_code),clean(r.role_name)||clean(r.role_code),t));
  if(stm.length)for(let i=0;i<stm.length;i+=50)await db.batch(stm.slice(i,i+50));
}
async function snapshot(db,userId,scope=null){
  await seedRolesFromEmployees(db,userId);
  const [rolesResult,countsResult,rulesResult]=await Promise.all([
    db.prepare(`SELECT * FROM hr_roles WHERE user_id=?1 ORDER BY is_deleted ASC,role_name COLLATE NOCASE,role_code COLLATE NOCASE`).bind(userId).all(),
    db.prepare(`SELECT role_code,department_code,is_deleted,fire_date,employee_code FROM hr_employees WHERE user_id=?1 AND TRIM(employee_code)<>''`).bind(userId).all().catch(()=>({results:[]})),
    db.prepare(`SELECT role_code,daily_norm_minutes,shift_type,updated_at FROM hr_role_attendance_rules WHERE user_id=?1`).bind(userId).all()
  ]);
  const employeeCounts=new Map();
  for(const x of filterEmployeesByScope(countsResult.results||[],scope)){
    if(Number(x.is_deleted)||(x.fire_date&&String(x.fire_date).trim()))continue;
    const code=String(x.role_code||'');if(code)employeeCounts.set(code,(employeeCounts.get(code)||0)+1);
  }
  const subset=isHrSubsetScope(scope),visibleRoleCodes=new Set(employeeCounts.keys()),ruleMap=new Map((rulesResult.results||[]).map(r=>[String(r.role_code||''),r]));
  const roles=(rolesResult.results||[]).filter(r=>!subset||visibleRoleCodes.has(String(r.role_code||''))).map(r=>{
    const rule=ruleMap.get(String(r.role_code||''))||{},shift=String(rule.shift_type||'DAY').toUpperCase()==='NIGHT'?'NIGHT':'DAY';
    return{id:r.iiko_role_id||'',code:r.role_code,name:r.role_name||r.role_code,deleted:Boolean(r.is_deleted),syncedAt:r.synced_at||'',employeeCount:employeeCounts.get(String(r.role_code))||0,dailyNormMinutes:Number(rule.daily_norm_minutes||480),shiftType:shift,attendanceRuleUpdatedAt:rule.updated_at||''};
  });
  const active=roles.filter(r=>!r.deleted);
  return{roles,schedules:[],schedulePolicyScope:'FREE_SHIFT_ROLE_NORM',restaurantScope:scope?{mode:scope.mode,departmentIds:scope.selectedDepartmentIds||[],departmentCodes:scope.selectedDepartmentCodes||[]}:null,
    counts:{roles:active.length,employees:active.reduce((a,r)=>a+Number(r.employeeCount||0),0),dayRoles:active.filter(r=>r.shiftType==='DAY').length,nightRoles:active.filter(r=>r.shiftType==='NIGHT').length}};
}
async function syncRoles(request,env,userId,scope){
  const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
  if(!state.found||!hasPrivateConnection(state.state))return json({success:false,message:'Сначала подключите SH Server в настройках.'},409);
  const result=await iikoText(privateConnection(state.state),'/resto/api/employees/roles?revisionFrom=-1');
  if(!result.ok)throw new Error(`SH Roles HTTP ${result.status}: ${result.text.slice(0,500)}`);
  const roles=parseRoles(result.text),t=now();
  await env.DB.prepare(`UPDATE hr_roles SET is_deleted=1,synced_at=?2 WHERE user_id=?1`).bind(userId,t).run();
  const stm=roles.map(r=>env.DB.prepare(`INSERT INTO hr_roles(user_id,iiko_role_id,role_code,role_name,is_deleted,synced_at) VALUES(?1,?2,?3,?4,?5,?6)
    ON CONFLICT(user_id,role_code) DO UPDATE SET iiko_role_id=excluded.iiko_role_id,role_name=excluded.role_name,is_deleted=excluded.is_deleted,synced_at=excluded.synced_at`).bind(userId,r.id||'',r.code,r.name||r.code,r.deleted?1:0,t));
  for(let i=0;i<stm.length;i+=50)await env.DB.batch(stm.slice(i,i+50));
  return json({success:true,syncedAt:t,...await snapshot(env.DB,userId,scope)});
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){
  try{
    const a=await getUser(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);
    await ensure(env.DB);const scope=await resolveHrRestaurantScope(request,env,a.user.id);
    return json({success:true,source:'SMART_HORECA_ROLES',...await snapshot(env.DB,a.user.id,scope)});
  }catch(e){console.error('[HR-ROLES-GET]',e);return json({success:false,message:e?.message||String(e)},500)}
}
export async function onRequestPost({request,env}){
  try{
    const a=await getUser(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);
    await ensure(env.DB);const userId=a.user.id,scope=await resolveHrRestaurantScope(request,env,userId);
    const body=await request.json().catch(()=>({})),action=clean(body.action);
    if(action==='syncRoles')return syncRoles(request,env,userId,scope);
    if(action!=='saveAttendanceRule')return json({success:false,message:'Старые шаблоны графиков отключены. Используйте норму должности и тип смены Face ID.'},410);
    const roleCode=clean(body.roleCode),shiftType=clean(body.shiftType).toUpperCase(),dailyNormMinutes=int(body.dailyNormMinutes,60,1440,480);
    if(!roleCode)return json({success:false,message:'Не указана должность'},400);
    if(!['DAY','NIGHT'].includes(shiftType))return json({success:false,message:'Тип смены должен быть DAY или NIGHT'},400);
    const role=await env.DB.prepare(`SELECT role_code FROM hr_roles WHERE user_id=?1 AND role_code=?2 AND is_deleted=0 LIMIT 1`).bind(userId,roleCode).first();
    if(!role)return json({success:false,message:'Должность не найдена'},404);
    await env.DB.prepare(`INSERT INTO hr_role_attendance_rules(user_id,role_code,daily_norm_minutes,shift_type,updated_at)
      VALUES(?1,?2,?3,?4,?5)
      ON CONFLICT(user_id,role_code) DO UPDATE SET daily_norm_minutes=excluded.daily_norm_minutes,shift_type=excluded.shift_type,updated_at=excluded.updated_at`)
      .bind(userId,roleCode,dailyNormMinutes,shiftType,now()).run();
    return json({success:true,roleCode,dailyNormMinutes,shiftType,...await snapshot(env.DB,userId,scope)});
  }catch(e){console.error('[HR-ROLES-POST]',e);return json({success:false,message:e?.message||String(e)},500)}
}
