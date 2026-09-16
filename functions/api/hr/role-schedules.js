import { iikoText } from '../iiko/_lib/iiko-client.js';
import { getUser, loadRequestIikoState, privateConnection, hasPrivateConnection } from '../iiko/_lib/user-state.js';
import { validateWeeklySchedule, validateCycleSchedule, AZ_LABOR_RULES } from './_lib/az-labor-rules.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function now(){return new Date().toISOString()}
function uid(prefix='id'){return `${prefix}_${crypto.randomUUID()}`}
function decodeXml(v){return String(v??'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&')}
function tag(xml,name){const m=String(xml||'').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));return m?decodeXml(m[1]).trim():''}
function blocks(xml,name){return [...String(xml||'').matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'gi'))].map(m=>m[1])}
function bool(v){return /^true$/i.test(clean(v))}
function int(v,min,max,fallback=0){const n=Number.parseInt(String(v??''),10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback}
function dateOnly(v){const s=clean(v);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''}
function timeOnly(v){const s=clean(v);return /^([01]\d|2[0-3]):[0-5]\d$/.test(s)?s:''}
function parseRoles(xml){return blocks(xml,'role').map(x=>({id:tag(x,'id'),code:tag(x,'code'),name:tag(x,'name'),deleted:bool(tag(x,'deleted'))})).filter(x=>x.code)}

const legalBasis={
  jurisdiction:'AZ',
  profile:'AZ_LABOR_CODE',
  rules:AZ_LABOR_RULES,
  articles:{normalTime:'Əmək Məcəlləsi 89–90',summarized:'Əmək Məcəlləsi 96',night:'Əmək Məcəlləsi 97',holidayEve:'Əmək Məcəlləsi 108'},
  calendar:'ƏƏSMN istehsalat təqvimi'
};

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_roles (
      user_id TEXT NOT NULL,
      iiko_role_id TEXT NOT NULL DEFAULT '',
      role_code TEXT NOT NULL,
      role_name TEXT NOT NULL DEFAULT '',
      is_deleted INTEGER NOT NULL DEFAULT 0,
      synced_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(user_id,role_code)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_roles_user ON hr_roles(user_id,is_deleted,role_name)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_schedules (
      user_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      role_code TEXT NOT NULL,
      schedule_name TEXT NOT NULL,
      pattern_type TEXT NOT NULL DEFAULT 'WEEKLY',
      weekdays TEXT NOT NULL DEFAULT '1,2,3,4,5',
      work_days INTEGER NOT NULL DEFAULT 5,
      off_days INTEGER NOT NULL DEFAULT 2,
      anchor_date TEXT NOT NULL DEFAULT '',
      shift_start TEXT NOT NULL,
      shift_end TEXT NOT NULL,
      break_minutes INTEGER NOT NULL DEFAULT 0,
      valid_from TEXT NOT NULL,
      valid_to TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,schedule_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_role_schedules_role ON hr_role_schedules(user_id,role_code,is_active,valid_from)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_schedule_days (
      user_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      weekday INTEGER NOT NULL,
      shift_start TEXT NOT NULL,
      shift_end TEXT NOT NULL,
      break_minutes INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(user_id,schedule_id,weekday)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_role_schedule_settings (
      user_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      accounting_mode TEXT NOT NULL DEFAULT 'NORMAL_WEEKLY',
      accounting_period_months INTEGER NOT NULL DEFAULT 1,
      legal_profile TEXT NOT NULL DEFAULT 'AZ_LABOR_CODE',
      validated_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(user_id,schedule_id)
    )`)
  ]);
}

async function seedRolesFromEmployees(db,userId){
  const rows=await db.prepare(`SELECT role_code,MAX(role_name) AS role_name FROM hr_employees WHERE user_id=?1 AND TRIM(role_code)<>'' GROUP BY role_code`).bind(userId).all().catch(()=>({results:[]}));
  const t=now(),statements=[];
  for(const r of rows.results||[]){statements.push(db.prepare(`INSERT OR IGNORE INTO hr_roles(user_id,iiko_role_id,role_code,role_name,is_deleted,synced_at) VALUES(?1,'',?2,?3,0,?4)`).bind(userId,clean(r.role_code),clean(r.role_name)||clean(r.role_code),t));}
  if(statements.length)await db.batch(statements);
}

async function snapshot(db,userId){
  await seedRolesFromEmployees(db,userId);
  const [rolesResult,schedulesResult,countsResult,daysResult,settingsResult]=await Promise.all([
    db.prepare(`SELECT * FROM hr_roles WHERE user_id=?1 ORDER BY is_deleted ASC,role_name COLLATE NOCASE,role_code COLLATE NOCASE`).bind(userId).all(),
    db.prepare(`SELECT * FROM hr_role_schedules WHERE user_id=?1 ORDER BY is_active DESC,is_default DESC,role_code COLLATE NOCASE,valid_from DESC,schedule_name COLLATE NOCASE`).bind(userId).all(),
    db.prepare(`SELECT role_code,COUNT(*) AS employee_count FROM hr_employees WHERE user_id=?1 AND TRIM(employee_code)<>'' AND is_deleted=0 AND (fire_date='' OR fire_date IS NULL) GROUP BY role_code`).bind(userId).all().catch(()=>({results:[]})),
    db.prepare(`SELECT schedule_id,weekday,shift_start,shift_end,break_minutes FROM hr_role_schedule_days WHERE user_id=?1 ORDER BY weekday`).bind(userId).all(),
    db.prepare(`SELECT schedule_id,accounting_mode,accounting_period_months,legal_profile,validated_at FROM hr_role_schedule_settings WHERE user_id=?1`).bind(userId).all()
  ]);
  const employeeCounts=new Map((countsResult.results||[]).map(x=>[String(x.role_code||''),Number(x.employee_count||0)]));
  const dayMap=new Map();for(const d of daysResult.results||[]){const id=String(d.schedule_id||'');if(!dayMap.has(id))dayMap.set(id,[]);dayMap.get(id).push({weekday:Number(d.weekday),shiftStart:d.shift_start,shiftEnd:d.shift_end,breakMinutes:Number(d.break_minutes||0)});}
  const settingsMap=new Map((settingsResult.results||[]).map(s=>[String(s.schedule_id||''),s]));
  const schedules=(schedulesResult.results||[]).map(s=>{
    const settings=settingsMap.get(String(s.schedule_id))||{};
    const weekdays=String(s.weekdays||'').split(',').map(Number).filter(Boolean);
    const storedDays=dayMap.get(String(s.schedule_id))||[];
    const dayRules=storedDays.length?storedDays:weekdays.map(day=>({weekday:day,shiftStart:s.shift_start,shiftEnd:s.shift_end,breakMinutes:Number(s.break_minutes||0)}));
    return{
      id:s.schedule_id,roleCode:s.role_code,name:s.schedule_name,patternType:s.pattern_type,
      weekdays,workDays:Number(s.work_days||0),offDays:Number(s.off_days||0),anchorDate:s.anchor_date||'',
      shiftStart:s.shift_start,shiftEnd:s.shift_end,breakMinutes:Number(s.break_minutes||0),dayRules,
      accountingMode:settings.accounting_mode||(s.pattern_type==='CYCLE'?'SUMMARIZED':'NORMAL_WEEKLY'),accountingPeriodMonths:Number(settings.accounting_period_months||1),
      legalProfile:settings.legal_profile||'',validatedAt:settings.validated_at||'',validFrom:s.valid_from,validTo:s.valid_to||'',
      isDefault:Boolean(s.is_default),active:Boolean(s.is_active),createdAt:s.created_at,updatedAt:s.updated_at
    };
  });
  const scheduleCounts=new Map();const defaultRoles=new Set();
  for(const s of schedules){if(s.active)scheduleCounts.set(s.roleCode,(scheduleCounts.get(s.roleCode)||0)+1);if(s.active&&s.isDefault)defaultRoles.add(s.roleCode)}
  const roles=(rolesResult.results||[]).map(r=>({id:r.iiko_role_id||'',code:r.role_code,name:r.role_name||r.role_code,deleted:Boolean(r.is_deleted),syncedAt:r.synced_at||'',employeeCount:employeeCounts.get(String(r.role_code))||0,scheduleCount:scheduleCounts.get(String(r.role_code))||0,hasDefaultSchedule:defaultRoles.has(String(r.role_code))}));
  const activeRoles=roles.filter(r=>!r.deleted);
  return{roles,schedules,legalBasis,counts:{roles:activeRoles.length,employees:activeRoles.reduce((a,r)=>a+r.employeeCount,0),schedules:schedules.filter(x=>x.active).length,rolesWithoutDefault:activeRoles.filter(r=>!r.hasDefaultSchedule).length}};
}

async function syncRoles(request,env,userId){
  const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);if(!state.found||!hasPrivateConnection(state.state))return json({success:false,message:'Сначала подключите SH Server в настройках.'},409);
  const connection=privateConnection(state.state),result=await iikoText(connection,'/resto/api/employees/roles?revisionFrom=-1');
  if(!result.ok)throw new Error(`SH Roles HTTP ${result.status}: ${result.text.slice(0,500)}`);
  const roles=parseRoles(result.text),t=now();
  await env.DB.prepare(`UPDATE hr_roles SET is_deleted=1,synced_at=?2 WHERE user_id=?1`).bind(userId,t).run();
  const stm=[];
  for(const r of roles){stm.push(env.DB.prepare(`INSERT INTO hr_roles(user_id,iiko_role_id,role_code,role_name,is_deleted,synced_at) VALUES(?1,?2,?3,?4,?5,?6)
    ON CONFLICT(user_id,role_code) DO UPDATE SET iiko_role_id=excluded.iiko_role_id,role_name=excluded.role_name,is_deleted=excluded.is_deleted,synced_at=excluded.synced_at`).bind(userId,r.id||'',r.code,r.name||r.code,r.deleted?1:0,t));}
  for(let i=0;i<stm.length;i+=50)await env.DB.batch(stm.slice(i,i+50));
  return json({success:true,syncedAt:t,...await snapshot(env.DB,userId)});
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{const a=await getUser(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);await ensure(env.DB);return json({success:true,source:'IIKO_ROLES_CACHE',...await snapshot(env.DB,a.user.id)});}
  catch(e){console.error('[HR-ROLE-SCHEDULES-GET]',e);return json({success:false,message:e?.message||String(e)},500)}
}

export async function onRequestPost({request,env}){
  try{
    const a=await getUser(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);await ensure(env.DB);const userId=a.user.id;
    const body=await request.json().catch(()=>({})),action=clean(body.action);
    if(action==='syncRoles')return await syncRoles(request,env,userId);
    if(action==='saveSchedule'){
      const roleCode=clean(body.roleCode),name=clean(body.name),scheduleId=clean(body.id)||uid('hrs'),patternType=(clean(body.patternType)||'WEEKLY').toUpperCase();
      const shiftStart=timeOnly(body.shiftStart),shiftEnd=timeOnly(body.shiftEnd),breakMinutes=int(body.breakMinutes,0,600,0),validFrom=dateOnly(body.validFrom),validTo=dateOnly(body.validTo);
      const workDays=int(body.workDays,1,14,5),offDays=int(body.offDays,1,14,2),anchorDate=dateOnly(body.anchorDate),isDefault=Boolean(body.isDefault),accountingPeriodMonths=int(body.accountingPeriodMonths,1,12,1);
      let weekdays=Array.isArray(body.weekdays)?body.weekdays.map(x=>int(x,1,7,0)).filter(Boolean):[1,2,3,4,5];weekdays=[...new Set(weekdays)].sort((x,y)=>x-y);
      if(!roleCode||!name)return json({success:false,message:'Укажите должность и название графика'},400);
      if(!['WEEKLY','CYCLE'].includes(patternType))return json({success:false,message:'Неизвестный тип графика'},400);
      if(!shiftStart||!shiftEnd)return json({success:false,message:'Укажите корректное время начала и конца смены'},400);
      if(!validFrom)return json({success:false,message:'Укажите дату начала действия графика'},400);
      if(validTo&&validTo<validFrom)return json({success:false,message:'Дата окончания не может быть раньше даты начала'},400);
      if(patternType==='WEEKLY'&&!weekdays.length)return json({success:false,message:'Выберите рабочие дни недели'},400);
      if(patternType==='CYCLE'&&!anchorDate)return json({success:false,message:'Для сменного цикла укажите опорную дату первой рабочей смены'},400);
      const role=await env.DB.prepare(`SELECT role_code FROM hr_roles WHERE user_id=?1 AND role_code=?2 AND is_deleted=0 LIMIT 1`).bind(userId,roleCode).first();if(!role)return json({success:false,message:'Должность не найдена. Сначала синхронизируйте должности из iiko.'},404);

      let legalCheck,dayRules=[];
      if(patternType==='WEEKLY'){
        const provided=Array.isArray(body.dayRules)?body.dayRules:[];
        dayRules=provided.length?provided.map(r=>({weekday:int(r.weekday,1,7,0),shiftStart:timeOnly(r.shiftStart),shiftEnd:timeOnly(r.shiftEnd),breakMinutes:int(r.breakMinutes,0,600,0)})).filter(r=>r.weekday):weekdays.map(day=>({weekday:day,shiftStart,shiftEnd,breakMinutes}));
        legalCheck=validateWeeklySchedule(dayRules);
        if(!legalCheck.ok)return json({success:false,message:legalCheck.message,legalBasis},400);
        dayRules=legalCheck.dayRules;weekdays=dayRules.map(r=>r.weekday);
      }else{
        legalCheck=validateCycleSchedule({shiftStart,shiftEnd,breakMinutes,workDays,offDays,accountingPeriodMonths});
        if(!legalCheck.ok)return json({success:false,message:legalCheck.message,legalBasis},400);
      }

      const t=now();
      if(isDefault)await env.DB.prepare(`UPDATE hr_role_schedules SET is_default=0,updated_at=?3 WHERE user_id=?1 AND role_code=?2 AND is_active=1`).bind(userId,roleCode,t).run();
      await env.DB.prepare(`INSERT INTO hr_role_schedules(user_id,schedule_id,role_code,schedule_name,pattern_type,weekdays,work_days,off_days,anchor_date,shift_start,shift_end,break_minutes,valid_from,valid_to,is_default,is_active,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,1,?16,?16)
        ON CONFLICT(user_id,schedule_id) DO UPDATE SET role_code=excluded.role_code,schedule_name=excluded.schedule_name,pattern_type=excluded.pattern_type,weekdays=excluded.weekdays,work_days=excluded.work_days,off_days=excluded.off_days,anchor_date=excluded.anchor_date,shift_start=excluded.shift_start,shift_end=excluded.shift_end,break_minutes=excluded.break_minutes,valid_from=excluded.valid_from,valid_to=excluded.valid_to,is_default=excluded.is_default,is_active=1,updated_at=excluded.updated_at`)
        .bind(userId,scheduleId,roleCode,name,patternType,weekdays.join(','),workDays,offDays,patternType==='CYCLE'?anchorDate:'',shiftStart,shiftEnd,breakMinutes,validFrom,validTo,isDefault?1:0,t).run();

      await env.DB.prepare(`DELETE FROM hr_role_schedule_days WHERE user_id=?1 AND schedule_id=?2`).bind(userId,scheduleId).run();
      if(patternType==='WEEKLY'&&dayRules.length){
        const dayStatements=dayRules.map(r=>env.DB.prepare(`INSERT INTO hr_role_schedule_days(user_id,schedule_id,weekday,shift_start,shift_end,break_minutes) VALUES(?1,?2,?3,?4,?5,?6)`).bind(userId,scheduleId,r.weekday,r.shiftStart,r.shiftEnd,r.breakMinutes));
        await env.DB.batch(dayStatements);
      }
      await env.DB.prepare(`INSERT INTO hr_role_schedule_settings(user_id,schedule_id,accounting_mode,accounting_period_months,legal_profile,validated_at)
        VALUES(?1,?2,?3,?4,'AZ_LABOR_CODE',?5)
        ON CONFLICT(user_id,schedule_id) DO UPDATE SET accounting_mode=excluded.accounting_mode,accounting_period_months=excluded.accounting_period_months,legal_profile=excluded.legal_profile,validated_at=excluded.validated_at`)
        .bind(userId,scheduleId,legalCheck.accountingMode||'NORMAL_WEEKLY',legalCheck.accountingPeriodMonths||accountingPeriodMonths,t).run();
      return json({success:true,scheduleId,legalCheck,...await snapshot(env.DB,userId)});
    }
    if(action==='disableSchedule'){
      const id=clean(body.id);if(!id)return json({success:false,message:'Не указан график'},400);
      await env.DB.prepare(`UPDATE hr_role_schedules SET is_active=0,is_default=0,updated_at=?3 WHERE user_id=?1 AND schedule_id=?2`).bind(userId,id,now()).run();
      return json({success:true,...await snapshot(env.DB,userId)});
    }
    return json({success:false,message:'Неизвестное действие'},400);
  }catch(e){console.error('[HR-ROLE-SCHEDULES-POST]',e);return json({success:false,message:e?.message||String(e)},500)}
}
