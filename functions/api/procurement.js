import { getUser, loadPrivateIikoState, privateConnection, hasPrivateConnection } from "./iiko/_lib/user-state.js";
import { resolveRestaurantScope } from "./iiko/_lib/restaurant-scope.js";
import { serverScopeFromConnection, logAuditEvent } from "./_lib/audit-log.js";

const HEADERS={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
  "Access-Control-Allow-Headers":"Content-Type, Authorization",
  "Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store"
};

const DEFAULT_SETTINGS={
  approvalTiers:[
    {code:"MANAGER",name:"Менеджер",maxAmount:300},
    {code:"DIRECTOR",name:"Директор",maxAmount:2000},
    {code:"OWNER",name:"Владелец",maxAmount:null}
  ],
  autoNeedEnabled:true,
  targetMode:"MAX_OR_MIN",
  defaultLeadDays:2,
  allowOverReceipt:false
};

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:HEADERS})}
function clean(v){return String(v??"").trim()}
function n(v,f=0){const x=Number(v);return Number.isFinite(x)?x:f}
function money(v){return Math.round((n(v)||0)*10000)/10000}
function q(v){return Math.round((n(v)||0)*1000)/1000}
function parse(v,f){try{return JSON.parse(String(v||""))}catch{return f}}
function now(){return new Date().toISOString()}
function uid(){return crypto.randomUUID()}
function dateKey(){return new Date().toISOString().slice(0,10).replace(/-/g,"")}
function docNo(prefix){return `${prefix}-${dateKey()}-${uid().slice(0,6).toUpperCase()}`}
function actor(user){return clean(user?.user_metadata?.full_name||user?.user_metadata?.name||user?.email||user?.id)}
function unique(values){return [...new Set((values||[]).map(clean).filter(Boolean))]}

