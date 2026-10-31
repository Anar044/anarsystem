// QR payment provider configuration, workspace + restaurant scoped.
// Server-only: credentials are encrypted at rest, never returned to browsers.
// Reuse the platform's existing one-time encryption root, not one Cloudflare
// variable per merchant. HKDF separates payments from iiko user-state encryption.
import {SMART_HORECA_STATE_ENCRYPTION_ENV} from '../../iiko/_lib/user-state.js';

const enc=new TextEncoder();
const dec=new TextDecoder();
const LABEL='SH_QR_PAYMENT_V1';
const b64=bytes=>{
  let s='';for(const v of bytes)s+=String.fromCharCode(v);return btoa(s);
};
const unb64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
const text=v=>String(v??'').trim();

function binding(env){
  const value=text(env?.[SMART_HORECA_STATE_ENCRYPTION_ENV]);
  if(value.length<24)throw Object.assign(
    new Error('Серверное шифрование не настроено. Администратор платформы должен один раз настроить защищённое хранилище.'),
    {status:503,code:'PAYMENT_ENCRYPTION_UNAVAILABLE'});
  return value;
}
async function key(env){
  const master=await crypto.subtle.importKey('raw',enc.encode(binding(env)),'HKDF',false,['deriveKey']);
  return crypto.subtle.deriveKey({
    name:'HKDF',hash:'SHA-256',
    salt:enc.encode('smart-horeca:qr-pay:credential-derivation:v1'),
    info:enc.encode('payriff-secret-key'),
  },master,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
function aad(workspaceId,restaurantId,environment){
  if(!workspaceId||!restaurantId||!['development','production'].includes(environment))
    throw Error('PAYMENT_SECRET_SCOPE_INVALID');
  return enc.encode('qr-pay:payriff:v1:'+workspaceId+':'+restaurantId+':'+environment);
}
export async function encryptPaymentSecret(env,{workspaceId,restaurantId,environment,secret}){
  const raw=String(secret??'');
  if(raw.trim().length<12||raw.length>1024||/[\u0000-\u001f\u007f]/.test(raw))
    throw Object.assign(new Error('Некорректный Secret Key Payriff'),{status:400,code:'PAYRIFF_SECRET_INVALID'});
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const cipher=await crypto.subtle.encrypt(
    {name:'AES-GCM',iv,additionalData:aad(workspaceId,restaurantId,environment)},
    await key(env),enc.encode(raw));
  return JSON.stringify({marker:LABEL,iv:b64(iv),ciphertext:b64(new Uint8Array(cipher))});
}
export async function decryptPaymentSecret(env,{workspaceId,restaurantId,environment,envelope}){
  try{
    const value=JSON.parse(envelope);
    if(value?.marker!==LABEL)throw Error('invalid envelope');
    const plaintext=await crypto.subtle.decrypt({
      name:'AES-GCM',iv:unb64(value.iv),
      additionalData:aad(workspaceId,restaurantId,environment)
    },await key(env),unb64(value.ciphertext));
    return dec.decode(plaintext);
  }catch{
    throw Object.assign(new Error('Не удалось расшифровать Payriff. Изменения в ключе шифрования или контексте ресторана требуют проверки администратора.'),
      {status:503,code:'PAYMENT_DECRYPT_FAILED'});
  }
}
export async function ensurePaymentSettings(db){
  if(!db)throw Object.assign(new Error('D1 не настроена'),{status:503,code:'PAYMENT_DB_MISSING'});
  await db.prepare(`CREATE TABLE IF NOT EXISTS qr_payment_provider_settings (
    workspace_id TEXT NOT NULL,restaurant_id TEXT NOT NULL,provider TEXT NOT NULL,
    environment TEXT NOT NULL,merchant_id TEXT NOT NULL,secret_encrypted TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
    PRIMARY KEY(workspace_id,restaurant_id,provider)
  )`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS qr_payment_menu_bindings (
    menu_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,restaurant_id TEXT NOT NULL,
    owner_id TEXT NOT NULL,created_at TEXT NOT NULL
  )`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_qr_payment_menu_scope
    ON qr_payment_menu_bindings(workspace_id,restaurant_id)`).run();
  await db.prepare(`CREATE TABLE IF NOT EXISTS qr_payment_provider_audit (
    id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL,restaurant_id TEXT NOT NULL,
    actor_user_id TEXT NOT NULL,action TEXT NOT NULL,created_at TEXT NOT NULL
  )`).run();
}
export function paymentSettingsScope(ctx){
  const workspaceId=text(ctx?.state?.access?.workspace?.id);
  const restaurantId=text(ctx?.restaurantId);
  if(!workspaceId||!restaurantId)
    throw Object.assign(new Error('Рабочее пространство или ресторан не определены'),
      {status:403,code:'PAYMENT_TENANT_SCOPE_REQUIRED'});
  return {workspaceId,restaurantId};
}
export async function fetchPaymentSettings(db,{workspaceId,restaurantId}){
  return db.prepare(`SELECT environment,merchant_id,secret_encrypted,enabled,updated_at
    FROM qr_payment_provider_settings
    WHERE workspace_id=?1 AND restaurant_id=?2 AND provider='PAYRIFF' LIMIT 1`)
    .bind(workspaceId,restaurantId).first();
}
export function safePaymentSettings(row,canManage){
  return {
    configured:Boolean(row?.secret_encrypted&&row?.merchant_id),
    provider:'PAYRIFF',environment:row?.environment||'development',
    merchantId:canManage?(row?.merchant_id||''):'',
    merchantMasked:row?.merchant_id?'••••'+String(row.merchant_id).slice(-4):'',
    updatedAt:row?.updated_at||null,
    canManage:Boolean(canManage),checkoutEnabled:row?.enabled===1||row?.enabled===true,
    verification:'NOT_VERIFIED',
    settlementManagedBy:'PAYRIFF_DASHBOARD'
  };
}
