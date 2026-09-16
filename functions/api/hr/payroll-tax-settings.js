import { getUser } from '../iiko/_lib/user-state.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function dateOnly(v){const s=clean(v);return /^\d{4}-\d{2}-\d{2}$/.test(s)?s:''}
function monthOnly(v){const s=clean(v);return /^\d{4}-\d{2}$/.test(s)?s:''}
function monthEnd(month){const [y,m]=month.split('-').map(Number),d=new Date(Date.UTC(y,m,0)).getUTCDate();return`${month}-${String(d).padStart(2,'0')}`}
function previousDate(v){const d=new Date(`${v}T00:00:00Z`);d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10)}
function now(){return new Date().toISOString()}
function uid(){return`htp_${crypto.randomUUID()}`}
function num(v,fallback=0){const n=Number(v);return Number.isFinite(n)?n:fallback}

export const DEFAULT_PAYROLL_TAX_SETTINGS={
  incomeTaxThreshold1:2500,incomeTaxThreshold2:8000,personalAllowance:200,
  incomeTaxLowPercent:3,incomeTaxMidPercent:10,incomeTaxHighPercent:14,
  socialThreshold1:200,socialThreshold2:8000,
  employeeSocialLowPercent:3,employeeSocialMidPercent:10,employeeSocialHighPercent:10,
  employerSocialLowPercent:22,employerSocialMidPercent:15,employerSocialHighPercent:11,
  employeeUnemploymentPercent:0.5,employerUnemploymentPercent:0.5,
  medicalThreshold:2500,
  employeeMedicalLowPercent:2,employeeMedicalHighPercent:0.5,
  employerMedicalLowPercent:2,employerMedicalHighPercent:0.5
};

const PERCENT_KEYS=[
  'incomeTaxLowPercent','incomeTaxMidPercent','incomeTaxHighPercent',
  'employeeSocialLowPercent','employeeSocialMidPercent','employeeSocialHighPercent',
  'employerSocialLowPercent','employerSocialMidPercent','employerSocialHighPercent',
  'employeeUnemploymentPercent','employerUnemploymentPercent',
  'employeeMedicalLowPercent','employeeMedicalHighPercent','employerMedicalLowPercent','employerMedicalHighPercent'
];
const MONEY_KEYS=['incomeTaxThreshold1','incomeTaxThreshold2','personalAllowance','socialThreshold1','socialThreshold2','medicalThreshold'];

function normalizeSettings(input={}){
  const out={...DEFAULT_PAYROLL_TAX_SETTINGS};
  for(const k of PERCENT_KEYS){const n=num(input[k],out[k]);if(n<0||n>100)throw new Error(`${k}: процент должен быть от 0 до 100`);out[k]=Math.round(n*10000)/10000}
  for(const k of MONEY_KEYS){const n=num(input[k],out[k]);if(n<0)throw new Error(`${k}: значение не может быть отрицательным`);out[k]=Math.round(n*100)/100}
  if(out.incomeTaxThreshold2<out.incomeTaxThreshold1)throw new Error('Второй порог подоходного налога не может быть меньше первого');
  if(out.socialThreshold2<out.socialThreshold1)throw new Error('Второй порог соцстраха не может быть меньше первого');
  return out;
}

