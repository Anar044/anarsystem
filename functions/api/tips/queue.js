import {loadRequestIikoState} from '../iiko/_lib/user-state.js';
import {resolveHrRestaurantScope} from '../hr/_lib/restaurant-scope.js';
import {hasPermission} from '../access/_lib/access-control.js';
import {logAuditEvent} from '../_lib/audit-log.js';
import {ensureTipLedger,evaluateQueue} from './_lib/ledger.js';

const clean=(x,max=150)=>String(x??'').trim().slice(0,max);
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',
  'Access-Control-Allow-Headers':'Authorization,Content-Type',
  'Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers});
const denied=(status,code,message)=>json({success:false,code,message},status);
const merchantId=x=>{const s=clean(x,80);if(s&&!/^[A-Za-z0-9_:-]{3,80}$/.test(s))throw Object.assign(new Error('Неверный Payriff Merchant ID'),{status:400});return s};
function minorUnits(value){
  const raw=String(value??'').trim();
  const match=/^(0|[1-9]\d{0,8})(?:\.(\d{1,2}))?$/.exec(raw);
  if(!match)throw Object.assign(new Error('Укажите корректный баланс в AZN (например 12.50)'),{status:400});
  return Number(match[1])*100+Number((match[2]||'').padEnd(2,'0'));
}
async function context(request,env,write){
  const state=await loadRequestIikoState(request,env);
  if(!state?.user)throw Object.assign(new Error('Требуется авторизация'),{status:401});
  if(!state.access?.allowed)throw Object.assign(new Error('Нет доступа к рабочему пространству'),{status:403});
  const permission=write?'finance.payments':'finance.view';
  if(!hasPermission(state.access,permission))
    throw Object.assign(new Error('Недостаточно прав: '+permission),{status:403});
  const owner=state.storageUserId||state.user.id;
  const scope=await resolveHrRestaurantScope(request,env,owner,state.access);
  if(!scope)throw Object.assign(new Error('Не настроен SH Server'),{status:409});
  if(scope.isChain&&scope.selectedDepartmentIds.length!==1)
    throw Object.assign(new Error('Выберите ровно один ресторан CHAIN'),{status:409});
  const restaurantId=scope.selectedDepartmentIds?.[0]||scope.selectedRestaurants?.[0]?.id;
  if(!restaurantId)throw Object.assign(new Error('Не определён ресторан'),{status:409});
  return {owner,restaurantId,scope,state};
}
async function settings(db,owner,restaurantId){
  return db.prepare(`SELECT receiving_merchant_id,payout_merchant_id,balance_minor,balance_source,
    balance_observed_at,updated_at FROM qr_tip_payout_accounts
    WHERE owner_id=?1 AND restaurant_id=?2`).bind(owner,restaurantId).first();
}
export async function onRequestOptions(){return new Response(null,{status:204,headers})}
export async function onRequestGet({request,env}){
  try{
    const ctx=await context(request,env,false);
    await ensureTipLedger(env.DB);
    const account=await settings(env.DB,ctx.owner,ctx.restaurantId);
    const [result,totals]=await Promise.all([
      env.DB.prepare(`SELECT l.liability_id,l.qr_order_id,l.amount_minor,l.currency,l.state,
        l.employee_id,l.created_at,l.last_error_code,
        e.display_name,e.first_name,e.last_name,
        s.card_last4,s.payout_status,s.recipient_ref
        FROM qr_tip_liabilities l
        LEFT JOIN hr_employees e ON e.user_id=l.owner_id AND e.iiko_employee_id=l.employee_id
        LEFT JOIN qr_tip_staff s ON s.owner_id=l.owner_id AND s.employee_id=l.employee_id
        WHERE l.owner_id=?1 AND l.restaurant_id=?2
        ORDER BY l.created_at ASC,l.liability_id ASC LIMIT 201`)
        .bind(ctx.owner,ctx.restaurantId).all(),
      env.DB.prepare(`SELECT COUNT(*) AS count_all,
        COUNT(CASE WHEN state NOT IN ('PAID','CANCELLED') THEN 1 END) AS count_unpaid,
        COALESCE(SUM(CASE WHEN state NOT IN ('PAID','CANCELLED') THEN amount_minor ELSE 0 END),0) AS unpaid_minor,
        COALESCE(SUM(CASE WHEN state='PAID' THEN amount_minor ELSE 0 END),0) AS paid_minor
        FROM qr_tip_liabilities WHERE owner_id=?1 AND restaurant_id=?2`)
        .bind(ctx.owner,ctx.restaurantId).first()
    ]);
    const full=(result.results||[]),truncated=full.length>200;
    const rows=full.slice(0,200);
    const evaluated=evaluateQueue(rows,account?.balance_minor??null,Boolean(account?.payout_merchant_id));
    const unpaidMinor=Number(totals?.unpaid_minor||0);
    return json({success:true,restaurantId:ctx.restaurantId,
      account:{receivingMerchantId:account?.receiving_merchant_id||'',
        payoutMerchantId:account?.payout_merchant_id||'',
        balanceAZN:account?.balance_minor===null||account?.balance_minor===undefined?null:(Number(account.balance_minor)/100).toFixed(2),
        balanceSource:account?.balance_source||'NOT_SET',balanceObservedAt:account?.balance_observed_at||'',
        providerBalanceVerified:false,payoutsEnabled:false},
      summary:{...evaluated.summary,
        unpaidMinor,paidMinor:Number(totals?.paid_minor||0),
        unpaidCount:Number(totals?.count_unpaid||0),
        totalRecords:Number(totals?.count_all||0),
        shortfallMinor:account?.balance_minor===null||account?.balance_minor===undefined?null:Math.max(0,unpaidMinor-Number(account.balance_minor)),
        previewOnly:truncated},
      items:evaluated.rows.map(e=>({
        id:e.liability_id,orderId:e.qr_order_id,
        employeeId:e.employee_id,employeeName:[e.last_name,e.first_name].filter(Boolean).join(' ')||e.display_name||e.employee_id,
        amountAZN:(Number(e.amount_minor)/100).toFixed(2),currency:e.currency,
        state:e.state,queueReason:e.queueReason,createdAt:e.created_at,
        cardLast4:e.card_last4||''
      }))});
  }catch(e){return denied(e.status||500,'TIP_QUEUE_GET_ERROR',e.status?e.message:'Ошибка загрузки очереди чаевых')}
}
export async function onRequestPost({request,env}){
  try{
    const ctx=await context(request,env,true);
    const body=await request.json().catch(()=>null);
    if(!body||typeof body!=='object'||Array.isArray(body))return denied(400,'BAD_REQUEST','Неверный запрос');
    if(body.action!=='saveAccountSnapshot')return denied(400,'BAD_ACTION','Разрешено только сохранение реквизитов двух счетов и ручного снимка баланса');
    await ensureTipLedger(env.DB);
    const old=await settings(env.DB,ctx.owner,ctx.restaurantId);
    const receiving=merchantId(body.receivingMerchantId);
    const payout=merchantId(body.payoutMerchantId);
    if(receiving&&payout&&receiving===payout)return denied(400,'SAME_ACCOUNT','Для приёма оплат и выплаты чаевых должны использоваться разные Payriff Merchant ID');
    if(old?.receiving_merchant_id&&old.receiving_merchant_id!==receiving){
      const pending=await env.DB.prepare(`SELECT 1 AS exists_liability FROM qr_tip_liabilities
        WHERE owner_id=?1 AND restaurant_id=?2 LIMIT 1`).bind(ctx.owner,ctx.restaurantId).first();
      if(pending)return denied(409,'RECEIVING_ACCOUNT_LOCKED','Нельзя менять приёмный счёт Payriff при существующих обязательствах. Требуется отдельная процедура миграции.');
    }
    const balanceProvided=body.balanceAZN!==undefined&&body.balanceAZN!==null&&String(body.balanceAZN).trim()!=='';
    const balanceMinor=balanceProvided?minorUnits(body.balanceAZN):null;
    const time=new Date().toISOString();
    await env.DB.prepare(`INSERT INTO qr_tip_payout_accounts(
        owner_id,restaurant_id,receiving_merchant_id,payout_merchant_id,
        balance_minor,balance_source,balance_observed_at,updated_by,updated_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?7)
      ON CONFLICT(owner_id,restaurant_id) DO UPDATE SET
        receiving_merchant_id=excluded.receiving_merchant_id,
        payout_merchant_id=excluded.payout_merchant_id,
        balance_minor=excluded.balance_minor,balance_source=excluded.balance_source,
        balance_observed_at=excluded.balance_observed_at,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(ctx.owner,ctx.restaurantId,receiving,payout,balanceMinor,balanceProvided?'ACCOUNTANT_REPORTED':'NOT_SET',
        time,ctx.state.user.id).run();
    // No payout transfer is attempted here; the balance is ACCOUNTANT_REPORTED only.
    await logAuditEvent({request,env,action:'UPDATE',entityType:'QR_TIP_PAYOUT_ACCOUNT',
      entityId:ctx.restaurantId,entityLabel:'Payriff accounts (non-secret references)',
      before:{receivingMerchantId:old?.receiving_merchant_id||'',payoutMerchantId:old?.payout_merchant_id||'',balanceMinor:old?.balance_minor??null},
      after:{receivingMerchantId:receiving,payoutMerchantId:payout,balanceMinor},
      restaurantIds:[ctx.restaurantId]});
    return json({success:true,account:{receivingMerchantId:receiving,payoutMerchantId:payout,
      balanceAZN:balanceMinor===null?null:(balanceMinor/100).toFixed(2),
      providerBalanceVerified:false,payoutsEnabled:false}});
  }catch(e){return denied(e.status||500,'TIP_QUEUE_SAVE_ERROR',e.status?e.message:'Не удалось сохранить настройки')}
}
