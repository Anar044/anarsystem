import {ensureTipStaffTables} from '../../hr/tips-profile.js';
// Smart Horeca QR tipping ledger. INTERNAL-ONLY recording contract.
// Never call recordVerifiedTip from a public browser request or directly from an
// unverified Payriff callback. Payment status/amount must be retrieved server-side.
const str=(x,n=160)=>String(x??'').trim().slice(0,n);
const integer=x=>Number.isSafeInteger(x)&&x>=0?x:null;
const ISO=()=>new Date().toISOString();
export const TIP_CURRENCY='AZN';

export async function ensureTipLedger(db){
  if(!db)throw new Error('D1 binding DB unavailable');
  await ensureTipStaffTables(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS qr_tip_payout_accounts (
      owner_id TEXT NOT NULL, restaurant_id TEXT NOT NULL,
      receiving_merchant_id TEXT NOT NULL DEFAULT '',
      payout_merchant_id TEXT NOT NULL DEFAULT '',
      balance_minor INTEGER,
      balance_source TEXT NOT NULL DEFAULT 'NOT_SET',
      balance_observed_at TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      PRIMARY KEY(owner_id,restaurant_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS qr_tip_liabilities (
      owner_id TEXT NOT NULL, restaurant_id TEXT NOT NULL,
      liability_id TEXT NOT NULL, qr_order_id TEXT NOT NULL,
      payriff_payment_id TEXT NOT NULL, payriff_merchant_id TEXT NOT NULL,
      employee_id TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor>0),
      currency TEXT NOT NULL DEFAULT 'AZN',
      state TEXT NOT NULL DEFAULT 'QUEUED',
      provider_request_id TEXT NOT NULL DEFAULT '',
      provider_transfer_id TEXT NOT NULL DEFAULT '',
      last_error_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(owner_id,liability_id),
      UNIQUE(owner_id,restaurant_id,payriff_payment_id),
      CHECK(currency='AZN')
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_qr_tip_liability_queue
      ON qr_tip_liabilities(owner_id,restaurant_id,state,created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS qr_tip_payout_attempts (
      owner_id TEXT NOT NULL, restaurant_id TEXT NOT NULL,
      attempt_id TEXT NOT NULL, liability_id TEXT NOT NULL,
      idempotency_key TEXT NOT NULL, status TEXT NOT NULL,
      provider_request_id TEXT NOT NULL DEFAULT '',
      provider_transfer_id TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY(owner_id,attempt_id),
      UNIQUE(owner_id,restaurant_id,idempotency_key)
    )`)
  ]);
}

export function evaluateQueue(items,balanceMinor,hasPayoutMerchant=false){
  const isBalanceKnown=Number.isSafeInteger(balanceMinor)&&balanceMinor>=0;
  let available=isBalanceKnown?balanceMinor:0;
  const rows=(items||[]).map(row=>{
    const amount=Number(row.amount_minor);
    const state=str(row.state,30);
    const linked=Boolean(row.recipient_ref&&row.payout_status==='VERIFIED');
    let reason=state;
    if(state==='PAID')reason='PAID';
    else if(state==='RECONCILE'||state==='DISPATCHING')reason='RECONCILE';
    else if(state==='CANCELLED')reason='CANCELLED';
    else if(!linked)reason='WAITING_CARD';
    else if(!hasPayoutMerchant)reason='WAITING_PROVIDER';
    else if(!isBalanceKnown)reason='WAITING_BALANCE';
    else if(available<amount)reason='WAITING_FUNDS';
    else {reason='READY_FOR_PROVIDER';available-=amount}
    return {...row,queueReason:reason};
  });
  const unpaid=rows.filter(x=>!['PAID','CANCELLED'].includes(x.state));
  const sum=xs=>xs.reduce((n,x)=>n+Number(x.amount_minor||0),0);
  return {rows,summary:{
    unpaidCount:unpaid.length,unpaidMinor:sum(unpaid),
    paidMinor:sum(rows.filter(x=>x.state==='PAID')),
    readyMinor:sum(rows.filter(x=>x.queueReason==='READY_FOR_PROVIDER')),
    waitingCardMinor:sum(rows.filter(x=>x.queueReason==='WAITING_CARD')),
    waitingFundsMinor:sum(rows.filter(x=>x.queueReason==='WAITING_FUNDS')),
    inReconciliationMinor:sum(rows.filter(x=>x.queueReason==='RECONCILE')),
    balanceMinor:isBalanceKnown?balanceMinor:null,
    balanceSource:'ACCOUNTANT_REPORTED',
    shortfallMinor:isBalanceKnown?Math.max(0,sum(unpaid)-balanceMinor):null
  }};
}

// This function is consumed by a future verified QR payment processor.
// It is intentionally NOT exposed by a Pages Function route.
export async function recordVerifiedTip(db,source){
  const ownerId=str(source?.ownerId),restaurantId=str(source?.restaurantId);
  const employeeId=str(source?.employeeId),qrOrderId=str(source?.qrOrderId);
  const payment=source?.verifiedPayriff||{};
  const paymentId=str(payment.paymentId);
  const merchantId=str(payment.merchantId);
  const totalMinor=integer(payment.paidAmountMinor);
  const amountMinor=integer(source?.tipMinor);
  if(!ownerId||!restaurantId||!employeeId||!qrOrderId||!paymentId||!merchantId)
    throw new Error('Missing trusted identity, QR order or Payriff identifiers');
  if(payment.verifiedBy!=='SERVER_ORDER_LOOKUP'||payment.status!=='PAID'||
     !Number.isFinite(Date.parse(payment.verifiedAt||''))||
     Math.abs(Date.now()-Date.parse(payment.verifiedAt))>15*60*1000)
    throw new Error('Payriff payment must be confirmed by a recent server-side status lookup');
  if(amountMinor===null||amountMinor===0||totalMinor===null||amountMinor>totalMinor)
    throw new Error('Invalid tip amount or paid total');
  await ensureTipLedger(db);
  const account=await db.prepare(`SELECT receiving_merchant_id FROM qr_tip_payout_accounts
    WHERE owner_id=?1 AND restaurant_id=?2`).bind(ownerId,restaurantId).first();
  if(!account?.receiving_merchant_id||account.receiving_merchant_id!==merchantId)
    throw new Error('Payriff receiving merchant does not match this restaurant');
  const staff=await db.prepare(`SELECT 1 AS eligible FROM qr_tip_staff_restaurants r
    JOIN hr_employees e ON e.user_id=r.owner_id AND e.iiko_employee_id=r.employee_id
    WHERE r.owner_id=?1 AND r.restaurant_id=?2 AND r.employee_id=?3
      AND r.guest_enabled=1 AND e.is_deleted=0 AND TRIM(e.fire_date)='' LIMIT 1`)
    .bind(ownerId,restaurantId,employeeId).first();
  if(!staff?.eligible)throw new Error('The selected waiter is not eligible for this restaurant');
  const time=ISO();
  const id=crypto.randomUUID();
  // Unique provider payment scope makes duplicate callbacks idempotent.
  await db.prepare(`INSERT INTO qr_tip_liabilities(
    owner_id,restaurant_id,liability_id,qr_order_id,payriff_payment_id,
    payriff_merchant_id,employee_id,amount_minor,created_at,updated_at)
    VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)
    ON CONFLICT(owner_id,restaurant_id,payriff_payment_id) DO NOTHING`)
    .bind(ownerId,restaurantId,id,qrOrderId,paymentId,merchantId,employeeId,amountMinor,time).run();
  const recorded=await db.prepare(`SELECT liability_id,qr_order_id,employee_id,amount_minor
    FROM qr_tip_liabilities WHERE owner_id=?1 AND restaurant_id=?2 AND payriff_payment_id=?3`)
    .bind(ownerId,restaurantId,paymentId).first();
  if(!recorded||recorded.employee_id!==employeeId||
     recorded.qr_order_id!==qrOrderId||Number(recorded.amount_minor)!==amountMinor)
    throw new Error('PAYMENT_ID_CONFLICT: mismatched duplicate Payriff payment');
  return {liabilityId:recorded.liability_id,created:recorded.liability_id===id};
}
