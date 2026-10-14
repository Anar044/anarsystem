import { loadRequestIikoState, hasPrivateConnection } from './iiko/_lib/user-state.js';
import { scopeStateForAssistant } from './iiko/_lib/ai-assistant-context.js';
import { hasPermission } from './access/_lib/access-control.js';
import { resolveRestaurantScope } from './iiko/_lib/restaurant-scope.js';

function cors(){return{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization'}}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...cors()}})}
function clean(v){return String(v??'').trim()}
function uuid(){return crypto.randomUUID()}
function safeName(name){return clean(name).replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(0,120)||'file'}
async function ensure(db){if(!db)throw new Error('D1 binding DB не настроен.');await db.batch([
  db.prepare(`CREATE TABLE IF NOT EXISTS fixed_asset_files (
    id TEXT PRIMARY KEY,
    asset_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    object_key TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`),
  db.prepare(`CREATE INDEX IF NOT EXISTS idx_fixed_asset_files_asset ON fixed_asset_files(user_id, asset_id, created_at)`)
]);}
function assetAccessError(message,status,code){
  const error=new Error(message);
  error.status=status;error.code=code;return error;
}
async function auth(request,env){
  const stored=await loadRequestIikoState(request,env);
  if(!stored)throw assetAccessError('Требуется авторизация.',401,'UNAUTHENTICATED');
  if(stored.accessDenied||!stored.access?.allowed){
    throw assetAccessError('Нет доступа к выбранной организации Smart Horeca.',403,stored.access?.reason||'WORKSPACE_ACCESS_DENIED');
  }
  const canRead=['inventory.assets.view','finance.view','reports.pnl'].some(permission=>hasPermission(stored.access,permission));
  const canWrite=hasPermission(stored.access,'inventory.assets.manage');
  if(request.method==='POST'?!canWrite:!canRead){
    throw assetAccessError('Нет прав для работы с основными средствами.',403,'ASSET_PERMISSION_DENIED');
  }
  if(!stored.found||!hasPrivateConnection(stored.state)){
    throw assetAccessError('Подключение Smart Horeca Server для организации не найдено.',409,'ASSET_SERVER_NOT_CONFIGURED');
  }
  const state=scopeStateForAssistant(stored.state,stored.access);
  const scope=resolveRestaurantScope({state,request,strict:true});
  if(!scope.allowedDepartmentIds.length){
    throw assetAccessError('Не найдены доступные подразделения организации.',403,'ASSET_DEPARTMENT_SCOPE_EMPTY');
  }
  await ensure(env.DB);
  return {...stored,scope};
}
function selectedRestaurants(a){return new Set((a?.scope?.selectedDepartmentIds||[]).map(String).filter(Boolean))}
function assetAllowed(asset,a){
  if(!asset)return false;
  const selected=selectedRestaurants(a);
  return !a?.scope?.isChain||!selected.size||selected.has(clean(asset.restaurant_id));
}
async function ownedAsset(db,userId,assetId){return db.prepare(`SELECT id,restaurant_id FROM fixed_assets WHERE id=?1 AND user_id=?2 LIMIT 1`).bind(assetId,userId).first()}
export async function onRequestOptions(){return new Response(null,{status:204,headers:cors()})}
export async function onRequestGet({request,env}){try{const a=await auth(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);const u=new URL(request.url),fileId=clean(u.searchParams.get('fileId')),assetId=clean(u.searchParams.get('assetId'));if(fileId){if(!env.ASSET_FILES)return json({success:false,message:'R2 binding ASSET_FILES не настроен.'},503);const row=await env.DB.prepare(`SELECT f.*,a.restaurant_id FROM fixed_asset_files f JOIN fixed_assets a ON a.id=f.asset_id AND a.user_id=f.user_id WHERE f.id=?1 AND f.user_id=?2 LIMIT 1`).bind(fileId,a.user.id).first();if(!row||!assetAllowed(row,a))return json({success:false,message:'Файл не найден в выбранном ресторане'},404);const obj=await env.ASSET_FILES.get(row.object_key);if(!obj)return json({success:false,message:'Файл отсутствует в хранилище'},404);const inline=String(row.kind).toUpperCase()==='PHOTO';return new Response(obj.body,{status:200,headers:{'Content-Type':row.content_type||'application/octet-stream','Content-Disposition':`${inline?'inline':'attachment'}; filename="${safeName(row.file_name)}"`,'Cache-Control':'private, max-age=300',...cors()}})}if(!assetId)return json({success:false,message:'Не указан объект'},400);const owned=await ownedAsset(env.DB,a.user.id,assetId);if(!owned||!assetAllowed(owned,a))return json({success:false,message:'Объект не найден в выбранном ресторане'},404);const r=await env.DB.prepare(`SELECT id,asset_id,kind,file_name,content_type,size,created_at FROM fixed_asset_files WHERE user_id=?1 AND asset_id=?2 ORDER BY created_at DESC`).bind(a.user.id,assetId).all();return json({success:true,storageConfigured:Boolean(env.ASSET_FILES),files:r.results||[]})}catch(e){return json({success:false,code:e?.code||'ASSET_ERROR',message:e.message||String(e)},e?.status||500)}}
export async function onRequestPost({request,env}){try{const a=await auth(request,env);if(!a)return json({success:false,message:'Требуется авторизация'},401);const type=request.headers.get('Content-Type')||'';if(type.includes('multipart/form-data')){if(!env.ASSET_FILES)return json({success:false,message:'Для загрузки фото и документов настройте R2 binding ASSET_FILES.'},503);const form=await request.formData();const assetId=clean(form.get('assetId')),kind=clean(form.get('kind')).toUpperCase()==='DOCUMENT'?'DOCUMENT':'PHOTO',file=form.get('file');if(!assetId||!(file instanceof File))return json({success:false,message:'Не выбран файл или объект'},400);const owned=await ownedAsset(env.DB,a.user.id,assetId);if(!owned||!assetAllowed(owned,a))return json({success:false,message:'Объект не найден в выбранном ресторане'},404);const contentType=clean(file.type)||'application/octet-stream';if(kind==='PHOTO'&&!contentType.startsWith('image/'))return json({success:false,message:'Для фото выберите изображение'},400);if(kind==='DOCUMENT'&&!(contentType==='application/pdf'||contentType.startsWith('image/')))return json({success:false,message:'Документ должен быть PDF или изображением'},400);const max=kind==='PHOTO'?6*1024*1024:12*1024*1024;if(file.size>max)return json({success:false,message:`Файл слишком большой. Максимум ${kind==='PHOTO'?6:12} МБ.`},400);const id=uuid(),objectKey=`${a.user.id}/${assetId}/${id}-${safeName(file.name)}`;await env.ASSET_FILES.put(objectKey,await file.arrayBuffer(),{httpMetadata:{contentType},customMetadata:{assetId,userId:a.user.id,kind}});await env.DB.prepare(`INSERT INTO fixed_asset_files(id,asset_id,user_id,kind,file_name,content_type,object_key,size,created_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`).bind(id,assetId,a.user.id,kind,clean(file.name),contentType,objectKey,file.size,new Date().toISOString()).run();return json({success:true,file:{id,asset_id:assetId,kind,file_name:clean(file.name),content_type:contentType,size:file.size}})}const b=await request.json().catch(()=>({}));if(clean(b.action)==='delete'){const id=clean(b.fileId);const row=await env.DB.prepare(`SELECT f.object_key,a.restaurant_id FROM fixed_asset_files f JOIN fixed_assets a ON a.id=f.asset_id AND a.user_id=f.user_id WHERE f.id=?1 AND f.user_id=?2 LIMIT 1`).bind(id,a.user.id).first();if(!row||!assetAllowed(row,a))return json({success:false,message:'Файл не найден в выбранном ресторане'},404);if(env.ASSET_FILES)await env.ASSET_FILES.delete(row.object_key);await env.DB.prepare(`DELETE FROM fixed_asset_files WHERE id=?1 AND user_id=?2`).bind(id,a.user.id).run();return json({success:true})}return json({success:false,message:'Неизвестное действие'},400)}catch(e){return json({success:false,code:e?.code||'ASSET_ERROR',message:e.message||String(e)},e?.status||500)}}