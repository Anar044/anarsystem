import { loadRequestIikoState, privateConnection } from '../iiko/_lib/user-state.js';
import { resolveHrRestaurantScope } from './_lib/restaurant-scope.js';
import { hasPermission } from '../access/_lib/access-control.js';
import { logAuditEvent } from '../_lib/audit-log.js';

// Staff setup ONLY. No card numbers, Payriff credentials, or transfers are accepted here.
const clean=(x,max=120)=>String(x??'').trim().slice(0,max);
const now=()=>new Date().toISOString();
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const fail=(status,code,message)=>json({success:false,code,message},status);
const CODE_ALPHABET='23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_SIZE=10;
function newCode(){
  const bytes=new Uint8Array(CODE_SIZE);crypto.getRandomValues(bytes);
  return [...bytes].map(n=>CODE_ALPHABET[n%CODE_ALPHABET.length]).join('');
}
async function ensure(db){
  if(!db)throw Object.assign(new Error('D1 не настроена'),{status:503});
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS qr_tip_staff (
      owner_id TEXT NOT NULL, employee_id TEXT NOT NULL, personal_code TEXT NOT NULL,
      card_holder TEXT NOT NULL DEFAULT '', card_last4 TEXT NOT NULL DEFAULT '',
      bank_name TEXT NOT NULL DEFAULT '', recipient_ref TEXT NOT NULL DEFAULT '',
      payout_status TEXT NOT NULL DEFAULT 'NOT_LINKED',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(owner_id,employee_id), UNIQUE(owner_id,personal_code)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS qr_tip_staff_restaurants (
      owner_id TEXT NOT NULL, restaurant_id TEXT NOT NULL, employee_id TEXT NOT NULL,
      pos_waiter_id TEXT NOT NULL DEFAULT '', guest_enabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(owner_id,restaurant_id,employee_id)
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_qr_tip_pos_unique
      ON qr_tip_staff_restaurants(owner_id,restaurant_id,pos_waiter_id) WHERE pos_waiter_id<>''`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_qr_tip_restaurant_staff
      ON qr_tip_staff_restaurants(owner_id,restaurant_id,guest_enabled)`)
  ]);
}
async function context(request,env,edit=false){
  const auth=await loadRequestIikoState(request,env);
  if(!auth?.user)throw Object.assign(new Error('Необходима авторизация'),{status:401});
  if(!auth.access?.allowed)throw Object.assign(new Error('Нет доступа к рабочему пространству'),{status:403});
  const canEdit=hasPermission(auth.access,'finance.payments');
  const canView=canEdit||hasPermission(auth.access,'finance.view')||hasPermission(auth.access,'hr.employees.view');
  if(edit&&!canEdit || !edit&&!canView)throw Object.assign(new Error('Недостаточно прав для управления чаевыми'),{status:403});
  const owner=auth.storageUserId||auth.user.id;
  const scope=await resolveHrRestaurantScope(request,env,owner,auth.access);
  if(!scope)throw Object.assign(new Error('Ресторан не настроен'),{status:409});
  if(scope.isChain && scope.selectedDepartmentIds.length!==1)
    throw Object.assign(new Error('Для настройки чаевых выберите один ресторан CHAIN'),{status:409});
  const restaurants=scope.selectedRestaurants||[];
  const restaurantId=scope.selectedDepartmentIds?.[0]||restaurants[0]?.id;
  if(!restaurantId)throw Object.assign(new Error('Не удалось определить ресторан'),{status:409});
  return {auth,owner,scope,restaurantId,canEdit,canViewBank:canEdit||hasPermission(auth.access,'finance.view')};
}
async function findEmployee(db,{owner,scope,restaurantId},employeeId){
  const row=await db.prepare(`SELECT iiko_employee_id,employee_code,display_name,first_name,last_name,
    role_code,role_name,department_code,is_deleted,fire_date FROM hr_employees
    WHERE user_id=?1 AND iiko_employee_id=?2 AND TRIM(employee_code)<>'' LIMIT 1`)
    .bind(owner,employeeId).first();
  if(!row)throw Object.assign(new Error('Сотрудник отсутствует в HR'),{status:404});
  if(scope.isChain){
    const allowed=new Set((scope.selectedRestaurants||[]).filter(r=>String(r.id)===String(restaurantId))
      .flatMap(r=>[r.id,r.code]).map(x=>clean(x).toUpperCase()).filter(Boolean));
    const member=await db.prepare(`SELECT 1 AS ok FROM hr_employee_departments
      WHERE user_id=?1 AND iiko_employee_id=?2 AND UPPER(department_code)=UPPER(?3) LIMIT 1`)
      .bind(owner,employeeId,(scope.selectedRestaurants||[]).find(r=>String(r.id)===String(restaurantId))?.code||restaurantId)
      .first().catch(()=>null);
    if(!allowed.has(clean(row.department_code).toUpperCase())&&!member?.ok)
      throw Object.assign(new Error('Сотрудник не относится к выбранному ресторану'),{status:403});
  }
  return row;
}
function dto(employee,config,restaurant,canEdit,canViewBank){
  const name=[employee.last_name,employee.first_name].filter(Boolean).join(' ')||employee.display_name||employee.employee_code;
  const response={success:true,employee:{id:employee.iiko_employee_id,name,code:employee.employee_code,
    roleName:employee.role_name||employee.role_code,active:!employee.is_deleted&&!employee.fire_date},
    restaurantId:restaurant,canEdit,
    tips:{guestEnabled:Boolean(config?.guest_enabled),posWaiterId:config?.pos_waiter_id||'',
      personalCode:canEdit?config?.personal_code||'':'',
      payoutStatus:config?.payout_status||'NOT_LINKED',
      cardConnected:Boolean(config?.recipient_ref&&config?.payout_status==='VERIFIED')}};
  if(canViewBank)Object.assign(response.tips,{cardHolder:config?.card_holder||'',cardLast4:config?.card_last4||'',bankName:config?.bank_name||''});
  return response;
}
async function profile(db,ctx,employee){
  return db.prepare(`SELECT s.personal_code,s.card_holder,s.card_last4,s.bank_name,s.recipient_ref,s.payout_status,
    r.guest_enabled,r.pos_waiter_id FROM qr_tip_staff s
    LEFT JOIN qr_tip_staff_restaurants r ON r.owner_id=s.owner_id AND r.employee_id=s.employee_id AND r.restaurant_id=?3
    WHERE s.owner_id=?1 AND s.employee_id=?2 LIMIT 1`).bind(ctx.owner,employee.iiko_employee_id,ctx.restaurantId).first();
}
const illegalBankInput=body=>Object.keys(body||{}).some(k=>/^(pan|cardNumber|fullCard|cvv|cvc|expiry|expiration|cardData)$/i.test(k));
export async function onRequestOptions(){return new Response(null,{status:204,headers})}
export async function onRequestGet({request,env}){
  try{
    const ctx=await context(request,env);
    const params=new URL(request.url).searchParams;
    const employeeId=clean(params.get('id'));
    await ensure(env.DB);
    if(params.get('list')==='1'){
      if(!ctx.canViewBank)return fail(403,'TIPS_FINANCE_REQUIRED','Требуется доступ к финансам');
      const restaurant=(ctx.scope.selectedRestaurants||[]).find(r=>String(r.id)===String(ctx.restaurantId));
      const deptCode=restaurant?.code||ctx.restaurantId;
      const rows=await env.DB.prepare(`SELECT e.iiko_employee_id AS id,e.display_name,e.first_name,e.last_name,
        e.role_name,e.role_code,e.employee_code,e.is_deleted,e.fire_date,
        s.personal_code,s.card_last4,s.payout_status,s.recipient_ref,
        r.pos_waiter_id,r.guest_enabled
        FROM hr_employees e
        LEFT JOIN qr_tip_staff s ON s.owner_id=e.user_id AND s.employee_id=e.iiko_employee_id
        LEFT JOIN qr_tip_staff_restaurants r ON r.owner_id=e.user_id AND r.employee_id=e.iiko_employee_id AND r.restaurant_id=?2
        WHERE e.user_id=?1 AND TRIM(e.employee_code)<>'' AND
          (?3=0 OR UPPER(e.department_code)=UPPER(?4) OR UPPER(e.department_code)=UPPER(?2)
          OR EXISTS (SELECT 1 FROM hr_employee_departments m
            WHERE m.user_id=e.user_id AND m.iiko_employee_id=e.iiko_employee_id
              AND (UPPER(m.department_code)=UPPER(?4) OR UPPER(m.department_code)=UPPER(?2))))
        ORDER BY e.is_deleted ASC,e.last_name COLLATE NOCASE,e.first_name COLLATE NOCASE
        LIMIT 500`).bind(ctx.owner,ctx.restaurantId,ctx.scope.isChain?1:0,deptCode).all();
      return json({success:true,restaurantId:ctx.restaurantId,items:(rows.results||[]).map(e=>({
        id:e.id,name:[e.last_name,e.first_name].filter(Boolean).join(' ')||e.display_name||e.employee_code,
        code:e.employee_code,roleName:e.role_name||e.role_code,
        active:!e.is_deleted&&!e.fire_date,guestEnabled:Boolean(e.guest_enabled),
        cardLast4:e.card_last4||'',payoutStatus:e.payout_status||'NOT_LINKED',
        cardConnected:Boolean(e.recipient_ref&&e.payout_status==='VERIFIED'),
        hasPersonalCode:Boolean(e.personal_code),posWaiterId:e.pos_waiter_id||''
      }))});
    }
    if(!employeeId)return fail(400,'MISSING_ID','Не указан сотрудник');
    const employee=await findEmployee(env.DB,ctx,employeeId);
    const config=await profile(env.DB,ctx,employee);
    return json(dto(employee,config,ctx.restaurantId,ctx.canEdit,ctx.canViewBank));
  }catch(e){return fail(e.status||500,'QR_TIP_PROFILE_GET',e.status?e.message:'Не удалось получить настройки чаевых')}
}
export async function onRequestPost({request,env}){
  try{
    const ctx=await context(request,env,true);
    const body=await request.json().catch(()=>null);
    if(!body||typeof body!=='object'||Array.isArray(body))return fail(400,'BAD_REQUEST','Неверный формат');
    if(illegalBankInput(body))return fail(400,'CARD_DATA_FORBIDDEN','Не отправляйте полный номер карты или CVV в Smart Horeca. Требуется защищённая привязка Payriff.');
    if(!['save','rotateCode'].includes(body.action))return fail(400,'BAD_ACTION','Неверное действие');
    const id=clean(body.employeeId);
    if(!id)return fail(400,'MISSING_ID','Не указан сотрудник');
    await ensure(env.DB);
    const employee=await findEmployee(env.DB,ctx,id);
    const old=await profile(env.DB,ctx,employee);
    const t=now();
    // A unique code belongs to an HR employee, never a table or cashier session.
    if(!old){
      let inserted=false;
      for(let attempt=0;attempt<6&&!inserted;attempt++){
        const code=newCode();
        try{
          await env.DB.prepare(`INSERT INTO qr_tip_staff(owner_id,employee_id,personal_code,created_at,updated_at)
            VALUES(?1,?2,?3,?4,?4) ON CONFLICT(owner_id,employee_id) DO NOTHING`)
            .bind(ctx.owner,id,code,t).run();
          inserted=true;
        }catch(e){if(!/UNIQUE|constraint/i.test(String(e.message)))throw e}
      }
      if(!inserted)return fail(503,'CODE_COLLISION','Не удалось создать персональный код');
    }
    if(body.action==='rotateCode'){
      let rotated=false;
      for(let attempt=0;attempt<6&&!rotated;attempt++){
        try{
          await env.DB.prepare(`UPDATE qr_tip_staff SET personal_code=?1,updated_at=?2
            WHERE owner_id=?3 AND employee_id=?4`).bind(newCode(),t,ctx.owner,id).run();
          rotated=true;
        }catch(e){if(!/UNIQUE|constraint/i.test(String(e.message)))throw e}
      }
      if(!rotated)return fail(503,'CODE_COLLISION','Не удалось обновить персональный код');
    }else{
      const cardHolder=clean(body.cardHolder,80).toUpperCase();
      const last4=clean(body.cardLast4,4);
      const bankName=clean(body.bankName,80);
      const posWaiterId=clean(body.posWaiterId,120);
      const enabled=body.guestEnabled===true;
      if(last4&&!/^\d{4}$/.test(last4))return fail(400,'INVALID_LAST4','Укажите только последние 4 цифры карты');
      if(cardHolder&&!/^[A-Z\s.'-]{3,80}$/.test(cardHolder))return fail(400,'INVALID_CARD_HOLDER','Имя владельца карты должно быть латиницей, как на карте');
      if(posWaiterId&&!/^[\w.:/-]{1,120}$/.test(posWaiterId))return fail(400,'INVALID_POS_ID','Некорректный ID официанта на кассе');
      if(enabled&&(employee.is_deleted||employee.fire_date))return fail(409,'EMPLOYEE_INACTIVE','Уволенному сотруднику нельзя включить чаевые');
      // The POS mapping is unique per restaurant; do not mutate card metadata if it conflicts.
      try{
        await env.DB.prepare(`INSERT INTO qr_tip_staff_restaurants
          (owner_id,restaurant_id,employee_id,pos_waiter_id,guest_enabled,created_at,updated_at)
          VALUES(?1,?2,?3,?4,?5,?6,?6)
          ON CONFLICT(owner_id,restaurant_id,employee_id) DO UPDATE SET
            pos_waiter_id=excluded.pos_waiter_id,guest_enabled=excluded.guest_enabled,updated_at=excluded.updated_at`)
          .bind(ctx.owner,ctx.restaurantId,id,posWaiterId,enabled?1:0,t).run();
      }catch(e){
        if(/UNIQUE|constraint/i.test(String(e.message)))return fail(409,'DUPLICATE_POS_ID','Этот ID кассы уже назначен другому сотруднику');
        throw e;
      }
      // Metadata is informational only and cannot activate payouts. Never accept PAN/CVV.
      await env.DB.prepare(`UPDATE qr_tip_staff SET card_holder=?1,card_last4=?2,bank_name=?3,
        updated_at=?4 WHERE owner_id=?5 AND employee_id=?6`)
        .bind(cardHolder,last4,bankName,t,ctx.owner,id).run();
    }
    const updated=await profile(env.DB,ctx,employee);
    await logAuditEvent({request,env,connection:privateConnection(ctx.auth.state),action:'UPDATE',
      entityType:'QR_TIP_STAFF',entityId:id,entityLabel:employee.display_name||id,
      before:{cardMask:old?.card_last4||'',guestEnabled:Boolean(old?.guest_enabled),posWaiterId:old?.pos_waiter_id||''},
      after:{cardMask:updated?.card_last4||'',guestEnabled:Boolean(updated?.guest_enabled),posWaiterId:updated?.pos_waiter_id||'',codeRotated:body.action==='rotateCode'},
      restaurantIds:[ctx.restaurantId]});
    return json(dto(employee,updated,ctx.restaurantId,ctx.canEdit,ctx.canViewBank));
  }catch(e){return fail(e.status||500,'QR_TIP_PROFILE_POST',e.status?e.message:'Не удалось сохранить настройки')}
}
