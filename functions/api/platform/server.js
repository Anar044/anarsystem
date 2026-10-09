import {getUser,loadPrivateIikoState,savePrivateIikoState,SMART_HORECA_STATE_ENCRYPTION_ENV} from '../iiko/_lib/user-state.js';
import {getDepartments,getDepartmentsFromOlap} from '../iiko/connect.js';
import {requirePlatformAdmin,ensurePlatformTables,PlatformError} from './_lib/organizations.js';

const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type'};
const clean=value=>String(value??'').trim();
const json=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:{...cors,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
function failure(error){
  if(!error?.status)console.error('[PLATFORM-SERVER]',error?.name||'Error',String(error?.message||'').slice(0,130));
  return json({success:false,message:error?.status?error.message:'Не удалось подключиться к SH Server. Проверьте адрес, доступ с Cloudflare и логин.',code:error?.code||'CONNECTION_FAILED'},error?.status||502);
}
async function context(request,env){
  const auth=await getUser(request,env);
  const db=requirePlatformAdmin(env,auth?.user);
  await ensurePlatformTables(db);
  return{db,user:auth.user};
}
async function organization(db,id){
  if(!clean(id))throw new PlatformError('Выберите организацию.',400,'ORG_REQUIRED');
  const row=await db.prepare('SELECT * FROM sh_platform_organizations WHERE id=?1 LIMIT 1').bind(clean(id)).first();
  if(!row)throw new PlatformError('Организация не найдена.',404,'ORG_NOT_FOUND');
  return row;
}
export function validateServer(input){
  const host=clean(input?.host).toLowerCase();
  const port=Number(input?.port),login=clean(input?.login),password=String(input?.password||'');
  if(!host||host.length>253||!(/^[a-z0-9.-]+$/).test(host)||!host.includes('.')||host.startsWith('.')||host.endsWith('.')||host.includes('..')){
    throw new PlatformError('Укажите публичный IP или DNS-имя SH Server без http://, пути и пробелов.',400,'INVALID_HOST');
  }
  if(host.endsWith('.local')||host.endsWith('.internal')||host.endsWith('.localhost')||host.endsWith('.test')||host.endsWith('.invalid')||host.endsWith('.example')){
    throw new PlatformError('Укажите доступный извне DNS-адрес SH Server.',400,'PRIVATE_HOST');
  }
  // Never allow the authenticated superadmin API to act as a general internal-network fetch proxy.
  if(/^\d[\d.]*$/.test(host)){
    const parts=host.split('.').map(Number);
    if(parts.length!==4||parts.some(x=>!Number.isInteger(x)||x<0||x>255))throw new PlatformError('Неверный IPv4 адрес.',400,'INVALID_IP');
    const [a,b,c]=parts;
    if(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&b===18||a===198&&b===19||a===192&&b===0&&c===0||a===192&&b===0&&c===2||a===198&&b===51&&c===100||a===203&&b===0&&c===113){
      throw new PlatformError('Cloudflare не может подключаться к локальному или зарезервированному IPv4. Используйте публичный адрес/домен.',400,'PRIVATE_IP');
    }
  }else{
    const labels=host.split('.');
    if(labels.some(x=>!(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/).test(x))){
      throw new PlatformError('Некорректное доменное имя.',400,'INVALID_HOST');
    }
  }
  if(!Number.isInteger(port)||port<1||port>65535)throw new PlatformError('Укажите корректный порт 1–65535.',400,'INVALID_PORT');
  if(!login||login.length>120)throw new PlatformError('Укажите логин SH Server.',400,'INVALID_LOGIN');
  if(!password||password.length>512)throw new PlatformError('Укажите пароль SH Server.',400,'INVALID_PASSWORD');
  return{ip:host,port:String(port),login,password};
}
async function discover(connection){
  const classic=await getDepartments(connection);
  let result=classic,olapError=null;
  if(!classic.departments.length){
    try{result=await getDepartmentsFromOlap(connection)}
    catch(error){olapError=error;result={departments:[],rawFormat:'failed'};}
  }
  const departments=(result.departments||[]).filter(d=>clean(d.id))
    .slice(0,1500).map(d=>({id:clean(d.id),code:clean(d.code),name:clean(d.name)||clean(d.id),parentId:clean(d.parentId)||null,type:'DEPARTMENT'}));
  if(!departments.length){
    const summary=classic.diagnostic||{format:classic.rawFormat,candidates:0,types:[]};
    const kinds=(summary.types||[]).slice(0,8).join(', ')||'нет';
    // Safe diagnostic without raw XML/JSON, password, login, or access tokens.
    const classicStatus='Справочник: '+clean(summary.format||'неизвестно')+
      ', элементов: '+Number(summary.candidates||0)+', типы: '+kinds+'. ';
    const salesStatus=olapError
      ? 'OLAP: запрос завершился ошибкой. '
      : 'OLAP: '+Number(result.diagnostic?.candidates||0)+' строк за 90 дней, подразделений 0. ';
    const hint='Проверьте права пользователя на справочник подразделений и доступ к CHAIN. Если справочник заполнен, пришлите только этот текст ошибки.';
    throw new PlatformError('Сервер подтвердил авторизацию, но ID подразделений не найдены. '+
      classicStatus+salesStatus+hint,502,olapError?'DEPARTMENTS_FALLBACK_FAILED':'DEPARTMENTS_EMPTY');
  }
  return{departments,source:result.rawFormat||'server'};
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:cors})}
export async function onRequestGet({request,env}){
  try{
    const {db}=await context(request,env);
    const org=await organization(db,new URL(request.url).searchParams.get('organizationId'));
    const stored=await loadPrivateIikoState(db,org.storage_owner_id,env);
    const conn=stored.state?.connection||{};
    const identity=stored.state?.identity||{};
    return json({success:true,server:{
      connected:stored.found&&!!conn.ip&&!!conn.login,
      host:clean(conn.ip),port:clean(conn.port),login:clean(conn.login),mode:org.server_mode,
      passwordStored:!!conn.password,
      departmentCount:(identity.departments||[]).length,departments:(identity.departments||[]).map(d=>({id:clean(d.id),name:clean(d.name),code:clean(d.code)})),
      updatedAt:stored.updatedAt||null,
      encrypted:stored.encrypted===true
    }});
  }catch(error){return failure(error)}
}
export async function onRequestPost({request,env}){
  try{
    const {db,user}=await context(request,env);
    const body=await request.json().catch(()=>({}));
    const org=await organization(db,body.organizationId);
    if(!clean(env[SMART_HORECA_STATE_ENCRYPTION_ENV])){
      throw new PlatformError('Настройте SMART_HORECA_STATE_ENCRYPTION_KEY в Cloudflare: пароли серверов нельзя хранить в D1 без шифрования.',503,'ENCRYPTION_REQUIRED');
    }
    const incoming=body.connection||{};
    // Empty password retains the existing credential after secure storage.
    const existing=await loadPrivateIikoState(db,org.storage_owner_id,env);
    const pass=String(incoming.password||'')||String(existing.state?.connection?.password||'');
    const conn=validateServer({...incoming,password:pass});
    const {departments,source}=await discover(conn);
    const stamp=new Date().toISOString();
    const storedConnection={
      ...conn,connectionType:org.server_mode,isChain:org.server_mode==='CHAIN',
      detectedMode:org.server_mode,organizationId:departments[0].id,
      displayName:org.name,networkName:org.name,restaurantName:org.name,connectedAt:stamp
    };
    const identity={
      mode:org.server_mode,detectedMode:org.server_mode,organizationId:departments[0].id,
      displayName:org.name,networkName:org.name,restaurantName:org.name,
      departmentIds:departments.map(d=>d.id),departments,
      organizations:departments.map(d=>({id:d.id,name:d.name,code:d.code,type:'DEPARTMENT'})),
      groups:[],pointsOfSale:[],restaurantSections:[],hierarchy:[],
      server:{ip:conn.ip,port:conn.port},checkedAt:stamp,source
    };
    const result=await savePrivateIikoState(db,org.storage_owner_id,{connection:storedConnection,identity,savedAt:stamp},env);
    if(!result.encrypted)throw new PlatformError('Соединение не было зашифровано, сохранение запрещено.',503,'ENCRYPTION_REQUIRED');
    await db.prepare("INSERT INTO sh_platform_audit (id,actor_user_id,organization_id,action,created_at) VALUES(?1,?2,?3,'SERVER_CONNECTED',?4)")
      .bind(crypto.randomUUID(),String(user.id),org.id,stamp).run();
    return json({success:true,server:{connected:true,host:conn.ip,port:conn.port,login:conn.login,
      mode:org.server_mode,passwordStored:true,departmentCount:departments.length,
      departments,encrypted:true,updatedAt:result.updatedAt}});
  }catch(error){return failure(error)}
}
export async function onRequestDelete({request,env}){
  try{
    const {db,user}=await context(request,env);
    const body=await request.json().catch(()=>({}));
    const org=await organization(db,body.organizationId);
    if(org.status==='ACTIVE')throw new PlatformError('Сначала приостановите организацию, затем отключите сервер.',409,'ACTIVE_ORGANIZATION');
    await db.prepare('DELETE FROM iiko_connections WHERE user_id=?1').bind(org.storage_owner_id).run();
    await db.prepare("INSERT INTO sh_platform_audit (id,actor_user_id,organization_id,action,created_at) VALUES(?1,?2,?3,'SERVER_DISCONNECTED',?4)")
      .bind(crypto.randomUUID(),String(user.id),org.id,new Date().toISOString()).run();
    return json({success:true});
  }catch(error){return failure(error)}
}
