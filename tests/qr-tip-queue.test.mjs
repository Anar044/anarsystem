import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const ledger=read('functions/api/tips/_lib/ledger.js');
const api=read('functions/api/tips/queue.js');
const ui=read('tips-queue.js');
const page=read('tips.html');
const staff=read('functions/api/hr/tips-profile.js');

function queueFunction(){
  const plain=ledger.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=const|async|function)/g,'');
  return new Function(plain+';return evaluateQueue;')();
}
const tip=(amount_minor,options={})=>({
  amount_minor,state:'QUEUED',recipient_ref:'recipient-ref',
  payout_status:'VERIFIED',...options
});

test('API and client JS syntax compiles',()=>{
  for(const s of [ledger,api,staff]){
    const plain=s.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=const|async|function)/g,'');
    assert.doesNotThrow(()=>new Function(plain));
  }
  assert.doesNotThrow(()=>new Function(ui));
});

test('Queue is FIFO, keeps insufficient funds and never fabricates paid payouts',()=>{
  const evaluate=queueFunction();
  const a=evaluate([tip(700),tip(600),tip(200)],1000,true);
  assert.deepEqual(a.rows.map(x=>x.queueReason),[
    'READY_FOR_PROVIDER','WAITING_FUNDS','READY_FOR_PROVIDER']);
  assert.equal(a.summary.unpaidMinor,1500);
  assert.equal(a.summary.shortfallMinor,500);
  assert.equal(a.summary.paidMinor,0);
  assert.equal(a.summary.readyMinor,900);
  const b=evaluate([tip(500,{recipient_ref:''}),tip(600)],800,true);
  assert.deepEqual(b.rows.map(x=>x.queueReason),['WAITING_CARD','READY_FOR_PROVIDER']);
  const c=evaluate([tip(400)],null,true);
  assert.equal(c.rows[0].queueReason,'WAITING_BALANCE');
  const d=evaluate([tip(400)],1000,false);
  assert.equal(d.rows[0].queueReason,'WAITING_PROVIDER');
});

test('Paid items never consume manual available balance and reconciliation is explicit',()=>{
  const evaluate=queueFunction();
  const x=evaluate([tip(900,{state:'PAID'}),tip(300,{state:'RECONCILE'}),tip(450)],500,true);
  assert.deepEqual(x.rows.map(v=>v.queueReason),['PAID','RECONCILE','READY_FOR_PROVIDER']);
  assert.equal(x.summary.paidMinor,900);
  assert.equal(x.summary.inReconciliationMinor,300);
  assert.equal(x.summary.unpaidMinor,750);
});

test('Only future verified Payriff server lookup can register a durable liability',()=>{
  assert.match(ledger,/verifiedBy!=='SERVER_ORDER_LOOKUP'/);
  assert.match(ledger,/payment.status!=='PAID'/);
  assert.match(ledger,/merchantId!==merchantId/);
  assert.match(ledger,/amountMinor>totalMinor/);
  assert.match(ledger,/ON CONFLICT\(owner_id,restaurant_id,payriff_payment_id\) DO NOTHING/);
  assert.match(ledger,/PAYMENT_ID_CONFLICT/);
  assert.match(ledger,/UNIQUE\(owner_id,restaurant_id,payriff_payment_id\)/);
  assert.match(ledger,/CHECK\(currency='AZN'\)/);
  assert.doesNotMatch(api,/recordVerifiedTip/);
});

test('Payout settings are finance scoped, no public transfer or provider credentials',()=>{
  assert.match(api,/hasPermission\(state.access,permission\)/);
  assert.match(api,/resolveHrRestaurantScope\(request,env,owner,state.access\)/);
  assert.match(api,/scope.isChain&&scope.selectedDepartmentIds.length!==1/);
  assert.match(api,/body.action!=='saveAccountSnapshot'/);
  assert.match(api,/ACCOUNTANT_REPORTED/);
  assert.match(api,/payoutsEnabled:false/);
  assert.match(api,/providerBalanceVerified:false/);
  assert.doesNotMatch(api+ledger,/api\/v3\/payout|api\/v3\/directPay|Payriff-Secret/);
  assert.doesNotMatch(page,/<input[^>]+(?:secret|cvv|cardNumber)/i);
});

test('Accountant UI shows queue, two accounts and manual balance warning',()=>{
  assert.match(page,/id="tipPayoutAccounts"/);
  assert.match(page,/id="tipQueueRows"/);
  assert.match(page,/tips-queue\.js\?/);
  assert.match(ui,/Недостаточно средств/);
  assert.match(ui,/providerBalanceVerified/);
  assert.match(ui,/сумма, указанная бухгалтером|введён бухгалтером|Баланс введён бухгалтером/i);
  assert.match(api,/COUNT\(CASE WHEN state NOT IN/);
  assert.match(api,/ORDER BY l.created_at ASC/);
});
