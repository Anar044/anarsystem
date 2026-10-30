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
const persistentWorkspace=read('persistent-workspace.js');
const siteAccess=read('site-access.js');
const registryHelper=read('functions/api/qr-menu/_lib/pos-registers.js');
const registryEndpoint=read('functions/api/qr-menu/pos-registers.js');
const tablePolicy=read('functions/api/qr-menu/_lib/table-sync-policy.js');
const ingestion=read('functions/api/plugin/_lib/ingest-auth.js');
const reference=read('qr-menu-reference-v2.js');
const shell=read('app-shell.js');
const modules=[core,publicApi,adminApi,bridge];
const compile=s=>new Function(s.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,''));
const cleanValue=(v,n=180)=>String(v??'').trim().slice(0,n);
const failed=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
const {requireTableSyncScope,isSharedD1Test}=new Function('fail','clean',
  tablePolicy.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'')+
  ';return{requireTableSyncScope,isSharedD1Test};'
)(failed,cleanValue);
const testRestaurant='28a38f52-9b1b-01a7-019f-8455da3a0010';
const testPlugin='0638669c-67e2-4f14-be2d-567404352a7c';
const testPreview='feature-qr-order-internal-co.smarthoreca.pages.dev';
const sharedConfig={
  QR_TABLE_SYNC_MODE:'shared-test',
  QR_TABLE_SYNC_PREVIEW_HOST:testPreview,
  QR_TABLE_SYNC_DEPARTMENT_ID:testRestaurant,
  QR_TABLE_SYNC_PLUGIN_ID:testPlugin
};

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
  assert.match(publicApi,/paymentMethod:'PAYRIFF',onlinePaymentEnabled:false/);
  assert.match(publicApi,/throw fail\('QR_ONLINE_PAYMENT_NOT_READY'/);
  assert.doesNotMatch(publicApi,/UPDATE qr_guest_orders.*state='CLOSED'/);
  assert.doesNotMatch(guest,/payriff|startPayment|cardNumber/i);
});
test('Payment-first guard rejects guest orders and setup even without the shared-test flag',async()=>{
  const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
  const bad=(status,code,message)=>new Response(JSON.stringify({success:false,code,message}),{status});
  const src=publicApi.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'');
  const {onRequestPost}=new Function('isSharedD1Test','fail','bad',src+';return {onRequestPost};')(
    ()=>false,fail,bad);
  const req=new Request('https://qr-preview.example/api/qr-menu/guest-orders',{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
      id:'some-menu',items:[{productId:'test',qty:1}],clientKey:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    })
  });
  const env={DB:{prepare:()=>{throw Error('No D1 writes allowed before payment')}}};
  const res=await onRequestPost({request:req,env});
  assert.equal(res.status,409);
  assert.equal((await res.json()).code,'QR_ONLINE_PAYMENT_NOT_READY');
  assert.match(adminApi,/if\(action==='saveSettings'&&body.orderingEnabled===true\)/);
  assert.match(bridge,/WHERE o.restaurant_id=\?3 AND o.payment_state='PAID_ONLINE'/);
  assert.match(bridge,/AND o.payment_method='PAYRIFF'/);
  assert.match(bridge,/\['ackCreated','ackKitchen'\]\.includes\(action\)/);
  assert.match(adminApi,/QR_ONLINE_PAYMENT_NOT_READY/);
  assert.match(bridge,/Без подтверждённой оплаты заказ не передаётся на кассу и кухню/);
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
  assert.match(adminApi,/pos_order_id='' AND payment_state='PAID_ONLINE' AND payment_method='PAYRIFF'/);
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
    'requireTableSyncScope','isSharedD1Test','verifyRegisteredQrPos',
    source+';return{onRequestPost};')(
    async()=>{},json,(status,code,message)=>json({success:false,code,message},status),
    invalid,(v,n=180)=>String(v??'').trim().slice(0,n),async()=>({verified:true}),
    requireTableSyncScope,isSharedD1Test,async()=>({verified:true})
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
  assert.equal(inconsistent.body.code,'QR_ONLINE_PAYMENT_NOT_READY');
  const full=await send('hello',{
    contractVersion:1,canCreateOrder:true,canAcknowledgeFiscal:true,canPrintKitchen:true
  });
  assert.equal(full.status,409);
  assert.equal(full.body.code,'QR_ONLINE_PAYMENT_NOT_READY');
  assert.equal(mockedDB.cap.can_create_order,0);
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
  assert.match(managementPage,/Подключение кассы и диагностика/);
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
  assert.match(admin,/\$\('qrOrderEnabled'\)\.disabled=\(sharedTest&&/);
  assert.match(admin,/!state\.settings\.posBridgeReady/);
  assert.match(admin,/\$\('qrPosRestaurantId'\)\.textContent/);
  assert.match(admin,/\$\('qrOrderCheckConnection'\)\.onclick=reload/);
});