async function ensure(db){
  if(!db)throw new Error("D1 binding DB не настроен.");
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_settings (
      server_scope TEXT PRIMARY KEY,
      settings_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_requisitions (
      id TEXT PRIMARY KEY,
      server_scope TEXT NOT NULL,
      number TEXT NOT NULL,
      status TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'MANUAL',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_by_name TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL DEFAULT '',
      restaurant_ids_json TEXT NOT NULL DEFAULT '[]',
      restaurant_names_json TEXT NOT NULL DEFAULT '[]',
      warehouse_id TEXT NOT NULL,
      warehouse_name TEXT NOT NULL DEFAULT '',
      needed_by TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      total_estimate REAL NOT NULL DEFAULT 0,
      required_approval_level TEXT NOT NULL DEFAULT '',
      approved_by TEXT NOT NULL DEFAULT '',
      approved_by_name TEXT NOT NULL DEFAULT '',
      approved_at TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_proc_req_scope_number ON procurement_requisitions(server_scope,number)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_req_scope_created ON procurement_requisitions(server_scope,created_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_requisition_lines (
      id TEXT PRIMARY KEY,
      requisition_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0,
      package_size REAL NOT NULL DEFAULT 1,
      package_count REAL NOT NULL DEFAULT 0,
      vat_percent REAL NOT NULL DEFAULT 0,
      expected_price REAL NOT NULL DEFAULT 0,
      current_stock REAL NOT NULL DEFAULT 0,
      min_stock REAL,
      max_stock REAL,
      store_id TEXT NOT NULL DEFAULT '',
      store_name TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_req_lines_req ON procurement_requisition_lines(requisition_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_quotes (
      id TEXT PRIMARY KEY,
      server_scope TEXT NOT NULL,
      requisition_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      supplier_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'OFFERED',
      currency TEXT NOT NULL DEFAULT 'AZN',
      delivery_days INTEGER NOT NULL DEFAULT 0,
      payment_terms TEXT NOT NULL DEFAULT '',
      valid_until TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      lines_json TEXT NOT NULL DEFAULT '[]',
      total_amount REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT '',
      created_by_name TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_quotes_req ON procurement_quotes(server_scope,requisition_id,created_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_orders (
      id TEXT PRIMARY KEY,
      server_scope TEXT NOT NULL,
      number TEXT NOT NULL,
      requisition_id TEXT NOT NULL,
      quote_id TEXT NOT NULL DEFAULT '',
      supplier_id TEXT NOT NULL,
      supplier_name TEXT NOT NULL DEFAULT '',
      warehouse_id TEXT NOT NULL,
      warehouse_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'APPROVED',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT '',
      created_by_name TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL DEFAULT '',
      confirmed_at TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      restaurant_ids_json TEXT NOT NULL DEFAULT '[]',
      restaurant_names_json TEXT NOT NULL DEFAULT '[]',
      total_amount REAL NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_proc_order_scope_number ON procurement_orders(server_scope,number)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_order_scope_created ON procurement_orders(server_scope,created_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_order_lines (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_name TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      ordered_qty REAL NOT NULL DEFAULT 0,
      confirmed_qty REAL NOT NULL DEFAULT 0,
      package_size REAL NOT NULL DEFAULT 1,
      package_count REAL NOT NULL DEFAULT 0,
      vat_percent REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_order_lines_order ON procurement_order_lines(order_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_receipts (
      id TEXT PRIMARY KEY,
      server_scope TEXT NOT NULL,
      order_id TEXT NOT NULL,
      iiko_document_number TEXT NOT NULL DEFAULT '',
      iiko_document_id TEXT NOT NULL DEFAULT '',
      iiko_status TEXT NOT NULL DEFAULT '',
      document_date TEXT NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0,
      lines_json TEXT NOT NULL DEFAULT '[]',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT '',
      created_by_name TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_receipts_order ON procurement_receipts(server_scope,order_id,created_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_stock_norms (
      server_scope TEXT NOT NULL,
      store_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      store_name TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT '',
      min_stock REAL,
      target_stock REAL,
      lead_days INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      restaurant_ids_json TEXT NOT NULL DEFAULT '[]',
      restaurant_names_json TEXT NOT NULL DEFAULT '[]',
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_by_name TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(server_scope,store_id,product_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_stock_norms_scope_store ON procurement_stock_norms(server_scope,store_id,product_id)`)
  ]);
  async function ensureColumn(table,column,definition){
    const info=await db.prepare("PRAGMA table_info("+table+")").all();
    if(!(info.results||[]).some(x=>String(x.name||"")===column)){
      await db.prepare("ALTER TABLE "+table+" ADD COLUMN "+column+" "+definition).run();
    }
  }
  await ensureColumn("procurement_requisition_lines","package_size","REAL NOT NULL DEFAULT 1");
  await ensureColumn("procurement_requisition_lines","package_count","REAL NOT NULL DEFAULT 0");
  await ensureColumn("procurement_requisition_lines","vat_percent","REAL NOT NULL DEFAULT 0");
  await ensureColumn("procurement_order_lines","package_size","REAL NOT NULL DEFAULT 1");
  await ensureColumn("procurement_order_lines","package_count","REAL NOT NULL DEFAULT 0");
  await ensureColumn("procurement_order_lines","vat_percent","REAL NOT NULL DEFAULT 0");
}

async function contextFor(request,env){
  const auth=await getUser(request,env);
  if(!auth){const e=new Error("Необходима авторизация.");e.status=401;throw e}
  const stored=await loadPrivateIikoState(env.DB,auth.user.id,env);
  if(!stored?.found||!hasPrivateConnection(stored.state)){const e=new Error("Сначала подключите Smart Horeca Server в настройках.");e.status=409;throw e}
  const connection=privateConnection(stored.state);
  const serverScope=await serverScopeFromConnection(connection);
  if(!serverScope)throw new Error("Не удалось определить контур подключенного сервера.");
  const scope=resolveRestaurantScope({state:stored.state,request,strict:true});
  await ensure(env.DB);
  return{auth,stored,connection,serverScope,scope};
}

function scopeData(scope){
  const ids=unique(scope?.selectedDepartmentIds||[]);
  const names=unique((scope?.selectedRestaurants||[]).map(x=>x?.name));
  return{ids,names};
}
function isFullScope(scope){
  const a=unique(scope?.allowedDepartmentIds||[]),s=unique(scope?.selectedDepartmentIds||[]);
  return !scope?.isChain||(a.length>0&&a.length===s.length&&s.every(x=>a.includes(x)));
}
function rowAllowed(row,scope){
  if(isFullScope(scope))return true;
  const selected=new Set(unique(scope?.selectedDepartmentIds||[]));
  const ids=unique(parse(row.restaurant_ids_json,[]));
  return ids.length>0&&ids.every(id=>selected.has(id));
}
function assertAllowed(row,scope){
  if(!rowAllowed(row,scope)){const e=new Error("Документ относится к другому выбранному подразделению.");e.status=403;throw e}
}
async function settings(db,serverScope){
  const row=await db.prepare("SELECT settings_json FROM procurement_settings WHERE server_scope=?1 LIMIT 1").bind(serverScope).first();
  const saved=parse(row?.settings_json,{});
  const tiers=Array.isArray(saved?.approvalTiers)&&saved.approvalTiers.length?saved.approvalTiers:DEFAULT_SETTINGS.approvalTiers;
  return{...DEFAULT_SETTINGS,...saved,approvalTiers:tiers};
}
function approvalLevel(total,s){
  const tiers=Array.isArray(s?.approvalTiers)?s.approvalTiers:[];
  for(const tier of tiers){
    const max=tier?.maxAmount;
    if(max===null||max===undefined||max===""||total<=n(max))return clean(tier?.code||tier?.name||"");
  }
  return clean(tiers.at(-1)?.code||"OWNER");
}
function normalizeLines(lines,{allowZeroPrice=false}={}){
  const src=Array.isArray(lines)?lines:[];
  if(!src.length)throw new Error("Добавьте хотя бы одну позицию.");
  const seen=new Set(),out=[];
  for(const raw of src){
    const productId=clean(raw?.productId);if(!productId)throw new Error("Не выбрана номенклатура.");
    if(seen.has(productId))throw new Error("Одна позиция не может повторяться в документе.");seen.add(productId);
    const sourceQuantity=q(raw?.quantity??raw?.orderedQty??raw?.receivedQty);
    const packageSize=q(raw?.packageSize??raw?.packingSize??1)||1;
    const packageCount=q(raw?.packageCount??raw?.packages??(sourceQuantity>0?sourceQuantity/packageSize:0));
    const quantity=q(packageSize*packageCount);
    if(!(packageSize>0))throw new Error("Фасовка должна быть больше нуля.");
    if(!(packageCount>0)||!(quantity>0))throw new Error("Количество упаковок должно быть больше нуля.");
    const vatPercent=n(raw?.vatPercent??raw?.ndsPercent,0);
    if(![0,2,8,18].includes(vatPercent))throw new Error("НДС должен быть 0%, 2%, 8% или 18%.");
    const price=money(raw?.unitPrice??raw?.expectedPrice??0);if(price<0||(!allowZeroPrice&&price<=0))throw new Error("Укажите корректную цену.");
    out.push({
      productId,
      productName:clean(raw?.productName),
      unit:clean(raw?.unit),
      quantity,
      packageSize,
      packageCount,
      vatPercent,
      unitPrice:price,
      currentStock:q(raw?.currentStock),
      minStock:raw?.minStock===null||raw?.minStock===undefined?null:q(raw.minStock),
      maxStock:raw?.maxStock===null||raw?.maxStock===undefined?null:q(raw.maxStock),
      storeId:clean(raw?.storeId),
      storeName:clean(raw?.storeName)
    });
  }
  return out;
}
async function reqRow(db,scope,id,serverScope){
  const row=await db.prepare("SELECT * FROM procurement_requisitions WHERE id=?1 AND server_scope=?2 LIMIT 1").bind(id,serverScope).first();
  if(!row){const e=new Error("Заявка не найдена.");e.status=404;throw e}
  assertAllowed(row,scope);return row;
}
async function orderRow(db,scope,id,serverScope){
  const row=await db.prepare("SELECT * FROM procurement_orders WHERE id=?1 AND server_scope=?2 LIMIT 1").bind(id,serverScope).first();
  if(!row){const e=new Error("Заказ не найден.");e.status=404;throw e}
  assertAllowed(row,scope);return row;
}
async function log(context,action,entityType,row,before,after,meta={}){
  const ids=parse(row?.restaurant_ids_json,context.scope.selectedDepartmentIds||[]);
  const names=parse(row?.restaurant_names_json,(context.scope.selectedRestaurants||[]).map(x=>x?.name));
  return logAuditEvent({
    request:context.request,env:context.env,connection:context.connection,action,entityType,
    entityId:row?.id||"",entityLabel:row?.number||"",documentNumber:row?.number||"",
    before,after,restaurantIds:ids,restaurantNames:names,metadata:meta
  });
}

async function readData(db,serverScope,scope){
  const [reqsR,reqLinesR,quotesR,ordersR,orderLinesR,receiptsR,normsR]=await Promise.all([
    db.prepare("SELECT * FROM procurement_requisitions WHERE server_scope=?1 ORDER BY created_at DESC LIMIT 500").bind(serverScope).all(),
    db.prepare(`SELECT l.* FROM procurement_requisition_lines l JOIN procurement_requisitions r ON r.id=l.requisition_id WHERE r.server_scope=?1 ORDER BY l.rowid`).bind(serverScope).all(),
    db.prepare("SELECT * FROM procurement_quotes WHERE server_scope=?1 ORDER BY created_at DESC LIMIT 1000").bind(serverScope).all(),
    db.prepare("SELECT * FROM procurement_orders WHERE server_scope=?1 ORDER BY created_at DESC LIMIT 500").bind(serverScope).all(),
    db.prepare(`SELECT l.* FROM procurement_order_lines l JOIN procurement_orders o ON o.id=l.order_id WHERE o.server_scope=?1 ORDER BY l.rowid`).bind(serverScope).all(),
    db.prepare("SELECT * FROM procurement_receipts WHERE server_scope=?1 ORDER BY created_at DESC LIMIT 1000").bind(serverScope).all(),
    db.prepare("SELECT * FROM procurement_stock_norms WHERE server_scope=?1 ORDER BY store_name,product_name").bind(serverScope).all()
  ]);
  const reqRows=(reqsR.results||[]).filter(x=>rowAllowed(x,scope));
  const reqIds=new Set(reqRows.map(x=>x.id));
  const quoteRows=(quotesR.results||[]).filter(x=>reqIds.has(x.requisition_id));
  const orderRows=(ordersR.results||[]).filter(x=>rowAllowed(x,scope));
  const orderIds=new Set(orderRows.map(x=>x.id));
  const receipts=(receiptsR.results||[]).filter(x=>orderIds.has(x.order_id)).map(r=>({
    id:r.id,orderId:r.order_id,iikoDocumentNumber:r.iiko_document_number,iikoDocumentId:r.iiko_document_id,iikoStatus:r.iiko_status,
    documentDate:r.document_date,totalAmount:n(r.total_amount),lines:parse(r.lines_json,[]),comment:r.comment,createdAt:r.created_at,createdBy:r.created_by_name||r.created_by
  }));
  const receiptsByOrder=new Map();
  for(const receipt of receipts){if(!receiptsByOrder.has(receipt.orderId))receiptsByOrder.set(receipt.orderId,[]);receiptsByOrder.get(receipt.orderId).push(receipt)}
  const reqLinesBy=new Map();for(const l of reqLinesR.results||[]){if(!reqIds.has(l.requisition_id))continue;if(!reqLinesBy.has(l.requisition_id))reqLinesBy.set(l.requisition_id,[]);reqLinesBy.get(l.requisition_id).push(l)}
  const orderLinesBy=new Map();for(const l of orderLinesR.results||[]){if(!orderIds.has(l.order_id))continue;if(!orderLinesBy.has(l.order_id))orderLinesBy.set(l.order_id,[]);orderLinesBy.get(l.order_id).push(l)}

  const requisitions=reqRows.map(r=>({
    id:r.id,number:r.number,status:r.status,source:r.source,createdAt:r.created_at,updatedAt:r.updated_at,createdBy:r.created_by_name||r.created_by,
    restaurantIds:parse(r.restaurant_ids_json,[]),restaurantNames:parse(r.restaurant_names_json,[]),warehouseId:r.warehouse_id,warehouseName:r.warehouse_name,
    neededBy:r.needed_by,comment:r.comment,totalEstimate:n(r.total_estimate),requiredApprovalLevel:r.required_approval_level,
    approvedBy:r.approved_by_name||r.approved_by,approvedAt:r.approved_at,
    lines:(reqLinesBy.get(r.id)||[]).map(l=>({id:l.id,productId:l.product_id,productName:l.product_name,unit:l.unit,quantity:n(l.quantity),packageSize:n(l.package_size,1)||1,packageCount:n(l.package_count)||n(l.quantity),vatPercent:n(l.vat_percent),expectedPrice:n(l.expected_price),currentStock:n(l.current_stock),minStock:l.min_stock===null?null:n(l.min_stock),maxStock:l.max_stock===null?null:n(l.max_stock),storeId:l.store_id,storeName:l.store_name})),
    quotes:quoteRows.filter(q=>q.requisition_id===r.id).map(q=>({id:q.id,supplierId:q.supplier_id,supplierName:q.supplier_name,status:q.status,currency:q.currency,deliveryDays:n(q.delivery_days),paymentTerms:q.payment_terms,validUntil:q.valid_until,comment:q.comment,totalAmount:n(q.total_amount),lines:parse(q.lines_json,[]),createdAt:q.created_at,createdBy:q.created_by_name||q.created_by}))
  }));

  const orders=orderRows.map(o=>{
    const rs=receiptsByOrder.get(o.id)||[],received=new Map(),receiptPrices=new Map();
    for(const receipt of rs)for(const line of receipt.lines||[]){
      const pid=clean(line.productId),qty=n(line.quantity??line.receivedQty),price=money(line.unitPrice);
      received.set(pid,n(received.get(pid))+qty);
      if(!receiptPrices.has(pid))receiptPrices.set(pid,[]);receiptPrices.get(pid).push(price);
    }
    const lines=(orderLinesBy.get(o.id)||[]).map(l=>{
      const rec=q(received.get(l.product_id)||0),ord=q(l.ordered_qty),rem=q(Math.max(0,ord-rec));
      return{id:l.id,productId:l.product_id,productName:l.product_name,unit:l.unit,orderedQty:ord,confirmedQty:q(l.confirmed_qty||l.ordered_qty),packageSize:n(l.package_size,1)||1,packageCount:n(l.package_count)||ord,vatPercent:n(l.vat_percent),unitPrice:n(l.unit_price),receivedQty:rec,remainingQty:rem};
    });
    const orderedQty=lines.reduce((s,x)=>s+x.orderedQty,0),receivedQty=lines.reduce((s,x)=>s+Math.min(x.orderedQty,x.receivedQty),0);
    const completed=lines.length>0&&lines.every(x=>x.remainingQty<=0.0005);
    const over=lines.some(x=>x.receivedQty>x.orderedQty+0.0005);
    const priceMismatch=lines.some(x=>(receiptPrices.get(x.productId)||[]).some(p=>Math.abs(p-x.unitPrice)>0.009));
    const effectiveStatus=o.status==="CANCELLED"?"CANCELLED":completed?"COMPLETED":receivedQty>0?"PARTIALLY_RECEIVED":o.status;
    const matchStatus=over?"QUANTITY_MISMATCH":priceMismatch?"PRICE_MISMATCH":completed?"MATCHED":receivedQty>0?"PARTIAL":"OPEN";
    return{
      id:o.id,number:o.number,requisitionId:o.requisition_id,quoteId:o.quote_id,supplierId:o.supplier_id,supplierName:o.supplier_name,
      warehouseId:o.warehouse_id,warehouseName:o.warehouse_name,status:o.status,effectiveStatus,createdAt:o.created_at,updatedAt:o.updated_at,
      createdBy:o.created_by_name||o.created_by,sentAt:o.sent_at,confirmedAt:o.confirmed_at,comment:o.comment,totalAmount:n(o.total_amount),
      restaurantIds:parse(o.restaurant_ids_json,[]),restaurantNames:parse(o.restaurant_names_json,[]),
      orderedQty:q(orderedQty),receivedQty:q(receivedQty),completionPercent:orderedQty>0?Math.round(receivedQty/orderedQty*1000)/10:0,matchStatus,
      lines,receipts:rs
    };
  });

  const requisitionsWithProgress=requisitions.map(r=>{
    const linkedOrders=orders.filter(o=>o.requisitionId===r.id&&o.effectiveStatus!=="CANCELLED");
    const orderedByProduct=new Map(),receivedByProduct=new Map();
    for(const o of linkedOrders){
      for(const line of o.lines||[]){
        orderedByProduct.set(line.productId,n(orderedByProduct.get(line.productId))+n(line.orderedQty));
        receivedByProduct.set(line.productId,n(receivedByProduct.get(line.productId))+n(line.receivedQty));
      }
    }
    const lineProgress=(r.lines||[]).map(line=>{
      const requested=n(line.quantity),ordered=n(orderedByProduct.get(line.productId)),received=n(receivedByProduct.get(line.productId));
      const pct=requested>0?Math.min(100,received/requested*100):0;
      return{productId:line.productId,requestedQty:requested,orderedQty:q(ordered),receivedQty:q(received),remainingQty:q(Math.max(0,requested-received)),completionPercent:Math.round(pct*10)/10};
    });
    const anyOrdered=lineProgress.some(x=>x.orderedQty>0.0005),anyReceived=lineProgress.some(x=>x.receivedQty>0.0005);
    const fullyOrdered=lineProgress.length>0&&lineProgress.every(x=>x.orderedQty>=x.requestedQty-0.0005);
    const fullyReceived=lineProgress.length>0&&lineProgress.every(x=>x.receivedQty>=x.requestedQty-0.0005);
    const completionPercent=lineProgress.length?Math.round(lineProgress.reduce((s,x)=>s+x.completionPercent,0)/lineProgress.length*10)/10:0;
    const effectiveStatus=r.status==="CANCELLED"?"CANCELLED":r.status==="CLOSED"?"CLOSED":fullyReceived&&linkedOrders.length?"COMPLETED":anyReceived?"PARTIALLY_FULFILLED":fullyOrdered?"ORDERED":anyOrdered?"PARTIALLY_ORDERED":r.status;
    return{...r,effectiveStatus,completionPercent,lineProgress,linkedOrders:linkedOrders.map(o=>({id:o.id,number:o.number,effectiveStatus:o.effectiveStatus,supplierId:o.supplierId,supplierName:o.supplierName,totalAmount:o.totalAmount,completionPercent:o.completionPercent}))};
  });

  const supplierMap=new Map();
  for(const o of orders.filter(x=>x.effectiveStatus!=="CANCELLED")){
    const key=o.supplierId||o.supplierName;if(!supplierMap.has(key))supplierMap.set(key,{supplierId:o.supplierId,supplierName:o.supplierName,orders:0,totalAmount:0,receivedAmount:0,completedOrders:0,avgCompletion:0,_completion:0});
    const s=supplierMap.get(key);s.orders++;s.totalAmount+=o.totalAmount;s._completion+=o.completionPercent;if(o.effectiveStatus==="COMPLETED")s.completedOrders++;
    s.receivedAmount+=(o.receipts||[]).reduce((a,r)=>a+n(r.totalAmount),0);
  }
  const supplierPerformance=[...supplierMap.values()].map(s=>({...s,totalAmount:money(s.totalAmount),receivedAmount:money(s.receivedAmount),avgCompletion:s.orders?Math.round(s._completion/s.orders*10)/10:0,_completion:undefined})).sort((a,b)=>b.totalAmount-a.totalAmount);
  const estimate=requisitionsWithProgress.reduce((s,r)=>s+n(r.totalEstimate),0),ordered=orders.filter(x=>x.effectiveStatus!=="CANCELLED").reduce((s,o)=>s+n(o.totalAmount),0),receivedAmount=receipts.reduce((s,r)=>s+n(r.totalAmount),0);
  const stockNorms=(normsR.results||[]).filter(x=>rowAllowed(x,scope)).map(x=>({
    storeId:x.store_id,storeName:x.store_name,productId:x.product_id,productName:x.product_name,unit:x.unit,
    minStock:x.min_stock===null?null:n(x.min_stock),targetStock:x.target_stock===null?null:n(x.target_stock),
    leadDays:n(x.lead_days),enabled:Number(x.enabled)!==0,updatedAt:x.updated_at,updatedBy:x.updated_by_name||x.updated_by
  }));
  return{
    requisitions:requisitionsWithProgress,orders,receipts,stockNorms,supplierPerformance,
    analytics:{requisitionEstimate:money(estimate),orderedAmount:money(ordered),receivedAmount:money(receivedAmount),estimatedSavings:money(Math.max(0,estimate-ordered)),activeOrders:orders.filter(x=>!["COMPLETED","CANCELLED"].includes(x.effectiveStatus)).length,completedOrders:orders.filter(x=>x.effectiveStatus==="COMPLETED").length,pendingApprovals:requisitionsWithProgress.filter(x=>x.status==="PENDING_APPROVAL").length,completedRequisitions:requisitionsWithProgress.filter(x=>x.effectiveStatus==="COMPLETED").length}
  };
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:HEADERS})}

export async function onRequestGet({request,env}){
  try{
    const c=await contextFor(request,env);
    const data=await readData(env.DB,c.serverScope,c.scope);
    return json({success:true,settings:await settings(env.DB,c.serverScope),scope:{mode:c.scope.mode,isChain:c.scope.isChain,selectedDepartmentIds:c.scope.selectedDepartmentIds,selectedRestaurants:c.scope.selectedRestaurants,fullSelection:isFullScope(c.scope)},...data});
  }catch(error){return json({success:false,message:error?.message||String(error)},error?.status||500)}
}

export async function onRequestPost({request,env}){
  try{
    const body=await request.json().catch(()=>({})),action=clean(body?.action).toLowerCase();
    const c=await contextFor(request,env);c.request=request;c.env=env;
    const db=env.DB,user=c.auth.user,userId=clean(user.id),userName=actor(user),stamp=now(),sd=scopeData(c.scope),s=await settings(db,c.serverScope);

    if(action==="save-stock-norms"){
      const rows=Array.isArray(body?.norms)?body.norms:[];if(!rows.length)throw new Error("Нет изменений норм запаса.");
      const sd=scopeData(c.scope),statements=[],saved=[];
      for(const raw of rows){
        const storeId=clean(raw?.storeId),productId=clean(raw?.productId);if(!storeId||!productId)continue;
        const minStock=raw?.minStock===null||raw?.minStock===undefined||raw?.minStock===""?null:q(raw.minStock);
        const targetStock=raw?.targetStock===null||raw?.targetStock===undefined||raw?.targetStock===""?null:q(raw.targetStock);
        const enabled=raw?.enabled===false?0:1,leadDays=Math.max(0,Math.round(n(raw?.leadDays)));
        if(minStock!==null&&minStock<0)throw new Error("Минимальный остаток не может быть отрицательным.");
        if(targetStock!==null&&targetStock<0)throw new Error("Целевой остаток не может быть отрицательным.");
        if(minStock!==null&&targetStock!==null&&targetStock<minStock)throw new Error("Целевой остаток должен быть не меньше минимального.");
        const storeName=clean(raw?.storeName),productName=clean(raw?.productName),unit=clean(raw?.unit);
        if(minStock===null&&targetStock===null){
          statements.push(db.prepare("DELETE FROM procurement_stock_norms WHERE server_scope=?1 AND store_id=?2 AND product_id=?3").bind(c.serverScope,storeId,productId));
          saved.push({storeId,productId,deleted:true});
        }else{
          statements.push(db.prepare(`INSERT INTO procurement_stock_norms(server_scope,store_id,product_id,store_name,product_name,unit,min_stock,target_stock,lead_days,enabled,restaurant_ids_json,restaurant_names_json,updated_at,updated_by,updated_by_name)
            VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)
            ON CONFLICT(server_scope,store_id,product_id) DO UPDATE SET
              store_name=excluded.store_name,product_name=excluded.product_name,unit=excluded.unit,min_stock=excluded.min_stock,target_stock=excluded.target_stock,
              lead_days=excluded.lead_days,enabled=excluded.enabled,restaurant_ids_json=excluded.restaurant_ids_json,restaurant_names_json=excluded.restaurant_names_json,
              updated_at=excluded.updated_at,updated_by=excluded.updated_by,updated_by_name=excluded.updated_by_name`)
            .bind(c.serverScope,storeId,productId,storeName,productName,unit,minStock,targetStock,leadDays,enabled,JSON.stringify(sd.ids),JSON.stringify(sd.names),stamp,userId,userName));
          saved.push({storeId,storeName,productId,productName,unit,minStock,targetStock,leadDays,enabled:enabled===1});
        }
      }
      for(let i=0;i<statements.length;i+=50)await db.batch(statements.slice(i,i+50));
      await logAuditEvent({request,env,connection:c.connection,action:"UPDATE",entityType:"PROCUREMENT_STOCK_NORMS",entityId:c.serverScope,entityLabel:"Нормы запаса закупок",before:null,after:saved,restaurantIds:sd.ids,restaurantNames:sd.names,metadata:{count:saved.length}});
      return json({success:true,count:saved.length});
    }

    if(action==="save-settings"){
      const input=body?.settings&&typeof body.settings==="object"?body.settings:{};
      const tiers=(Array.isArray(input.approvalTiers)?input.approvalTiers:[]).map(x=>({code:clean(x?.code),name:clean(x?.name),maxAmount:x?.maxAmount===null||x?.maxAmount===""?null:money(x?.maxAmount)})).filter(x=>x.code&&x.name);
      const next={...s,...input,approvalTiers:tiers.length?tiers:s.approvalTiers};
      await db.prepare(`INSERT INTO procurement_settings(server_scope,settings_json,updated_at,updated_by) VALUES(?1,?2,?3,?4) ON CONFLICT(server_scope) DO UPDATE SET settings_json=excluded.settings_json,updated_at=excluded.updated_at,updated_by=excluded.updated_by`).bind(c.serverScope,JSON.stringify(next),stamp,userId).run();
      await logAuditEvent({request,env,connection:c.connection,action:"UPDATE_SETTINGS",entityType:"PROCUREMENT_SETTINGS",entityId:c.serverScope,entityLabel:"Настройки закупок",before:s,after:next,restaurantIds:sd.ids,restaurantNames:sd.names});
      return json({success:true,settings:next});
    }

    if(action==="create-requisition"){
      const lines=normalizeLines(body?.lines,{allowZeroPrice:true}),warehouseId=clean(body?.warehouseId),warehouseName=clean(body?.warehouseName);
      if(!warehouseId)throw new Error("Выберите склад назначения.");
      const total=money(lines.reduce((sum,x)=>sum+x.packageCount*x.unitPrice,0)),id=uid(),number=docNo("PR"),level=approvalLevel(total,s);
      const row={id,number,restaurant_ids_json:JSON.stringify(sd.ids),restaurant_names_json:JSON.stringify(sd.names)};
      const stmts=[db.prepare(`INSERT INTO procurement_requisitions(id,server_scope,number,status,source,created_at,updated_at,created_by,created_by_name,restaurant_ids_json,restaurant_names_json,warehouse_id,warehouse_name,needed_by,comment,total_estimate,required_approval_level) VALUES(?1,?2,?3,'DRAFT',?4,?5,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`).bind(id,c.serverScope,number,clean(body?.source||"MANUAL").toUpperCase(),stamp,userId,userName,row.restaurant_ids_json,row.restaurant_names_json,warehouseId,warehouseName,clean(body?.neededBy),clean(body?.comment),total,level)];
      for(const x of lines)stmts.push(db.prepare(`INSERT INTO procurement_requisition_lines(id,requisition_id,product_id,product_name,unit,quantity,package_size,package_count,vat_percent,expected_price,current_stock,min_stock,max_stock,store_id,store_name) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`).bind(uid(),id,x.productId,x.productName,x.unit,x.quantity,x.packageSize,x.packageCount,x.vatPercent,x.unitPrice,x.currentStock,x.minStock,x.maxStock,x.storeId,x.storeName));
      await db.batch(stmts);
      await log(c,"CREATE","PURCHASE_REQUISITION",row,null,{id,number,status:"DRAFT",warehouseId,warehouseName,totalEstimate:total,requiredApprovalLevel:level,lines});
      return json({success:true,id,number,status:"DRAFT"},201);
    }

    if(action==="update-requisition"){
      const r=await reqRow(db,c.scope,clean(body?.id),c.serverScope);if(r.status!=="DRAFT"){const e=new Error("Изменять можно только черновик заявки.");e.status=409;throw e}
      const lines=normalizeLines(body?.lines,{allowZeroPrice:true}),warehouseId=clean(body?.warehouseId||r.warehouse_id),warehouseName=clean(body?.warehouseName||r.warehouse_name),total=money(lines.reduce((sum,x)=>sum+x.packageCount*x.unitPrice,0)),level=approvalLevel(total,s);
      const before={...r,lines:(await db.prepare("SELECT * FROM procurement_requisition_lines WHERE requisition_id=?1").bind(r.id).all()).results||[]};
      const stmts=[db.prepare("DELETE FROM procurement_requisition_lines WHERE requisition_id=?1").bind(r.id),db.prepare(`UPDATE procurement_requisitions SET updated_at=?2,updated_by=?3,warehouse_id=?4,warehouse_name=?5,needed_by=?6,comment=?7,total_estimate=?8,required_approval_level=?9 WHERE id=?1`).bind(r.id,stamp,userId,warehouseId,warehouseName,clean(body?.neededBy),clean(body?.comment),total,level)];
      for(const x of lines)stmts.push(db.prepare(`INSERT INTO procurement_requisition_lines(id,requisition_id,product_id,product_name,unit,quantity,expected_price,current_stock,min_stock,max_stock,store_id,store_name) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`).bind(uid(),r.id,x.productId,x.productName,x.unit,x.quantity,x.packageSize,x.packageCount,x.vatPercent,x.unitPrice,x.currentStock,x.minStock,x.maxStock,x.storeId,x.storeName));
      await db.batch(stmts);await log(c,"UPDATE","PURCHASE_REQUISITION",r,before,{id:r.id,number:r.number,status:r.status,warehouseId,warehouseName,totalEstimate:total,requiredApprovalLevel:level,lines});
      return json({success:true,id:r.id,status:r.status});
    }

    if(action==="close-requisition"){
      const r=await reqRow(db,c.scope,clean(body?.id),c.serverScope);
      if(["DRAFT","PENDING_APPROVAL","CANCELLED","CLOSED"].includes(r.status)){const e=new Error("Эту заявку нельзя закрыть вручную.");e.status=409;throw e}
      const reason=clean(body?.reason);if(!reason)throw new Error("Укажите причину ручного закрытия заявки.");
      const before={status:r.status,comment:r.comment};
      const nextComment=[clean(r.comment), "Закрыто вручную: "+reason].filter(Boolean).join("\n");
      await db.prepare("UPDATE procurement_requisitions SET status='CLOSED',comment=?2,updated_at=?3,updated_by=?4 WHERE id=?1").bind(r.id,nextComment,stamp,userId).run();
      await log(c,"CLOSE","PURCHASE_REQUISITION",r,before,{status:"CLOSED",reason});
      return json({success:true,id:r.id,status:"CLOSED"});
    }

    if(["submit-requisition","approve-requisition","cancel-requisition"].includes(action)){
      const r=await reqRow(db,c.scope,clean(body?.id),c.serverScope),before={status:r.status};
      let next=r.status,extra={};
      if(action==="submit-requisition"){if(r.status!=="DRAFT"){const e=new Error("На согласование можно отправить только черновик.");e.status=409;throw e}next="PENDING_APPROVAL"}
      if(action==="approve-requisition"){if(r.status!=="PENDING_APPROVAL"){const e=new Error("Согласовать можно только заявку на согласовании.");e.status=409;throw e}next="APPROVED";extra={approved_by:userId,approved_by_name:userName,approved_at:stamp}}
      if(action==="cancel-requisition"){
        const cnt=await db.prepare("SELECT COUNT(*) c FROM procurement_orders WHERE requisition_id=?1 AND status<>'CANCELLED'").bind(r.id).first();
        if(n(cnt?.c)>0){const e=new Error("По заявке уже есть активный заказ поставщику.");e.status=409;throw e}next="CANCELLED"
      }
      await db.prepare(`UPDATE procurement_requisitions SET status=?2,updated_at=?3,updated_by=?4,approved_by=?5,approved_by_name=?6,approved_at=?7 WHERE id=?1`).bind(r.id,next,stamp,userId,extra.approved_by||r.approved_by,extra.approved_by_name||r.approved_by_name,extra.approved_at||r.approved_at).run();
      await log(c,action.replace("-requisition","").toUpperCase(),"PURCHASE_REQUISITION",r,before,{status:next,requiredApprovalLevel:r.required_approval_level,approvedBy:extra.approved_by_name||r.approved_by_name});
      return json({success:true,id:r.id,status:next});
    }

    if(action==="add-quote"){
      const r=await reqRow(db,c.scope,clean(body?.requisitionId),c.serverScope);
      if(!["APPROVED","PENDING_APPROVAL"].includes(r.status)){const e=new Error("Предложения поставщиков добавляются после отправки заявки на согласование.");e.status=409;throw e}
      const supplierId=clean(body?.supplierId),supplierName=clean(body?.supplierName);if(!supplierId)throw new Error("Выберите поставщика.");
      const reqLines=(await db.prepare("SELECT * FROM procurement_requisition_lines WHERE requisition_id=?1").bind(r.id).all()).results||[],reqProducts=new Set(reqLines.map(x=>x.product_id));
      const lines=normalizeLines(body?.lines).map(x=>{if(!reqProducts.has(x.productId))throw new Error("В предложении есть позиция, которой нет в заявке.");return{productId:x.productId,productName:x.productName,unit:x.unit,quantity:x.quantity,packageSize:x.packageSize,packageCount:x.packageCount,vatPercent:x.vatPercent,unitPrice:x.unitPrice,total:money(x.packageCount*x.unitPrice)}});
      const total=money(lines.reduce((sum,x)=>sum+x.total,0)),id=uid();
      await db.prepare(`INSERT INTO procurement_quotes(id,server_scope,requisition_id,supplier_id,supplier_name,status,currency,delivery_days,payment_terms,valid_until,comment,lines_json,total_amount,created_at,created_by,created_by_name) VALUES(?1,?2,?3,?4,?5,'OFFERED',?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`).bind(id,c.serverScope,r.id,supplierId,supplierName,clean(body?.currency||"AZN"),Math.max(0,Math.round(n(body?.deliveryDays))),clean(body?.paymentTerms),clean(body?.validUntil),clean(body?.comment),JSON.stringify(lines),total,stamp,userId,userName).run();
      await log(c,"CREATE","SUPPLIER_QUOTE",r,null,{id,requisitionId:r.id,supplierId,supplierName,totalAmount:total,lines});
      return json({success:true,id,totalAmount:total},201);
    }

    if(action==="create-order"){
      const r=await reqRow(db,c.scope,clean(body?.requisitionId),c.serverScope);
      if(r.status!=="APPROVED"){const e=new Error("PO можно создать только из согласованной заявки.");e.status=409;throw e}
      let quote=null;if(clean(body?.quoteId))quote=await db.prepare("SELECT * FROM procurement_quotes WHERE id=?1 AND server_scope=?2 AND requisition_id=?3 LIMIT 1").bind(clean(body.quoteId),c.serverScope,r.id).first();
      const supplierId=clean(body?.supplierId||quote?.supplier_id),supplierName=clean(body?.supplierName||quote?.supplier_name);if(!supplierId)throw new Error("Выберите поставщика.");
      const reqLines=(await db.prepare("SELECT * FROM procurement_requisition_lines WHERE requisition_id=?1").bind(r.id).all()).results||[],reqBy=new Map(reqLines.map(x=>[x.product_id,x]));
      const sourceLines=body?.lines||(quote?parse(quote.lines_json,[]):[]),lines=normalizeLines(sourceLines);
      const existing=(await db.prepare(`SELECT l.product_id,SUM(l.ordered_qty) qty FROM procurement_order_lines l JOIN procurement_orders o ON o.id=l.order_id WHERE o.requisition_id=?1 AND o.status<>'CANCELLED' GROUP BY l.product_id`).bind(r.id).all()).results||[],already=new Map(existing.map(x=>[x.product_id,n(x.qty)]));
      for(const x of lines){const req=reqBy.get(x.productId);if(!req)throw new Error("В PO есть позиция, которой нет в PR.");const remaining=q(n(req.quantity)-n(already.get(x.productId)));if(x.quantity>remaining+0.0005)throw new Error(`${req.product_name}: количество PO превышает остаток заявки (${remaining}).`)}
      const id=uid(),number=docNo("PO"),total=money(lines.reduce((sum,x)=>sum+x.packageCount*x.unitPrice,0)),row={id,number,restaurant_ids_json:r.restaurant_ids_json,restaurant_names_json:r.restaurant_names_json};
      const stmts=[db.prepare(`INSERT INTO procurement_orders(id,server_scope,number,requisition_id,quote_id,supplier_id,supplier_name,warehouse_id,warehouse_name,status,created_at,updated_at,created_by,created_by_name,comment,restaurant_ids_json,restaurant_names_json,total_amount) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,'APPROVED',?10,?10,?11,?12,?13,?14,?15,?16)`).bind(id,c.serverScope,number,r.id,clean(quote?.id),supplierId,supplierName,r.warehouse_id,r.warehouse_name,stamp,userId,userName,clean(body?.comment),r.restaurant_ids_json,r.restaurant_names_json,total)];
      for(const x of lines)stmts.push(db.prepare(`INSERT INTO procurement_order_lines(id,order_id,product_id,product_name,unit,ordered_qty,confirmed_qty,package_size,package_count,vat_percent,unit_price) VALUES(?1,?2,?3,?4,?5,?6,?6,?7,?8,?9,?10)`).bind(uid(),id,x.productId,x.productName||reqBy.get(x.productId)?.product_name||"",x.unit||reqBy.get(x.productId)?.unit||"",x.quantity,x.packageSize,x.packageCount,x.vatPercent,x.unitPrice));
      if(quote)stmts.push(db.prepare("UPDATE procurement_quotes SET status='SELECTED' WHERE id=?1").bind(quote.id));
      await db.batch(stmts);await log(c,"CREATE","PURCHASE_ORDER",row,null,{id,number,requisitionId:r.id,supplierId,supplierName,totalAmount:total,lines});
      return json({success:true,id,number,status:"APPROVED"},201);
    }

    if(["send-order","confirm-order","cancel-order"].includes(action)){
      const o=await orderRow(db,c.scope,clean(body?.id),c.serverScope),before={status:o.status};
      let next=o.status,sent=o.sent_at,confirmed=o.confirmed_at;
      if(action==="send-order"){if(o.status!=="APPROVED"){const e=new Error("Отправить можно только согласованный PO.");e.status=409;throw e}next="SENT";sent=stamp}
      if(action==="confirm-order"){
        if(!["SENT","APPROVED"].includes(o.status)){const e=new Error("Подтвердить можно только отправленный/согласованный PO.");e.status=409;throw e}next="CONFIRMED";confirmed=stamp;
        const requested=Array.isArray(body?.lines)?body.lines:[];
        if(requested.length){
          const existing=(await db.prepare("SELECT * FROM procurement_order_lines WHERE order_id=?1").bind(o.id).all()).results||[],map=new Map(requested.map(x=>[clean(x.productId),q(x.confirmedQty??x.quantity)]));
          const updates=[];for(const l of existing)if(map.has(l.product_id)){const v=map.get(l.product_id);if(v<0||v>n(l.ordered_qty)+0.0005)throw new Error("Подтверждённое количество некорректно.");updates.push(db.prepare("UPDATE procurement_order_lines SET confirmed_qty=?2 WHERE id=?1").bind(l.id,v))}
          if(updates.length)await db.batch(updates);
        }
      }
      if(action==="cancel-order"){
        const cnt=await db.prepare("SELECT COUNT(*) c FROM procurement_receipts WHERE order_id=?1").bind(o.id).first();if(n(cnt?.c)>0){const e=new Error("Нельзя отменить PO после фактической приёмки.");e.status=409;throw e}next="CANCELLED"
      }
      await db.prepare("UPDATE procurement_orders SET status=?2,updated_at=?3,sent_at=?4,confirmed_at=?5 WHERE id=?1").bind(o.id,next,stamp,sent,confirmed).run();
      await log(c,action.replace("-order","").toUpperCase(),"PURCHASE_ORDER",o,before,{status:next,sentAt:sent,confirmedAt:confirmed});
      return json({success:true,id:o.id,status:next});
    }

    if(action==="sync-receipt"){
      const documentNumber=clean(body?.iikoDocumentNumber);if(!documentNumber)throw new Error("Не указан номер накладной.");
      const receipt=await db.prepare("SELECT * FROM procurement_receipts WHERE server_scope=?1 AND iiko_document_number=?2 LIMIT 1").bind(c.serverScope,documentNumber).first();
      if(!receipt){const e=new Error("Связанная приёмка не найдена.");e.status=404;throw e}
      const o=await orderRow(db,c.scope,receipt.order_id,c.serverScope);
      const lines=normalizeLines(body?.lines,{allowZeroPrice:true}).map(x=>({productId:x.productId,productName:x.productName,unit:x.unit,quantity:x.quantity,packageSize:x.packageSize,packageCount:x.packageCount,vatPercent:x.vatPercent,unitPrice:x.unitPrice,total:money(x.packageCount*x.unitPrice)}));
      const total=money(lines.reduce((s,x)=>s+x.total,0));
      await db.prepare("UPDATE procurement_receipts SET iiko_status=?2,document_date=?3,total_amount=?4,lines_json=?5,comment=?6 WHERE id=?1").bind(receipt.id,clean(body?.iikoStatus||receipt.iiko_status),clean(body?.documentDate||receipt.document_date),total,JSON.stringify(lines),clean(body?.comment||receipt.comment)).run();
      const orderLines=(await db.prepare("SELECT * FROM procurement_order_lines WHERE order_id=?1").bind(o.id).all()).results||[];
      const receiptRows=(await db.prepare("SELECT lines_json FROM procurement_receipts WHERE order_id=?1").bind(o.id).all()).results||[],received=new Map();
      for(const rr of receiptRows)for(const l of parse(rr.lines_json,[])){const pid=clean(l.productId);received.set(pid,n(received.get(pid))+n(l.quantity??l.receivedQty))}
      const completed=orderLines.length>0&&orderLines.every(l=>n(received.get(l.product_id))>=n(l.confirmed_qty||l.ordered_qty)-0.0005);
      const hasAny=[...received.values()].some(v=>v>0),next=completed?"COMPLETED":hasAny?"PARTIALLY_RECEIVED":(["CANCELLED"].includes(o.status)?o.status:"CONFIRMED");
      await db.prepare("UPDATE procurement_orders SET status=?2,updated_at=?3 WHERE id=?1").bind(o.id,next,stamp).run();
      await log(c,"SYNC","PURCHASE_RECEIPT",o,{status:o.status,receiptId:receipt.id},{status:next,receiptId:receipt.id,iikoDocumentNumber:documentNumber,iikoStatus:clean(body?.iikoStatus),totalAmount:total,lines});
      return json({success:true,id:o.id,receiptId:receipt.id,status:next,totalAmount:total});
    }

    if(action==="receive-order"){
      const o=await orderRow(db,c.scope,clean(body?.id),c.serverScope);
      const incomingDocNo=clean(body?.iikoDocumentNumber);
      if(incomingDocNo){
        const duplicate=await db.prepare("SELECT id,order_id,total_amount FROM procurement_receipts WHERE server_scope=?1 AND iiko_document_number=?2 LIMIT 1").bind(c.serverScope,incomingDocNo).first();
        if(duplicate)return json({success:true,id:o.id,receiptId:duplicate.id,status:o.status,totalAmount:n(duplicate.total_amount),duplicate:true});
      }
      if(["CANCELLED","COMPLETED"].includes(o.status)){const e=new Error("Этот заказ уже закрыт.");e.status=409;throw e}
      const orderLines=(await db.prepare("SELECT * FROM procurement_order_lines WHERE order_id=?1").bind(o.id).all()).results||[],by=new Map(orderLines.map(x=>[x.product_id,x]));
      const oldReceipts=(await db.prepare("SELECT lines_json FROM procurement_receipts WHERE order_id=?1").bind(o.id).all()).results||[],received=new Map();
      for(const rec of oldReceipts)for(const l of parse(rec.lines_json,[])){const pid=clean(l.productId);received.set(pid,n(received.get(pid))+n(l.quantity??l.receivedQty))}
      const lines=normalizeLines(body?.lines).map(x=>{const ol=by.get(x.productId);if(!ol)throw new Error("Приёмка содержит позицию вне PO.");const remaining=q(n(ol.confirmed_qty||ol.ordered_qty)-n(received.get(x.productId)));if(!s.allowOverReceipt&&x.quantity>remaining+0.0005)throw new Error(`${ol.product_name}: принимаемое количество больше остатка PO (${remaining}).`);return{productId:x.productId,productName:x.productName||ol.product_name,unit:x.unit||ol.unit,quantity:x.quantity,unitPrice:x.unitPrice,total:money(x.quantity*x.unitPrice)}})
      const id=uid(),total=money(lines.reduce((sum,x)=>sum+x.total,0));
      await db.prepare(`INSERT INTO procurement_receipts(id,server_scope,order_id,iiko_document_number,iiko_document_id,iiko_status,document_date,total_amount,lines_json,comment,created_at,created_by,created_by_name) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`).bind(id,c.serverScope,o.id,clean(body?.iikoDocumentNumber),clean(body?.iikoDocumentId),clean(body?.iikoStatus||"PROCESSED"),clean(body?.documentDate||stamp.slice(0,10)),total,JSON.stringify(lines),clean(body?.comment),stamp,userId,userName).run();
      for(const l of lines)received.set(l.productId,n(received.get(l.productId))+l.quantity);
      const completed=orderLines.length>0&&orderLines.every(l=>n(received.get(l.product_id))>=n(l.confirmed_qty||l.ordered_qty)-0.0005),next=completed?"COMPLETED":"PARTIALLY_RECEIVED";
      await db.prepare("UPDATE procurement_orders SET status=?2,updated_at=?3 WHERE id=?1").bind(o.id,next,stamp).run();
      await log(c,"RECEIVE","PURCHASE_ORDER",o,{status:o.status},{status:next,receiptId:id,iikoDocumentNumber:clean(body?.iikoDocumentNumber),totalAmount:total,lines});
      return json({success:true,id:o.id,receiptId:id,status:next,totalAmount:total});
    }

    return json({success:false,message:"Неизвестное действие закупок."},400);
  }catch(error){
    console.error("[PROCUREMENT]",error);
    return json({success:false,message:error?.message||String(error)},error?.status||500)
  }
}