async function ensure(db){
  if(!db)throw new Error('D1 binding DB не настроен.');
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_payroll_tax_profiles (
      user_id TEXT NOT NULL,profile_id TEXT NOT NULL,effective_from TEXT NOT NULL,effective_to TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'MANUAL',settings_json TEXT NOT NULL DEFAULT '{}',is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(user_id,profile_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_hr_payroll_tax_profiles_date ON hr_payroll_tax_profiles(user_id,is_active,effective_from,effective_to)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_payroll_tax_profiles_start ON hr_payroll_tax_profiles(user_id,effective_from)`)
  ]);
}
function dto(r){let settings={...DEFAULT_PAYROLL_TAX_SETTINGS};try{settings=normalizeSettings(JSON.parse(r.settings_json||'{}'))}catch{}return{id:r.profile_id,effectiveFrom:r.effective_from,effectiveTo:r.effective_to||'',mode:r.mode||'MANUAL',settings,createdAt:r.created_at,updatedAt:r.updated_at}}
async function activeProfile(db,userId,asOf){const r=await db.prepare(`SELECT * FROM hr_payroll_tax_profiles WHERE user_id=?1 AND is_active=1 AND effective_from<=?2 AND (effective_to='' OR effective_to>=?2) ORDER BY effective_from DESC LIMIT 1`).bind(userId,asOf).first();return r?dto(r):null}
async function history(db,userId){const r=await db.prepare(`SELECT * FROM hr_payroll_tax_profiles WHERE user_id=?1 AND is_active=1 ORDER BY effective_from DESC LIMIT 30`).bind(userId).all();return(r.results||[]).map(dto)}
async function snapshot(db,userId,asOf){const active=await activeProfile(db,userId,asOf);return{success:true,asOf,source:active?'SAVED_PROFILE':'SYSTEM_DEFAULT',active,mode:active?.mode||'DEFAULT',settings:active?.settings||{...DEFAULT_PAYROLL_TAX_SETTINGS},defaults:{...DEFAULT_PAYROLL_TAX_SETTINGS},history:await history(db,userId)}}

async function saveProfile(db,userId,effectiveFrom,mode,settings){
  const t=now(),exact=await db.prepare(`SELECT profile_id FROM hr_payroll_tax_profiles WHERE user_id=?1 AND effective_from=?2 LIMIT 1`).bind(userId,effectiveFrom).first();
  const next=await db.prepare(`SELECT effective_from FROM hr_payroll_tax_profiles WHERE user_id=?1 AND is_active=1 AND effective_from>?2 ORDER BY effective_from ASC LIMIT 1`).bind(userId,effectiveFrom).first();
  const effectiveTo=next?.effective_from?previousDate(next.effective_from):'';
  if(!exact)await db.prepare(`UPDATE hr_payroll_tax_profiles SET effective_to=?3,updated_at=?4 WHERE user_id=?1 AND is_active=1 AND effective_from<?2 AND (effective_to='' OR effective_to>=?2)`).bind(userId,effectiveFrom,previousDate(effectiveFrom),t).run();
  const id=exact?.profile_id||uid();
  await db.prepare(`INSERT INTO hr_payroll_tax_profiles(user_id,profile_id,effective_from,effective_to,mode,settings_json,is_active,created_at,updated_at)
    VALUES(?1,?2,?3,?4,?5,?6,1,?7,?7)
    ON CONFLICT(user_id,profile_id) DO UPDATE SET effective_from=excluded.effective_from,effective_to=excluded.effective_to,mode=excluded.mode,settings_json=excluded.settings_json,is_active=1,updated_at=excluded.updated_at`)
    .bind(userId,id,effectiveFrom,effectiveTo,mode,JSON.stringify(settings),t).run();
  return id;
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){try{
  const a=await getUser(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);await ensure(env.DB);
  const url=new URL(request.url),month=monthOnly(url.searchParams.get('month')),asOf=dateOnly(url.searchParams.get('asOf'))||(month?monthEnd(month):new Date().toISOString().slice(0,10));
  return json(await snapshot(env.DB,a.user.id,asOf));
}catch(e){console.error('[HR-TAX-SETTINGS-GET]',e);return json({success:false,message:e?.message||String(e)},500)}}
export async function onRequestPost({request,env}){try{
  const a=await getUser(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);await ensure(env.DB);const userId=a.user.id;
  const b=await request.json().catch(()=>({})),action=clean(b.action),effectiveFrom=dateOnly(b.effectiveFrom);if(!effectiveFrom)return json({success:false,message:'Укажите дату начала действия'},400);
  if(action==='save')await saveProfile(env.DB,userId,effectiveFrom,'MANUAL',normalizeSettings(b.settings||{}));
  else if(action==='useDefault')await saveProfile(env.DB,userId,effectiveFrom,'DEFAULT',{...DEFAULT_PAYROLL_TAX_SETTINGS});
  else return json({success:false,message:'Неизвестное действие'},400);
  return json(await snapshot(env.DB,userId,effectiveFrom));
}catch(e){console.error('[HR-TAX-SETTINGS-POST]',e);return json({success:false,message:e?.message||String(e)},400)}}