test('POS selector is server-scoped and strips raw backend event data',async()=>{
  const restaurantId='28a38f52-9b1b-01a7-019f-8455da3a0010';
  const pluginId='0638669c-67e2-4f14-be2d-567404352a7c';
  let target='',requestHeaders={};
  const rows=[
    {pluginId,departmentId:restaurantId,pluginName:'TEST POS',groupName:'Test Group',version:'1.3.50',online:true,
      data:{rawPersonalGuestData:'must-not-leak'},privilegedToken:'must-not-leak'},
    {pluginId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      departmentId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',pluginName:'OTHER RESTAURANT',online:true},
    {pluginId:'not-a-guid',departmentId:restaurantId,pluginName:'INVALID'}
  ];
  const code=registryHelper.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'');
  const {registeredPosRegisters}=new Function('pluginBackendUrl','pluginBackendHeaders','fail','clean','fetch',
    code+';return{registeredPosRegisters};')(
      (_env,path)=>'https://test-backend.example'+path,
      (_env,headers)=>({...headers,'X-SH-Backend-Token':'private-backend-token'}),
      (code,message,status=400)=>Object.assign(new Error(message),{code,status}),
      (x,n=180)=>String(x??'').trim().slice(0,n),
      async(url,options)=>{
        target=url;requestHeaders=options.headers;
        return{ok:true,json:async()=>({success:true,plugins:rows})};
      }
    );
  const results=await registeredPosRegisters({},restaurantId);
  assert.equal(new URL(target).searchParams.get('departmentIds'),restaurantId);
  assert.equal(requestHeaders['X-SH-Backend-Token'],'private-backend-token');
  assert.equal(results.length,1);
  assert.equal(results[0].pluginId,pluginId);
  assert.equal(results[0].online,true);
  assert.doesNotMatch(JSON.stringify(results),/rawPersonalGuestData|must-not-leak|private-backend-token|OTHER RESTAURANT/);
});
test('QR settings POST rejects a cashier not registered in the selected restaurant',async()=>{
  const source=adminApi.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'');
  let writes=0,lookups=0;
  const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
  const {onRequestPost}=new Function(
    'ensureOrders','adminContext','settings','registeredPosRegisters','response','bad','fail','clean','token','eventStmt',
    'requireTableSyncScope','isSharedD1Test',
    source+';return{onRequestPost};'
  )(
    async()=>{},
    async()=>({ownerId:'test-owner',restaurantId:'28a38f52-9b1b-01a7-019f-8455da3a0010',menu:{id:'m'}}),
    async()=>null,
    async()=>{lookups++;return[{pluginId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}]},
    json,(status,code,message)=>json({success:false,code,message},status),
    fail,(x,n=180)=>String(x??'').trim().slice(0,n),()=>'token',()=>({}),
    requireTableSyncScope,isSharedD1Test
  );
  const request=new Request('https://feature-qr-order-internal-co.smarthoreca.pages.dev/api/qr-menu/order-admin',{method:'POST',body:JSON.stringify({
    action:'saveSettings',serviceMode:'TABLE',posPluginId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    orderingEnabled:false
  })});
  const db={prepare:()=>{writes++;throw Error('A cross-tenant selection must never perform D1 writes')}};
  const res=await onRequestPost({request,env:{DB:db}});
  assert.equal(res.status,403);
  assert.equal((await res.json()).code,'QR_POS_NOT_IN_RESTAURANT');
  assert.equal(lookups,1);
  assert.equal(writes,0);
});
test('Cashier picker is a select backed by server-validated POS registry, not free-form ID',()=>{
  assert.match(managementPage,/<select id="qrOrderPlugin"/);
  assert.doesNotMatch(managementPage,/<input id="qrOrderPlugin"/);
  assert.match(managementPage,/id="qrPosListReload"/);
  assert.match(admin,/\/api\/qr-menu\/pos-registers/);
  assert.match(admin,/loadRegisters/);
  assert.match(registryEndpoint,/adminContext\(request,env\)/);
  assert.match(registryEndpoint,/registeredPosRegisters\(env,ctx\.restaurantId\)/);
  assert.match(adminApi,/QR_POS_NOT_IN_RESTAURANT/);
  assert.match(adminApi,/registeredPosRegisters\(env,ctx\.restaurantId\)/);
});


