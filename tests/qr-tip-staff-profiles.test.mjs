import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const api=read('functions/api/hr/tips-profile.js');
const card=read('hr-employee.html');
const finance=read('finance.html');
const financeView=read('tips.html');
const admin=read('tips-staff.js');
const staff=read('hr-employee-tips.js');
const shell=read('app-shell.js');

test('new tip profile API and UIs parse as JavaScript',()=>{
  const moduleBody=api.replace(/^import\s+.*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'');
  assert.doesNotThrow(()=>new Function(moduleBody));
  assert.doesNotThrow(()=>new Function(admin));
  assert.doesNotThrow(()=>new Function(staff));
});

test('Tip recipient settings require real finance payment permissions and HR staff ids',()=>{
  assert.match(api,/hasPermission\(auth\.access,'finance\.payments'\)/);
  assert.match(api,/loadRequestIikoState\(request,env\)/);
  assert.match(api,/resolveHrRestaurantScope\(request,env,owner,auth\.access\)/);
  assert.match(api,/SELECT iiko_employee_id,employee_code/);
  assert.match(api,/WHERE user_id=\?1 AND iiko_employee_id=\?2/);
  assert.match(api,/scope\.isChain && scope\.selectedDepartmentIds\.length!==1/);
  assert.match(api,/hr_employee_departments/);
});

test('Card setup is provider-gated: never collect PAN, CVV or allow manual VERIFIED',()=>{
  assert.match(api,/CARD_DATA_FORBIDDEN/);
  assert.match(api,/INVALID_LAST4/);
  assert.match(api,/recipient_ref=CASE WHEN card_holder/);
  assert.match(api,/payout_status=CASE WHEN card_holder/);
  assert.match(api,/payout_status TEXT NOT NULL DEFAULT 'NOT_LINKED'/);
  assert.doesNotMatch(api,/action==='verifyCard'|action==='sendPayout'|action==='markPaid'/);
  assert.doesNotMatch(financeView+card,/<input[^>]+(?:id|name)="(?:cardNumber|cvv|expiry)"/);
  assert.match(financeView,/Полный номер карты/);
});

test('POS mapping is restaurant-scoped and personal code uniquely belongs to staff',()=>{
  assert.match(api,/PRIMARY KEY\(owner_id,employee_id\), UNIQUE\(owner_id,personal_code\)/);
  assert.match(api,/PRIMARY KEY\(owner_id,restaurant_id,employee_id\)/);
  assert.match(api,/idx_qr_tip_pos_unique/);
  assert.match(api,/DUPLICATE_POS_ID/);
  assert.match(api,/personal_code=\?1,updated_at=\?2/);
  assert.match(api,/crypto\.getRandomValues/);
  assert.match(api,/codeRotated/);
});

test('Both accountant and HR employee UIs expose the feature without changing QR ordering',()=>{
  assert.match(card,/data-tab="tips"/);
  assert.match(card,/data-panel="tips"/);
  assert.match(card,/hr-employee-tips\.js/);
  assert.match(finance,/href="\/tips\.html"/);
  assert.match(shell,/data-unified-nav-item=\\"tips\.html\\"/);
  assert.match(shell,/return'tips.html'/);
  assert.match(admin,/\/api\/hr\/tips-profile\?list=1/);
  assert.match(staff,/\/api\/hr\/tips-profile/);
  assert.doesNotMatch(admin+staff,/Payriff\s+payment\s+success|paymentConfirmed/);
});
