import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const core=read('functions/api/qr-menu/_lib/orders.js');
const publicApi=read('functions/api/qr-menu/guest-orders.js');
const adminApi=read('functions/api/qr-menu/order-admin.js');
const bridge=read('functions/api/qr-menu/pos-bridge.js');
const guest=read('qr-order-guest.js');
const admin=read('qr-order-admin.js');
const menu=read('menu.html');
const editor=read('qr-menu.html');
const reference=read('qr-menu-reference-v2.js');
const shell=read('app-shell.js');
const modules=[core,publicApi,adminApi,bridge];
const compile=s=>new Function(s.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,''));
function getCore(){
  const source=core.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'');
  return new Function(source+';return {priceBasket,validateTable,publicState};')();
}
test('All new QR order APIs and client scripts are syntactically valid',()=>{
  for(const source of modules)assert.doesNotThrow(()=>compile(source));
  assert.doesNotThrow(()=>new Function(guest));
  assert.doesNotThrow(()=>new Function(admin));
  assert.match(menu,/qr-order-guest\.js/);
  assert.match(editor,/qr-order-admin\.html/);
  assert.match(shell,/data-unified-nav-item="qr-order-admin\.html"/);
});
test('Published D1 dishes always set the price; guest cannot send custom prices',async()=>{
  const {priceBasket}=getCore();
  const db={prepare:sql=>({bind:()=>({all:async()=>({results:[
    {id:'dish1',iiko_id:'11111111-1111-4111-8111-111111111111',name:'Суп',price:12.40,currency:'AZN'},
    {id:'dish2',iiko_id:'22222222-2222-4222-8222-222222222222',name:'Чай',price:2.75,currency:'AZN'}
  ]})})})};
  const basket=await priceBasket(db,'menu1',[{dishId:'dish1',qty:2,price:0.01},{dishId:'dish2',qty:1}]);
  assert.equal(basket.totalMinor,2755);
  assert.equal(basket.items[0].unitMinor,1240);
  assert.deepEqual(basket.items.map(x=>x.productId),['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222']);
  await assert.rejects(priceBasket(db,'menu1',[{dishId:'dish1',qty:0}]),/Некорректная строка/);
  await assert.rejects(priceBasket(db,'menu1',[{dishId:'dish1',qty:1},{dishId:'dish1',qty:1}]),/Некорректная строка/);
  await assert.rejects(priceBasket(db,'menu1',[{dishId:'unknown',qty:1}]),/больше не доступна/);
  const unmapped={prepare:()=>({bind:()=>({all:async()=>({results:[{id:'custom',iiko_id:'local-1',name:'Custom',price:3,currency:'AZN'}]})})})};
  await assert.rejects(priceBasket(unmapped,'menu1',[{dishId:'custom',qty:1}]),/не сопоставлено/);
});
test('Table QR keys are verified on server; fast food uses one generic QR',async()=>{
  const {validateTable}=getCore();
  let actualKey='';
  const db={prepare:()=>({bind:(_id,key)=>{actualKey=key;return {first:async()=>key==='valid-token'?{id:'t1',table_label:'Стол 1',pos_table_id:'POS1'}:null}}})};
  assert.equal((await validateTable(db,{service_mode:'FAST_FOOD',menu_id:'m'},'')).id,'');
  await assert.rejects(validateTable(db,{service_mode:'FAST_FOOD',menu_id:'m'},'some-token'),/общий QR/);
  assert.equal((await validateTable(db,{service_mode:'TABLE',menu_id:'m'},'valid-token')).id,'t1');
  assert.equal(actualKey,'valid-token');
  await assert.rejects(validateTable(db,{service_mode:'TABLE',menu_id:'m'},''),/отсканируйте QR/);
  await assert.rejects(validateTable(db,{service_mode:'TABLE',menu_id:'m'},'wrong'),/недействителен/);
});
test('Public route is anti-replay, disabled by default and payment cannot be forged',()=>{
  assert.match(core,/ordering_enabled INTEGER NOT NULL DEFAULT 0/);
  assert.match(core,/UNIQUE\(menu_id,client_key\)/);
  assert.match(core,/receipt_token TEXT UNIQUE NOT NULL/);
  assert.match(publicApi,/request_digest!==digest/);
  assert.match(publicApi,/QR_ORDER_RATE_SECRET/);
  assert.match(publicApi,/CF-Connecting-IP/);
  assert.match(publicApi,/isPosReady\(env.DB,configured\)/);
  assert.match(publicApi,/POS_OFFLINE/);
  assert.match(adminApi,/POS_BRIDGE_NOT_READY/);
  assert.match(bridge,/action==='hello'/);
  assert.match(publicApi,/priceBasket\(env.DB,menu.id,body.items\)/);
  assert.match(publicApi,/INSERT OR IGNORE INTO qr_guest_orders/);
  assert.match(publicApi,/paymentMethod:'PAY_AT_POS'/);
  assert.doesNotMatch(publicApi,/UPDATE qr_guest_orders.*state='CLOSED'/);
  assert.doesNotMatch(guest,/payriff|startPayment|cardNumber/i);
});
test('POS bridge requires dual secret and known plugin, uses an idempotent lease',()=>{
  assert.match(bridge,/QR_POS_BRIDGE_TOKEN/);
  assert.match(bridge,/verifyPluginIngress/);
  assert.match(bridge,/externalOrderId:item.id/);
  assert.match(bridge,/state='LEASED'/);
  assert.match(bridge,/pos_plugin_id=\?4/);
  assert.match(bridge,/lease_until/);
  assert.match(bridge,/ackCreated/);
  assert.match(bridge,/ackFiscalized/);
  assert.match(bridge,/FISCAL_PROOF_REQUIRED/);
  assert.match(bridge,/payment_method!=='PAY_AT_POS'/);
  assert.match(bridge,/pos_order_id!==posId/);
});
test('Read-only reference guest view stays unmodified visually and online checkout is opt-in',()=>{
  assert.match(reference,/window\.SHQRReference=\{onLoaded,onDishOpen,onDishClose\}/);
  assert.match(reference,/getSelectedItems/);
  assert.doesNotMatch(reference,/\bfetch\s*\(|XMLHttpRequest|\/api\/|payments|submitOrder/);
  assert.match(guest,/if\(!enabled\)return;setup\(\)/);
  assert.match(guest,/Заказ зарегистрирован\. Это ещё не подтверждение создания заказа на кассе/);
});

test('Kitchen dispatch is separate from POS creation and real fiscal closure',()=>{
  assert.match(core,/kitchen_status TEXT NOT NULL DEFAULT 'NOT_SENT'/);
  assert.match(core,/can_print_kitchen INTEGER NOT NULL DEFAULT 0/);
  assert.match(core,/ALTER TABLE qr_guest_orders ADD COLUMN kitchen_status/);
  assert.match(bridge,/action==='ackKitchen'/);
  assert.match(bridge,/\['PRINTED','CHECK_REQUIRED'\]/);
  assert.match(bridge,/prev\.pos_order_id!==posId/);
  assert.match(bridge,/prev\.kitchen_status!=='NOT_SENT'/);
  assert.match(bridge,/kitchen_status='NOT_SENT'/);
  assert.match(bridge,/canPrintKitchen!==true/);
  assert.match(publicApi,/can_print_kitchen=1/);
  assert.match(adminApi,/can_print_kitchen=1/);
  assert.match(guest,/order\.kitchenStatus==='PRINTED'/);
  assert.match(admin,/kitchen_status==='CHECK_REQUIRED'/);
});

test('Physical kitchen printing cannot be acknowledged by an arbitrary guest request',()=>{
  assert.doesNotMatch(publicApi,/ackKitchen|kitchenStatus\s*:\s*body\./);
  assert.match(bridge,/verifyPluginIngress\(request,env/);
  assert.match(bridge,/X-QR-Bridge-Token/);
  assert.match(bridge,/KITCHEN_ORDER_MISMATCH/);
  assert.match(bridge,/KITCHEN_STATUS_CONFLICT/);
});