test('QR orders button stays in protected workspace instead of falling back to Dashboard',()=>{
  assert.match(editor,/href="\/qr-order-admin\.html"[^>]*>🧾 QR-заказы и столы<\/a>/);
  assert.match(siteAccess,/'qr-menu\.html':\['qr\.manage'\]/);
  assert.match(siteAccess,/'qr-order-admin\.html':\['qr\.manage'\]/);
  const start=persistentWorkspace.indexOf('  function canonicalPagePath(path){');
  const end=persistentWorkspace.indexOf('  function permitted(route){',start);
  assert.ok(start>0&&end>start,'Route resolver source exists');
  const resolver=persistentWorkspace.slice(start,end);
  const resolve=new Function('location','document','PROCUREMENT','INTERNAL',
    resolver+';return resolvePilotRoute;')(
    {origin:'https://feature-qr-order-internal-co.smarthoreca.pages.dev'},
    {querySelector:()=>null},Object.freeze({}),[]
  );
  for(const path of ['/qr-order-admin','/qr-order-admin.html']){
    const route=resolve(path);
    assert.deepEqual(route,{
      href:'/qr-order-admin.html',
      label:'QR-заказы и столы',
      permissions:['qr.manage']
    });
    assert.notEqual(route.href,'/dashboard.html');
  }
  assert.equal(resolve('/qr-order-admin.html?invite=attacker'),null);
  assert.equal(resolve('/qr-order-admin.html#unexpected'),null);
  assert.equal(resolve('https://other.example/qr-order-admin.html'),null);
  assert.match(persistentWorkspace,/route\.href==='\/qr-order-admin\.html'&&normalized\.href==='\/qr-menu\.html'/);
  assert.match(managementPage,/href="\/qr-menu\.html"/);
});

test('Unpublished QR menu shows actionable next step, never leaves a fake loading state',()=>{
  assert.match(managementPage,/id="qrOrderPrerequisite" hidden/);
  assert.match(managementPage,/id="qrOrderOpenEditor"/);
  assert.match(managementPage,/id="qrOrderRetry"/);
  const start=admin.indexOf("const status=(v,id='qrOrderError')");
  const end=admin.indexOf('async function loadRegisters()',start);
  assert.ok(start>0&&end>start,'Prerequisite state functions are present');
  const nodes=new Map();
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{
      textContent:'Загрузка…',hidden:true,checked:true,disabled:false,
      replaceChildren(...value){this.items=value}
    });
    return nodes.get(id);
  };
  const document={
    getElementById:node,
    createElement:tag=>({tag,value:'',textContent:''})
  };
  const {showPrerequisite}=new Function('document',
    "const $=id=>document.getElementById(id);let state={settings:{orderingEnabled:true}};\n"+
    admin.slice(start,end)+"\nreturn{showPrerequisite};"
  )(document);
  showPrerequisite({code:'QR_MENU_NOT_PUBLISHED',message:'Сначала опубликуйте QR-меню выбранного ресторана'});
  assert.equal(node('qrOrderPrerequisite').hidden,false);
  assert.equal(node('qrOrderOpenEditor').hidden,false);
  assert.match(node('qrOrderPrerequisiteTitle').textContent,/опубликуйте QR-меню/);
  assert.match(node('qrOrderPrerequisiteMessage').textContent,/тестовом ресторане/);
  assert.equal(node('qrOrderEnabled').checked,false);
  assert.equal(node('qrOrderEnabled').disabled,true);
  assert.equal(node('qrOrderSave').disabled,true);
  assert.equal(node('qrAddTable').disabled,true);
  assert.equal(node('qrOrderPlugin').disabled,true);
  assert.equal(node('qrPosRestaurantName').textContent,'Меню не опубликовано');
  assert.equal(node('qrPosServerState').textContent,'Нет данных');
  assert.equal(node('qrPosConnectionState').textContent,'Не проверено');
  assert.equal(node('qrOrderError').textContent,'');
  showPrerequisite({code:'QR_ORDER_DB_UNAVAILABLE',message:'База D1 не подключена'});
  assert.equal(node('qrOrderOpenEditor').hidden,true);
  assert.equal(node('qrPosRestaurantName').textContent,'Не удалось загрузить');
  assert.match(node('qrOrderError').textContent,/База D1 не подключена/);
  assert.equal(node('qrOrderSave').disabled,true);
});

