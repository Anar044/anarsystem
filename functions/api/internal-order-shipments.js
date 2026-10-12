// Controlled cross-RMS outgoingInvoice trial on the dedicated test branch.
// Outgoing may affect stock; linked incoming must be verified separately.
// Never replay an outgoing whose result is unknown.
import {getUser,loadPrivateIikoState,privateConnection,hasPrivateConnection} from "./iiko/_lib/user-state.js";
import {restaurantDirectory} from "./iiko/_lib/restaurant-scope.js";
import {resolveAccessForUser,hasPermission,requirePermission} from "./access/_lib/access-control.js";
import {serverScopeFromConnection,logAuditEvent} from "./_lib/audit-log.js";
import {iikoText,iikoJson} from "./iiko/_lib/iiko-client.js";
import {resolveStoreScope} from "./iiko/_lib/store-scope.js";
import {warehouseCostRows,costQuote} from "./_lib/internal-shipment-cost.js";
import {inspectOutgoingForOrder} from "./_lib/internal-order-invoice.js";
import {findOutgoingInvoices} from "./_lib/internal-order-iiko-lookup.js";
import {prepareInternalShipment,shipmentXml,parseIikoValidation} from "./_lib/internal-shipment-core.js";
import {canAccessInternalOrder} from "./_lib/internal-order-core.js";
import {isIikoRestApiLicenseError,IIKO_REST_API_LICENSE_MESSAGE} from "./_lib/internal-order-license.js";
import {assessInternalShipmentRoute} from "./_lib/internal-order-route.js";
import {previewConfirmedInternalRoute} from "./_lib/internal-order-route-preview.js";
import {extractIikoInvoiceSummaries,compareIikoInvoicePair,identifyIikoPairCounteragents,validatedPairWarehouseMapping} from "./_lib/internal-order-pair-probe.js";
import {getIikoSuppliers} from "./iiko/_lib/iiko-suppliers.js";
import {findLinkedIncomingInvoices} from "./_lib/internal-order-incoming-lookup.js";
import {validateShipmentOutgoingForReceipt} from "./_lib/internal-order-receipt-check.js";
import {buildInternalDispatchPreview} from "./_lib/internal-order-dispatch-preview.js";
import {validateInternalAccountCodes} from "./_lib/internal-order-account-codes.js";

const H={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type,Authorization","Access-Control-Allow-Methods":"GET,POST,OPTIONS"};
const str=v=>String(v??"").trim();
const id=v=>str(v).replace(/^\{+|\}+$/g,"").toLowerCase();
const json=(x,code=200)=>new Response(JSON.stringify(x),{status:code,headers:H});
const err=(msg,status=400)=>Object.assign(new Error(msg),{status});
const parse=(s,f=[])=>{try{return JSON.parse(s)||f}catch{return f}};
async function ensure(db){
  if(!db)throw err("D1 недоступна.",503);
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS sh_internal_order_shipments (id TEXT PRIMARY KEY,server_scope TEXT NOT NULL,order_id TEXT NOT NULL,number TEXT NOT NULL,iiko_document_id TEXT NOT NULL,status TEXT NOT NULL,source_store_id TEXT NOT NULL,destination_store_id TEXT NOT NULL,counteragent_id TEXT NOT NULL,document_date TEXT NOT NULL,account_to_code TEXT NOT NULL DEFAULT '',revenue_account_code TEXT NOT NULL DEFAULT '',lines_json TEXT NOT NULL,total_cents INTEGER NOT NULL,created_at TEXT NOT NULL,created_by TEXT NOT NULL,updated_at TEXT NOT NULL,iiko_document_number TEXT NOT NULL DEFAULT '',iiko_status TEXT NOT NULL DEFAULT '',error_text TEXT NOT NULL DEFAULT '')"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_internal_shipment_number ON sh_internal_order_shipments(server_scope,number)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_internal_shipment_order ON sh_internal_order_shipments(server_scope,order_id,created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS sh_internal_order_warehouse_counterparties (server_scope TEXT NOT NULL,source_store_id TEXT NOT NULL,destination_store_id TEXT NOT NULL,outgoing_buyer_id TEXT NOT NULL,outgoing_buyer_name TEXT NOT NULL,incoming_supplier_id TEXT NOT NULL,incoming_supplier_name TEXT NOT NULL,evidence_outgoing_id TEXT NOT NULL,evidence_incoming_id TEXT NOT NULL,evidence_outgoing_number TEXT NOT NULL,evidence_incoming_number TEXT NOT NULL,confirmed_by TEXT NOT NULL,confirmed_at TEXT NOT NULL,PRIMARY KEY(server_scope,source_store_id,destination_store_id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS sh_internal_order_account_settings (server_scope TEXT PRIMARY KEY,revenue_account_code TEXT NOT NULL DEFAULT '',expense_account_code TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,updated_by TEXT NOT NULL)")
  ]);
}
function visible(o,c){
  return canAccessInternalOrder(o,c.allowed.map(x=>x.id),{
    request:hasPermission(c.access,"procurement.internal.request"),
    fulfill:hasPermission(c.access,"procurement.internal.fulfill"),
    configure:hasPermission(c.access,"procurement.internal.configure")
  });
}
function shipper(o,c){return hasPermission(c.access,"procurement.internal.fulfill")&&c.allowed.some(x=>id(x.id)===id(o.central_department_id))}
async function ctx(request,env){
  const auth=await getUser(request,env);if(!auth)throw err("Необходима авторизация.",401);
  const access=await resolveAccessForUser(env.DB,auth.user,{claimInvite:true,request});if(!access?.allowed)throw err("Доступ запрещён.",403);
  const stored=await loadPrivateIikoState(env.DB,access.storageUserId||access.ownerUserId||auth.user.id,env);
  if(!stored?.found||!hasPrivateConnection(stored.state))throw err("Подключите Smart Horeca Server.",409);
  const conn=privateConnection(stored.state),scope=await serverScopeFromConnection(conn);
  if(!scope)throw err("Контур сервера не определён.",409);
  const dep=restaurantDirectory(stored.state),a=access.scope;
  const allowed=access.isOwner||a?.mode!=="SELECTED"?dep:dep.filter(x=>(a.departmentIds||[]).some(y=>id(y)===id(x.id))||(a.departmentCodes||[]).includes(x.code));
  await ensure(env.DB);
  return {auth,access,connection:conn,scope,allowed,env,request};
}
async function order(c,orderId){
  const o=await c.env.DB.prepare("SELECT * FROM sh_internal_orders WHERE server_scope=?1 AND id=?2").bind(c.scope,str(orderId)).first();
  if(!o)throw err("Заказ не найден.",404);
  if(!visible(o,c))throw err("Заказ другого RMS недоступен.",403);
  return o;
}
async function rows(c,orderId){
  return (await c.env.DB.prepare("SELECT * FROM sh_internal_order_shipments WHERE server_scope=?1 AND order_id=?2 ORDER BY created_at,number").bind(c.scope,orderId).all()).results||[];
}
const expose=s=>({id:s.id,number:s.number,status:s.status,documentDate:s.document_date,sourceStoreId:s.source_store_id,destinationStoreId:s.destination_store_id,counteragentId:s.counteragent_id,accountToCode:s.account_to_code,revenueAccountCode:s.revenue_account_code,lines:parse(s.lines_json),totalCents:s.total_cents,iikoDocumentId:s.iiko_document_id,iikoDocumentNumber:s.iiko_document_number,iikoStatus:s.iiko_status,error:s.error_text,createdAt:s.created_at,updatedAt:s.updated_at});
// This is a configuration of CODE identifiers, not a replacement of iiko chart
// of accounts. Empty pair preserves the server's default account mapping.
async function accountSettings(c){
  const row=await c.env.DB.prepare("SELECT revenue_account_code,expense_account_code,updated_at FROM sh_internal_order_account_settings WHERE server_scope=?1")
    .bind(c.scope).first();
  return {revenueAccountCode:str(row?.revenue_account_code),expenseAccountCode:str(row?.expense_account_code),
    updatedAt:str(row?.updated_at),usesIikoDefaults:!row||(!row.revenue_account_code&&!row.expense_account_code)};
}

