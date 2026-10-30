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
const managementPage=read('qr-order-admin.html');
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
  assert.match(bridge,/body\.canPrintKitchen!==canCreate/);
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

test('Cashier can retry only a known pre-creation validation failure',()=>{
  assert.match(adminApi,/action==='retryValidationFailure'/);
  assert.match(adminApi,/last_error='POS_VALIDATION_FAILED'/);
  assert.match(adminApi,/pos_order_id='' AND payment_state='UNPAID'/);
  assert.match(adminApi,/QR_RETRY_UNSAFE/);
  assert.match(adminApi,/owner_id=\?3 AND restaurant_id=\?4/);
  assert.match(admin,/o\.last_error==='POS_VALIDATION_FAILED'/);
  assert.match(admin,/Требуется сверка с кассой/);
  assert.doesNotMatch(publicApi,/retryValidationFailure/);
});
test('Reloading a QR menu cannot re-submit an already confirmed basket',()=>{
  assert.match(reference,/clearSelectedItems/);
  assert.match(guest,/receiptTicket\)\{/);
  assert.match(guest,/if\(submitting\|\|!enabled\|\|receiptTicket\)return/);
  assert.match(guest,/sessionStorage\.removeItem\(key\(\)\)/);
  assert.match(guest,/Начать новый заказ/);
});


test('Diagnostic HTTPS hello cannot receive or dispatch POS orders',async()=>{
  const mockedDB={cap:null,writes:[],prepare(sql){
    return{bind:(...params)=>({
      run:async()=>{this.writes.push({sql,params});if(sql.includes('INSERT INTO qr_pos_bridge_capabilities'))this.cap={
        can_create_order:params[2],can_ack_fiscal:params[2],can_print_kitchen:params[2],last_seen_at:params[3]
      };return{success:true}},
      first:async()=>{
        if(sql.includes('SELECT can_create_order,can_ack_fiscal,can_print_kitchen,last_seen_at'))
          return this.cap;
        return null
      }
    })}
  }};
  const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
  const invalid=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
  const source=bridge.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'');
  const {onRequestPost}=new Function('ensureOrders','response','bad','fail','clean','verifyPluginIngress',
    source+';return{onRequestPost};')(
    async()=>{},json,(status,code,message)=>json({success:false,code,message},status),
    invalid,(v,n=180)=>String(v??'').trim().slice(0,n),async()=>({verified:true})
  );
  const env={QR_POS_BRIDGE_TOKEN:'test-secret',DB:mockedDB};
  async function send(action,options={},secret='test-secret'){
    const request=new Request('https://qr-staging.example/api/qr-menu/pos-bridge',{
      method:'POST',headers:{'Content-Type':'application/json','X-QR-Bridge-Token':secret},
      body:JSON.stringify({action,pluginId:'test-plugin',departmentId:'test-department',...options})
    });
    const res=await onRequestPost({request,env});
    return{status:res.status,body:await res.json()};
  }
  const diagnostics=await send('hello',{
    contractVersion:1,canCreateOrder:false,canAcknowledgeFiscal:false,canPrintKitchen:false
  });
  assert.equal(diagnostics.status,200);
  assert.equal(diagnostics.body.accepted,true);
  assert.equal(diagnostics.body.orderingReady,false);
  assert.equal(mockedDB.cap.can_create_order,0);
  const blockedPull=await send('pull');
  assert.equal(blockedPull.status,409);
  assert.equal(blockedPull.body.code,'QR_POS_NOT_READY');
  assert.equal(mockedDB.writes.filter(x=>x.sql.includes('UPDATE qr_guest_orders')).length,0);
  const inconsistent=await send('hello',{
    contractVersion:1,canCreateOrder:true,canAcknowledgeFiscal:true,canPrintKitchen:false
  });
  assert.equal(inconsistent.status,409);
  assert.equal(inconsistent.body.code,'QR_BRIDGE_VERSION_UNSUPPORTED');
  const full=await send('hello',{
    contractVersion:1,canCreateOrder:true,canAcknowledgeFiscal:true,canPrintKitchen:true
  });
  assert.equal(full.status,200);
  assert.equal(full.body.orderingReady,true);
  assert.equal(mockedDB.cap.can_create_order,1);
  const wrongSecret=await send('hello',{
    contractVersion:1,canCreateOrder:false,canAcknowledgeFiscal:false,canPrintKitchen:false
  },'wrong-secret');
  assert.equal(wrongSecret.status,401);
  assert.equal(wrongSecret.body.code,'QR_BRIDGE_FORBIDDEN');
});
test('Admin explicitly distinguishes diagnostic connection from POS readiness',()=>{
  assert.match(adminApi,/posBridgeConnected:bridgeConnected,posBridgeReady:bridgeReady/);
  assert.match(admin,/state\.settings\.posBridgeConnected/);
  assert.match(admin,/Режим диагностики: заказы и печать отключены/);
  assert.match(bridge,/Number\(caps\.can_create_order\)!==1/);
  assert.match(bridge,/QR_POS_NOT_READY/);
});

test('In-app test POS setup never exposes secrets and preserves protected workspace scope',()=>{
  assert.match(managementPage,/Подключение кассы из Smart Horeca/);
  assert.match(managementPage,/id="qrPosConnectionState"/);
  assert.match(managementPage,/id="qrPosServerState"/);
  assert.match(managementPage,/id="qrOrderCheckConnection"/);
  assert.match(adminApi,/backendSetup:\{/);
  assert.match(adminApi,/bridgeTokenConfigured:Boolean\(clean\(env.QR_POS_BRIDGE_TOKEN\)\)/);
  assert.match(adminApi,/ingressTokenConfigured:Boolean\(clean\(env.PLUGIN_INGEST_TOKEN\)\)/);
  assert.match(adminApi,/posBridgeLastSeen:bridgeConnected\?posStatus.last_seen_at:null/);
  assert.doesNotMatch(adminApi,/bridgeToken:\s*env\.QR_POS_BRIDGE_TOKEN/);
  assert.doesNotMatch(adminApi,/ingressToken:\s*env\.PLUGIN_INGEST_TOKEN/);
  assert.match(adminApi,/adminContext\(request,env\)/);
  assert.match(adminApi,/restaurant_id=\?1 AND plugin_id=\?2/);
  assert.match(admin,/\$\('qrOrderEnabled'\)\.disabled=!state\.settings\.posBridgeReady/);
  assert.match(admin,/\$\('qrPosRestaurantId'\)\.textContent/);
  assert.match(admin,/\$\('qrOrderCheckConnection'\)\.onclick=reload/);
});