test('Read-only POS tablesSnapshot authenticates, scopes and stores valid halls',async()=>{
  const source=bridge.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'');
  const saved=[];
  const db={prepare:sql=>({bind:(...args)=>({run:async()=>{saved.push({sql,args});return{success:true}}})})};
  const payload={action:'tablesSnapshot',
    pluginId:'0638669c-67e2-4f14-be2d-567404352a7c',
    departmentId:'28a38f52-9b1b-01a7-019f-8455da3a0010',
    tables:[
      {posTableId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',sectionId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      sectionName:'Зал',name:'Стол 1',number:1,isActive:true},
      {posTableId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',sectionId:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      sectionName:'Терраса',name:'Стол 1',number:1,isActive:true}
    ]
  };
  const err=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
  let verified=0;
  const {onRequestPost}=new Function('ensureOrders','response','bad','fail','clean','verifyPluginIngress',
    'requireTableSyncScope','isSharedD1Test','verifyRegisteredQrPos',
    source+';return{onRequestPost};')(
    async()=>{},(v,status=200)=>new Response(JSON.stringify(v),{status}),
    (status,code,message)=>new Response(JSON.stringify({success:false,code,message}),{status}),
    err,(v,n=180)=>String(v??'').trim().slice(0,n),
    async()=>{verified++;return{verified:true}},
    requireTableSyncScope,isSharedD1Test,async()=>{verified++;return{verified:true}}
  );
  const env={QR_POS_BRIDGE_TOKEN:'secret',...sharedConfig,DB:db};
  const send=async data=>{
    const req=new Request('https://feature-qr-order-internal-co.smarthoreca.pages.dev/api/qr-menu/pos-bridge',{method:'POST',
      headers:{'X-QR-Bridge-Token':'secret'},body:JSON.stringify(data)});
    const res=await onRequestPost({request:req,env});return{status:res.status,body:await res.json()};
  };
  const ok=await send(payload);
  assert.equal(ok.status,200);assert.equal(ok.body.tableCount,2);
  assert.equal(verified,1);
  assert.equal(saved.length,1);
  assert.equal(saved[0].args[0],payload.departmentId);
  assert.equal(saved[0].args[1],payload.pluginId);
  assert.equal(JSON.parse(saved[0].args[3]).length,2);
  const duplicate=await send({...payload,tables:[payload.tables[0],payload.tables[0]]});
  assert.equal(duplicate.status,400);
  assert.equal(duplicate.body.code,'POS_TABLE_CATALOG_INVALID');
  assert.equal(saved.length,1);
  const wrongId=await send({...payload,tables:[{...payload.tables[0],sectionId:'evil'}]});
  assert.equal(wrongId.status,400);
  assert.equal(saved.length,1);
});
test('QR table importer only accepts a fresh authenticated POS catalog and keeps old QR keys',async()=>{
  const source=adminApi.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'');
  const restaurantId='28a38f52-9b1b-01a7-019f-8455da3a0010',
    pluginId='0638669c-67e2-4f14-be2d-567404352a7c',
    existingPosId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    newPosId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    stranger='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const sectionId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const catalog=[
    {posTableId:existingPosId,sectionId,sectionName:'Основной зал',name:'Стол 1',number:1,isActive:true},
    {posTableId:newPosId,sectionId,sectionName:'Терраса',name:'Стол 2',number:2,isActive:true}
  ];
  const rows=[{id:'original-qr-id',table_label:'Старый стол',pos_table_id:existingPosId,table_key:'permanent-token'}];
  const batched=[];
  const db={
    prepare(sql){return{bind:(...params)=>({
      __sql:sql,
      first:async()=>sql.includes('qr_pos_table_snapshots')?{
        tables_json:JSON.stringify(catalog),last_seen_at:new Date().toISOString()
      }:null,
      all:async()=>({results:rows}),
      run:async()=>({success:true})
    }),__sql:sql}},
    async batch(statements){batched.push(statements);return []}
  };
  const err=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
  const {onRequestPost}=new Function('ensureOrders','adminContext','settings','registeredPosRegisters','response','bad','fail','clean','token','eventStmt',
    'requireTableSyncScope','isSharedD1Test',
    source+';return{onRequestPost};')(
    async()=>{},async()=>({ownerId:'owner',restaurantId,menu:{id:'menu'}}),
    async()=>({owner_id:'owner',restaurant_id:restaurantId,pos_plugin_id:pluginId,service_mode:'TABLE'}),
    async()=>[],(v,status=200)=>new Response(JSON.stringify(v),{status}),
    (status,code,message)=>new Response(JSON.stringify({success:false,code,message}),{status}),
    err,(v,n=180)=>String(v??'').trim().slice(0,n),()=> 'new-qr-token',()=>({}),
    requireTableSyncScope,isSharedD1Test
  );
  const send=async ids=>{
    const request=new Request('https://feature-qr-order-internal-co.smarthoreca.pages.dev/api/qr-menu/order-admin',
      {method:'POST',body:JSON.stringify({action:'syncPosTables',posTableIds:ids})});
    const res=await onRequestPost({request,env:{DB:db,...sharedConfig}});
    return{status:res.status,body:await res.json()};
  };
  const forged=await send([stranger]);
  assert.equal(forged.status,409);
  assert.equal(forged.body.code,'QR_TABLE_SELECTION_INVALID');
  assert.equal(batched.length,0);
  const valid=await send([existingPosId,newPosId]);
  assert.equal(valid.status,200);
  assert.equal(valid.body.created,1);
  assert.equal(valid.body.linked,1);
  assert.equal(batched.length,1);
  assert.equal(batched[0].length,2);
  // Existing row is updated only with its section metadata. Its table_key
  // and printed QR remain untouched and it is not deleted/recreated.
  const writeSql=batched[0].map(x=>x.__sql||'');
  assert.match(writeSql[0],/UPDATE qr_order_tables/);
  assert.doesNotMatch(writeSql[0],/table_key|DELETE/);
  assert.match(writeSql[1],/INSERT INTO qr_order_tables/);
});
test('QR page offers grouped automatic POS table import and manual fallback',()=>{
  assert.match(managementPage,/id="qrPosCatalogGroups"/);
  assert.match(managementPage,/id="qrTableImport"/);
  assert.match(managementPage,/id="qrTableRefresh"/);
  assert.match(managementPage,/id="qrTableManual"/);
  assert.match(admin,/function renderPosCatalog/);
  assert.match(admin,/action:'syncPosTables'/);
  assert.match(adminApi,/action==='syncPosTables'/);
  assert.match(adminApi,/qr_pos_table_snapshots/);
  assert.match(core,/CREATE TABLE IF NOT EXISTS qr_pos_table_snapshots/);
  assert.match(core,/ADD COLUMN section_name/);
});