async function audit(c,action,o,s,info){
  await logAuditEvent({request:c.request,env:c.env,connection:c.connection,action,entityType:"INTERNAL_SHIPMENT",entityId:s.id,entityLabel:s.number,documentNumber:s.number,restaurantIds:[o.central_department_id,o.destination_department_id],restaurantNames:[o.central_department_name,o.destination_department_name],before:null,after:info});
}
async function shipment(c,o,shipmentId){
  const s=await c.env.DB.prepare("SELECT * FROM sh_internal_order_shipments WHERE server_scope=?1 AND order_id=?2 AND id=?3").bind(c.scope,o.id,str(shipmentId)).first();
  if(!s)throw err("Отгрузка не найдена.",404);
  return s;
}
async function setShipStatus(c,s,from,to,extra={}){
  const time=new Date().toISOString();
  const r=await c.env.DB.prepare("UPDATE sh_internal_order_shipments SET status=?1,updated_at=?2,iiko_document_number=?3,iiko_status=?4,error_text=?5 WHERE server_scope=?6 AND id=?7 AND status=?8")
    .bind(to,time,str(extra.iikoDocumentNumber??s.iiko_document_number),str(extra.iikoStatus??s.iiko_status),str(extra.error??""),c.scope,s.id,from).run();
  if(Number(r.meta?.changes||0)!==1)throw err("Отгрузка была изменена другим пользователем. Обновите страницу.",409);
}
async function verifyRouteWarehouses(c,o){
  const [source,destination]=await Promise.all([
    resolveStoreScope(c.connection,[o.central_department_id]),
    resolveStoreScope(c.connection,[o.destination_department_id])
  ]);
  if(!source.resolved||!source.storeIds.some(x=>id(x)===id(o.central_store_id)))throw err("Склад отправителя не подтверждён в структуре iikoChain.",409);
  if(!destination.resolved||!destination.storeIds.some(x=>id(x)===id(o.destination_store_id)))throw err("Склад-покупатель RMS не подтверждён в структуре iikoChain.",409);
}
async function getWarehouseQuote(c,o,date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date+"T00:00:00Z")))throw err("Укажите корректную дату накладной.",400);
  const today=new Date().toISOString().slice(0,10);
  if(date>today)throw err("Нельзя подготовить отгрузку будущей датой: себестоимость ещё не рассчитана.",409);
  await verifyRouteWarehouses(c,o);
  const q=new URLSearchParams({timestamp:date+"T23:59:59",store:id(o.central_store_id)});
  q.append("department",id(o.central_department_id));
  const res=await iikoJson(c.connection,"/resto/api/v2/reports/balance/stores?"+q,{timeoutMs:30000});
  if(!res.ok||!res.payload)throw err("iikoChain не вернул себестоимость склада отправителя: HTTP "+res.status,502);
  const approved=parse(o.approved_lines_json,[]);
  const rows=warehouseCostRows(res.payload,o.central_store_id,approved.map(x=>x.productId));
  return {quotes:costQuote(approved,rows,date),timestamp:date+"T23:59:59",storeId:o.central_store_id,source:"/resto/api/v2/reports/balance/stores"};
}
async function outgoingLookup(c,s){
  const found=await findOutgoingInvoices(c.connection,s.iiko_document_number||s.number,s.document_date);
  if(!found.checked)throw err("iiko не подтвердил результат поиска накладной. Попробуйте позже; повторная отправка заблокирована.",502);
  const docs=found.documents;
  const lines=parse(s.lines_json);
  const v=inspectOutgoingForOrder({sourceStoreId:s.source_store_id,approvedLines:lines.map(l=>({productId:l.productId,quantity:l.amount}))},docs,s.iiko_document_number||s.number);
  if(v.valid){
    if(!v.quantityMatched)throw err("В документе iiko не совпадают количества сохранённой отгрузки.",409);
    if(id(v.documentId)!==id(s.iiko_document_id))throw err("Номер совпал с другим документом iiko (ID отличается). Требуется ручная проверка.",409);
    if(id(v.counteragentId)!==id(s.counteragent_id))throw err("Контрагент расходной отличается от выбранного в заказе.",409);
    const found=docs.find(x=>id(x.id)===id(s.iiko_document_id));
    const stored=new Map(lines.map(l=>[id(l.productId),l]));
    for(const item of found?.items||[]){
      const itemPrice=Number(item.price),expected=Number(stored.get(id(item.productId))?.unitPrice);
      if(!Number.isFinite(itemPrice)||Math.abs(itemPrice-expected)>0.009)throw err("Отпускная цена в расходной iiko отличается от подготовленной. Исправьте документ перед подтверждением.",409);
      const expectedSum=Number(stored.get(id(item.productId))?.sumCents||0)/100;
      if(!Number.isFinite(Number(item.sum))||Math.abs(Number(item.sum)-expectedSum)>0.015)throw err("Сумма строки расходной iiko отличается от подготовленной.",409);
    }
  }
  return v;
}
// A single operator click creates and POSTS one outgoing invoice in iiko.
// All checks are server-side. A known/unknown existing iiko write is never replayed.
// iikoChain UI permits a receiving STORE as invoice buyer, but this
// installation's /documents/import/outgoingInvoice REST importer casts
// counteragentId to resto.front.User and throws ClassCastException for STORE.
// Never substitute an unrelated legal person or submit that invalid XML.
async function assertSupportedIikoShipmentRoute(c,order){
  const mapping=await c.env.DB.prepare("SELECT * FROM sh_internal_order_warehouse_counterparties WHERE server_scope=?1 AND source_store_id=?2 AND destination_store_id=?3")
    .bind(c.scope,id(order.central_store_id),id(order.destination_store_id)).first();
  const route=assessInternalShipmentRoute(order,{mapping,host:new URL(c.request.url).hostname});
  if(!route.supported)throw err(route.message,409);
  return mapping;
}
// This is NOT authorization to post. The independent route gate remains closed.
// When a vendor-confirmed shipment transport is available, never fall back
// from a confirmed supplier/User counterparty to the receiving Store ID.
async function verifiedBuyerId(c,o){
  const mapping=await c.env.DB.prepare("SELECT * FROM sh_internal_order_warehouse_counterparties WHERE server_scope=?1 AND source_store_id=?2 AND destination_store_id=?3")
    .bind(c.scope,id(o.central_store_id),id(o.destination_store_id)).first();
  if(!mapping)throw err("Для выбранной пары складов не сохранён подтверждённый внутренний контрагент.",409);
  await verifyRouteWarehouses(c,o);
  const suppliers=await getIikoSuppliers(c.connection);
  if(suppliers.status!==200||!suppliers.rows?.length)throw err("Не удалось проверить внутреннего контрагента по справочнику iiko.",502);
  const preview=previewConfirmedInternalRoute(o,mapping,suppliers.rows);
  if(!preview.valid)throw err(preview.message,409);
  return preview.outgoing.counteragentId;
}
async function dispatchShipment(c,o,s){
  await assertSupportedIikoShipmentRoute(c,o);
  if(o.status!=="READY")throw err("Заказ уже не готов к отгрузке.",409);
  if(s.status!=="PREPARED")throw err("Эта отгрузка уже передавалась в iiko. Повторная отправка запрещена.",409);
  await verifyRouteWarehouses(c,o);
  if(id(s.counteragent_id)!==id(await verifiedBuyerId(c,o)))throw err("Покупатель расходной не совпадает с подтверждённым внутренним контрагентом RMS-получателя.",409);
  const lines=parse(s.lines_json,[]);
  if(lines.some(l=>l.costSource!=="iikoChain warehouse balance"||!l.costTimestamp))
    throw err("Нельзя отгрузить документ с неподтверждённой себестоимостью.",409);
  const found=await findOutgoingInvoices(c.connection,s.number,s.document_date);
  if(!found.checked)throw err("iiko не подтвердил отсутствие такой накладной. Отгрузка не отправлялась, попробуйте позже.",502);
  if(found.documents.length)throw err("Накладная "+s.number+" уже существует в iiko. Отправка повторно запрещена.",409);
  await setShipStatus(c,s,"PREPARED","PROCESSING");
  const xml=shipmentXml({id:s.iiko_document_id,number:s.number,date:s.document_date,
    storeId:s.source_store_id,counteragentId:s.counteragent_id,
    accountToCode:s.account_to_code,revenueAccountCode:s.revenue_account_code,
    comment:"Smart Horeca internal order "+o.number+" → "+o.destination_department_name,
    lines,status:"PROCESSED"});
  try{
    const response=await iikoText(c.connection,"/resto/api/documents/import/outgoingInvoice",{
      method:"POST",headers:{"Content-Type":"application/xml; charset=utf-8",Accept:"application/xml,text/xml,*/*"},
      body:xml,timeoutMs:60000
    });
    const val=parseIikoValidation(response.text);
    if(!response.ok||["false","0","no"].includes(str(val.valid).toLowerCase())||(!val.valid&&val.errorMessage)){
      const errorText=str(val.errorMessage||val.additionalInfo||
        response.text.replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim()).slice(0,240);
      await setShipStatus(c,s,"PROCESSING","CHECK_REQUIRED",{error:"iiko HTTP "+response.status+": "+errorText});
      return {success:false,code:"IIKO_RESULT_UNKNOWN",message:"iiko не подтвердил отгрузку (HTTP "+response.status+"). Повторное списание заблокировано. Система проверит документ "+s.number+".",status:"CHECK_REQUIRED"};
    }
    let verification;
    try{verification=await outgoingLookup(c,s)}catch(e){verification={valid:false,message:str(e.message)}}
    if(!verification.valid||!verification.processed){
      await setShipStatus(c,s,"PROCESSING","CHECK_REQUIRED",{error:"iiko принял запрос, но проведение не подтверждено: "+str(verification.message)});
      return {success:false,code:"IIKO_RESULT_UNKNOWN",message:"Запрос отправлен в iiko, но проведение пока не подтверждено. Повторная отгрузка заблокирована.",status:"CHECK_REQUIRED"};
    }
    await setShipStatus(c,s,"PROCESSING","IIKO_PROCESSED",{iikoDocumentNumber:verification.documentNumber,iikoStatus:verification.status});
    try{await audit(c,"PROCESS_IIKO",o,s,{iikoDocumentId:verification.documentId,sourceStoreId:s.source_store_id,destinationStoreId:s.destination_store_id,linkedIncomingVerified:false})}
    catch(e){console.error("Internal order shipment audit",str(e?.message||e))}
    return {success:true,status:"IIKO_PROCESSED",documentNumber:s.number,shipmentId:s.id,
      outgoingPosted:true,linkedIncomingVerified:false,
      message:"Расходная №"+s.number+" проведена в iiko. Теперь проверяем связанную приходную у получателя. Не отправляйте повторно."};
  }catch(e){
    // Once processing was attempted, the remote outcome may be unknown.
    // Never POST again automatically or expose a retry button.
    try{await setShipStatus(c,s,"PROCESSING","CHECK_REQUIRED",{error:str(e.message).slice(0,700)})}
    catch(f){console.error("Shipment uncertain transition",str(f?.message||f))}
    return {success:false,code:"IIKO_RESULT_UNKNOWN",message:"Связь с iiko прервалась. Состояние отгрузки неизвестно; повторная отправка заблокирована до проверки.",status:"CHECK_REQUIRED"};
  }
}
export async function onRequestOptions(){return new Response(null,{status:204,headers:H})}
export async function onRequestGet({request,env}){
  try{
    const c=await ctx(request,env),orderId=new URL(request.url).searchParams.get("orderId");
    if(new URL(request.url).searchParams.get("settings")==="accounts"){
      requirePermission(c.access,"procurement.internal.configure");
      return json({success:true,settings:await accountSettings(c)});
    }
    const o=await order(c,orderId);
    const list=await rows(c,o.id);
    const totals=Object.fromEntries(parse(o.approved_lines_json).map(x=>[id(x.productId),{productId:x.productId,approved:Number(x.quantity),reserved:0}]));
    for(const s of list)if(s.status!=="CANCELLED")for(const l of parse(s.lines_json)){const t=totals[id(l.productId)];if(t)t.reserved+=Number(l.amount)}
    // Show the specifically confirmed buyer mapping for this
    // exact pair of source and destination warehouses. Never derive it
    // from RMS display names or client-supplied IDs.
    const mapped=await c.env.DB.prepare("SELECT source_store_id,destination_store_id,outgoing_buyer_id,outgoing_buyer_name,incoming_supplier_id,incoming_supplier_name,evidence_outgoing_id,evidence_incoming_id,evidence_outgoing_number,evidence_incoming_number,confirmed_at FROM sh_internal_order_warehouse_counterparties WHERE server_scope=?1 AND source_store_id=?2 AND destination_store_id=?3")
      .bind(c.scope,id(o.central_store_id),id(o.destination_store_id)).first();
    const route=assessInternalShipmentRoute(o,{mapping:mapped,host:new URL(request.url).hostname});
    const oldUncertain=list.some(s=>["CHECK_REQUIRED","IMPORTING","PROCESSING"].includes(s.status));
    const verifiedMapping=mapped?{
      sourceStoreId:mapped.source_store_id,destinationStoreId:mapped.destination_store_id,
      outgoingBuyerId:mapped.outgoing_buyer_id,outgoingBuyerName:mapped.outgoing_buyer_name,
      incomingSupplierId:mapped.incoming_supplier_id,incomingSupplierName:mapped.incoming_supplier_name,
      evidenceOutgoingNumber:mapped.evidence_outgoing_number,evidenceIncomingNumber:mapped.evidence_incoming_number,
      confirmedAt:mapped.confirmed_at
    }:null;
    return json({success:true,shipments:list.map(expose),remaining:Object.values(totals).map(x=>({...x,remaining:Math.max(0,Math.round((x.approved-x.reserved)*1000)/1000)})),canFulfill:shipper(o,c),
      canDispatch:shipper(o,c)&&route.supported&&!oldUncertain,
      dispatchBlockedReason:oldUncertain?"По этой заявке есть расходная с неподтверждённым результатом iiko. Новая отгрузка запрещена до сверки.":route.supported?"":route.message,
      dispatchBlockCode:oldUncertain?"PREVIOUS_SHIPMENT_UNCERTAIN":route.supported?"":route.code,
      confirmedReceiverMapping:verifiedMapping,testRouteEnabled:route.supported,requiresIntegrationValidation:!route.supported});
  }catch(e){
    if(isIikoRestApiLicenseError(e))return json({success:false,code:"IIKO_REST_API_LICENSE",message:IIKO_REST_API_LICENSE_MESSAGE},503);
    return json({success:false,message:e.message},e.status||500);
  }
}
// Read-only: admin can compare real successful iikoChain outgoing/incoming pair.
async function exportIikoPairExample(c,kind,documentNumber,day){
  const dd=day.slice(8,10)+"."+day.slice(5,7)+"."+day.slice(0,4);
  const attempts=[];
  for(const d of [day,dd]){
    const params=new URLSearchParams({from:d,to:d});
    const path="/resto/api/documents/export/"+(kind==="outgoing"?"outgoingInvoice":"incomingInvoice")+"?"+params;
    let res;
    try{res=await iikoText(c.connection,path,{headers:{Accept:"application/xml,text/xml,*/*"},timeoutMs:30000})}
    catch(e){attempts.push({dateFormat:d,httpStatus:null,error:str(e.message).slice(0,100)});continue}
    const rows=res.ok?extractIikoInvoiceSummaries(res.text,kind):[];
    const found=rows.filter(x=>str(x.number).toLowerCase()===str(documentNumber).toLowerCase());
    attempts.push({dateFormat:d,httpStatus:res.status,totalDocuments:rows.length,matchingDocuments:found.length});
    if(found.length===1)return {document:found[0],attempts,found:true};
    if(found.length>1)return {document:null,attempts,found:false,ambiguous:true};
  }
  return {document:null,found:false,attempts};
}
export async function onRequestPost({request,env}){
  try{
    const body=await request.json().catch(()=>({})),c=await ctx(request,env),action=str(body.action);
    if(action==="save-account-settings"){
      requirePermission(c.access,"procurement.internal.configure");
      const checked=validateInternalAccountCodes(body);
      if(!checked.valid)throw err(checked.message,400);
      const {revenueAccountCode,expenseAccountCode}=checked;
      const now=new Date().toISOString();
      await c.env.DB.prepare("INSERT INTO sh_internal_order_account_settings (server_scope,revenue_account_code,expense_account_code,updated_at,updated_by) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(server_scope) DO UPDATE SET revenue_account_code=excluded.revenue_account_code,expense_account_code=excluded.expense_account_code,updated_at=excluded.updated_at,updated_by=excluded.updated_by")
        .bind(c.scope,revenueAccountCode,expenseAccountCode,now,str(c.auth.user.id)).run();
      try{await logAuditEvent({request:c.request,env:c.env,connection:c.connection,action:"INTERNAL_SHIPMENT_ACCOUNT_SETTINGS",entityType:"INTERNAL_SETTINGS",entityId:c.scope,entityLabel:"Счета внутренних заказов",before:null,after:{revenueAccountCode,expenseAccountCode}})}
      catch(e){console.error("Internal order account settings audit failed",str(e?.message||e))}
      return json({success:true,settings:await accountSettings(c),
        message:"Счета сохранены для будущих расходных накладных в текущем серверном контуре. Уже проведённые документы не изменены."});
    }
    if(action==="diagnose-pair"){
      requirePermission(c.access,"procurement.internal.configure");
      const day=str(body.documentDate),outgoingNumber=str(body.outgoingNumber),incomingNumber=str(body.incomingNumber);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!outgoingNumber||!incomingNumber||outgoingNumber.length>60||incomingNumber.length>60)
        throw err("Укажите дату и номера двух проведённых накладных iiko.",400);
      const outgoing=await exportIikoPairExample(c,"outgoing",outgoingNumber,day);
      const incoming=await exportIikoPairExample(c,"incoming",incomingNumber,day);
      let referenceRows=[],supplierLookupStatus="not-requested",supplierLookupError="";
      if(outgoing.document&&incoming.document){
        try{
          const supplierResult=await getIikoSuppliers(c.connection);
          referenceRows=supplierResult.rows||[];
          supplierLookupStatus=supplierResult.status===200?"ok":"HTTP "+supplierResult.status;
        }catch(e){
          supplierLookupStatus="error";
          supplierLookupError=str(e?.message||e).slice(0,160);
        }
      }
      return json({success:true,readOnly:true,from:"iikoChain REST export",outgoing,incoming,
        comparison:compareIikoInvoicePair(outgoing.document,incoming.document),
        mappingCandidate:validatedPairWarehouseMapping(outgoing.document,incoming.document,referenceRows),
        supplierReferences:{
          ...identifyIikoPairCounteragents(outgoing.document,incoming.document,referenceRows),
          supplierLookupStatus,supplierLookupError,
          supplierDirectoryEntries:referenceRows.length
        },
        note:"Только чтение API. Идентификатор покупателя в успешно проведённой расходной необходимо сверять с iiko справочником поставщиков; ID склада не является допустимой заменой. Автоматическая отгрузка пока заблокирована."});
    }
    if(action==="find-linked-incoming"){
      requirePermission(c.access,"procurement.internal.configure");
      const day=str(body.documentDate),number=str(body.outgoingNumber);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!number||number.length>60)
        throw err("Укажите дату и номер ранее проведённой расходной накладной iiko.",400);
      const outgoing=await exportIikoPairExample(c,"outgoing",number,day);
      if(!outgoing.document||outgoing.ambiguous)
        return json({success:true,readOnly:true,stockOperation:false,found:false,confirmed:false,
          code:"OUTGOING_NOT_VERIFIED",message:"Не удалось однозначно найти расходную в iiko. Приходную не искали.",outgoingAttempts:outgoing.attempts});
      // Use only server-verified mapping evidence, never client-supplied Store or supplier IDs.
      const records=(await c.env.DB.prepare("SELECT destination_store_id,incoming_supplier_id,outgoing_buyer_id FROM sh_internal_order_warehouse_counterparties WHERE server_scope=?1 AND evidence_outgoing_id=?2")
        .bind(c.scope,id(outgoing.document.id)).all()).results||[];
      const exact=records.filter(row=>id(row.outgoing_buyer_id)===id(outgoing.document.counteragentId));
      const mapped=exact.length===1?exact[0]:null;
      const result=await findLinkedIncomingInvoices(c.connection,outgoing.document,{
        recipientStoreId:mapped?.destination_store_id||"",
        supplierId:mapped?.incoming_supplier_id||""
      });
      return json({success:true,readOnly:true,stockOperation:false,
        outgoing:{id:outgoing.document.id,number:outgoing.document.number,status:outgoing.document.status,
          storeId:outgoing.document.storeId,counteragentId:outgoing.document.counteragentId},
        validatedWarehouseMapping:!!mapped,receiverStoreId:mapped?.destination_store_id||"",
        ...result,
        note:"Только GET iiko. Подтверждение связи не даёт разрешения на отгрузку или проведение приходной."});
    }
    if(action==="confirm-pair-mapping"){
      requirePermission(c.access,"procurement.internal.configure");
      const day=str(body.documentDate),outNo=str(body.outgoingNumber),inNo=str(body.incomingNumber);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!outNo||!inNo||outNo.length>60||inNo.length>60)
        throw err("Дата и номера двух проведённых накладных обязательны.",400);
      // Re-fetch evidence; never trust buyer/store IDs provided by the client.
      const outgoing=await exportIikoPairExample(c,"outgoing",outNo,day);
      const incoming=await exportIikoPairExample(c,"incoming",inNo,day);
      if(!outgoing.document||!incoming.document||outgoing.ambiguous||incoming.ambiguous)
        throw err("Не удалось однозначно найти обе эталонные накладные в iiko.",409);
      const suppliers=await getIikoSuppliers(c.connection);
      if(suppliers.status!==200)throw err("Справочник контрагентов iiko сейчас недоступен.",502);
      const mapping=validatedPairWarehouseMapping(outgoing.document,incoming.document,suppliers.rows);
      if(!mapping.valid)throw err(mapping.reason,409);
      const now=new Date().toISOString();
      await c.env.DB.prepare("INSERT INTO sh_internal_order_warehouse_counterparties (server_scope,source_store_id,destination_store_id,outgoing_buyer_id,outgoing_buyer_name,incoming_supplier_id,incoming_supplier_name,evidence_outgoing_id,evidence_incoming_id,evidence_outgoing_number,evidence_incoming_number,confirmed_by,confirmed_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13) ON CONFLICT(server_scope,source_store_id,destination_store_id) DO UPDATE SET outgoing_buyer_id=excluded.outgoing_buyer_id,outgoing_buyer_name=excluded.outgoing_buyer_name,incoming_supplier_id=excluded.incoming_supplier_id,incoming_supplier_name=excluded.incoming_supplier_name,evidence_outgoing_id=excluded.evidence_outgoing_id,evidence_incoming_id=excluded.evidence_incoming_id,evidence_outgoing_number=excluded.evidence_outgoing_number,evidence_incoming_number=excluded.evidence_incoming_number,confirmed_by=excluded.confirmed_by,confirmed_at=excluded.confirmed_at")
        .bind(c.scope,mapping.sourceStoreId,mapping.destinationStoreId,mapping.outgoingBuyerId,mapping.outgoingBuyerName,mapping.incomingSupplierId,mapping.incomingSupplierName,mapping.evidenceOutgoingId,mapping.evidenceIncomingId,mapping.evidenceOutgoingNumber,mapping.evidenceIncomingNumber,str(c.auth.user.id),now).run();
      return json({success:true,mapping:{...mapping,confirmedAt:now},canDispatch:false,
        message:"Подтверждено соответствие внутренних контрагентов выбранным складам. Реальная отгрузка всё ещё заблокирована до проверки API создания связанной приходной."});
    }
    if(action==="list-pair-mappings"){
      requirePermission(c.access,"procurement.internal.configure");
      const r=(await c.env.DB.prepare("SELECT source_store_id,destination_store_id,outgoing_buyer_id,outgoing_buyer_name,incoming_supplier_id,incoming_supplier_name,evidence_outgoing_number,evidence_incoming_number,confirmed_at FROM sh_internal_order_warehouse_counterparties WHERE server_scope=?1 ORDER BY confirmed_at DESC LIMIT 100").bind(c.scope).all()).results||[];
      return json({success:true,canDispatch:false,mappings:r.map(x=>({
        sourceStoreId:x.source_store_id,destinationStoreId:x.destination_store_id,
        outgoingBuyerId:x.outgoing_buyer_id,outgoingBuyerName:x.outgoing_buyer_name,
        incomingSupplierId:x.incoming_supplier_id,incomingSupplierName:x.incoming_supplier_name,
        evidenceOutgoingNumber:x.evidence_outgoing_number,evidenceIncomingNumber:x.evidence_incoming_number,
        confirmedAt:x.confirmed_at
      }))});
    }
    const o=await order(c,body.orderId);
    if(action==="check-receipt"){
      // Available to users allowed to view this order, including receiver RMS.
      // All remote calls are GET; no D1 changes, new shipment reservations,
      // automatic receipt postings, or status transitions are performed.
      const s=await shipment(c,o,body.shipmentId);
      if(s.status!=="IIKO_PROCESSED")
        return json({success:true,readOnly:true,stockOperation:false,receipt:{confirmed:false,code:"OUTGOING_NOT_VERIFIED",
          message:"Нельзя проверять приёмку: расходная этой отгрузки ещё не подтверждена как проведённая."}});
      const mapping=await c.env.DB.prepare("SELECT * FROM sh_internal_order_warehouse_counterparties WHERE server_scope=?1 AND source_store_id=?2 AND destination_store_id=?3")
        .bind(c.scope,id(o.central_store_id),id(o.destination_store_id)).first();
      if(!mapping||id(mapping.outgoing_buyer_id)!==id(s.counteragent_id))
        return json({success:true,readOnly:true,stockOperation:false,receipt:{confirmed:false,code:"RECEIVER_MAPPING_UNVERIFIED",
          message:"Пара складов или внутренний контрагент этой отгрузки не подтверждены."}});
      const source=await exportIikoPairExample(c,"outgoing",s.iiko_document_number||s.number,s.document_date);
      if(!source.document||source.ambiguous)
        return json({success:true,readOnly:true,stockOperation:false,receipt:{confirmed:false,code:"OUTGOING_NOT_FOUND",
          message:"Не удалось однозначно прочитать проведённую расходную из iiko. Ничего не изменено."}});
      const validation=validateShipmentOutgoingForReceipt(s,source.document,mapping.outgoing_buyer_id);
      if(!validation.valid)
        return json({success:true,readOnly:true,stockOperation:false,receipt:{confirmed:false,code:validation.code,message:validation.message}});
      const incoming=await findLinkedIncomingInvoices(c.connection,source.document,{
        recipientStoreId:o.destination_store_id,supplierId:mapping.incoming_supplier_id
      });
      return json({success:true,readOnly:true,stockOperation:false,sourceConfirmed:true,
        receipt:incoming,canMarkReceived:false,
        message:incoming.message});
    }
    if(!shipper(o,c))throw err("Только уполномоченный сотрудник RMS-отправителя может оформлять отгрузку.",403);
    if(action==="preview-route"){
      // Explicitly read only: no shipment reservation, no iiko POST.
      const mapping=await c.env.DB.prepare("SELECT * FROM sh_internal_order_warehouse_counterparties WHERE server_scope=?1 AND source_store_id=?2 AND destination_store_id=?3")
        .bind(c.scope,id(o.central_store_id),id(o.destination_store_id)).first();
      if(!mapping)return json({success:true,readOnly:true,stockOperation:false,preview:previewConfirmedInternalRoute(o,null,[])});
      await verifyRouteWarehouses(c,o);
      const suppliers=await getIikoSuppliers(c.connection);
      if(suppliers.status!==200||!suppliers.rows?.length)throw err("Невозможно подтвердить контрагентов по текущему справочнику iiko. Ничего не отправлено.",502);
      const preview=previewConfirmedInternalRoute(o,mapping,suppliers.rows);
      return json({success:true,readOnly:true,stockOperation:false,preview});
    }
    if(action==="preview-dispatch"){
      // Dry run: validate ONE chosen product and its actual iikoChain source-store cost.
      // No iiko document import, no D1 reservation, no change to order/shipment state.
      if(o.status!=="READY")throw err("Для расчёта отгрузки заявка должна быть готова.",409);
      if(!Array.isArray(body.lines)||body.lines.length!==1)
        throw err("Для первого теста выберите один товар и его количество.",400);
      const savedMapping=await c.env.DB.prepare("SELECT * FROM sh_internal_order_warehouse_counterparties WHERE server_scope=?1 AND source_store_id=?2 AND destination_store_id=?3")
        .bind(c.scope,id(o.central_store_id),id(o.destination_store_id)).first();
      if(!savedMapping)throw err("Для получателя ещё нет подтверждённого соответствия контрагента.",409);
      await verifyRouteWarehouses(c,o);
      const suppliers=await getIikoSuppliers(c.connection);
      if(suppliers.status!==200||!suppliers.rows?.length)throw err("Не удалось прочитать справочник внутренних контрагентов iiko.",502);
      const route=previewConfirmedInternalRoute(o,savedMapping,suppliers.rows);
      if(!route.valid)throw err(route.message,409);
      const all=await rows(c,o.id);
      const date=str(body.documentDate);
      // Check uncertain local statuses before doing any additional read of iiko.
      if(all.some(x=>["CHECK_REQUIRED","IMPORTING","PROCESSING"].includes(x.status)))
        return json({success:true,readOnly:true,stockOperation:false,preview:buildInternalDispatchPreview({
          status:o.status,route,approved:parse(o.approved_lines_json,[]),
          existing:all.map(x=>({status:x.status,lines:parse(x.lines_json)})),
          requested:body.lines,costQuotes:[],documentDate:date
        })});
      const prices=await getWarehouseQuote(c,o,date);
      const preview=buildInternalDispatchPreview({status:o.status,route,
        approved:parse(o.approved_lines_json,[]),
        existing:all.map(x=>({status:x.status,lines:parse(x.lines_json)})),
        requested:body.lines,costQuotes:prices.quotes,documentDate:date});
      return json({success:true,readOnly:true,stockOperation:false,
        source:prices.source,accountingModeVerified:false,preview,
        message:"Предварительный расчёт выполнен. Отгрузка и создание связанной приходной остаются заблокированными."});
    }
    // Test branch exposes only one controlled one-click POST flow.
    // Do not revive legacy draft/update and old PREPARED import paths.
    if(["dispatch-existing","prepare","save-iiko-draft","process-iiko"].includes(action))
      throw err("Для пробной отправки используйте только новую кнопку «Отгрузить» в готовой заявке. Старые способы импорта заблокированы.",409);
    if(action==="dispatch"){
      await assertSupportedIikoShipmentRoute(c,o);
      if(o.status!=="READY")throw err("Заказ ещё не готов к отгрузке.",409);
      if(!Array.isArray(body.lines)||body.lines.length!==1||
         !Number.isFinite(Number(body.lines[0]?.amount))||
         Number(body.lines[0].amount)<=0||Number(body.lines[0].amount)>1)
        throw err("Первая пробная отгрузка: один товар, количество не более 1 в основной единице. Другие документы не создаются.",400);
      const buyerId=await verifiedBuyerId(c,o);
      const accounts=await accountSettings(c);
      const date=str(body.documentDate),prices=await getWarehouseQuote(c,o,date);
      const all=await rows(c,o.id),approved=parse(o.approved_lines_json);
      if(all.some(x=>["CHECK_REQUIRED","IMPORTING","PROCESSING"].includes(x.status)))
        throw err("Результат предыдущей отгрузки неизвестен. Сначала необходимо сверить документ в iiko.",409);
      const previous=all.map(x=>({status:x.status,lines:parse(x.lines_json)}));
      const prepared=prepareInternalShipment(approved,previous,body.lines,prices.quotes);
      const index=all.length+1,number=o.number+"-S"+String(index).padStart(2,"0");
      const sid=crypto.randomUUID(),documentId=crypto.randomUUID(),time=new Date().toISOString();
      const lock=await c.env.DB.prepare("UPDATE sh_internal_orders SET revision=revision+1,updated_at=?1 WHERE id=?2 AND server_scope=?3 AND status='READY' AND revision=?4")
        .bind(time,o.id,c.scope,o.revision).run();
      if(Number(lock.meta?.changes||0)!==1)throw err("Заявка изменена. Обновите её перед отгрузкой.",409);
      await c.env.DB.prepare("INSERT INTO sh_internal_order_shipments (id,server_scope,order_id,number,iiko_document_id,status,source_store_id,destination_store_id,counteragent_id,document_date,account_to_code,revenue_account_code,lines_json,total_cents,created_at,created_by,updated_at) VALUES (?1,?2,?3,?4,?5,'PREPARED',?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?14)")
        .bind(sid,c.scope,o.id,number,documentId,o.central_store_id,o.destination_store_id,buyerId,date,accounts.expenseAccountCode,accounts.revenueAccountCode,JSON.stringify(prepared.lines),prepared.totalCents,time,c.auth.user.id).run();
      const created=await shipment(c,o,sid);
      try{await audit(c,"PREPARE_FOR_DISPATCH",o,created,{number,sourceStoreId:o.central_store_id,destinationStoreId:o.destination_store_id,lines:prepared.lines})}
      catch(e){console.error("Internal shipment audit",str(e?.message||e))}
      return json(await dispatchShipment(c,o,created));
    }
    if(action==="dispatch-existing"){
      await assertSupportedIikoShipmentRoute(c,o);
      const ready=await shipment(c,o,body.shipmentId);
      if(ready.status!=="PREPARED")throw err("Повторно отправлять накладную в iiko нельзя.",409);
      return json(await dispatchShipment(c,o,ready));
    }
    if(action==="quote"){
      if(o.status!=="READY")throw err("Заказ не готов к отгрузке.",409);
      const result=await getWarehouseQuote(c,o,str(body.documentDate));
      return json({success:true,...result,recipient:{departmentId:o.destination_department_id,departmentName:o.destination_department_name,storeId:o.destination_store_id,storeName:o.destination_store_name}});
    }
    if(action==="prepare"){
      // Obsolete draft endpoint cannot reserve quantities while real REST
      // invoice pairing is still unverified.
      await assertSupportedIikoShipmentRoute(c,o);
      if(o.status!=="READY")throw err("Подготовка отгрузки доступна только для готового к отгрузке заказа.",409);
      const counteragentId=await verifiedBuyerId(c,o),date=str(body.documentDate);
      const prices=await getWarehouseQuote(c,o,date);
      const all=await rows(c,o.id);
      const approved=parse(o.approved_lines_json),prior=all.map(s=>({status:s.status,lines:parse(s.lines_json)}));
      const prepared=prepareInternalShipment(approved,prior,body.lines,prices.quotes);
      const index=all.length+1,number=o.number+"-S"+String(index).padStart(2,"0");
      const sid=crypto.randomUUID(),documentId=crypto.randomUUID(),time=new Date().toISOString();
      // CAS locks the order revision, preventing concurrent reservations of the
      // same approved quantities across parallel requests.
      const lock=await c.env.DB.prepare("UPDATE sh_internal_orders SET revision=revision+1,updated_at=?1 WHERE id=?2 AND server_scope=?3 AND status='READY' AND revision=?4").bind(time,o.id,c.scope,o.revision).run();
      if(Number(lock.meta?.changes||0)!==1)throw err("Кто-то изменил заказ. Обновите список и повторите.",409);
      await c.env.DB.prepare("INSERT INTO sh_internal_order_shipments (id,server_scope,order_id,number,iiko_document_id,status,source_store_id,destination_store_id,counteragent_id,document_date,account_to_code,revenue_account_code,lines_json,total_cents,created_at,created_by,updated_at) VALUES (?1,?2,?3,?4,?5,'PREPARED',?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?14)")
       .bind(sid,c.scope,o.id,number,documentId,o.central_store_id,o.destination_store_id,counteragentId,date,str(body.accountToCode),str(body.revenueAccountCode),JSON.stringify(prepared.lines),prepared.totalCents,time,c.auth.user.id).run();
      const s=await shipment(c,o,sid);await audit(c,"PREPARE",o,s,{number,lines:prepared.lines,totalCents:prepared.totalCents,counteragentId,sourceStoreId:o.central_store_id,recipientStoreId:o.destination_store_id,costTimestamp:prices.timestamp});
      return json({success:true,shipment:expose(s)},201);
    }
    const s=await shipment(c,o,body.shipmentId);
    if(action==="cancel"){
      if(s.status!=="PREPARED")throw err("Отменить можно только отгрузку, ещё не отправленную в iiko.",409);
      await setShipStatus(c,s,"PREPARED","CANCELLED");
      await audit(c,"CANCEL",o,s,{status:"CANCELLED"});
      return json({success:true});
    }
    if(action==="save-iiko-draft"){
      await assertSupportedIikoShipmentRoute(c,o);
      if(s.status!=="PREPARED")throw err("Этот документ уже отправлялся в iiko. Повторная отправка запрещена до сверки.",409);
      await verifyRouteWarehouses(c,o);
      if(id(s.counteragent_id)!==id(await verifiedBuyerId(c,o)))throw err("Покупатель расходной не совпадает с подтверждённым контрагентом RMS-получателя.",409);
      // Block old manually-priced shipments prepared before the automatic
      // warehouse valuation upgrade. Users must cancel and recreate them.
      const previousLines=parse(s.lines_json,[]);
      if(previousLines.some(l=>l.costSource!=="iikoChain warehouse balance"||!l.costTimestamp))throw err("Эта отгрузка подготовлена по старой схеме с ручной ценой. Отмените её и создайте заново по себестоимости iiko.",409);
      // Do not automatically retry an ambiguous transport error: iiko may have
      // persisted the draft even if the network response was lost.
      // Check the stable document number before importing; never silently
      // overwrite another user's unrelated outgoing invoice.
      const prior=await findOutgoingInvoices(c.connection,s.number,s.document_date);
      if(!prior.checked)throw err("iiko не подтвердил отсутствие расходной. Отправка остановлена, чтобы избежать дублирования.",502);
      if(prior.documents.length)throw err("Расходная с номером "+s.number+" уже существует в iiko. Повторный импорт запрещён; используйте сверку.",409);
      await setShipStatus(c,s,"PREPARED","IMPORTING");
      const xml=shipmentXml({id:s.iiko_document_id,number:s.number,date:s.document_date,storeId:s.source_store_id,counteragentId:s.counteragent_id,accountToCode:s.account_to_code,revenueAccountCode:s.revenue_account_code,comment:"Smart Horeca internal order "+o.number+" → "+o.destination_department_name,lines:parse(s.lines_json)});
      try{
        const res=await iikoText(c.connection,"/resto/api/documents/import/outgoingInvoice",{method:"POST",headers:{"Content-Type":"application/xml; charset=utf-8",Accept:"application/xml,text/xml,*/*"},body:xml,timeoutMs:60000});
        const val=parseIikoValidation(res.text);
        if(!res.ok||["false","0","no"].includes(val.valid.toLowerCase())||(!val.valid&&!!val.errorMessage)){
          const plainText=String(res.text||"").replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,240);
          const msg=val.errorMessage||val.additionalInfo||(plainText?"iiko: "+plainText:"iiko отклонил документ (HTTP "+res.status+").");
          await setShipStatus(c,s,"IMPORTING","CHECK_REQUIRED",{error:msg});
          return json({success:false,code:"CHECK_REQUIRED",message:msg+" Проверьте iiko по номеру "+s.number+"; автоматический повтор отключён."},409);
        }
        await setShipStatus(c,s,"IMPORTING","DRAFT_SAVED",{iikoDocumentNumber:val.documentNumber||s.number,iikoStatus:"UNKNOWN"});
        // Import is already completed in iiko. Audit failures must not turn a
        // successful write into a retryable error or a second import.
        try{await audit(c,"SAVE_IIKO_DRAFT",o,s,{iikoDocumentNumber:val.documentNumber||s.number,processed:false})}catch(e){console.error("Internal shipment audit error",String(e?.message||e))}
        return json({success:true,documentNumber:val.documentNumber||s.number,message:"Расходная накладная отправлена в iiko без проведения. Проверяйте статус в iiko."});
      }catch(e){
        await setShipStatus(c,s,"IMPORTING","CHECK_REQUIRED",{error:str(e.message).slice(0,700)});
        throw err("Ответ iiko неизвестен. Проверьте существование документа "+s.number+" в iiko; повторная отправка отключена. "+e.message,502);
      }
    }
    if(action==="process-iiko"){
      await assertSupportedIikoShipmentRoute(c,o);
      if(s.status!=="DRAFT_VERIFIED")throw err("Отгрузка возможна только после сохранения и сверки непроведённой накладной в iiko.",409);
      if(o.status!=="READY")throw err("Статус заявки изменён. Отгрузка заблокирована.",409);
      await verifyRouteWarehouses(c,o);
      if(id(s.counteragent_id)!==id(await verifiedBuyerId(c,o)))throw err("Покупатель накладной не совпадает с подтверждённым контрагентом RMS-получателя.",409);
      const lines=parse(s.lines_json,[]);
      if(lines.some(l=>l.costSource!=="iikoChain warehouse balance"||!l.costTimestamp))throw err("Себестоимость накладной не подтверждена iiko.",409);
      const before=await outgoingLookup(c,s);
      if(!before.valid||!before.quantityMatched||before.processed||before.status!=="NEW")
        throw err(before.message||"Накладная изменена, не найдена или уже проведена. Обновите сверку.",409);
      if(id(before.documentId)!==id(s.iiko_document_id)||id(before.counteragentId)!==id(s.counteragent_id))
        throw err("Номер, ID или покупатель документа не совпадает с заявкой.",409);
      // Lock before any stock-affecting request. A lost response must NEVER
      // cause an automatic second POST to iiko.
      await setShipStatus(c,s,"DRAFT_VERIFIED","PROCESSING");
      const xml=shipmentXml({id:s.iiko_document_id,number:s.iiko_document_number||s.number,
        date:s.document_date,storeId:s.source_store_id,counteragentId:s.counteragent_id,
        accountToCode:s.account_to_code,revenueAccountCode:s.revenue_account_code,
        comment:"Smart Horeca internal order "+o.number+" → "+o.destination_department_name,
        lines,status:"PROCESSED"});
      try{
        const response=await iikoText(c.connection,"/resto/api/documents/import/outgoingInvoice",{
          method:"POST",headers:{"Content-Type":"application/xml; charset=utf-8",Accept:"application/xml,text/xml,*/*"},
          body:xml,timeoutMs:60000
        });
        const validation=parseIikoValidation(response.text);
        if(!response.ok||["false","0","no"].includes(str(validation.valid).toLowerCase())){
          const hint=str(validation.errorMessage||validation.additionalInfo||response.text.replace(/<[^>]*>/g," ").trim()).slice(0,250);
          await setShipStatus(c,s,"PROCESSING","CHECK_REQUIRED",{error:"Нужна сверка проведения: HTTP "+response.status+". "+hint});
          return json({success:false,code:"PROCESS_UNCERTAIN",message:"iiko не подтвердил проведение (HTTP "+response.status+"). Повтор запрещён. Сверьте расходную "+s.number+"."},409);
        }
        let verification;
        try{verification=await outgoingLookup(c,s)}catch(e){verification={valid:false,message:str(e.message)}}
        if(!verification.valid||!verification.processed){
          await setShipStatus(c,s,"PROCESSING","CHECK_REQUIRED",{error:"iiko принял запрос, но факт проведения ещё не подтверждён. "+str(verification.message)});
          return json({success:false,code:"PROCESS_UNCERTAIN",message:"iiko получил запрос проведения, но списание не подтверждено. Проверьте "+s.number+"; не проводите повторно."},409);
        }
        await setShipStatus(c,s,"PROCESSING","IIKO_PROCESSED",{iikoDocumentNumber:verification.documentNumber,iikoStatus:verification.status});
        try{await audit(c,"PROCESS_IIKO",o,s,{iikoDocumentId:verification.documentId,processed:true,linkedIncomingVerified:false})}catch(e){console.error("Internal shipment posting audit failure",String(e?.message||e))}
        return json({success:true,shipmentNumber:s.number,verification:{...verification,linkedIncomingVerified:false},message:"Расходная проведена в iiko. Связанная приходная RMS-получателя ещё требует сверки."});
      }catch(e){
        await setShipStatus(c,s,"PROCESSING","CHECK_REQUIRED",{error:str(e.message).slice(0,700)});
        throw err("Результат проведения в iiko неизвестен. Проверьте "+s.number+"; повторное проведение заблокировано. "+e.message,502);
      }
    }
    if(action==="verify-iiko"){
      if(!["CHECK_REQUIRED","DRAFT_SAVED","DRAFT_VERIFIED","PROCESSING","IIKO_PROCESSED"].includes(s.status))throw err("Для этой отгрузки пока нет документа iiko.",409);
      const result=await outgoingLookup(c,s);
      if(!result.valid){
        // An ambiguous remote request must remain blocked until an authoritative
        // iiko document is found. Never release its reserved stock quantity.
        if(s.status==="PROCESSING")await setShipStatus(c,s,"PROCESSING","CHECK_REQUIRED",{error:"Результат проведения неизвестен: "+str(result.message)});
        return json({success:true,verification:{...result,linkedIncomingVerified:false},shipment:expose(s)});
      }
      // An ambiguous POST may still be in progress while an eventual-consistency
      // read reports NEW. Never reopen the posting button in that situation.
      if(!result.processed&&["CHECK_REQUIRED","PROCESSING"].includes(s.status)){
        if(s.status==="PROCESSING")await setShipStatus(c,s,"PROCESSING","CHECK_REQUIRED",{
          error:"Проверка iiko пока показывает NEW после попытки проведения. Нужна повторная серверная проверка без повторного POST.",
          iikoDocumentNumber:result.documentNumber,iikoStatus:result.status
        });
        return json({success:true,verification:{...result,uncertainProcessing:true,linkedIncomingVerified:false,canMarkShipped:false},shipment:expose(s)});
      }
      const status=result.processed?"IIKO_PROCESSED":"DRAFT_VERIFIED";
      await setShipStatus(c,s,s.status,status,{iikoDocumentNumber:result.documentNumber,iikoStatus:result.status});
      const updated=await shipment(c,o,s.id);
      try{await audit(c,"VERIFY_IIKO",o,updated,{status,iikoDocumentId:result.documentId,processed:result.processed})}catch(e){console.error("Shipment background audit error",str(e?.message||e))}
      return json({success:true,verification:{...result,linkedIncomingVerified:false,canMarkReceived:false},shipment:expose(updated)});
    }
    throw err("Неизвестная операция.",400);
  }catch(e){
    if(isIikoRestApiLicenseError(e))return json({success:false,code:"IIKO_REST_API_LICENSE",message:IIKO_REST_API_LICENSE_MESSAGE},503);
    return json({success:false,message:e.message||String(e)},e.status||500);
  }
}
