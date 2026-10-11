// Internal RMS shipment workflow. Saves documents as UNPROCESSED iiko draft only;
// never creates incoming invoices, posts stock, or pays debt.
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
    db.prepare("CREATE INDEX IF NOT EXISTS idx_internal_shipment_order ON sh_internal_order_shipments(server_scope,order_id,created_at)")
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
export async function onRequestOptions(){return new Response(null,{status:204,headers:H})}
export async function onRequestGet({request,env}){
  try{
    const c=await ctx(request,env),orderId=new URL(request.url).searchParams.get("orderId");
    const o=await order(c,orderId);
    const list=await rows(c,o.id);
    const totals=Object.fromEntries(parse(o.approved_lines_json).map(x=>[id(x.productId),{productId:x.productId,approved:Number(x.quantity),reserved:0}]));
    for(const s of list)if(s.status!=="CANCELLED")for(const l of parse(s.lines_json)){const t=totals[id(l.productId)];if(t)t.reserved+=Number(l.amount)}
    return json({success:true,shipments:list.map(expose),remaining:Object.values(totals).map(x=>({...x,remaining:Math.max(0,Math.round((x.approved-x.reserved)*1000)/1000)})),canFulfill:shipper(o,c)});
  }catch(e){return json({success:false,message:e.message},e.status||500)}
}
export async function onRequestPost({request,env}){
  try{
    const body=await request.json().catch(()=>({})),c=await ctx(request,env),action=str(body.action);
    const o=await order(c,body.orderId);
    if(!shipper(o,c))throw err("Только уполномоченный сотрудник RMS-отправителя может оформлять отгрузку.",403);
    if(action==="quote"){
      if(o.status!=="READY")throw err("Заказ не готов к отгрузке.",409);
      const result=await getWarehouseQuote(c,o,str(body.documentDate));
      return json({success:true,...result,recipient:{departmentId:o.destination_department_id,departmentName:o.destination_department_name,storeId:o.destination_store_id,storeName:o.destination_store_name}});
    }
    if(action==="prepare"){
      if(o.status!=="READY")throw err("Подготовка отгрузки доступна только для готового к отгрузке заказа.",409);
      const counteragentId=str(o.destination_store_id),date=str(body.documentDate);
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
      if(s.status!=="PREPARED")throw err("Этот документ уже отправлялся в iiko. Повторная отправка запрещена до сверки.",409);
      await verifyRouteWarehouses(c,o);
      if(id(s.counteragent_id)!==id(o.destination_store_id))throw err("Покупатель расходной должен совпадать со складом RMS-получателя, выбранным в заказе.",409);
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
      if(s.status!=="DRAFT_VERIFIED")throw err("Отгрузка возможна только после сохранения и сверки непроведённой накладной в iiko.",409);
      if(o.status!=="READY")throw err("Статус заявки изменён. Отгрузка заблокирована.",409);
      await verifyRouteWarehouses(c,o);
      if(id(s.counteragent_id)!==id(o.destination_store_id))throw err("Покупатель накладной отличается от склада RMS-получателя.",409);
      const lines=parse(s.lines_json,[]);
      if(lines.some(l=>l.costSource!=="iikoChain warehouse balance"||!l.costTimestamp))throw err("Себестоимость накладной не подтверждена iiko.",409);
      const before=await outgoingLookup(c,s);
      if(!before.valid||!before.quantityMatched||before.processed||before.status!=="NEW")
        throw err(before.message||"Накладная изменена, не найдена или уже проведена. Обновите сверку.",409);
      if(id(before.documentId)!==id(s.iiko_document_id)||id(before.counteragentId)!==id(o.destination_store_id))
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
      if(!result.valid)return json({success:true,verification:{...result,linkedIncomingVerified:false},shipment:expose(s)});
      const status=result.processed?"IIKO_PROCESSED":"DRAFT_VERIFIED";
      await setShipStatus(c,s,s.status,status,{iikoDocumentNumber:result.documentNumber,iikoStatus:result.status});
      const updated=await shipment(c,o,s.id);
      await audit(c,"VERIFY_IIKO",o,updated,{status,iikoDocumentId:result.documentId,processed:result.processed});
      return json({success:true,verification:{...result,linkedIncomingVerified:false,canMarkReceived:false},shipment:expose(updated)});
    }
    throw err("Неизвестная операция.",400);
  }catch(e){return json({success:false,message:e.message||String(e)},e.status||500)}
}