test('Shared D1 table upload requires preview host and exact test restaurant and plugin',async()=>{
  const source=bridge.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'');
  let schemaAttempts=0;
  const {onRequestPost}=new Function('ensureOrders','response','bad','fail','clean','verifyPluginIngress',
    'requireTableSyncScope','isSharedD1Test','verifyRegisteredQrPos',source+';return{onRequestPost};')(
    async()=>{schemaAttempts++},
    (v,status=200)=>new Response(JSON.stringify(v),{status}),
    (status,code,message)=>new Response(JSON.stringify({success:false,code,message}),{status}),
    failed,cleanValue,async()=>({verified:true}),requireTableSyncScope,isSharedD1Test,
    async()=>({verified:true})
  );
  const identity={pluginId:testPlugin,departmentId:testRestaurant};
  async function post(host,env,action='tablesSnapshot',overrides={}){
    const request=new Request('https://'+host+'/api/qr-menu/pos-bridge',{
      method:'POST',headers:{'X-QR-Bridge-Token':'secret'},
      body:JSON.stringify({...identity,action,tables:[],...overrides})
    });
    const res=await onRequestPost({request,env:{
      QR_POS_BRIDGE_TOKEN:'secret',...env,DB:{
        prepare(){throw new Error('Unexpected database write during blocked operation')}
      }
    }});
    return{status:res.status,body:await res.json()};
  }
  const noConfig=await post(testPreview,{});
  assert.equal(noConfig.status,403);
  assert.equal(noConfig.body.code,'QR_TABLE_SYNC_HOST_FORBIDDEN');
  const otherHost=await post('smarthoreca.pages.dev',sharedConfig);
  assert.equal(otherHost.status,403);
  assert.equal(otherHost.body.code,'QR_TABLE_SYNC_HOST_FORBIDDEN');
  const foreignRestaurant=await post(testPreview,sharedConfig,'tablesSnapshot',{
    departmentId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  });
  assert.equal(foreignRestaurant.status,403);
  assert.equal(foreignRestaurant.body.code,'QR_TABLE_SYNC_TEST_SCOPE_FORBIDDEN');
  const foreignPlugin=await post(testPreview,sharedConfig,'tablesSnapshot',{
    pluginId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  });
  assert.equal(foreignPlugin.status,403);
  assert.equal(foreignPlugin.body.code,'QR_TABLE_SYNC_TEST_SCOPE_FORBIDDEN');
  assert.equal(schemaAttempts,0);
});
test('Shared D1 test POS cannot enable ordering or call POS pull',async()=>{
  const source=bridge.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'');
  const {onRequestPost}=new Function('ensureOrders','response','bad','fail','clean','verifyPluginIngress',
    'requireTableSyncScope','isSharedD1Test','verifyRegisteredQrPos',source+';return{onRequestPost};')(
    async()=>{},
    (v,status=200)=>new Response(JSON.stringify(v),{status}),
    (status,code,message)=>new Response(JSON.stringify({success:false,code,message}),{status}),
    failed,cleanValue,async()=>({verified:true}),requireTableSyncScope,isSharedD1Test
  );
  const base={pluginId:testPlugin,departmentId:testRestaurant};
  async function send(body){
    const request=new Request('https://'+testPreview+'/api/qr-menu/pos-bridge',{
      method:'POST',headers:{'X-QR-Bridge-Token':'secret'},body:JSON.stringify({...base,...body})
    });
    const res=await onRequestPost({request,env:{
      ...sharedConfig,QR_POS_BRIDGE_TOKEN:'secret',DB:{
        prepare(){throw new Error('Blocked operations cannot reach D1')}
      }
    }});
    return{status:res.status,body:await res.json()};
  }
  const pull=await send({action:'pull'});
  assert.equal(pull.status,409);
  assert.equal(pull.body.code,'QR_SHARED_D1_ORDERS_DISABLED');
  const fullHello=await send({action:'hello',contractVersion:1,
    canCreateOrder:true,canAcknowledgeFiscal:true,canPrintKitchen:true});
  assert.equal(fullHello.status,409);
  assert.equal(fullHello.body.code,'QR_SHARED_D1_DIAGNOSTICS_ONLY');
  const created=await send({action:'ackCreated',externalOrderId:'fake'});
  assert.equal(created.status,409);
  const guestSource=publicApi.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'');
  const {onRequestPost:guestPost}=new Function('isSharedD1Test','fail','bad',
    guestSource+';return{onRequestPost};')(
      isSharedD1Test,failed,(status,code,message)=>
        new Response(JSON.stringify({success:false,code,message}),{status})
    );
  const res=await guestPost({request:new Request('https://'+testPreview+'/api/qr-menu/guest-orders',{
    method:'POST',body:'{}'
  }),env:sharedConfig});
  assert.equal(res.status,409);
  assert.equal((await res.json()).code,'QR_SHARED_D1_ORDERS_DISABLED');
});

