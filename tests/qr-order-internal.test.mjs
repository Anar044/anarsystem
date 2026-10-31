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
const paymentProvider=read('functions/api/qr-menu/_lib/payment-provider-settings.js');
const paymentEndpoint=read('functions/api/qr-menu/payment-settings.js');
const sandboxPayment=read('functions/api/qr-menu/payment-checkout.js');
const payriffGateway=read('functions/api/qr-menu/_lib/payriff-checkout.js');
const paymentCallback=read('functions/api/qr-menu/payment-callback.js');
const paymentReturn=read('qr-payment-return.html');
const paymentAttempts=read('functions/api/qr-menu/payment-attempts.js');
const payriffRefund=read('functions/api/qr-menu/_lib/payriff-refund.js');
const paidOrderQueue=read('functions/api/qr-menu/paid-order-queue.js');
const checkoutPolicy=read('functions/api/qr-menu/_lib/checkout-policy.js');
const paymentConnectivity=read('functions/api/qr-menu/payment-connectivity.js');
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

test('Payriff credentials are encrypted with workspace/restaurant AAD and a server-only root',async()=>{
  const source=paymentProvider.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'');
  const {encryptPaymentSecret,decryptPaymentSecret,safePaymentSettings,paymentSettingsScope}=
    new Function('SMART_HORECA_STATE_ENCRYPTION_ENV',source+
      ';return{encryptPaymentSecret,decryptPaymentSecret,safePaymentSettings,paymentSettingsScope};')(
      'SMART_HORECA_STATE_ENCRYPTION_KEY');
  const env={SMART_HORECA_STATE_ENCRYPTION_KEY:'test-only-platform-master-encryption-secret'};
  const args={workspaceId:'w-1',restaurantId:'r-1',environment:'development',secret:'test-payriff-secret-000'};
  const encrypted=await encryptPaymentSecret(env,args);
  assert.doesNotMatch(encrypted,/test-payriff-secret-000/);
  assert.equal(await decryptPaymentSecret(env,{...args,envelope:encrypted}),args.secret);
  await assert.rejects(decryptPaymentSecret(env,{...args,workspaceId:'w-2',envelope:encrypted}));
  await assert.rejects(decryptPaymentSecret(env,{...args,restaurantId:'r-2',envelope:encrypted}));
  await assert.rejects(decryptPaymentSecret(env,{...args,environment:'production',envelope:encrypted}));
  await assert.rejects(decryptPaymentSecret({SMART_HORECA_STATE_ENCRYPTION_KEY:'different-platform-key-12345678'},{
    ...args,envelope:encrypted}));
  await assert.rejects(encryptPaymentSecret({},args),e=>e.code==='PAYMENT_ENCRYPTION_UNAVAILABLE');
  const safe=safePaymentSettings({merchant_id:'ES1095709',secret_encrypted:encrypted},false);
  assert.equal(safe.configured,true);
  assert.equal(safe.merchantId,'');
  assert.doesNotMatch(JSON.stringify(safe),/test-payriff-secret-000/);
  assert.equal(paymentSettingsScope({
    restaurantId:'r-1',state:{access:{workspace:{id:'w-1'}}}
  }).workspaceId,'w-1');
});
test('QR Pay warns owners to check provider application status, not merely the UI mode',()=>{
  assert.match(managementPage,/qrPayriffProviderModeWarning/);
  assert.match(managementPage,/НЕ переводит/);
  assert.match(managementPage,/статус Development/);
  assert.match(admin,/а не ONLINE/);
  assert.match(admin,/Реальные деньги могут списаться/);
});
test('Payriff setup is restricted to owner, tenant, Development and same origin',()=>{
  assert.match(paymentEndpoint,/ctx\?\.state\?\.access\?\.isOwner===true/);
  assert.match(paymentEndpoint,/PAYMENT_CONFIG_OWNER_REQUIRED/);
  assert.match(paymentEndpoint,/hasPermission\(ctx\?\.state\?\.access,'settings.manage'\)/);
  assert.match(paymentEndpoint,/PAYMENT_SCOPE_FORGED/);
  assert.match(paymentEndpoint,/PAYMENT_RESTAURANT_CHANGED/);
  assert.match(admin,/expectedRestaurantId:paymentLoadedRestaurant/);
  assert.match(paymentEndpoint,/PAYMENT_PRODUCTION_LOCKED/);
  assert.match(paymentEndpoint,/PAYMENT_ORIGIN_MISMATCH/);
  assert.match(paymentEndpoint,/secretKey/);
  assert.match(paymentEndpoint,/encryptPaymentSecret/);
  assert.match(paymentEndpoint,/safePaymentSettings\(row,isManager\(ctx\)\)/);
  assert.match(paymentProvider,/PRIMARY KEY\(workspace_id,restaurant_id,provider\)/);
  assert.match(paymentProvider,/name:'HKDF'/);
  assert.match(managementPage,/id="qrPaymentPanel"/);
  for(const id of ['qrPaymentMerchantId','qrPaymentSecret','qrPaymentSave','qrPaymentDisconnect',
    'qrPaymentContext','qrPaymentSummary'])assert.match(managementPage,new RegExp('id="'+id+'"'));
  assert.match(admin,/loadPaymentSettings/);
  assert.doesNotMatch(admin,/loadPayriffTestStatus/);
});
test('Payriff API refuses foreign restaurant, external origin, non-owner and production writes',async()=>{
  const src=paymentEndpoint.replace(/^import[\s\S]*?from\s+['\"][^'\"]+['\"];\s*$/gm,'')
    .replace(/\bexport\s+(?=async|function|const)/g,'');
  const json=(body,status=200)=>new Response(JSON.stringify(body),{status});
  const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
  let owner=true, adminPermissions=[], writes=0, encrypted='', merchantId='';
  const adminContext=async()=>({
    restaurantId:'r-1',menu:{id:'m-1'},ownerId:'u-1',
    state:{access:{isOwner:owner,permissions:adminPermissions,workspace:{id:'w-1'}},user:{id:'user-1'}}
  });
  const {onRequestGet,onRequestPost}=new Function('adminContext','response','bad','fail','clean','hasPermission',
    'ensurePaymentSettings','paymentSettingsScope','fetchPaymentSettings',
    'encryptPaymentSecret','decryptPaymentSecret','safePaymentSettings',
    'ensureCheckoutPolicy','fetchCheckoutPolicy','isLivePreview',
    src+';return {onRequestGet,onRequestPost};')(
    adminContext,json,(status,code,message)=>json({success:false,code,message},status),
    fail,(v,n=180)=>String(v??'').trim().slice(0,n),
    (access,permission)=>(access?.permissions||[]).includes(permission),async()=>{},
    ctx=>({workspaceId:ctx.state.access.workspace.id,restaurantId:ctx.restaurantId}),
    async()=>encrypted?{merchant_id:merchantId,secret_encrypted:encrypted,environment:'development'}:null,
    async(_env,args)=>{encrypted='encrypted-not-plaintext';merchantId='ES1095709';return encrypted},
    async()=>{throw Error('Should not decrypt new credential')},
    (row,canManage)=>({configured:!!row,canManage,merchantId:canManage?row?.merchant_id||'':'',
      merchantMasked:row?.merchant_id?'••••'+row.merchant_id.slice(-4):'',checkoutEnabled:false}),
    async()=>{},async()=>null,row=>Number(row?.live_preview_enabled)===1
  );
  const env={SMART_HORECA_STATE_ENCRYPTION_KEY:'test-encryption-key-sufficient-length',
    DB:{prepare:()=>({bind:()=>({first:async()=>null})}),batch:async()=>{writes++}}};
  const call=(body,origin='https://preview.example')=>onRequestPost({env,request:
    new Request('https://preview.example/api/qr-menu/payment-settings',{method:'POST',
      headers:{'Content-Type':'application/json','Origin':origin},
      body:JSON.stringify(body)})});
  const body={action:'save',expectedRestaurantId:'r-1',environment:'development',
    merchantId:'ES1095709',secretKey:'test-secret-example-123456'};
  let res=await call({...body,expectedRestaurantId:'another-restaurant'});
  assert.equal(res.status,409);assert.equal(writes,0);
  res=await call({...body,restaurantId:'another-restaurant'});
  assert.equal(res.status,403);assert.equal(writes,0);
  res=await call(body,'https://attacker.example');
  assert.equal(res.status,403);assert.equal(writes,0);
  owner=false;res=await call(body);
  assert.equal(res.status,403);assert.equal(writes,0);
  adminPermissions=['settings.manage'];
  res=await call({...body,expectedRestaurantId:'another-restaurant'});
  assert.equal(res.status,409);assert.equal(writes,0);
  adminPermissions=[];
  owner=true;res=await call({...body,environment:'production'});
  assert.equal(res.status,409);assert.equal(writes,0);
  res=await call(body);
  assert.equal(res.status,200);assert.equal(writes,1);
  const output=await res.text();
  assert.doesNotMatch(output,/test-secret-example-123456|encrypted-not-plaintext/);
  res=await onRequestGet({request:new Request('https://preview.example/api/qr-menu/payment-settings'),env});
  assert.equal(res.status,200);
  assert.doesNotMatch(await res.text(),/test-secret-example-123456|encrypted-not-plaintext/);
});
test('Opening a QR checkout does not create D1 tables or write before payment',async()=>{
  const source=sandboxPayment
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm,'')
    .replace(/\bexport\s+(?=async|function|const)/g,'');
  const respond=(payload,status=200)=>new Response(JSON.stringify(payload),{
    status,headers:{'Content-Type':'application/json'}
  });
  let capturedPaymentScope=null;
  const getter=new Function('publishedMenu','settings','validateTable',
    'fetchPaymentSettings','response','bad','fail','clean','fetchCheckoutPolicy','isLivePreview',
    source+';return onRequestGet;')(
    async()=>({id:'menu1',organization_id:'restaurant1'}),
    async()=>({owner_id:'owner1',restaurant_id:'restaurant1',menu_id:'menu1',service_mode:'TABLE'}),
    async()=>({id:'table1',table_label:'Бар - Стол 1'}),
    async(_db,scope)=>{
      capturedPaymentScope=scope;
      if(!scope.workspaceId||!scope.restaurantId)
        throw Error('D1 bind received undefined restaurant/workspace ID');
      return {enabled:1,environment:'development',
        merchant_id:'ES9990000',secret_encrypted:'ciphertext'};
    },
    respond,(status,code,message)=>respond({success:false,code,message},status),
    failed,cleanValue,async()=>null,row=>Number(row?.live_preview_enabled)===1);
  let queryCount=0;
  const env={DB:{prepare(sql){
    queryCount++;
    assert.doesNotMatch(sql,/^\s*(CREATE|INSERT|UPDATE|DELETE|ALTER)\b/i);
    if(sql.includes('qr_payment_menu_bindings'))
      return {bind:()=>({first:async()=>({
        workspace_id:'workspace1',restaurant_id:'restaurant1',owner_id:'owner1'})})};
    throw Error('Unexpected read query');
  }}};
  const request=new Request('https://'+testPreview+'/api/qr-menu/payment-checkout?id=slug&table=table-key');
  const result=await getter({request,env});
  assert.equal(result.status,200);
  const body=await result.json();
  assert.equal(body.testCheckoutEnabled,true);
  assert.deepEqual(capturedPaymentScope,{
    workspaceId:'workspace1',restaurantId:'restaurant1'
  });
  assert.equal(body.tableLabel,'Бар - Стол 1');
  assert.equal(queryCount,1);
  const broken=await getter({request,env:{DB:{prepare(){throw Error('D1 storage issue')}}}});
  assert.equal(broken.status,503);
  const err=await broken.json();
  assert.equal(err.code,'QR_PAYMENT_MENU_BINDING_UNAVAILABLE');
  assert.doesNotMatch(err.message,/D1 storage issue/);
  assert.match(err.message,/MENU_BINDING/);
  assert.match(sandboxPayment,/QR_PAYMENT_.*_UNAVAILABLE/);
  assert.match(sandboxPayment,/readOnlyStep\('PROVIDER_SETTINGS'/);
  assert.match(sandboxPayment,/readOnlyStep\('TABLE_SETTINGS'/);
  assert.match(sandboxPayment,/readOnlyStep\('TABLE_LOOKUP'/);
});
test('Payriff legacy encrypted Online merchant can enable real 0.01 AZN only with explicit owner confirmation',()=>{
  assert.match(paymentEndpoint,/action==='setLivePreview'/);
  assert.match(paymentEndpoint,/confirmRealCharge!==true/);
  assert.match(paymentEndpoint,/expectedMerchantId!==existing.merchant_id/);
  assert.match(paymentEndpoint,/live_preview_enabled=excluded.live_preview_enabled/);
  assert.match(paymentEndpoint,/max_live_minor=1/);
  assert.match(managementPage,/id="qrPaymentToggleLive"/);
  assert.match(admin,/toggleRealOneKopek/);
  assert.match(guest,/LIVE_PREVIEW_001/);
  assert.match(guest,/С карты будет РЕАЛЬНО списано 0,01 AZN/);
  assert.match(sandboxPayment,/basket.totalMinor!==1/);
  assert.match(sandboxPayment,/LIVE_PREVIEW_001/);
  assert.doesNotMatch(sandboxPayment,/INSERT INTO qr_guest_orders|ackCreated|ackKitchen/);
});
test('Payriff development checkout verifies purchase, amount and currency before paid',async()=>{
  const gateway=payriffGateway.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm,'')
    .replace(/\bexport\s+(?=async|function|const)/g,'');
  const fail=(code,message,status=400)=>Object.assign(new Error(message),{status,code});
  const {createPayriffCheckout,classifyPayriffPayment}=new Function('fail',gateway+
    ';return {createPayriffCheckout,classifyPayriffPayment};')(fail);
  const ref='aa000000-1111-4222-8333-cccccccccccc';
  const orderId='aabbccdd-1111-4222-8333-cccccccccccc';
  let sent=null;
  const good=await createPayriffCheckout({secret:'test-secret',amountMinor:1500,reference:ref,
    callbackUrl:'https://preview.example/callback',redirectUrl:'https://preview.example/return',
    fetcher:async(url,options)=>{
      sent={url,options};
      return {ok:true,json:async()=>({code:'00000',payload:{
        orderId,paymentUrl:'https://pay.payriff.com/redirect/fake'}})};
    }});
  assert.equal(good.orderId,orderId);
  assert.match(sent.url,/\/api\/v3\/orders$/);
  assert.equal(sent.options.headers.Authorization,'test-secret');
  const posted=JSON.parse(sent.options.body);
  assert.equal(posted.amount,15);
  assert.equal(posted.currency,'AZN');
  assert.equal(posted.operation,'PURCHASE');
  assert.equal(sent.options.headers['X-REQUEST-RRN'],ref);
  assert.equal(posted.requestRRN,undefined);
  assert.equal(posted.callbackUrl,'https://preview.example/callback');
  assert.equal(classifyPayriffPayment({
    orderId,amount:15,paidAmount:15,currencyType:'AZN',operationType:'PURCHASE',
    paymentStatus:'APPROVED'},{orderId,amountMinor:1500}),'PAID_VERIFIED');
  for(const wrong of [
    {paymentStatus:'PREAUTH_APPROVED'},
    {operationType:'PRE_AUTH'},
    {amount:14},
    {paidAmount:14},
    {currencyType:'USD'},
    {orderId:'unrelated'}]){
    assert.notEqual(classifyPayriffPayment({
      orderId,amount:15,paidAmount:15,currencyType:'AZN',operationType:'PURCHASE',
      paymentStatus:'APPROVED',...wrong},{orderId,amountMinor:1500}),'PAID_VERIFIED');
  }
  await assert.rejects(createPayriffCheckout({secret:'test',amountMinor:1500,reference:ref,
    fetcher:async()=>({ok:true,json:async()=>({code:'00000',
      payload:{orderId,paymentUrl:'https://evil.example/steal'}})})}));
  const {readPayriffByReference}=new Function('fail',gateway+
    ';return {readPayriffByReference};')(fail);
  let method='';
  await readPayriffByReference({secret:'test-secret',reference:ref,fetcher:async(url,opts)=>{
    assert.equal(url,'https://api.payriff.com/api/v3/orders/'+ref+'/rrn');
    method=opts.method;
    return {ok:true,json:async()=>({code:'00000',payload:{orderId}})};
  }});
  assert.equal(method,'GET');
  await assert.rejects(createPayriffCheckout({secret:'test',amountMinor:1500,reference:ref,
    fetcher:async()=>{throw new Error('network disconnected')}}),
    e=>e.code==='PAYRIFF_CONNECT_FAILED');
  await assert.rejects(createPayriffCheckout({secret:'test',amountMinor:1500,reference:ref,
    fetcher:async()=>({ok:false,status:302})}),
    e=>e.code==='PAYRIFF_UNEXPECTED_REDIRECT');
  await assert.rejects(createPayriffCheckout({secret:'test',amountMinor:1500,reference:ref,
    fetcher:async()=>({ok:true,json:async()=>({code:'15400',responseId:'abc'})})}),
    e=>e.code==='PAYRIFF_REJECTED_15400');
  await assert.rejects(createPayriffCheckout({secret:'test',amountMinor:1500,reference:ref,
    fetcher:async()=>({ok:false,status:400,json:async()=>({
      code:'15400',responseId:'support123',message:'UNSAFE-MERCHANT-SECRET'
    })})}),e=>e.code==='PAYRIFF_HTTP_400_CODE_15400'
      &&e.providerResponseId==='support123'
      &&!e.message.includes('UNSAFE-MERCHANT-SECRET'));
  await assert.rejects(createPayriffCheckout({secret:'test',amountMinor:1500,reference:ref,
    fetcher:async()=>({ok:false,status:400,json:async()=>({
      code:'15400',responseId:'unsafe text here',message:'UNSAFE-MERCHANT-SECRET'
    })})}),e=>e.code==='PAYRIFF_HTTP_400_CODE_15400'&&e.providerResponseId===null);
  assert.match(sandboxPayment,/readPayriffByReference/);
  assert.match(sandboxPayment,/last_checked_at/);
  assert.match(sandboxPayment,/ticket:receipt/);
  assert.match(guest,/sandboxClientKeyKey/);
  assert.match(guest,/sessionStorage\.setItem\(sandboxClientKeyKey\(\),sandboxKey\)/);
});
test('Payment attempts history distinguishes empty D1 store from zero rows, without modifying DB',async()=>{
  const source=paymentAttempts
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm,'')
    .replace(/\bexport\s+(?=async|function|const)/g,'');
  const mockCtx=async()=>({
    restaurantId:'r1',
    state:{access:{isOwner:true,workspace:{id:'w1'}}}
  });
  const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
  const output=(value,status=200)=>new Response(JSON.stringify(value),{status});
  const handle=new Function('adminContext','hasPermission','paymentSettingsScope',
    'response','bad','fail',source+';return onRequestGet;')(
    mockCtx,()=>false,ctx=>({workspaceId:'w1',restaurantId:ctx.restaurantId}),
    output,(status,code,message)=>output({success:false,code,message},status),fail);
  let queries=[];
  const env={
    DB:{prepare(sql){
      queries.push(sql);
      assert.doesNotMatch(sql,/^\s*(CREATE|INSERT|UPDATE|DELETE|ALTER)/i);
      if(sql.includes('sqlite_master'))return {first:async()=>null};
      throw Error('Unexpected SQL query');
    }}
  };
  let res=await handle({request:new Request('https://preview.example/'),env});
  assert.equal(res.status,200);
  let body=await res.json();
  assert.equal(body.storageReady,false);
  assert.deepEqual(body.attempts,[]);
  assert.match(body.notice,/Transactions/);
  assert.equal(queries.length,1);
  queries=[];
  const empty={
    DB:{prepare(sql){
      queries.push(sql);
      if(sql.includes('sqlite_master'))return {first:async()=>(
        sql.includes('qr_payriff_refunds')?null:{name:'qr_payment_intents'})};
      if(sql.includes('FROM qr_payment_intents'))return {bind:(w,r)=>{
        assert.equal(w,'w1');assert.equal(r,'r1');
        return {all:async()=>({results:[]})};
      }};
      throw Error('Unexpected read query');
    }}
  };
  res=await handle({request:new Request('https://preview.example/'),env:empty});
  assert.equal(res.status,200);
  body=await res.json();
  assert.equal(body.storageReady,true);
  assert.deepEqual(body.attempts,[]);
  assert.match(body.notice,/нет записей/);
  assert.equal(queries.length,3);
});
test('Payriff UNKNOWN reconciliation exposes provider error instead of hiding it behind history reload',async()=>{
  const src=paymentAttempts
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm,'')
    .replace(/\bexport\s+(?=async|function|const)/g,'');
  const failed=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
  const output=(body,status=200)=>new Response(JSON.stringify(body),{status});
  const id='11111111-2222-4333-8444-555555555555';
  const attempt={id,state:'UNKNOWN',restaurant_id:'restaurant1',
    workspace_id:'workspace1',merchant_id:'ES1093754',
    provider_order_id:null,created_at:'2026-10-31T01:04:38Z',
    table_label:'Бар - Стол 1',total_minor:1,last_checked_at:'',};
  const queries=[],lookups=[];
  const db={prepare(sql){
    queries.push(sql);
    if(sql.includes('SELECT * FROM qr_payment_intents'))return {bind:()=>({first:async()=>({...attempt})})};
    if(sql.includes('UPDATE qr_payment_intents SET last_checked_at'))return {
      bind:()=>({first:async()=>({id})})};
    throw Error('Unexpected database operation: '+sql.slice(0,60));
  }};
  const onRequestPost=new Function('adminContext','response','bad','fail',
    'paymentSettingsScope','fetchPaymentSettings','decryptPaymentSecret',
    'readPayriffByReference','readPayriffPayment','classifyPayriffPayment',
    'hasPermission',src+';return onRequestPost;')(
    async()=>({restaurantId:'restaurant1',state:{
      access:{isOwner:true,workspace:{id:'workspace1'}}}}),
    output,(status,code,message)=>output({success:false,code,message},status),
    failed,ctx=>({workspaceId:'workspace1',restaurantId:ctx.restaurantId}),
    async()=>({environment:'development',merchant_id:'ES1093754',secret_encrypted:'encrypted'}),
    async()=> 'server-side-secret',
    async opts=>{lookups.push({reference:opts.reference});
      throw failed('PAYRIFF_HTTP_404','Payriff returned HTTP 404',502);
    },
    async()=>{throw Error('Must use RRN for UNKNOWN');},
    ()=>{throw Error('Must not classify unconfirmed payment');},
    ()=>false
  );
  const res=await onRequestPost({env:{DB:db},
    request:new Request('https://preview.example/api/qr-menu/payment-attempts',{
      method:'POST',headers:{'Origin':'https://preview.example',
        'Content-Type':'application/json'},
      body:JSON.stringify({action:'reconcile',intentId:id,
        expectedRestaurantId:'restaurant1'})
    })});
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.success,true);
  assert.equal(body.attempt.state,'UNKNOWN');
  assert.equal(body.reconciliation.outcome,'UNCONFIRMED');
  assert.equal(body.reconciliation.code,'PAYRIFF_HTTP_404');
  assert.match(body.notice,/PAYRIFF_HTTP_404/);
  assert.equal(body.reconciliation.responseId,null);
  assert.ok(body.reconciliation.checkedAt);
  assert.deepEqual(lookups,[{reference:id}]);
  assert.equal(queries.filter(s=>s.includes('UPDATE')).length,1);
  assert.doesNotMatch(JSON.stringify(body),/server-side-secret|encrypted/);
  assert.match(admin,/paymentAttemptResults\.set\(attempt.id/);
  assert.match(admin,/await loadPaymentAttempts\(\)/);
  assert.match(managementPage,/qr-order-admin\.js\?v=20261031-auto-refund6/);
});
test('Cloudflare to Payriff diagnostic only GETs a synthetic RRN, is owner-scoped and never reveals secret',async()=>{
  const src=paymentConnectivity
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm,'')
    .replace(/\bexport\s+(?=async|function|const)/g,'');
  const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
  const output=(body,status=200)=>new Response(JSON.stringify(body),{status});
  let allowed=true,requests=[];
  const get=new Function('adminContext','response','bad','fail',
    'paymentSettingsScope','fetchPaymentSettings','decryptPaymentSecret',
    'hasPermission','fetch',src+';return onRequestGet;')(
    async()=>({restaurantId:'r1',state:{access:{isOwner:allowed,workspace:{id:'w1'}}}}),
    output,(status,code,message)=>output({success:false,code,message},status),fail,
    ctx=>({restaurantId:ctx.restaurantId,workspaceId:'w1'}),
    async(_db,scope)=>{
      assert.deepEqual(scope,{restaurantId:'r1',workspaceId:'w1'});
      return {environment:'development',secret_encrypted:'some-cipher'};
    },
    async()=> 'not-a-real-merchant-secret-12345',()=>false,
    async(url,options)=>{
      requests.push({url,method:options.method,headers:options.headers});
      return {status:404};
    }
  );
  const target='https://'+testPreview+'/api/qr-menu/payment-connectivity';
  const testRequest=new Request(target,{method:'GET'});
  let res=await get({request:testRequest,env:{DB:{}}});
  assert.equal(res.status,200);
  let answer=await res.json();
  assert.equal(answer.reachedHttp,true);
  assert.equal(answer.httpStatus,404);
  assert.equal(requests.length,1);
  assert.equal(requests[0].method,'GET');
  assert.match(requests[0].url,/api\.payriff\.com\/api\/v3\/orders\/00000000.*\/rrn/);
  assert.equal(requests[0].headers.Authorization,'not-a-real-merchant-secret-12345');
  assert.doesNotMatch(JSON.stringify(answer),/not-a-real-merchant-secret-12345|some-cipher/);
  allowed=false;
  res=await get({request:testRequest,env:{DB:{}}});
  assert.equal(res.status,403);
  assert.equal(requests.length,1);
  res=await get({request:new Request('https://smarthoreca.pages.dev/api/qr-menu/payment-connectivity'),env:{DB:{}}});
  assert.equal(res.status,403);
  assert.equal(requests.length,1);
  assert.match(admin,/checkPayriffConnectivity/);
  assert.match(admin,/\$\('qrPayriffConnectivityCheck'\)\.onclick=checkPayriffConnectivity/);
  assert.match(managementPage,/id="qrPayriffConnectivityStatus"/);
  assert.match(managementPage,/qr-order-admin\.js\?v=20261031-auto-refund6/);
  assert.doesNotMatch(paymentConnectivity,/method:'POST'|INSERT INTO|UPDATE qr_payment_intents/);
});
test('Payriff network probe distinguishes a fetch transport failure from an HTTP refusal',async()=>{
  const src=paymentConnectivity
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm,'')
    .replace(/\bexport\s+(?=async|function|const)/g,'');
  const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
  const output=(body,status=200)=>new Response(JSON.stringify(body),{status});
  const get=new Function('adminContext','response','bad','fail',
    'paymentSettingsScope','fetchPaymentSettings','decryptPaymentSecret',
    'hasPermission','fetch',src+';return onRequestGet;')(
    async()=>({restaurantId:'r1',state:{access:{isOwner:true,workspace:{id:'w1'}}}}),
    output,(status,code,message)=>output({success:false,code,message},status),fail,
    ctx=>({restaurantId:ctx.restaurantId,workspaceId:'w1'}),
    async()=>({environment:'development',secret_encrypted:'ciphertext'}),
    async()=> 'secret-never-in-response',()=>false,
    async()=>{const e=new TypeError('TLS problem with credential secret-never-in-response');
      e.cause={code:'ECONNRESET'};throw e}
  );
  const res=await get({request:new Request('https://'+testPreview+'/api/qr-menu/payment-connectivity'),env:{DB:{}}});
  assert.equal(res.status,200);
  const result=await res.json();
  assert.equal(result.reachedHttp,false);
  assert.equal(result.kind,'FETCH_TYPE_ERROR');
  assert.equal(result.causeCode,'ECONNRESET');
  assert.doesNotMatch(JSON.stringify(result),/secret-never-in-response|TLS problem/);
});
test('Automatic paid queue has activation cutoff and POS-driven refund is tenant-scoped at-most-once',async()=>{
  assert.match(core,/auto_enabled_at/);
  assert.match(adminApi,/auto_enabled_at=CASE/);
  assert.match(bridge,/INSERT OR IGNORE INTO qr_guest_orders/);
  assert.match(bridge,/pi.created_at>=s.auto_enabled_at/);
  assert.match(bridge,/pi.state='PAID_VERIFIED'/);
  assert.match(bridge,/pi.provider_order_id IS NOT NULL/);
  assert.match(bridge,/pi.total_minor=1/);
  assert.match(bridge,/requestPosPayriffRefund\(env,identity,body\)/);
  assert.match(bridge,/action==='ackClosed'/);
  assert.match(bridge,/action==='ackKitchen'/);
  assert.doesNotMatch(admin,/Передать оплаченный заказ на кассу|queueVerified/);
  assert.match(payriffRefund,/CREATE TABLE IF NOT EXISTS qr_payriff_refunds/);
  assert.match(payriffRefund,/UNIQUE\(intent_id,transaction_id\)/);
  assert.match(payriffRefund,/state='UNKNOWN'/);
  assert.match(payriffRefund,/api\/v3\/refund/);
  assert.match(payriffRefund,/X-REQUEST-RRN/);
  assert.doesNotMatch(payriffRefund,/Promise\.all\(.*refund/);
});
test('Payriff refund reuses the original POS transaction without a second provider POST',async()=>{
  const source=payriffRefund
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm,'')
    .replace(/\bexport\s+(?=async|function|const)/g,'');
  const fail=(code,message,status=400)=>Object.assign(new Error(message),{status,code});
  const item={
    id:'11111111-2222-4333-8444-555555555555',menu_id:'menu1',
    restaurant_id:'restaurant1',payment_intent_id:'intent1',payment_state:'PAID_ONLINE',
    payment_method:'PAYRIFF',total_minor:1,pos_order_id:'22222222-3333-4444-8555-666666666666',
    provider_order_id:'33333333-4444-4555-8666-777777777777',
    paid_state:'PAID_VERIFIED',workspace_id:'workspace1',
    merchant_id:'ES1093754',paid_minor:1
  };
  const tx='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const state={refund:null,providerCalls:0};
  const db={prepare(sql){
    return {
      run:async()=>({success:true}), // CREATE TABLE, no bind parameters
      bind:(...params)=>({
        first:async()=>{
          if(sql.includes('FROM qr_guest_orders o'))
            return params[1]==='restaurant1'&&params[2]==='plugin1'?item:null;
          if(sql.includes('SELECT * FROM qr_payriff_refunds'))return state.refund;
          if(sql.includes('COALESCE(SUM(amount_minor)'))return {
            reserved_minor:state.refund?state.refund.amount_minor:0,
            unknown_count:state.refund?.state==='UNKNOWN'?1:0
          };
          if(sql.includes('INSERT OR IGNORE INTO qr_payriff_refunds')){
            if(state.refund)return null;
            state.refund={id:params[0],intent_id:params[1],
              external_order_id:params[2],transaction_id:params[4],
              amount_minor:params[5],state:'UNKNOWN'};
            return {id:state.refund.id};
          }
          if(sql.includes('UPDATE qr_payriff_refunds')){
            state.refund.state='ACCEPTED';return{id:state.refund.id};
          }
          throw Error('Unexpected refund query: '+sql.slice(0,100));
        },
        run:async()=>({success:true})
      })
    };
  }};
  const crypto={randomUUID:()=> 'ffffffff-ffff-4fff-8fff-ffffffffffff'};
  const invoke=new Function('fail','fetchPaymentSettings','decryptPaymentSecret','fetch','crypto',
    source+';return requestPosPayriffRefund;')(
    fail,async()=>({merchant_id:'ES1093754',
      secret_encrypted:'encrypted',environment:'development'}),
    async()=> 'server-only-secret',
    async(url,options)=>{
      state.providerCalls++;
      assert.equal(options.method,'POST');
      assert.equal(url,'https://api.payriff.com/api/v3/refund');
      assert.equal(options.headers['X-REQUEST-RRN'],tx);
      assert.equal(options.headers.Authorization,'server-only-secret');
      assert.deepEqual(JSON.parse(options.body),{
        orderId:item.provider_order_id,amount:0.01,
        refundReason:'iikoFront QR payment return '+tx
      });
      return {ok:true,status:200,json:async()=>({code:'00000',responseId:'success123'})};
    },crypto
  );
  const args={externalOrderId:item.id,posOrderId:item.pos_order_id,
    transactionId:tx,amountMinor:1};
  const identity={departmentId:'restaurant1',pluginId:'plugin1'};
  let one=await invoke({DB:db},identity,args);
  assert.equal(one.refundAccepted,true);
  assert.equal(state.providerCalls,1);
  const duplicate=await invoke({DB:db},identity,args);
  assert.equal(duplicate.duplicate,true);
  assert.equal(state.providerCalls,1);
  await assert.rejects(invoke({DB:db},identity,{...args,amountMinor:2}),
    e=>e.code==='QR_REFUND_REPLAY_MISMATCH');
  await assert.rejects(invoke({DB:db},{...identity,departmentId:'other'},args),
    e=>e.code==='QR_REFUND_PAYMENT_UNVERIFIED');
  assert.equal(state.providerCalls,1);
});
test('One verified Payriff intent creates at most one tenant-scoped queued POS order',async()=>{
  const source=paidOrderQueue.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm,'')
    .replace(/\bexport\s+(?=async|function|const)/g,'');
  const restaurant='28a38f52-9b1b-01a7-019f-8455da3a0010';
  const plugin='0638669c-67e2-4f14-be2d-567404352a7c';
  const intentId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const tableId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const posId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  const productId='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  const intent={id:intentId,receipt_token:'e'.repeat(64),workspace_id:'workspace1',
    restaurant_id:restaurant,menu_id:'menu1',client_key:'client1',
    basket_digest:'digest',table_id:tableId,table_label:'Бар - Стол 1',
    pos_table_id:posId,items_json:JSON.stringify([{productId,qty:1,
      unitMinor:1,lineMinor:1}]),guest_note:'',total_minor:1,
    provider_order_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    state:'PAID_VERIFIED',currency:'AZN'};
  const cfg={owner_id:'owner1',restaurant_id:restaurant,
    pos_plugin_id:plugin,service_mode:'TABLE',ordering_enabled:1};
  const calls={inserts:0,events:0,query:0,policy:0};let stored=null;
  const ctx={ownerId:'owner1',restaurantId:restaurant,
    menu:{id:'menu1',public_slug:'menu-demo'},
    state:{access:{isOwner:true}}};
  const fail=(code,message,status=400)=>Object.assign(new Error(message),{code,status});
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
  const {onRequestPost}=new Function('adminContext','ensureOrders','settings',
    'response','bad','fail','clean','paymentSettingsScope',
    'fetchCheckoutPolicy','isLivePreview','requireTableSyncScope','crypto',
    source+';return {onRequestPost};')(
      async()=>ctx,async()=>{},
      async()=>cfg,json,(status,code,message)=>json({success:false,code,message},status),
      fail,(v,n=180)=>String(v??'').slice(0,n),
      ()=>({workspaceId:'workspace1',restaurantId:restaurant}),
      async()=>({live_preview_enabled:1}),row=>Number(row?.live_preview_enabled)===1,
      (request,env,identity)=>{
        assert.equal(new URL(request.url).hostname,testPreview);
        assert.equal(identity.departmentId,restaurant);
        assert.equal(identity.pluginId,plugin);
      },
      {randomUUID:()=> 'ffffffff-ffff-4fff-8fff-ffffffffffff'});
  const db={prepare(sql){
    return {bind:(...params)=>({
      first:async()=>{
        if(sql.includes('SELECT * FROM qr_payment_intents')){
          calls.query++;return params[0]===intentId?intent:null;
        }
        if(sql.includes('FROM qr_order_tables'))
          return {id:tableId,pos_table_id:posId,active:1};
        if(sql.includes('SELECT can_create_order'))
          return {can_create_order:1,last_seen_at:new Date().toISOString()};
        if(sql.includes('INSERT OR IGNORE INTO qr_guest_orders')){
          if(stored)return null;
          calls.inserts++;
          stored={id:params[0],state:'AWAITING_POS',total_minor:1,
            payment_state:'PAID_ONLINE',payment_method:'PAYRIFF'};
          return {id:stored.id};
        }
        if(sql.includes('SELECT * FROM qr_guest_orders'))
          return stored;
        throw Error('Unexpected SQL first: '+sql.slice(0,75));
      },
      run:async()=>{
        if(sql.includes('INSERT INTO qr_order_events')){calls.events++;return{success:true}};
        throw Error('Unexpected SQL run');
      }
    })};
  }};
  const req=()=>new Request('https://'+testPreview+'/api/qr-menu/paid-order-queue',{
    method:'POST',headers:{Origin:'https://'+testPreview,'Content-Type':'application/json'},
    body:JSON.stringify({action:'queueVerified',intentId,
      confirmCreate:true,expectedRestaurantId:restaurant})
  });
  let res=await onRequestPost({request:req(),env:{DB:db}});
  assert.equal(res.status,200,await res.clone().text());let body=await res.json();
  assert.equal(body.duplicate,false);
  assert.equal(body.order.state,'AWAITING_POS');
  assert.equal(calls.inserts,1);
  res=await onRequestPost({request:req(),env:{DB:db}});
  body=await res.json();
  assert.equal(res.status,200);assert.equal(body.duplicate,true);
  assert.equal(calls.inserts,1);assert.equal(calls.events,1);
  intent.state='UNKNOWN';stored=null;
  res=await onRequestPost({request:req(),env:{DB:db}});
  body=await res.json();assert.equal(res.status,409);
  assert.equal(body.code,'QR_PAID_QUEUE_NOT_VERIFIED');
  assert.equal(calls.inserts,1);
  intent.state='PAID_VERIFIED';
  ctx.state.access.isOwner=false;
  res=await onRequestPost({request:req(),env:{DB:db}});
  body=await res.json();assert.equal(res.status,403);
  assert.equal(body.code,'QR_PAID_QUEUE_OWNER_ONLY');
  assert.equal(calls.inserts,1);
  assert.match(bridge,/pi\.state='PAID_VERIFIED'/);
  assert.match(bridge,/pi\.provider_order_id IS NOT NULL/);
  assert.match(bridge,/paymentReference:paid\.provider_order_id/);
  assert.match(core,/idx_qr_one_order_per_paid_intent/);
  // The UI must never require a second manual dispatch click.
  assert.doesNotMatch(admin,/queueVerified|Передать оплаченный заказ на кассу/);
  assert.match(bridge,/INSERT OR IGNORE INTO qr_guest_orders/);
  assert.match(bridge,/pi.created_at>=s.auto_enabled_at/);
  assert.doesNotMatch(paidOrderQueue,/createPayriffCheckout|fetch\s*\(/);
});
test('Payriff previous-attempt history is scoped and never creates a new charge',()=>{
  assert.match(paymentAttempts,/adminContext\(request,env\)/);
  assert.match(paymentAttempts,/hasPermission\(ctx\?\.state\?\.access,'settings.manage'\)/);
  assert.match(paymentAttempts,/WHERE workspace_id=\?1 AND restaurant_id=\?2/);
  assert.match(paymentAttempts,/body.expectedRestaurantId!==scope.restaurantId/);
  assert.match(paymentAttempts,/readPayriffByReference/);
  assert.match(paymentAttempts,/last_checked_at/);
  assert.match(paymentAttempts,/lookupCode==='PAYRIFF_HTTP_400_CODE_01000'/);
  assert.match(paymentAttempts,/providerRequestRejected:providerRejected/);
  assert.match(paymentAttempts,/Это НЕ означает отмену оплаты/);
  assert.match(paymentAttempts,/sqlite_master/);
  assert.match(paymentAttempts,/storageReady:false/);
  assert.match(paymentAttempts,/storageReady:true/);
  assert.match(admin,/if\(!result.storageReady\)/);
  assert.match(admin,/if\(!items.length\)/);
  assert.match(admin,/if\(\$\('qrPaymentAttemptsPanel'\)\?\.open\)await loadPaymentAttempts\(\)/);
  assert.match(managementPage,/id="qrPayriffAttemptsMessage"/);
  assert.match(paymentAttempts,/PAID_VERIFIED/);
  assert.doesNotMatch(paymentAttempts,/createPayriffCheckout|POST \/api\/v3\/orders/);
  assert.match(managementPage,/id="qrPaymentAttemptsPanel"/);
  assert.match(admin,/loadPaymentAttempts/);
  assert.match(admin,/action:'reconcile'/);
  assert.match(guest,/sessionStorage\.setItem\(sandboxClientKeyKey\(\),sandboxKey\)/);
  assert.match(sandboxPayment,/UPDATE qr_payment_intents SET state='UNKNOWN'/);
});
test('Sandbox payment requires preview, scoped restaurant and owner activation, never POS',()=>{
  assert.match(sandboxPayment,/feature-qr-order-internal-co\.smarthoreca\.pages\.dev/);
  assert.match(sandboxPayment,/Number\(cfg\.enabled\)===1/);
  assert.match(sandboxPayment,/LIVE_PREVIEW_001/);
  assert.match(sandboxPayment,/qr_payment_menu_bindings/);
  assert.match(sandboxPayment,/qr_payment_provider_settings/);
  assert.match(sandboxPayment,/UNIQUE\(workspace_id,restaurant_id,menu_id,client_key\)/);
  assert.match(sandboxPayment,/createPayriffCheckout/);
  assert.match(sandboxPayment,/readPayriffPayment/);
  assert.match(sandboxPayment,/state='PAID_VERIFIED'|PAID_VERIFIED/);
  assert.match(paymentEndpoint,/action==='setTestCheckout'/);
  assert.match(paymentEndpoint,/PAYRIFF_TEST_PREVIEW_ONLY/);
  assert.match(admin,/toggleTestCheckout/);
  assert.match(managementPage,/qrPaymentToggleTest/);
  assert.match(managementPage,/qrPaymentQrOriginWarning/);
  assert.match(admin,/isPreviewQr/);
  assert.match(admin,/Копировать тестовую ссылку/);
  assert.match(guest,/explainSandboxAvailability/);
  assert.match(guest,/shqrPayriffAvailability/);
  assert.match(managementPage,/qrTestCheckoutReadiness/);
  assert.match(managementPage,/id="qrGuestPayCheck"/);
  assert.match(admin,/async function checkGuestCheckout\(\)/);
  assert.match(admin,/\$\('qrGuestPayCheck'\)\.onclick=checkGuestCheckout/);
  assert.match(admin,/cfg\.guestCheckoutReady/);
  assert.match(paymentEndpoint,/guestCheckoutReady/);
  assert.match(paymentEndpoint,/testQrScopeReady/);
  assert.match(paymentEndpoint,/binding\.workspace_id===scope\.workspaceId/);
  assert.match(menu,/qr-order-guest\.js\?v=20261031-payment-return3/);
  assert.match(guest,/submitSandboxPayment/);
  assert.match(guest,/sessionStorage\.setItem\(sandboxTicketKey\(\),sandboxTicket\)/);
  assert.match(paymentCallback,/readPayriffPayment/);
  assert.match(paymentCallback,/classifyPayriffPayment/);
});
test('Payriff return uses a visible page and verifies the existing ticket, never a new charge',async()=>{
  assert.match(sandboxPayment,/qr-payment-return\.html\?id=/);
  assert.match(sandboxPayment,/qrPaymentTicket=/);
  assert.match(sandboxPayment,/payment-callback\?qrPaymentTicket=/);
  assert.match(paymentReturn,/Проверяем оплату/);
  assert.match(paymentReturn,/fetch\('\/api\/qr-menu\/payment-checkout\?ticket=/);
  assert.match(paymentReturn,/paidVerified/);
  assert.match(paymentReturn,/Не оплачивайте повторно/);
  assert.doesNotMatch(paymentReturn,/method:\s*['"]POST['"]|location\.assign\(.*payriff/);
  // Regression: previously the client-key path returned a stale CHECKOUT
  // without ever calling Payriff's authoritative order lookup.
  assert.match(guest,/if\(sandboxTicket\)url\.searchParams\.set\('ticket',sandboxTicket\)/);
  const src=paymentCallback
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm,'')
    .replace(/\bexport\s+(?=async|function|const)/g,'');
  const get=new Function(src+';return onRequestGet;')();
  const opaque='a'.repeat(64);
  const request=new Request('https://qr-preview.example/api/qr-menu/payment-callback?qrPaymentTicket='+
    opaque+'&id=menu-1&table=bar-1');
  const r=await get({request});
  assert.equal(r.status,303);
  assert.match(r.headers.get('location'),/qr-payment-return\.html/);
  assert.match(r.headers.get('location'),/qrPaymentTicket=/);
  assert.equal(r.headers.get('Cache-Control'),'no-store');
  assert.equal(r.headers.get('Referrer-Policy'),'no-referrer');
  assert.match(paymentCallback,/request\.headers\.get\('Accept'\)\?\.includes\('text\/html'\)/);
  assert.match(paymentReturn,/shqr_return_ticket:/);
  assert.doesNotMatch(paymentCallback,/INSERT INTO qr_guest_orders|createPayriffCheckout/);
});
test('Payriff webhook is untrusted and can only reconcile an existing paid order',async()=>{
  const src=paymentCallback.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];\s*$/gm,'')
    .replace(/\bexport\s+(?=async|function|const)/g,'');
  const calls={lookups:0,updates:0,provider:0},ticket='b'.repeat(64);
  const intent={
    id:'11111111-2222-4333-8444-555555555555',
    receipt_token:ticket,state:'CHECKOUT',provider_order_id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    merchant_id:'ES1093754',workspace_id:'w1',restaurant_id:'r1',total_minor:1
  };
  const post=new Function('fetchPaymentSettings','decryptPaymentSecret',
    'readPayriffPayment','classifyPayriffPayment',src+';return onRequestPost;')(
    async()=>({merchant_id:'ES1093754',environment:'development',secret_encrypted:'server-cipher'}),
    async()=> 'server-secret',
    async({secret,orderId})=>{calls.provider++;
      assert.equal(secret,'server-secret');
      assert.equal(orderId,intent.provider_order_id);
      return {orderId,amount:0.01,currencyType:'AZN',operationType:'PURCHASE',paymentStatus:'APPROVED'};
    },
    (data,{orderId,amountMinor})=>{
      assert.equal(data.orderId,orderId);assert.equal(amountMinor,1);
      return data.paymentStatus==='APPROVED'?'PAID_VERIFIED':'PENDING';
    }
  );
  const env={DB:{prepare(sql){
    if(sql.includes('SELECT * FROM qr_payment_intents'))return {bind:secret=>{
      assert.equal(secret,ticket);return {first:async()=>{calls.lookups++;return intent;}};
    }};
    if(sql.includes('UPDATE qr_payment_intents'))return {bind:(state)=>{
      assert.equal(state,'PAID_VERIFIED');
      return {run:async()=>{calls.updates++;return{meta:{changes:1}}}};
    }};
    throw Error('Unexpected SQL');
  }}};
  let r=await post({request:new Request('https://preview.example/api/qr-menu/payment-callback'),env});
  assert.equal((await r.json()).verified,false);
  assert.equal(calls.provider,0);
  r=await post({request:new Request('https://preview.example/api/qr-menu/payment-callback?qrPaymentTicket='+
    ticket,{method:'POST'}),env});
  assert.equal((await r.json()).verified,true);
  assert.equal(calls.provider,1);
  assert.equal(calls.updates,1);
  assert.doesNotMatch(paymentCallback,/createPayriffCheckout|INSERT INTO qr_guest_orders/);
});
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
  assert.doesNotMatch(guest,/cardNumber|cardCVV|cardExpiry/);
  assert.match(sandboxPayment,/paidVerified/);
  assert.match(sandboxPayment,/No public menu lookup|loadScope/);
  assert.match(sandboxPayment,/qr_payment_intents/);
  assert.match(sandboxPayment,/state='CREATING'/);
  assert.match(sandboxPayment,/state='UNKNOWN'/);
  assert.match(sandboxPayment,/orderSettings.owner_id!==binding.owner_id/);
  assert.doesNotMatch(sandboxPayment,/INSERT INTO qr_guest_orders|ackCreated|ackKitchen/);
  assert.match(paymentCallback,/UPDATE qr_payment_intents/);
  assert.doesNotMatch(paymentCallback,/INSERT INTO qr_guest_orders|createPayriffCheckout/);
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
  assert.match(adminApi,/isLivePreview\(policy\)/);
  assert.match(bridge,/WHERE o.restaurant_id=\?3 AND o.payment_state='PAID_ONLINE'/);
  assert.match(bridge,/AND o.payment_method='PAYRIFF'/);
  assert.match(bridge,/QR_POS_UNPAID_ACK_FORBIDDEN/);
  assert.match(adminApi,/QR_PAID_MODE_DISABLED/);
  assert.match(bridge,/pi\.state='PAID_VERIFIED'/);
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
  assert.match(bridge,/body\.canPrintKitchen===true&&!canCreate/);
  assert.match(publicApi,/can_print_kitchen=1/);
  assert.match(adminApi,/kitchenPrintReady:kitchenReady/);
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
        can_create_order:params[2],can_ack_fiscal:0,can_print_kitchen:params[3],last_seen_at:params[4]
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
  const env={QR_POS_BRIDGE_TOKEN:'test-secret',...sharedConfig,DB:mockedDB};
  async function send(action,options={},secret='test-secret'){
    const request=new Request('https://'+testPreview+'/api/qr-menu/pos-bridge',{
      method:'POST',headers:{'Content-Type':'application/json','X-QR-Bridge-Token':secret},
      body:JSON.stringify({action,pluginId:testPlugin,departmentId:testRestaurant,...options})
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
  assert.equal(inconsistent.body.code,'QR_PAID_MODE_DISABLED');
  const full=await send('hello',{
    contractVersion:1,canCreateOrder:true,canAcknowledgeFiscal:true,canPrintKitchen:true
  });
  assert.equal(full.status,409);
  assert.equal(full.body.code,'QR_PAID_MODE_DISABLED');
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
  assert.match(admin,/\$\('qrOrderEnabled'\)\.disabled=true/);
  assert.match(admin,/Приём QR-заказов запрещён до подтверждённой онлайн-оплаты Payriff/);
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
  assert.match(managementPage,/id="qrPaymentPanel"/);
  assert.match(admin,/loadPaymentSettings/);
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
test('Shared D1 POS allows only an allowlisted plugin and blocks pull without readiness',async()=>{
  const source=bridge.replace(/^import .*;\s*$/gm,'').replace(/\bexport\s+(?=async|function|const)/g,'');
  const {onRequestPost}=new Function('ensureOrders','response','bad','fail','clean','verifyPluginIngress',
    'requireTableSyncScope','isSharedD1Test','verifyRegisteredQrPos',source+';return{onRequestPost};')(
    async()=>{},
    (v,status=200)=>new Response(JSON.stringify(v),{status}),
    (status,code,message)=>new Response(JSON.stringify({success:false,code,message}),{status}),
    failed,cleanValue,async()=>({verified:true}),requireTableSyncScope,isSharedD1Test,
    async()=>({verified:true})
  );
  const base={pluginId:testPlugin,departmentId:testRestaurant};
  async function send(body){
    const request=new Request('https://'+testPreview+'/api/qr-menu/pos-bridge',{
      method:'POST',headers:{'X-QR-Bridge-Token':'secret'},body:JSON.stringify({...base,...body})
    });
    const res=await onRequestPost({request,env:{
      ...sharedConfig,QR_POS_BRIDGE_TOKEN:'secret',DB:{
        prepare(sql){
          if(sql.includes('FROM qr_pos_bridge_capabilities')||
              sql.includes('FROM qr_payment_checkout_policy'))
            return{bind:()=>({first:async()=>null})};
          throw new Error('Unexpected database access for unready POS');
        }
      }
    }});
    return{status:res.status,body:await res.json()};
  }
  const pull=await send({action:'pull'});
  assert.equal(pull.status,409);
  assert.equal(pull.body.code,'QR_POS_NOT_READY');
  const fullHello=await send({action:'hello',contractVersion:1,
    canCreateOrder:true,canAcknowledgeFiscal:true,canPrintKitchen:true});
  assert.equal(fullHello.status,409);
  assert.equal(fullHello.body.code,'QR_PAID_MODE_DISABLED');
  const created=await send({action:'ackCreated',externalOrderId:'fake'});
  assert.equal(created.status,400);
  assert.equal(created.body.code,'POS_ACK_REQUIRED');
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
  assert.match(managementPage,/qr-order-admin\.js\?v=20261031-auto-refund6/);
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
  assert.match(bridge,/requireTableSyncScope\(request,env,identity\)/);
  assert.match(adminApi,/singleKeyDiagnosticMode:isSharedD1Test\(env\)/);
});
