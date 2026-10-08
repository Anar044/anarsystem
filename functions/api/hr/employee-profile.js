import { loadRequestIikoState, privateConnection } from '../iiko/_lib/user-state.js';
import { resolveHrRestaurantScope, filterEmployeesByScope } from './_lib/restaurant-scope.js';
import { calculateCompensation, AZ_PAYROLL_RULE_PROFILE } from './_lib/az-payroll-rules.js';
import { logAuditEvent } from '../_lib/audit-log.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v,max=500){return String(v??'').trim().slice(0,max)}
function dateOnly(v){const s=clean(v,10);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''}
function int(v,min,max,fallback){const n=Number.parseInt(String(v??''),10);return Number.isFinite(n)?Math.min(max,Math.max(min,n)):fallback}
function now(){return new Date().toISOString()}
function todayBaku(){try{return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Baku',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}catch{return new Date().toISOString().slice(0,10)}}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_profiles (
      user_id TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL,
      fin TEXT NOT NULL DEFAULT '',
      ssn TEXT NOT NULL DEFAULT '',
      birth_date TEXT NOT NULL DEFAULT '',
      phone_primary TEXT NOT NULL DEFAULT '',
      phone_secondary TEXT NOT NULL DEFAULT '',
      email_personal TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      emergency_contact_name TEXT NOT NULL DEFAULT '',
      emergency_contact_relation TEXT NOT NULL DEFAULT '',
      emergency_contact_phone TEXT NOT NULL DEFAULT '',
      education_level TEXT NOT NULL DEFAULT '',
      education_institution TEXT NOT NULL DEFAULT '',
      specialty TEXT NOT NULL DEFAULT '',
      employment_type TEXT NOT NULL DEFAULT 'MAIN',
      factual_hire_date TEXT NOT NULL DEFAULT '',
      factual_fire_date TEXT NOT NULL DEFAULT '',
      official_hire_date TEXT NOT NULL DEFAULT '',
      official_fire_date TEXT NOT NULL DEFAULT '',
      official_employer_name TEXT NOT NULL DEFAULT '',
      official_employer_voen TEXT NOT NULL DEFAULT '',
      quota_category TEXT NOT NULL DEFAULT 'NONE',
      work_capacity_percent INTEGER NOT NULL DEFAULT 100,
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,iiko_employee_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_employee_profiles_user ON hr_employee_profiles(user_id,updated_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_schedule_overrides (
      user_id TEXT NOT NULL,
      override_id TEXT NOT NULL,
      iiko_employee_id TEXT NOT NULL,
      schedule_id TEXT NOT NULL,
      effective_from TEXT NOT NULL,
      effective_to TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(user_id,override_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_employee_schedule_current ON hr_employee_schedule_overrides(user_id,iiko_employee_id,is_active,effective_from DESC)`)
  ]);
}

function profileDto(r){
  return{
    fin:r?.fin||'',ssn:r?.ssn||'',birthDate:r?.birth_date||'',
    phonePrimary:r?.phone_primary||'',phoneSecondary:r?.phone_secondary||'',emailPersonal:r?.email_personal||'',address:r?.address||'',
    emergencyContactName:r?.emergency_contact_name||'',emergencyContactRelation:r?.emergency_contact_relation||'',emergencyContactPhone:r?.emergency_contact_phone||'',
    educationLevel:r?.education_level||'',educationInstitution:r?.education_institution||'',specialty:r?.specialty||'',
    employmentType:r?.employment_type||'MAIN',factualHireDate:r?.factual_hire_date||'',factualFireDate:r?.factual_fire_date||'',
    officialHireDate:r?.official_hire_date||'',officialFireDate:r?.official_fire_date||'',officialEmployerName:r?.official_employer_name||'',officialEmployerVoen:r?.official_employer_voen||'',
    quotaCategory:r?.quota_category||'NONE',workCapacityPercent:Number(r?.work_capacity_percent||100),notes:r?.notes||'',
    createdAt:r?.created_at||'',updatedAt:r?.updated_at||''
  };
}

function normalizeProfile(input={}){
  const employmentType=(clean(input.employmentType,30)||'MAIN').toUpperCase();
  const quotaCategory=(clean(input.quotaCategory,30)||'NONE').toUpperCase();
  return{
    fin:clean(input.fin,40).toUpperCase(),
    ssn:clean(input.ssn,50),
    birthDate:dateOnly(input.birthDate),
    phonePrimary:clean(input.phonePrimary,60),
    phoneSecondary:clean(input.phoneSecondary,60),
    emailPersonal:clean(input.emailPersonal,160),
    address:clean(input.address,500),
    emergencyContactName:clean(input.emergencyContactName,160),
    emergencyContactRelation:clean(input.emergencyContactRelation,100),
    emergencyContactPhone:clean(input.emergencyContactPhone,60),
    educationLevel:clean(input.educationLevel,120),
    educationInstitution:clean(input.educationInstitution,220),
    specialty:clean(input.specialty,180),
    employmentType:['MAIN','PART_TIME','SECONDARY','OTHER'].includes(employmentType)?employmentType:'MAIN',
    factualHireDate:dateOnly(input.factualHireDate),
    factualFireDate:dateOnly(input.factualFireDate),
    officialHireDate:dateOnly(input.officialHireDate),
    officialFireDate:dateOnly(input.officialFireDate),
    officialEmployerName:clean(input.officialEmployerName,220),
    officialEmployerVoen:clean(input.officialEmployerVoen,80),
    quotaCategory:['NONE','MINOR','DISABILITY','OTHER'].includes(quotaCategory)?quotaCategory:'NONE',
    workCapacityPercent:int(input.workCapacityPercent,1,100,100),
    notes:clean(input.notes,4000)
  };
}

async function employeeRow(db,userId,employeeId){
  return db.prepare(`SELECT e.*,
      COALESCE((SELECT b.provider FROM hr_employee_device_bindings b WHERE b.user_id=e.user_id AND b.iiko_employee_id=e.iiko_employee_id ORDER BY b.updated_at DESC LIMIT 1),
               (SELECT l.provider FROM hr_employee_device_links l WHERE l.user_id=e.user_id AND l.iiko_employee_id=e.iiko_employee_id ORDER BY l.updated_at DESC LIMIT 1),'') AS attendance_provider,
      COALESCE((SELECT b.external_employee_id FROM hr_employee_device_bindings b WHERE b.user_id=e.user_id AND b.iiko_employee_id=e.iiko_employee_id ORDER BY b.updated_at DESC LIMIT 1),
               (SELECT l.external_employee_id FROM hr_employee_device_links l WHERE l.user_id=e.user_id AND l.iiko_employee_id=e.iiko_employee_id ORDER BY l.updated_at DESC LIMIT 1),'') AS attendance_external_id
    FROM hr_employees e
    WHERE e.user_id=?1 AND e.iiko_employee_id=?2 AND TRIM(e.employee_code)<>''
    LIMIT 1`).bind(userId,employeeId).first();
}

async function loadProfile(db,userId,employeeId){
  const row=await db.prepare(`SELECT * FROM hr_employee_profiles WHERE user_id=?1 AND iiko_employee_id=?2 LIMIT 1`).bind(userId,employeeId).first();
  return profileDto(row);
}

async function compensationSnapshot(db,userId,employee,asOf){
  const employeeTerm=await db.prepare(`SELECT * FROM hr_compensation_terms WHERE user_id=?1 AND iiko_employee_id=?2 AND is_active=1 AND effective_from<=?3 AND (effective_to='' OR effective_to>=?3) ORDER BY effective_from DESC LIMIT 1`).bind(userId,employee.iiko_employee_id,asOf).first().catch(()=>null);
  const roleTerm=!employeeTerm&&employee.role_code?await db.prepare(`SELECT * FROM hr_role_compensation_terms WHERE user_id=?1 AND role_code=?2 AND is_active=1 AND effective_from<=?3 AND (effective_to='' OR effective_to>=?3) ORDER BY effective_from DESC LIMIT 1`).bind(userId,employee.role_code,asOf).first().catch(()=>null):null;
  const term=employeeTerm||roleTerm;
  if(!term)return{configured:false,sourceType:'',sourceLabel:'Не настроено',term:null,calculation:null,ruleProfile:AZ_PAYROLL_RULE_PROFILE};
  const dto={
    id:term.term_id||'',effectiveFrom:term.effective_from||'',effectiveTo:term.effective_to||'',
    officialGross:Number(term.official_gross||0),additionalAmount:Number(term.additional_amount||0),
    additionalPaymentMethod:term.additional_payment_method||'CASH',additionalTaxTreatment:term.additional_tax_treatment||'TAXABLE',
    additionalLegalBasis:term.additional_legal_basis||'',note:term.note||''
  };
  return{
    configured:true,
    sourceType:employeeTerm?'EMPLOYEE':'ROLE',
    sourceLabel:employeeTerm?'Индивидуальные условия':'Условия должности',
    term:dto,
    calculation:calculateCompensation({officialGross:dto.officialGross,additionalAmount:dto.additionalAmount,additionalTaxTreatment:dto.additionalTaxTreatment,calculationDate:asOf}),
    ruleProfile:AZ_PAYROLL_RULE_PROFILE
  };
}

async function scheduleSnapshot(db,userId,employee,asOf){
  if(!employee.role_code)return{configured:false,sourceType:'',sourceLabel:'Не настроено',schedule:null,dayRules:[]};

  const override=await db.prepare(`SELECT o.override_id,o.effective_from,o.effective_to,o.note,s.*
    FROM hr_employee_schedule_overrides o
    JOIN hr_role_schedules s ON s.user_id=o.user_id AND s.schedule_id=o.schedule_id
    WHERE o.user_id=?1 AND o.iiko_employee_id=?2 AND o.is_active=1 AND s.is_active=1
      AND o.effective_from<=?3 AND (o.effective_to='' OR o.effective_to>=?3)
    ORDER BY o.effective_from DESC LIMIT 1`).bind(userId,employee.iiko_employee_id,asOf).first().catch(()=>null);

  const s=override||await db.prepare(`SELECT * FROM hr_role_schedules WHERE user_id=?1 AND role_code=?2 AND is_active=1 AND is_default=1
    AND valid_from<=?3 AND (valid_to='' OR valid_to>=?3) ORDER BY valid_from DESC LIMIT 1`).bind(userId,employee.role_code,asOf).first().catch(()=>null);

  if(!s)return{configured:false,sourceType:'',sourceLabel:'Не настроено',schedule:null,dayRules:[]};

  const days=await db.prepare(`SELECT weekday,shift_start,shift_end,break_minutes FROM hr_role_schedule_days WHERE user_id=?1 AND schedule_id=?2 ORDER BY weekday`).bind(userId,s.schedule_id).all().catch(()=>({results:[]}));
  return{
    configured:true,
    sourceType:override?'EMPLOYEE':'ROLE',
    sourceLabel:override?'Индивидуальный график':'Основной график должности',
    overrideId:override?.override_id||'',
    overrideEffectiveFrom:override?.effective_from||'',
    overrideEffectiveTo:override?.effective_to||'',
    overrideNote:override?.note||'',
    schedule:{
      id:s.schedule_id,name:s.schedule_name,patternType:s.pattern_type,weekdays:String(s.weekdays||'').split(',').map(Number).filter(Boolean),
      workDays:Number(s.work_days||0),offDays:Number(s.off_days||0),anchorDate:s.anchor_date||'',shiftStart:s.shift_start,shiftEnd:s.shift_end,
      breakMinutes:Number(s.break_minutes||0),validFrom:s.valid_from,validTo:s.valid_to||''
    },
    dayRules:(days.results||[]).map(d=>({weekday:Number(d.weekday),shiftStart:d.shift_start,shiftEnd:d.shift_end,breakMinutes:Number(d.break_minutes||0)}))
  };
}

function employeeDto(e){
  const full=[e.last_name,e.first_name,e.middle_name].filter(Boolean).join(' ')||e.display_name||e.employee_code||e.iiko_employee_id;
  return{
    id:e.iiko_employee_id,code:e.employee_code||'',name:full,displayName:e.display_name||'',
    firstName:e.first_name||'',middleName:e.middle_name||'',lastName:e.last_name||'',
    roleCode:e.role_code||'',roleName:e.role_name||'',departmentCode:e.department_code||'',
    hireDate:e.hire_date||'',fireDate:e.fire_date||'',deleted:Boolean(e.is_deleted),
    attendanceProvider:e.attendance_provider||'',attendanceExternalId:e.attendance_external_id||''
  };
}

async function snapshot(request,env,state,employeeId){
  const userId=state.user.id;
  const scope=await resolveHrRestaurantScope(request,env,userId);
  const row=await employeeRow(env.DB,userId,employeeId);
  if(!row)return{error:json({success:false,message:'Сотрудник не найден. Сначала синхронизируйте справочник сотрудников.'},404)};
  if(filterEmployeesByScope([row],scope).length===0)return{error:json({success:false,message:'Сотрудник не относится к выбранному ресторану.'},403)};
  const asOf=todayBaku();
  const [profile,compensation]=await Promise.all([
    loadProfile(env.DB,userId,employeeId),
    compensationSnapshot(env.DB,userId,row,asOf)
  ]);
  return{data:{success:true,asOf,employee:employeeDto(row),profile,compensation,restaurantScope:scope?{mode:scope.mode,departmentIds:scope.selectedDepartmentIds||[],departmentCodes:scope.selectedDepartmentCodes||[]}:null}};
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}

export async function onRequestGet({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    await ensure(env.DB);
    const employeeId=clean(new URL(request.url).searchParams.get('id'),120);if(!employeeId)return json({success:false,message:'Не указан сотрудник'},400);
    const snap=await snapshot(request,env,state,employeeId);if(snap.error)return snap.error;return json(snap.data);
  }catch(e){console.error('[HR-EMPLOYEE-PROFILE-GET]',e);return json({success:false,message:e?.message||String(e)},500)}
}

export async function onRequestPost({request,env}){
  try{
    const state=await loadRequestIikoState(request,env);if(!state?.user)return json({success:false,message:'Требуется авторизация'},401);
    await ensure(env.DB);
    const body=await request.json().catch(()=>({})),action=clean(body.action,40);
    if(action!=='saveProfile')return json({success:false,message:'Неизвестное действие'},400);
    const employeeId=clean(body.employeeId,120);if(!employeeId)return json({success:false,message:'Не указан сотрудник'},400);
    const current=await snapshot(request,env,state,employeeId);if(current.error)return current.error;
    const beforeProfile=current.data.profile||{};
    const {createdAt:_beforeCreatedAt,updatedAt:_beforeUpdatedAt,...before}=beforeProfile;
    const profile=normalizeProfile(body.profile||{});
    if(profile.factualFireDate&&profile.factualHireDate&&profile.factualFireDate<profile.factualHireDate)return json({success:false,message:'Фактическая дата увольнения не может быть раньше даты приёма'},400);
    if(profile.officialFireDate&&profile.officialHireDate&&profile.officialFireDate<profile.officialHireDate)return json({success:false,message:'Официальная дата увольнения не может быть раньше даты приёма'},400);
    const t=now();
    await env.DB.prepare(`INSERT INTO hr_employee_profiles(
      user_id,iiko_employee_id,fin,ssn,birth_date,phone_primary,phone_secondary,email_personal,address,
      emergency_contact_name,emergency_contact_relation,emergency_contact_phone,education_level,education_institution,specialty,
      employment_type,factual_hire_date,factual_fire_date,official_hire_date,official_fire_date,official_employer_name,official_employer_voen,
      quota_category,work_capacity_percent,notes,created_at,updated_at
    ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?26)
    ON CONFLICT(user_id,iiko_employee_id) DO UPDATE SET
      fin=excluded.fin,ssn=excluded.ssn,birth_date=excluded.birth_date,phone_primary=excluded.phone_primary,phone_secondary=excluded.phone_secondary,email_personal=excluded.email_personal,address=excluded.address,
      emergency_contact_name=excluded.emergency_contact_name,emergency_contact_relation=excluded.emergency_contact_relation,emergency_contact_phone=excluded.emergency_contact_phone,
      education_level=excluded.education_level,education_institution=excluded.education_institution,specialty=excluded.specialty,
      employment_type=excluded.employment_type,factual_hire_date=excluded.factual_hire_date,factual_fire_date=excluded.factual_fire_date,official_hire_date=excluded.official_hire_date,official_fire_date=excluded.official_fire_date,
      official_employer_name=excluded.official_employer_name,official_employer_voen=excluded.official_employer_voen,quota_category=excluded.quota_category,work_capacity_percent=excluded.work_capacity_percent,
      notes=excluded.notes,updated_at=excluded.updated_at`)
      .bind(state.user.id,employeeId,profile.fin,profile.ssn,profile.birthDate,profile.phonePrimary,profile.phoneSecondary,profile.emailPersonal,profile.address,
        profile.emergencyContactName,profile.emergencyContactRelation,profile.emergencyContactPhone,profile.educationLevel,profile.educationInstitution,profile.specialty,
        profile.employmentType,profile.factualHireDate,profile.factualFireDate,profile.officialHireDate,profile.officialFireDate,profile.officialEmployerName,profile.officialEmployerVoen,
        profile.quotaCategory,profile.workCapacityPercent,profile.notes,t).run();

    const connection=privateConnection(state.state);
    await logAuditEvent({
      request,env,connection,action:'UPDATE',entityType:'HR_EMPLOYEE_PROFILE',entityId:employeeId,entityLabel:current.data.employee.name,
      before,after:profile,
      restaurantIds:current.data.restaurantScope?.departmentIds||[],
      metadata:{departmentCode:current.data.employee.departmentCode,employeeCode:current.data.employee.code,roleCode:current.data.employee.roleCode}
    });

    const updated=await snapshot(request,env,state,employeeId);if(updated.error)return updated.error;return json(updated.data);
  }catch(e){console.error('[HR-EMPLOYEE-PROFILE-POST]',e);return json({success:false,message:e?.message||String(e)},500)}
}