test('QR cashier settings save has explicit feedback and stale client JS cannot mask it',()=>{
  assert.match(admin,/status\('Сохраняем настройки…','qrOrderSaveStatus'\)/);
  assert.match(admin,/Настройки сохранены\. Касса привязана к выбранному ресторану/);
  assert.match(admin,/Сервер принял настройки\. Проверьте выбранную кассу/);
  assert.match(admin,/Не удалось сохранить:/);
  assert.match(admin,/Ранее сохранённая привязка не удалена/);
  assert.match(managementPage,/qr-order-admin\.js\?v=20261030-compact-workspace1/);
});

test('QR management offers independently scrollable desktop panels and a mobile layout',()=>{
  assert.match(managementPage,/class="qro-workspace"/);
  assert.match(managementPage,/class="qro-list-scroll" id="qrPosCatalogScroll"/);
  assert.match(managementPage,/class="qro-list-scroll" id="qrQrScroll"/);
  assert.match(managementPage,/id="qrQrPanel"/);
  assert.match(managementPage,/\.qro-workspace\{display:grid/);
  assert.match(managementPage,/@media\(max-width:1050px\)/);
  assert.match(managementPage,/id="qrPosSetup"/);
  assert.match(managementPage,/class="qro-panel qro-journal"/);
});
test('QR hall accordions and bulk selection ignore inactive and already linked POS tables',()=>{
  for(const id of ['qrTableSelectAll','qrTableSelectNone','qrCatalogSelectionSummary',
    'qrQrSectionFilter','qrQrSearch'])assert.match(managementPage,new RegExp('id="'+id+'"'));
  assert.match(admin,/document\.createElement\('details'\)/);
  assert.match(admin,/checkbox\.disabled=!table\.isActive\|\|linked/);
  assert.match(admin,/updateCatalogSelection\(\)/);
  assert.match(admin,/expandedSections/);
  assert.match(admin,/selectSection\.addEventListener\('click'/);
  assert.match(admin,/\$\('qrQrSectionFilter'\)\.onchange=renderTables/);
  assert.match(admin,/\$\('qrQrSearch'\)\.oninput=renderTables/);
  assert.match(admin,/className='qro-qr-more'/);
});
test('One-key QR preview bridge verifies registered POS while never requiring or replacing global ingress token',async()=>{
  const plugin='0638669c-67e2-4f14-be2d-567404352a7c';
  const department='28a38f52-9b1b-01a7-019f-8455da3a0010';
  let lookupUrl='',lookupCount=0;
  const src=ingestion.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'');
  const {verifyRegisteredQrPos}=new Function('pluginBackendUrl','pluginBackendHeaders','fetch',
    src+';return{verifyRegisteredQrPos};')(
    (env,path)=>'https://registry.example'+path,
    (env,headers)=>headers,
    async(url)=>{lookupUrl=url;lookupCount++;return{ok:true,json:async()=>({
      plugins:[{pluginId:plugin,departmentId:department}]
    })};}
  );
  const confirmed=await verifyRegisteredQrPos({},{pluginId:plugin,departmentId:department});
  assert.equal(confirmed.verified,true);
  assert.equal(confirmed.pluginId,plugin);
  assert.equal(new URL(lookupUrl).searchParams.get('departmentIds'),department);
  assert.equal(lookupCount,1);
  await assert.rejects(verifyRegisteredQrPos({},{pluginId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    departmentId:department}),e=>e.code==='PLUGIN_DEPARTMENT_MISMATCH'&&e.status===403);
  assert.match(ingestion,/export async function verifyPluginIngress/);
  assert.match(ingestion,/const expected=clean\(env\?\.PLUGIN_INGEST_TOKEN\)/);
  assert.match(bridge,/verifyRegisteredQrPos\(env,identity\)/);
  assert.match(bridge,/if\(!isSharedD1Test\(env\)\)/);
  assert.match(adminApi,/singleKeyDiagnosticMode:isSharedD1Test\(env\)/);
});
