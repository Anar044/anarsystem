import { getUser, loadPrivateIikoState, privateConnection, hasPrivateConnection } from "./iiko/_lib/user-state.js";
import { resolveRestaurantScope, cookieDepartmentIds } from "./iiko/_lib/restaurant-scope.js";
import { resolveAccessForUser, hasPermission, requirePermission } from "./access/_lib/access-control.js";
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
function randomToken(){
  const bytes=crypto.getRandomValues(new Uint8Array(32));let raw="";
  for(const b of bytes)raw+=String.fromCharCode(b);
  return btoa(raw).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
async function tokenHash(value){
  const data=new TextEncoder().encode(clean(value));
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",data));
  return [...digest].map(b=>b.toString(16).padStart(2,"0")).join("");
}
function dateKey(){return new Date().toISOString().slice(0,10).replace(/-/g,"")}
function docNo(prefix){return `${prefix}-${dateKey()}-${uid().slice(0,6).toUpperCase()}`}
function actor(user){return clean(user?.user_metadata?.full_name||user?.user_metadata?.name||user?.email||user?.id)}
function unique(values){return [...new Set((values||[]).map(clean).filter(Boolean))]}

async function ensure(db){
  if(!db)throw new Error("D1 binding DB не настроен.");
  // Existing deployments already have the schema. Avoid running dozens of
  // CREATE TABLE / CREATE INDEX / PRAGMA statements on every page read.
  // This lightweight, read-only probe also verifies the migrated columns.
  try{
    await db.prepare(`SELECT
      (SELECT rfq_id FROM procurement_quotes LIMIT 1),
      (SELECT grn_id FROM procurement_receipts LIMIT 1),
      (SELECT variance_status FROM procurement_receipts LIMIT 1),
      (SELECT variance_reason FROM procurement_receipts LIMIT 1),
      (SELECT resolution_method FROM procurement_receipts LIMIT 1),
      (SELECT resolution_status FROM procurement_receipts LIMIT 1),
      (SELECT resolution_note FROM procurement_receipts LIMIT 1),
      (SELECT resolution_by FROM procurement_receipts LIMIT 1),
      (SELECT resolution_at FROM procurement_receipts LIMIT 1),
      (SELECT variance_reviewed_by FROM procurement_receipts LIMIT 1),
      (SELECT variance_reviewed_at FROM procurement_receipts LIMIT 1),
      (SELECT package_size FROM procurement_requisition_lines LIMIT 1),
      (SELECT package_count FROM procurement_requisition_lines LIMIT 1),
      (SELECT container_id FROM procurement_requisition_lines LIMIT 1),
      (SELECT package_name FROM procurement_requisition_lines LIMIT 1),
      (SELECT vat_percent FROM procurement_requisition_lines LIMIT 1),
      (SELECT package_size FROM procurement_order_lines LIMIT 1),
      (SELECT package_count FROM procurement_order_lines LIMIT 1),
      (SELECT container_id FROM procurement_order_lines LIMIT 1),
      (SELECT package_name FROM procurement_order_lines LIMIT 1),
      (SELECT vat_percent FROM procurement_order_lines LIMIT 1),
      (SELECT id FROM procurement_grns LIMIT 1),
      (SELECT id FROM procurement_requisitions LIMIT 1),
      (SELECT id FROM procurement_orders LIMIT 1),
      (SELECT id FROM procurement_rfqs LIMIT 1),
      (SELECT id FROM procurement_rfq_suppliers LIMIT 1),
      (SELECT server_scope FROM procurement_settings LIMIT 1),
      (SELECT server_scope FROM procurement_stock_norms LIMIT 1),
      (SELECT server_scope FROM procurement_supplier_profiles LIMIT 1),
      (SELECT id FROM procurement_supplier_contracts LIMIT 1)`).first();
    return;
  }catch(error){
    // Only missing schema can trigger a migration; do not compound transient
    // D1 failures with write-heavy CREATE/ALTER statements.
    if(!/no such table|no such column/i.test(String(error?.message||error)))throw error;
  }
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
      container_id TEXT NOT NULL DEFAULT '',
      package_name TEXT NOT NULL DEFAULT '',
      vat_percent REAL NOT NULL DEFAULT 0,
      expected_price REAL NOT NULL DEFAULT 0,
      current_stock REAL NOT NULL DEFAULT 0,
      min_stock REAL,
      max_stock REAL,
      store_id TEXT NOT NULL DEFAULT '',
      store_name TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_req_lines_req ON procurement_requisition_lines(requisition_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_rfqs (
      id TEXT PRIMARY KEY,
      server_scope TEXT NOT NULL,
      requisition_id TEXT NOT NULL,
      number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT',
      deadline TEXT NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      supplier_ids_json TEXT NOT NULL DEFAULT '[]',
      supplier_names_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT '',
      created_by_name TEXT NOT NULL DEFAULT '',
      sent_at TEXT NOT NULL DEFAULT '',
      closed_at TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_proc_rfq_scope_number ON procurement_rfqs(server_scope,number)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_rfq_req ON procurement_rfqs(server_scope,requisition_id,created_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_rfq_suppliers (
      id TEXT PRIMARY KEY,
      server_scope TEXT NOT NULL,
      rfq_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      supplier_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      token_hash TEXT NOT NULL DEFAULT '',
      token_created_at TEXT NOT NULL DEFAULT '',
      token_expires_at TEXT NOT NULL DEFAULT '',
      responded_at TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_proc_rfq_supplier_unique ON procurement_rfq_suppliers(rfq_id,supplier_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_rfq_supplier_scope ON procurement_rfq_suppliers(server_scope,rfq_id,status)`),
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
      container_id TEXT NOT NULL DEFAULT '',
      package_name TEXT NOT NULL DEFAULT '',
      vat_percent REAL NOT NULL DEFAULT 0,
      unit_price REAL NOT NULL DEFAULT 0
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_order_lines_order ON procurement_order_lines(order_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_grns (
      id TEXT PRIMARY KEY,
      server_scope TEXT NOT NULL,
      order_id TEXT NOT NULL,
      number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'RECEIVED',
      document_date TEXT NOT NULL,
      supplier_id TEXT NOT NULL DEFAULT '',
      supplier_name TEXT NOT NULL DEFAULT '',
      warehouse_id TEXT NOT NULL DEFAULT '',
      warehouse_name TEXT NOT NULL DEFAULT '',
      total_amount REAL NOT NULL DEFAULT 0,
      lines_json TEXT NOT NULL DEFAULT '[]',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT '',
      created_by_name TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_proc_grn_scope_number ON procurement_grns(server_scope,number)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_grns_order ON procurement_grns(server_scope,order_id,created_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_receipts (
      id TEXT PRIMARY KEY,
      server_scope TEXT NOT NULL,
      order_id TEXT NOT NULL,
      iiko_document_number TEXT NOT NULL DEFAULT '',
      iiko_document_id TEXT NOT NULL DEFAULT '',
      iiko_status TEXT NOT NULL DEFAULT '',
      variance_status TEXT NOT NULL DEFAULT 'NONE',
      variance_reason TEXT NOT NULL DEFAULT '',
      variance_reviewed_by TEXT NOT NULL DEFAULT '',
      variance_reviewed_at TEXT NOT NULL DEFAULT '',
      resolution_method TEXT NOT NULL DEFAULT '',
      resolution_status TEXT NOT NULL DEFAULT 'NONE',
      resolution_note TEXT NOT NULL DEFAULT '',
      resolution_by TEXT NOT NULL DEFAULT '',
      resolution_at TEXT NOT NULL DEFAULT '',
      document_date TEXT NOT NULL,
      total_amount REAL NOT NULL DEFAULT 0,
      lines_json TEXT NOT NULL DEFAULT '[]',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT '',
      created_by_name TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_receipts_order ON procurement_receipts(server_scope,order_id,created_at DESC)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_supplier_profiles (
      server_scope TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      supplier_name TEXT NOT NULL DEFAULT '',
      tax_id TEXT NOT NULL DEFAULT '',
      contact_person TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      address TEXT NOT NULL DEFAULT '',
      payment_terms TEXT NOT NULL DEFAULT '',
      payment_days INTEGER NOT NULL DEFAULT 0,
      min_order_amount REAL NOT NULL DEFAULT 0,
      delivery_days_json TEXT NOT NULL DEFAULT '[]',
      categories_json TEXT NOT NULL DEFAULT '[]',
      note TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_by_name TEXT NOT NULL DEFAULT '',
      PRIMARY KEY(server_scope,supplier_id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_supplier_profiles_scope ON procurement_supplier_profiles(server_scope,supplier_name)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS procurement_supplier_contracts (
      id TEXT PRIMARY KEY,
      server_scope TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      number TEXT NOT NULL DEFAULT '',
      title TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '',
      end_date TEXT NOT NULL DEFAULT '',
      payment_terms TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT NOT NULL DEFAULT '',
      updated_by_name TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_proc_supplier_contracts ON procurement_supplier_contracts(server_scope,supplier_id,end_date)`),
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
  await ensureColumn("procurement_quotes","rfq_id","TEXT NOT NULL DEFAULT ''");
  await ensureColumn("procurement_receipts","grn_id","TEXT NOT NULL DEFAULT ''");
  await ensureColumn("procurement_receipts","variance_status","TEXT NOT NULL DEFAULT 'NONE'");
  await ensureColumn("procurement_receipts","variance_reason","TEXT NOT NULL DEFAULT ''");
  await ensureColumn("procurement_receipts","variance_reviewed_by","TEXT NOT NULL DEFAULT ''");
  await ensureColumn("procurement_receipts","variance_reviewed_at","TEXT NOT NULL DEFAULT ''");
  await ensureColumn("procurement_receipts","resolution_method","TEXT NOT NULL DEFAULT ''");
  await ensureColumn("procurement_receipts","resolution_status","TEXT NOT NULL DEFAULT 'NONE'");
  await ensureColumn("procurement_receipts","resolution_note","TEXT NOT NULL DEFAULT ''");
  await ensureColumn("procurement_receipts","resolution_by","TEXT NOT NULL DEFAULT ''");
  await ensureColumn("procurement_receipts","resolution_at","TEXT NOT NULL DEFAULT ''");
  await ensureColumn("procurement_requisition_lines","package_size","REAL NOT NULL DEFAULT 1");
  await ensureColumn("procurement_requisition_lines","package_count","REAL NOT NULL DEFAULT 0");
  await ensureColumn("procurement_requisition_lines","container_id","TEXT NOT NULL DEFAULT ''");
  await ensureColumn("procurement_requisition_lines","package_name","TEXT NOT NULL DEFAULT ''");
  await ensureColumn("procurement_requisition_lines","vat_percent","REAL NOT NULL DEFAULT 0");
  await ensureColumn("procurement_order_lines","package_size","REAL NOT NULL DEFAULT 1");
  await ensureColumn("procurement_order_lines","package_count","REAL NOT NULL DEFAULT 0");
  await ensureColumn("procurement_order_lines","container_id","TEXT NOT NULL DEFAULT ''");
  await ensureColumn("procurement_order_lines","package_name","TEXT NOT NULL DEFAULT ''");
  await ensureColumn("procurement_order_lines","vat_percent","REAL NOT NULL DEFAULT 0");
}

function scopedByAccess(state,request,access){
  const base=resolveRestaurantScope({state,request,strict:true});
  if(access?.isOwner||access?.scope?.mode!=="SELECTED")return base;

  const allowedIds=new Set((access.scope.departmentIds||[]).map(clean).filter(Boolean));
  const allowedCodes=new Set((access.scope.departmentCodes||[]).map(clean).filter(Boolean));
  const permitted=(base.allRestaurants||[]).filter(r=>allowedIds.has(clean(r.id))||allowedCodes.has(clean(r.code)));
  const permittedIds=unique(permitted.map(x=>x.id));
  if(!permittedIds.length){
    const e=new Error("Для пользователя не назначены доступные подразделения.");e.status=403;e.code="ACCESS_SCOPE_EMPTY";throw e;
  }

  const explicitlyRequested=cookieDepartmentIds(request);
  const forbidden=explicitlyRequested.filter(id=>!permittedIds.includes(id));
  if(forbidden.length){
    const e=new Error("У пользователя нет доступа к выбранному подразделению.");e.status=403;e.code="ACCESS_SCOPE_FORBIDDEN";throw e;
  }

  const selected=explicitlyRequested.length?explicitlyRequested:permittedIds;
  const narrowed=resolveRestaurantScope({state,requestedIds:selected,strict:true});
  return{...narrowed,allowedDepartmentIds:permittedIds,allRestaurants:permitted};
}

async function contextFor(request,env){
  const auth=await getUser(request,env);
  if(!auth){const e=new Error("Необходима авторизация.");e.status=401;throw e}
  const access=await resolveAccessForUser(env.DB,auth.user,{claimInvite:true,request});
  if(!access.allowed){const e=new Error("Доступ к Smart Horeca не назначен.");e.status=403;e.code=access.reason||"ACCESS_DENIED";throw e}
  const storageUserId=access.storageUserId||access.ownerUserId;
  const stored=await loadPrivateIikoState(env.DB,storageUserId,env);
  if(!stored?.found||!hasPrivateConnection(stored.state)){const e=new Error("Сначала подключите Smart Horeca Server в настройках.");e.status=409;throw e}
  const connection=privateConnection(stored.state);
  const serverScope=await serverScopeFromConnection(connection);
  if(!serverScope)throw new Error("Не удалось определить контур подключенного сервера.");
  const scope=scopedByAccess(stored.state,request,access);
  await ensure(env.DB);
  return{auth,access,stored,connection,serverScope,scope,storageUserId};
}

const PROCUREMENT_VIEW_PERMISSIONS={
  catalog:["procurement.request.create"],
  requests:["procurement.request.view_own","procurement.request.view_all"],
  approvals:["procurement.approve"],
  sourcing:["procurement.sourcing"],
  suppliers:["procurement.sourcing"],
  orders:["procurement.po.manage"],
  receiving:["procurement.receive"],
  analytics:["procurement.analytics"],
  norms:["procurement.norms.manage"],
  settings:["procurement.settings.manage"]
};
const PROCUREMENT_ACTION_PERMISSIONS={
  "save-stock-norms":"procurement.norms.manage",
  "save-settings":"procurement.settings.manage",
  "create-requisition":"procurement.request.create",
  "update-requisition":"procurement.request.create",
  "close-requisition":"procurement.request.create",
  "submit-requisition":"procurement.request.create",
  "cancel-requisition":"procurement.request.create",
  "approve-requisition":"procurement.approve",
  "create-rfq":"procurement.sourcing",
  "send-rfq":"procurement.sourcing",
  "close-rfq":"procurement.sourcing",
  "create-rfq-link":"procurement.sourcing",
  "save-supplier-profile":"procurement.sourcing",
  "save-supplier-contract":"procurement.sourcing",
  "delete-supplier-contract":"procurement.sourcing",
  "add-quote":"procurement.sourcing",
  "create-order":"procurement.po.manage",
  "send-order":"procurement.po.manage",
  "confirm-order":"procurement.po.manage",
  "cancel-order":"procurement.po.manage",
  "create-grn":"procurement.receive",
  "link-invoice":"procurement.receive",
  "review-invoice-variance":"procurement.approve",
  "plan-variance-resolution":"procurement.approve",
  "verify-variance-resolution":"procurement.approve",
  "sync-receipt":"procurement.receive",
  "receive-order":"procurement.receive"
};
function requireAnyPermission(access,list){
  if((list||[]).some(p=>hasPermission(access,p)))return;
  const e=new Error("Недостаточно прав для этого раздела закупок.");e.status=403;e.code="ACCESS_DENIED";throw e;
}
function redactProcurementCosts(data){
  const clone=structuredClone(data);
  clone.requisitions=(clone.requisitions||[]).map(r=>({...r,totalEstimate:null,quotes:[],lines:(r.lines||[]).map(l=>({...l,expectedPrice:null})),linkedOrders:(r.linkedOrders||[]).map(o=>({...o,totalAmount:null}))}));
  clone.orders=(clone.orders||[]).map(o=>({...o,totalAmount:null,
    lines:(o.lines||[]).map(l=>({...l,unitPrice:null,invoiceUnitPrice:null,priceDelta:null})),
    grns:(o.grns||[]).map(g=>({...g,totalAmount:null,lines:(g.lines||[]).map(l=>({...l,unitPrice:null,total:null}))})),
    receipts:(o.receipts||[]).map(r=>({...r,totalAmount:null,lines:(r.lines||[]).map(l=>({...l,unitPrice:null,total:null}))})),
    threeWay:o.threeWay?{...o.threeWay,poTotal:null,grnTotal:null,invoiceTotal:null,lines:(o.threeWay.lines||[]).map(l=>({...l,poPrice:null,invoicePrice:null,priceDelta:null}))}:o.threeWay
  }));
  clone.grns=(clone.grns||[]).map(r=>({...r,totalAmount:null,lines:(r.lines||[]).map(l=>({...l,unitPrice:null}))}));
  clone.receipts=(clone.receipts||[]).map(r=>({...r,totalAmount:null,lines:(r.lines||[]).map(l=>({...l,unitPrice:null}))}));
  clone.supplierPerformance=[];
  if(clone.analytics)clone.analytics={...clone.analytics,requisitionEstimate:null,orderedAmount:null,receivedAmount:null,estimatedSavings:null};
  return clone;
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
    const containerId=clean(raw?.containerId);
    if(!(packageSize>0))throw new Error("Фасовка должна быть больше нуля.");
    if(!containerId&&Math.abs(packageSize-1)>0.0005)throw new Error("Ручная фасовка запрещена. Выберите фасовку из iiko.");
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
      containerId,
      packageName:clean(raw?.packageName),
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
function invoiceVariance(grnLines,invoiceLines){
  const a=new Map((grnLines||[]).map(x=>[clean(x.productId),x]));
  const b=new Map((invoiceLines||[]).map(x=>[clean(x.productId),x]));
  const items=[];
  for(const id of new Set([...a.keys(),...b.keys()])){
    if(!id)continue;
    const g=a.get(id),i=b.get(id),grnQty=q(g?.quantity??g?.receivedQty??0),invoiceQty=q(i?.quantity??i?.receivedQty??0);
    const poPrice=money(g?.unitPrice??0),invoicePrice=money(i?.unitPrice??0);
    const quantityDiff=q(invoiceQty-grnQty),priceDiff=money(invoicePrice-poPrice);
    if(Math.abs(quantityDiff)>0.0005||Math.abs(priceDiff)>0.009)items.push({productId:id,quantityDiff,priceDiff});
  }
  return items;
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
async function physicalProgress(db,orderId){
  const orderLines=(await db.prepare("SELECT * FROM procurement_order_lines WHERE order_id=?1").bind(orderId).all()).results||[];
  const grnRows=(await db.prepare("SELECT lines_json FROM procurement_grns WHERE order_id=?1").bind(orderId).all()).results||[];
  const legacyRows=(await db.prepare("SELECT lines_json FROM procurement_receipts WHERE order_id=?1 AND (grn_id IS NULL OR grn_id='')").bind(orderId).all()).results||[];
  const received=new Map();
  for(const row of [...grnRows,...legacyRows])for(const line of parse(row.lines_json,[])){
    const pid=clean(line.productId),value=n(line.quantity??line.receivedQty);
    received.set(pid,n(received.get(pid))+value);
  }
  const completed=orderLines.length>0&&orderLines.every(l=>n(received.get(l.product_id))>=n(l.confirmed_qty||l.ordered_qty)-0.0005);
  const hasAny=[...received.values()].some(v=>v>0.0005);
  return{orderLines,received,completed,hasAny};
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

async function readData(db,serverScope,scope,view=""){
  // PO/receiving pages only need order + physical receipt + invoice records.
  // Empty optional result sets preserve the existing response shape.
  const lightweightOrders=view==="orders"||view==="receiving";
  const empty=()=>Promise.resolve({results:[]});
  const [reqsR,reqLinesR,rfqsR,quotesR,ordersR,orderLinesR,grnsR,receiptsR,normsR,supplierProfilesR,supplierContractsR]=await Promise.all([
    lightweightOrders?empty():db.prepare("SELECT * FROM procurement_requisitions WHERE server_scope=?1 ORDER BY created_at DESC LIMIT 500").bind(serverScope).all(),
    lightweightOrders?empty():db.prepare(`SELECT l.* FROM procurement_requisition_lines l JOIN procurement_requisitions r ON r.id=l.requisition_id WHERE r.server_scope=?1 ORDER BY l.rowid`).bind(serverScope).all(),
    lightweightOrders?empty():db.prepare("SELECT * FROM procurement_rfqs WHERE server_scope=?1 ORDER BY created_at DESC LIMIT 1000").bind(serverScope).all(),
    lightweightOrders?empty():db.prepare("SELECT * FROM procurement_quotes WHERE server_scope=?1 ORDER BY created_at DESC LIMIT 1000").bind(serverScope).all(),
    db.prepare("SELECT * FROM procurement_orders WHERE server_scope=?1 ORDER BY created_at DESC LIMIT 500").bind(serverScope).all(),
    db.prepare(`SELECT l.* FROM procurement_order_lines l JOIN procurement_orders o ON o.id=l.order_id WHERE o.server_scope=?1 ORDER BY l.rowid`).bind(serverScope).all(),
    db.prepare("SELECT * FROM procurement_grns WHERE server_scope=?1 ORDER BY created_at DESC LIMIT 1000").bind(serverScope).all(),
    db.prepare("SELECT * FROM procurement_receipts WHERE server_scope=?1 ORDER BY created_at DESC LIMIT 1000").bind(serverScope).all(),
    lightweightOrders?empty():db.prepare("SELECT * FROM procurement_stock_norms WHERE server_scope=?1 ORDER BY store_name,product_name").bind(serverScope).all(),
    lightweightOrders?empty():db.prepare("SELECT * FROM procurement_supplier_profiles WHERE server_scope=?1 ORDER BY supplier_name").bind(serverScope).all(),
    lightweightOrders?empty():db.prepare("SELECT * FROM procurement_supplier_contracts WHERE server_scope=?1 ORDER BY supplier_id,end_date DESC,created_at DESC").bind(serverScope).all()
  ]);
  const reqRows=(reqsR.results||[]).filter(x=>rowAllowed(x,scope));
  const reqIds=new Set(reqRows.map(x=>x.id));
  const rfqRows=(rfqsR.results||[]).filter(x=>reqIds.has(x.requisition_id));
  const quoteRows=(quotesR.results||[]).filter(x=>reqIds.has(x.requisition_id));
  const orderRows=(ordersR.results||[]).filter(x=>rowAllowed(x,scope));
  const orderIds=new Set(orderRows.map(x=>x.id));
  const receipts=(receiptsR.results||[]).filter(x=>orderIds.has(x.order_id)).map(r=>({
    id:r.id,orderId:r.order_id,grnId:r.grn_id||"",iikoDocumentNumber:r.iiko_document_number,iikoDocumentId:r.iiko_document_id,iikoStatus:r.iiko_status,
    varianceStatus:r.variance_status||"NONE",varianceReason:r.variance_reason||"",varianceReviewedBy:r.variance_reviewed_by||"",varianceReviewedAt:r.variance_reviewed_at||"",
    resolutionMethod:r.resolution_method||"",resolutionStatus:r.resolution_status||"NONE",resolutionNote:r.resolution_note||"",resolutionBy:r.resolution_by||"",resolutionAt:r.resolution_at||"",
    documentDate:r.document_date,totalAmount:n(r.total_amount),lines:parse(r.lines_json,[]),comment:r.comment,createdAt:r.created_at,createdBy:r.created_by_name||r.created_by
  }));
  const realGrns=(grnsR.results||[]).filter(x=>orderIds.has(x.order_id)).map(g=>({
    id:g.id,orderId:g.order_id,number:g.number,status:g.status,documentDate:g.document_date,supplierId:g.supplier_id,supplierName:g.supplier_name,
    warehouseId:g.warehouse_id,warehouseName:g.warehouse_name,totalAmount:n(g.total_amount),lines:parse(g.lines_json,[]),comment:g.comment,
    createdAt:g.created_at,createdBy:g.created_by_name||g.created_by,legacy:false
  }));
  // Backward compatibility: invoices created before GRN support also represent the
  // historical physical receipt, so they remain visible as read-only legacy GRNs.
  const legacyGrns=receipts.filter(r=>!clean(r.grnId)).map(r=>({
    id:"legacy-"+r.id,orderId:r.orderId,number:"GRN · "+(r.iikoDocumentNumber||"legacy"),status:"LEGACY",documentDate:r.documentDate,
    supplierId:"",supplierName:"",warehouseId:"",warehouseName:"",totalAmount:r.totalAmount,lines:r.lines,comment:r.comment,
    createdAt:r.createdAt,createdBy:r.createdBy,legacy:true,invoiceId:r.id
  }));
  const grns=[...realGrns,...legacyGrns];
  const receiptsByOrder=new Map(),grnsByOrder=new Map();
  for(const receipt of receipts){if(!receiptsByOrder.has(receipt.orderId))receiptsByOrder.set(receipt.orderId,[]);receiptsByOrder.get(receipt.orderId).push(receipt)}
  for(const grn of grns){if(!grnsByOrder.has(grn.orderId))grnsByOrder.set(grn.orderId,[]);grnsByOrder.get(grn.orderId).push(grn)}
  const reqLinesBy=new Map();for(const l of reqLinesR.results||[]){if(!reqIds.has(l.requisition_id))continue;if(!reqLinesBy.has(l.requisition_id))reqLinesBy.set(l.requisition_id,[]);reqLinesBy.get(l.requisition_id).push(l)}
  const orderLinesBy=new Map();for(const l of orderLinesR.results||[]){if(!orderIds.has(l.order_id))continue;if(!orderLinesBy.has(l.order_id))orderLinesBy.set(l.order_id,[]);orderLinesBy.get(l.order_id).push(l)}

  const requisitions=reqRows.map(r=>({
    id:r.id,number:r.number,status:r.status,source:r.source,createdAt:r.created_at,updatedAt:r.updated_at,createdById:r.created_by,createdBy:r.created_by_name||r.created_by,
    restaurantIds:parse(r.restaurant_ids_json,[]),restaurantNames:parse(r.restaurant_names_json,[]),warehouseId:r.warehouse_id,warehouseName:r.warehouse_name,
    neededBy:r.needed_by,comment:r.comment,totalEstimate:n(r.total_estimate),requiredApprovalLevel:r.required_approval_level,
    approvedBy:r.approved_by_name||r.approved_by,approvedAt:r.approved_at,
    lines:(reqLinesBy.get(r.id)||[]).map(l=>({id:l.id,productId:l.product_id,productName:l.product_name,unit:l.unit,quantity:n(l.quantity),packageSize:n(l.package_size,1)||1,packageCount:n(l.package_count)||n(l.quantity),containerId:l.container_id||"",packageName:l.package_name||"",vatPercent:n(l.vat_percent),expectedPrice:n(l.expected_price),currentStock:n(l.current_stock),minStock:l.min_stock===null?null:n(l.min_stock),maxStock:l.max_stock===null?null:n(l.max_stock),storeId:l.store_id,storeName:l.store_name})),
    rfqs:rfqRows.filter(x=>x.requisition_id===r.id).map(x=>({
      id:x.id,number:x.number,status:x.status,deadline:x.deadline,message:x.message,
      supplierIds:parse(x.supplier_ids_json,[]),supplierNames:parse(x.supplier_names_json,[]),
      createdAt:x.created_at,createdBy:x.created_by_name||x.created_by,sentAt:x.sent_at,closedAt:x.closed_at,
      responseCount:new Set(quoteRows.filter(q=>q.requisition_id===r.id&&clean(q.rfq_id)===clean(x.id)).map(q=>clean(q.supplier_id)).filter(Boolean)).size
    })),
    quotes:quoteRows.filter(q=>q.requisition_id===r.id).map(q=>({id:q.id,rfqId:q.rfq_id||"",supplierId:q.supplier_id,supplierName:q.supplier_name,status:q.status,currency:q.currency,deliveryDays:n(q.delivery_days),paymentTerms:q.payment_terms,validUntil:q.valid_until,comment:q.comment,totalAmount:n(q.total_amount),lines:parse(q.lines_json,[]),createdAt:q.created_at,createdBy:q.created_by_name||q.created_by}))
  }));

  const orders=orderRows.map(o=>{
    const invoices=receiptsByOrder.get(o.id)||[],orderGrns=grnsByOrder.get(o.id)||[],rawOrderLines=orderLinesBy.get(o.id)||[];
    const received=new Map(),invoiceQty=new Map(),invoicePrices=new Map(),linkedGrnQty=new Map();
    const orderProductIds=new Set(rawOrderLines.map(x=>clean(x.product_id)));

    for(const grn of orderGrns)for(const line of grn.lines||[]){
      const pid=clean(line.productId),qty=n(line.quantity??line.receivedQty);
      received.set(pid,n(received.get(pid))+qty);
    }

    const linkedGrnIds=new Set();
    for(const invoice of invoices){
      let linkedGrn=null;
      if(clean(invoice.grnId))linkedGrn=orderGrns.find(g=>clean(g.id)===clean(invoice.grnId))||null;
      else linkedGrn=orderGrns.find(g=>g.legacy&&g.invoiceId===invoice.id)||null;
      if(linkedGrn&&!linkedGrnIds.has(linkedGrn.id)){
        linkedGrnIds.add(linkedGrn.id);
        for(const line of linkedGrn.lines||[]){
          const pid=clean(line.productId),qty=n(line.quantity??line.receivedQty);
          linkedGrnQty.set(pid,n(linkedGrnQty.get(pid))+qty);
        }
      }
      for(const line of invoice.lines||[]){
        const pid=clean(line.productId),qty=n(line.quantity??line.receivedQty),price=money(line.unitPrice);
        invoiceQty.set(pid,n(invoiceQty.get(pid))+qty);
        if(!invoicePrices.has(pid))invoicePrices.set(pid,[]);
        invoicePrices.get(pid).push(price);
      }
    }

    const lines=rawOrderLines.map(l=>{
      const pid=clean(l.product_id),rec=q(received.get(pid)||0),linked=q(linkedGrnQty.get(pid)||0),inv=q(invoiceQty.get(pid)||0),ord=q(l.ordered_qty),rem=q(Math.max(0,ord-rec));
      const prices=invoicePrices.get(pid)||[],poPrice=n(l.unit_price);
      const priceMismatch=prices.some(p=>Math.abs(p-poPrice)>0.009);
      const invoicePrice=prices.length?money(prices.reduce((s,x)=>s+x,0)/prices.length):null;
      const lineStatus=
        rec>ord+0.0005?"QUANTITY_MISMATCH":
        Math.abs(inv-linked)>0.0005?"INVOICE_QTY_MISMATCH":
        priceMismatch?"PRICE_MISMATCH":
        !orderGrns.length?"WAITING_GRN":
        rec<ord-0.0005?"PARTIAL_GRN":
        linked<rec-0.0005?"WAITING_INVOICE":"MATCHED";
      return{
        id:l.id,productId:pid,productName:l.product_name,unit:l.unit,orderedQty:ord,confirmedQty:q(l.confirmed_qty||l.ordered_qty),
        packageSize:n(l.package_size,1)||1,packageCount:n(l.package_count)||ord,containerId:l.container_id||"",packageName:l.package_name||"",
        vatPercent:n(l.vat_percent),unitPrice:poPrice,receivedQty:rec,grnQty:rec,linkedGrnQty:linked,invoicedQty:inv,invoiceUnitPrice:invoicePrice,remainingQty:rem,
        quantityDelta:q(rec-ord),invoiceQuantityDelta:q(inv-linked),priceDelta:invoicePrice===null?null:money(invoicePrice-poPrice),threeWayStatus:lineStatus
      };
    });

    const extraInvoiceLines=[];
    for(const [pid,inv] of invoiceQty.entries()){
      if(orderProductIds.has(pid))continue;
      const sample=invoices.flatMap(x=>x.lines||[]).find(x=>clean(x.productId)===pid)||{};
      const prices=invoicePrices.get(pid)||[],invoicePrice=prices.length?money(prices.reduce((s,x)=>s+x,0)/prices.length):null;
      extraInvoiceLines.push({
        productId:pid,productName:clean(sample.productName)||pid,unit:clean(sample.unit),poQty:0,grnQty:n(received.get(pid)),invoiceQty:q(inv),
        poPrice:null,invoicePrice,quantityDelta:n(received.get(pid)),invoiceQuantityDelta:q(inv-n(linkedGrnQty.get(pid))),priceDelta:null,status:"INVOICE_QTY_MISMATCH",extra:true
      });
    }

    const orderedQty=lines.reduce((s,x)=>s+x.orderedQty,0),receivedQty=lines.reduce((s,x)=>s+Math.min(x.orderedQty,x.receivedQty),0);
    const completed=lines.length>0&&lines.every(x=>x.remainingQty<=0.0005);
    const over=lines.some(x=>x.receivedQty>x.orderedQty+0.0005);
    const invoiceQtyMismatch=lines.some(x=>Math.abs(x.invoicedQty-x.linkedGrnQty)>0.0005)||extraInvoiceLines.length>0;
    const priceMismatch=lines.some(x=>x.priceDelta!==null&&Math.abs(x.priceDelta)>0.009);
    const unlinkedGrnCount=orderGrns.filter(g=>!g.legacy&&!linkedGrnIds.has(g.id)).length;
    const effectiveStatus=o.status==="CANCELLED"?"CANCELLED":completed?"COMPLETED":receivedQty>0?"PARTIALLY_RECEIVED":o.status;

    let matchStatus="WAITING_GRN";
    if(orderGrns.length){
      if(over)matchStatus="QUANTITY_MISMATCH";
      else if(invoiceQtyMismatch)matchStatus="INVOICE_QTY_MISMATCH";
      else if(priceMismatch)matchStatus="PRICE_MISMATCH";
      else if(!completed)matchStatus="PARTIAL_GRN";
      else if(unlinkedGrnCount>0||!invoices.length)matchStatus="WAITING_INVOICE";
      else matchStatus="MATCHED";
    }

    const enrichedGrns=orderGrns.map(g=>({
      ...g,
      invoices:g.legacy
        ? invoices.filter(x=>x.id===g.invoiceId)
        : invoices.filter(x=>clean(x.grnId)===clean(g.id))
    }));
    const grnTotal=money(orderGrns.reduce((s,g)=>s+n(g.totalAmount),0));
    const invoiceTotal=money(invoices.reduce((s,r)=>s+n(r.totalAmount),0));
    const threeWay={
      status:matchStatus,poTotal:n(o.total_amount),grnTotal,invoiceTotal,grnCount:orderGrns.length,invoiceCount:invoices.length,
      unlinkedGrnCount,quantityMatched:!over&&!invoiceQtyMismatch,priceMatched:!priceMismatch,
      lines:[
        ...lines.map(x=>({
          productId:x.productId,productName:x.productName,unit:x.unit,poQty:x.orderedQty,grnQty:x.receivedQty,invoiceQty:x.invoicedQty,
          poPrice:x.unitPrice,invoicePrice:x.invoiceUnitPrice,quantityDelta:x.quantityDelta,invoiceQuantityDelta:x.invoiceQuantityDelta,priceDelta:x.priceDelta,status:x.threeWayStatus
        })),
        ...extraInvoiceLines
      ]
    };

    return{
      id:o.id,number:o.number,requisitionId:o.requisition_id,quoteId:o.quote_id,supplierId:o.supplier_id,supplierName:o.supplier_name,
      warehouseId:o.warehouse_id,warehouseName:o.warehouse_name,status:o.status,effectiveStatus,createdAt:o.created_at,updatedAt:o.updated_at,
      createdById:o.created_by,createdBy:o.created_by_name||o.created_by,sentAt:o.sent_at,confirmedAt:o.confirmed_at,comment:o.comment,totalAmount:n(o.total_amount),
      restaurantIds:parse(o.restaurant_ids_json,[]),restaurantNames:parse(o.restaurant_names_json,[]),
      orderedQty:q(orderedQty),receivedQty:q(receivedQty),completionPercent:orderedQty>0?Math.round(receivedQty/orderedQty*1000)/10:0,matchStatus,
      lines,grns:enrichedGrns,receipts:invoices,threeWay
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
    s.receivedAmount+=(o.grns||[]).reduce((a,r)=>a+n(r.totalAmount),0);
  }
  const supplierPerformance=[...supplierMap.values()].map(s=>({...s,totalAmount:money(s.totalAmount),receivedAmount:money(s.receivedAmount),avgCompletion:s.orders?Math.round(s._completion/s.orders*10)/10:0,_completion:undefined})).sort((a,b)=>b.totalAmount-a.totalAmount);
  const estimate=requisitionsWithProgress.reduce((s,r)=>s+n(r.totalEstimate),0),ordered=orders.filter(x=>x.effectiveStatus!=="CANCELLED").reduce((s,o)=>s+n(o.totalAmount),0),receivedAmount=grns.reduce((s,r)=>s+n(r.totalAmount),0);
  const stockNorms=(normsR.results||[]).filter(x=>rowAllowed(x,scope)).map(x=>({
    storeId:x.store_id,storeName:x.store_name,productId:x.product_id,productName:x.product_name,unit:x.unit,
    minStock:x.min_stock===null?null:n(x.min_stock),targetStock:x.target_stock===null?null:n(x.target_stock),
    leadDays:n(x.lead_days),enabled:Number(x.enabled)!==0,updatedAt:x.updated_at,updatedBy:x.updated_by_name||x.updated_by
  }));
  const supplierProfiles=(supplierProfilesR.results||[]).map(x=>({
    supplierId:x.supplier_id,supplierName:x.supplier_name,taxId:x.tax_id,contactPerson:x.contact_person,phone:x.phone,email:x.email,address:x.address,
    paymentTerms:x.payment_terms,paymentDays:n(x.payment_days),minOrderAmount:n(x.min_order_amount),
    deliveryDays:parse(x.delivery_days_json,[]),categories:parse(x.categories_json,[]),note:x.note,updatedAt:x.updated_at,updatedBy:x.updated_by_name||x.updated_by
  }));
  const supplierContracts=(supplierContractsR.results||[]).map(x=>({
    id:x.id,supplierId:x.supplier_id,number:x.number,title:x.title,startDate:x.start_date,endDate:x.end_date,paymentTerms:x.payment_terms,status:x.status,comment:x.comment,
    createdAt:x.created_at,updatedAt:x.updated_at,updatedBy:x.updated_by_name||x.updated_by
  }));
  return{
    requisitions:requisitionsWithProgress,orders,grns,receipts,stockNorms,supplierPerformance,supplierProfiles,supplierContracts,
    analytics:{requisitionEstimate:money(estimate),orderedAmount:money(ordered),receivedAmount:money(receivedAmount),estimatedSavings:money(Math.max(0,estimate-ordered)),activeOrders:orders.filter(x=>!["COMPLETED","CANCELLED"].includes(x.effectiveStatus)).length,completedOrders:orders.filter(x=>x.effectiveStatus==="COMPLETED").length,pendingApprovals:requisitionsWithProgress.filter(x=>x.status==="PENDING_APPROVAL").length,completedRequisitions:requisitionsWithProgress.filter(x=>x.effectiveStatus==="COMPLETED").length}
  };
}

export async function onRequestOptions(){return new Response(null,{status:204,headers:HEADERS})}

export async function onRequestGet({request,env}){
  try{
    const c=await contextFor(request,env);
    const url=new URL(request.url),view=clean(url.searchParams.get("view")||"catalog").toLowerCase();
    requireAnyPermission(c.access,PROCUREMENT_VIEW_PERMISSIONS[view]||PROCUREMENT_VIEW_PERMISSIONS.catalog);
    let data=await readData(env.DB,c.serverScope,c.scope,view);

    if(view==="requests"&&!hasPermission(c.access,"procurement.request.view_all")){
      data={...data,requisitions:(data.requisitions||[]).filter(r=>clean(r.createdById)===clean(c.auth.user.id)),orders:[],grns:[],receipts:[],supplierPerformance:[]};
    }
    if(view==="approvals")data={...data,requisitions:(data.requisitions||[]).filter(r=>r.status==="PENDING_APPROVAL"),orders:[],grns:[],receipts:[],supplierPerformance:[]};
    if(view==="catalog"||view==="norms")data={...data,requisitions:[],orders:[],grns:[],receipts:[],supplierPerformance:[]};
    if(view==="sourcing")data={...data,orders:[],grns:[],receipts:[]};
    if(view==="suppliers")data={...data,requisitions:[],orders:[],grns:[],receipts:[],stockNorms:[]};
    if(view==="orders"||view==="receiving")data={...data,requisitions:[],supplierPerformance:view==="orders"?data.supplierPerformance:[]};
    if(!["suppliers","sourcing","analytics"].includes(view))data={...data,supplierProfiles:[],supplierContracts:[]};
    if(!hasPermission(c.access,"procurement.prices.view")&&!hasPermission(c.access,"sensitive.cost.view"))data=redactProcurementCosts(data);

    return json({success:true,settings:view==="settings"?await settings(env.DB,c.serverScope):undefined,access:{permissions:c.access.permissions,scope:c.access.scope},scope:{mode:c.scope.mode,isChain:c.scope.isChain,selectedDepartmentIds:c.scope.selectedDepartmentIds,selectedRestaurants:c.scope.selectedRestaurants,fullSelection:isFullScope(c.scope)},...data});
  }catch(error){return json({success:false,message:error?.message||String(error),code:error?.code||""},error?.status||500)}
}

export async function onRequestPost({request,env}){
  try{
    const body=await request.json().catch(()=>({})),action=clean(body?.action).toLowerCase();
    const c=await contextFor(request,env);c.request=request;c.env=env;
    const requiredPermission=PROCUREMENT_ACTION_PERMISSIONS[action];
    if(requiredPermission)requirePermission(c.access,requiredPermission);
    else{const e=new Error("Действие закупок не разрешено.");e.status=403;e.code="ACCESS_ACTION_UNKNOWN";throw e}
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
      for(const x of lines)stmts.push(db.prepare(`INSERT INTO procurement_requisition_lines(id,requisition_id,product_id,product_name,unit,quantity,package_size,package_count,container_id,package_name,vat_percent,expected_price,current_stock,min_stock,max_stock,store_id,store_name) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`).bind(uid(),id,x.productId,x.productName,x.unit,x.quantity,x.packageSize,x.packageCount,x.containerId,x.packageName,x.vatPercent,x.unitPrice,x.currentStock,x.minStock,x.maxStock,x.storeId,x.storeName));
      await db.batch(stmts);
      await log(c,"CREATE","PURCHASE_REQUISITION",row,null,{id,number,status:"DRAFT",warehouseId,warehouseName,totalEstimate:total,requiredApprovalLevel:level,lines});
      return json({success:true,id,number,status:"DRAFT"},201);
    }

    if(action==="update-requisition"){
      const r=await reqRow(db,c.scope,clean(body?.id),c.serverScope);if(r.status!=="DRAFT"){const e=new Error("Изменять можно только черновик заявки.");e.status=409;throw e}
      const lines=normalizeLines(body?.lines,{allowZeroPrice:true}),warehouseId=clean(body?.warehouseId||r.warehouse_id),warehouseName=clean(body?.warehouseName||r.warehouse_name),total=money(lines.reduce((sum,x)=>sum+x.packageCount*x.unitPrice,0)),level=approvalLevel(total,s);
      const before={...r,lines:(await db.prepare("SELECT * FROM procurement_requisition_lines WHERE requisition_id=?1").bind(r.id).all()).results||[]};
      const stmts=[db.prepare("DELETE FROM procurement_requisition_lines WHERE requisition_id=?1").bind(r.id),db.prepare(`UPDATE procurement_requisitions SET updated_at=?2,updated_by=?3,warehouse_id=?4,warehouse_name=?5,needed_by=?6,comment=?7,total_estimate=?8,required_approval_level=?9 WHERE id=?1`).bind(r.id,stamp,userId,warehouseId,warehouseName,clean(body?.neededBy),clean(body?.comment),total,level)];
      for(const x of lines)stmts.push(db.prepare(`INSERT INTO procurement_requisition_lines(id,requisition_id,product_id,product_name,unit,quantity,package_size,package_count,container_id,package_name,vat_percent,expected_price,current_stock,min_stock,max_stock,store_id,store_name) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`).bind(uid(),r.id,x.productId,x.productName,x.unit,x.quantity,x.packageSize,x.packageCount,x.containerId,x.packageName,x.vatPercent,x.unitPrice,x.currentStock,x.minStock,x.maxStock,x.storeId,x.storeName));
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

    if(action==="save-supplier-profile"){
      const supplierId=clean(body?.supplierId),supplierName=clean(body?.supplierName);if(!supplierId)throw new Error("Выберите поставщика.");
      const deliveryDays=unique((Array.isArray(body?.deliveryDays)?body.deliveryDays:[]).map(x=>String(Math.round(n(x)))).filter(x=>["1","2","3","4","5","6","7"].includes(x))).map(Number).sort((a,b)=>a-b);
      const categories=unique(Array.isArray(body?.categories)?body.categories:clean(body?.categories).split(",")).slice(0,50);
      const paymentDays=Math.max(0,Math.round(n(body?.paymentDays))),minOrder=Math.max(0,money(body?.minOrderAmount));
      await db.prepare(`INSERT INTO procurement_supplier_profiles(server_scope,supplier_id,supplier_name,tax_id,contact_person,phone,email,address,payment_terms,payment_days,min_order_amount,delivery_days_json,categories_json,note,updated_at,updated_by,updated_by_name)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)
        ON CONFLICT(server_scope,supplier_id) DO UPDATE SET supplier_name=excluded.supplier_name,tax_id=excluded.tax_id,contact_person=excluded.contact_person,phone=excluded.phone,email=excluded.email,address=excluded.address,payment_terms=excluded.payment_terms,payment_days=excluded.payment_days,min_order_amount=excluded.min_order_amount,delivery_days_json=excluded.delivery_days_json,categories_json=excluded.categories_json,note=excluded.note,updated_at=excluded.updated_at,updated_by=excluded.updated_by,updated_by_name=excluded.updated_by_name`)
        .bind(c.serverScope,supplierId,supplierName,clean(body?.taxId),clean(body?.contactPerson),clean(body?.phone),clean(body?.email),clean(body?.address),clean(body?.paymentTerms),paymentDays,minOrder,JSON.stringify(deliveryDays),JSON.stringify(categories),clean(body?.note),stamp,userId,userName).run();
      await log(c,"UPDATE","SUPPLIER_PROFILE",{id:supplierId,number:supplierName,restaurant_ids_json:"[]",restaurant_names_json:"[]"},null,{supplierId,supplierName,taxId:clean(body?.taxId),paymentDays,minOrderAmount:minOrder,deliveryDays,categories});
      return json({success:true,supplierId});
    }

    if(action==="save-supplier-contract"){
      const supplierId=clean(body?.supplierId),id=clean(body?.id)||uid();if(!supplierId)throw new Error("Выберите поставщика.");
      const status=["ACTIVE","EXPIRED","DRAFT","CANCELLED"].includes(String(body?.status||"").toUpperCase())?String(body.status).toUpperCase():"ACTIVE";
      const existing=await db.prepare("SELECT * FROM procurement_supplier_contracts WHERE id=?1 AND server_scope=?2 LIMIT 1").bind(id,c.serverScope).first();
      if(existing&&clean(existing.supplier_id)!==supplierId){const e=new Error("Договор относится к другому поставщику.");e.status=409;throw e}
      if(existing){
        await db.prepare(`UPDATE procurement_supplier_contracts SET number=?2,title=?3,start_date=?4,end_date=?5,payment_terms=?6,status=?7,comment=?8,updated_at=?9,updated_by=?10,updated_by_name=?11 WHERE id=?1`)
          .bind(id,clean(body?.number),clean(body?.title),clean(body?.startDate),clean(body?.endDate),clean(body?.paymentTerms),status,clean(body?.comment),stamp,userId,userName).run();
      }else{
        await db.prepare(`INSERT INTO procurement_supplier_contracts(id,server_scope,supplier_id,number,title,start_date,end_date,payment_terms,status,comment,created_at,updated_at,updated_by,updated_by_name)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11,?12,?13)`)
          .bind(id,c.serverScope,supplierId,clean(body?.number),clean(body?.title),clean(body?.startDate),clean(body?.endDate),clean(body?.paymentTerms),status,clean(body?.comment),stamp,userId,userName).run();
      }
      await log(c,existing?"UPDATE":"CREATE","SUPPLIER_CONTRACT",{id,number:clean(body?.number),restaurant_ids_json:"[]",restaurant_names_json:"[]"},existing?{status:existing.status,endDate:existing.end_date}:null,{supplierId,status,endDate:clean(body?.endDate)});
      return json({success:true,id});
    }

    if(action==="delete-supplier-contract"){
      const id=clean(body?.id);if(!id)throw new Error("Не указан договор.");
      const existing=await db.prepare("SELECT * FROM procurement_supplier_contracts WHERE id=?1 AND server_scope=?2 LIMIT 1").bind(id,c.serverScope).first();
      if(!existing){const e=new Error("Договор не найден.");e.status=404;throw e}
      await db.prepare("DELETE FROM procurement_supplier_contracts WHERE id=?1 AND server_scope=?2").bind(id,c.serverScope).run();
      await log(c,"DELETE","SUPPLIER_CONTRACT",{id,number:existing.number,restaurant_ids_json:"[]",restaurant_names_json:"[]"},existing,null);
      return json({success:true,id});
    }

    if(action==="create-rfq"){
      const r=await reqRow(db,c.scope,clean(body?.requisitionId),c.serverScope);
      if(r.status!=="APPROVED"){const e=new Error("RFQ можно создать только по согласованной заявке.");e.status=409;throw e}
      const suppliers=Array.isArray(body?.suppliers)?body.suppliers:[],normalized=[],seen=new Set();
      for(const raw of suppliers){
        const id=clean(raw?.id),name=clean(raw?.name);
        if(!id||seen.has(id))continue;
        seen.add(id);normalized.push({id,name:name||id});
      }
      if(!normalized.length)throw new Error("Выберите хотя бы одного поставщика для RFQ.");
      const id=uid(),number=docNo("RFQ"),deadline=clean(body?.deadline),message=clean(body?.message),row={id,number,restaurant_ids_json:r.restaurant_ids_json,restaurant_names_json:r.restaurant_names_json};
      const stmts=[db.prepare(`INSERT INTO procurement_rfqs(id,server_scope,requisition_id,number,status,deadline,message,supplier_ids_json,supplier_names_json,created_at,created_by,created_by_name)
        VALUES(?1,?2,?3,?4,'DRAFT',?5,?6,?7,?8,?9,?10,?11)`)
        .bind(id,c.serverScope,r.id,number,deadline,message,JSON.stringify(normalized.map(x=>x.id)),JSON.stringify(normalized.map(x=>x.name)),stamp,userId,userName)];
      for(const s of normalized)stmts.push(db.prepare(`INSERT INTO procurement_rfq_suppliers(id,server_scope,rfq_id,supplier_id,supplier_name,status) VALUES(?1,?2,?3,?4,?5,'PENDING')`).bind(uid(),c.serverScope,id,s.id,s.name));
      await db.batch(stmts);
      await log(c,"CREATE","REQUEST_FOR_QUOTATION",row,null,{id,number,requisitionId:r.id,deadline,suppliers:normalized});
      return json({success:true,id,number,status:"DRAFT"},201);
    }

    if(action==="create-rfq-link"){
      const rfqId=clean(body?.id),supplierId=clean(body?.supplierId);
      if(!rfqId||!supplierId)throw new Error("Не указан RFQ или поставщик.");
      const rfq=await db.prepare("SELECT q.*,r.restaurant_ids_json,r.restaurant_names_json FROM procurement_rfqs q JOIN procurement_requisitions r ON r.id=q.requisition_id WHERE q.id=?1 AND q.server_scope=?2 LIMIT 1").bind(rfqId,c.serverScope).first();
      if(!rfq){const e=new Error("RFQ не найден.");e.status=404;throw e}
      assertAllowed(rfq,c.scope);
      if(rfq.status==="CLOSED"){const e=new Error("RFQ уже закрыт.");e.status=409;throw e}
      let supplier=await db.prepare("SELECT * FROM procurement_rfq_suppliers WHERE rfq_id=?1 AND supplier_id=?2 LIMIT 1").bind(rfqId,supplierId).first();
      if(!supplier){
        const ids=parse(rfq.supplier_ids_json,[]).map(clean),names=parse(rfq.supplier_names_json,[]);
        const idx=ids.indexOf(supplierId);
        if(idx<0){const e=new Error("Поставщик не входит в этот RFQ.");e.status=404;throw e}
        const sid=uid(),name=clean(names[idx]||supplierId);
        await db.prepare("INSERT INTO procurement_rfq_suppliers(id,server_scope,rfq_id,supplier_id,supplier_name,status) VALUES(?1,?2,?3,?4,?5,'PENDING')").bind(sid,c.serverScope,rfqId,supplierId,name).run();
        supplier=await db.prepare("SELECT * FROM procurement_rfq_suppliers WHERE id=?1").bind(sid).first();
      }
      const token=randomToken(),hash=await tokenHash(token);
      const deadlineMs=rfq.deadline?new Date(rfq.deadline+"T23:59:59Z").getTime():0;
      const expires=new Date(deadlineMs>Date.now()?deadlineMs:Date.now()+7*24*3600*1000).toISOString();
      await db.prepare("UPDATE procurement_rfq_suppliers SET token_hash=?2,token_created_at=?3,token_expires_at=?4 WHERE id=?1").bind(supplier.id,hash,stamp,expires).run();
      const origin=new URL(request.url).origin,link=origin+"/rfq-response.html?token="+encodeURIComponent(token);
      await log(c,"CREATE_LINK","REQUEST_FOR_QUOTATION",rfq,null,{rfqId,supplierId,supplierName:supplier.supplier_name,expiresAt:expires});
      return json({success:true,id:rfqId,supplierId,link,expiresAt:expires});
    }

    if(["send-rfq","close-rfq"].includes(action)){
      const id=clean(body?.id);
      const rfq=await db.prepare("SELECT q.*,r.restaurant_ids_json,r.restaurant_names_json FROM procurement_rfqs q JOIN procurement_requisitions r ON r.id=q.requisition_id WHERE q.id=?1 AND q.server_scope=?2 LIMIT 1").bind(id,c.serverScope).first();
      if(!rfq){const e=new Error("RFQ не найден.");e.status=404;throw e}
      assertAllowed(rfq,c.scope);
      let next=rfq.status,sent=rfq.sent_at,closed=rfq.closed_at;
      if(action==="send-rfq"){
        if(!["DRAFT","SENT"].includes(rfq.status)){const e=new Error("Отправить можно только открытый RFQ.");e.status=409;throw e}
        next="SENT";if(!sent)sent=stamp;
      }else{
        if(rfq.status==="CLOSED")return json({success:true,id,status:"CLOSED"});
        next="CLOSED";closed=stamp;
      }
      await db.prepare("UPDATE procurement_rfqs SET status=?2,sent_at=?3,closed_at=?4 WHERE id=?1").bind(id,next,sent,closed).run();
      await log(c,action==="send-rfq"?"SEND":"CLOSE","REQUEST_FOR_QUOTATION",rfq,{status:rfq.status},{status:next,sentAt:sent,closedAt:closed});
      return json({success:true,id,status:next});
    }

    if(action==="add-quote"){
      const r=await reqRow(db,c.scope,clean(body?.requisitionId),c.serverScope);
      if(!["APPROVED","PENDING_APPROVAL"].includes(r.status)){const e=new Error("Предложения поставщиков добавляются после отправки заявки на согласование.");e.status=409;throw e}
      const supplierId=clean(body?.supplierId),supplierName=clean(body?.supplierName);if(!supplierId)throw new Error("Выберите поставщика.");
      const rfqId=clean(body?.rfqId);
      if(rfqId){
        const rfq=await db.prepare("SELECT * FROM procurement_rfqs WHERE id=?1 AND server_scope=?2 AND requisition_id=?3 LIMIT 1").bind(rfqId,c.serverScope,r.id).first();
        if(!rfq){const e=new Error("RFQ не найден.");e.status=404;throw e}
        if(rfq.status==="CLOSED"){const e=new Error("Этот RFQ уже закрыт.");e.status=409;throw e}
        const allowed=new Set(parse(rfq.supplier_ids_json,[]).map(clean));
        if(!allowed.has(supplierId)){const e=new Error("Этот поставщик не входит в выбранный RFQ.");e.status=409;throw e}
      }
      const reqLines=(await db.prepare("SELECT * FROM procurement_requisition_lines WHERE requisition_id=?1").bind(r.id).all()).results||[],reqProducts=new Set(reqLines.map(x=>x.product_id));
      const lines=normalizeLines(body?.lines).map(x=>{if(!reqProducts.has(x.productId))throw new Error("В предложении есть позиция, которой нет в заявке.");return{productId:x.productId,productName:x.productName,unit:x.unit,quantity:x.quantity,packageSize:x.packageSize,packageCount:x.packageCount,containerId:x.containerId,packageName:x.packageName,vatPercent:x.vatPercent,unitPrice:x.unitPrice,total:money(x.packageCount*x.unitPrice)}});
      const total=money(lines.reduce((sum,x)=>sum+x.total,0));
      let existingQuote=rfqId?await db.prepare("SELECT * FROM procurement_quotes WHERE rfq_id=?1 AND supplier_id=?2 ORDER BY created_at DESC LIMIT 1").bind(rfqId,supplierId).first():null;
      if(existingQuote?.status==="SELECTED"){const e=new Error("По этому предложению уже создан PO. Изменение заблокировано.");e.status=409;throw e}
      const id=existingQuote?.id||uid(),currency=clean(body?.currency||"AZN"),deliveryDays=Math.max(0,Math.round(n(body?.deliveryDays))),paymentTerms=clean(body?.paymentTerms),validUntil=clean(body?.validUntil),comment=clean(body?.comment);
      if(existingQuote){
        await db.prepare(`UPDATE procurement_quotes SET supplier_name=?2,status='OFFERED',currency=?3,delivery_days=?4,payment_terms=?5,valid_until=?6,comment=?7,lines_json=?8,total_amount=?9,created_at=?10,created_by=?11,created_by_name=?12 WHERE id=?1`)
          .bind(id,supplierName,currency,deliveryDays,paymentTerms,validUntil,comment,JSON.stringify(lines),total,stamp,userId,userName).run();
      }else{
        await db.prepare(`INSERT INTO procurement_quotes(id,server_scope,requisition_id,rfq_id,supplier_id,supplier_name,status,currency,delivery_days,payment_terms,valid_until,comment,lines_json,total_amount,created_at,created_by,created_by_name) VALUES(?1,?2,?3,?4,?5,?6,'OFFERED',?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)`)
          .bind(id,c.serverScope,r.id,rfqId,supplierId,supplierName,currency,deliveryDays,paymentTerms,validUntil,comment,JSON.stringify(lines),total,stamp,userId,userName).run();
      }
      if(rfqId)await db.prepare("UPDATE procurement_rfq_suppliers SET status='RESPONDED',responded_at=?3 WHERE rfq_id=?1 AND supplier_id=?2").bind(rfqId,supplierId,stamp).run();
      await log(c,existingQuote?"UPDATE":"CREATE","SUPPLIER_QUOTE",r,existingQuote?{id:existingQuote.id,totalAmount:n(existingQuote.total_amount)}:null,{id,rfqId,requisitionId:r.id,supplierId,supplierName,totalAmount:total,lines});
      return json({success:true,id,totalAmount:total},existingQuote?200:201);
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
      for(const x of lines)stmts.push(db.prepare(`INSERT INTO procurement_order_lines(id,order_id,product_id,product_name,unit,ordered_qty,confirmed_qty,package_size,package_count,container_id,package_name,vat_percent,unit_price) VALUES(?1,?2,?3,?4,?5,?6,?6,?7,?8,?9,?10,?11,?12)`).bind(uid(),id,x.productId,x.productName||reqBy.get(x.productId)?.product_name||"",x.unit||reqBy.get(x.productId)?.unit||"",x.quantity,x.packageSize,x.packageCount,x.containerId,x.packageName,x.vatPercent,x.unitPrice));
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
        const [invoiceCnt,grnCnt]=await Promise.all([
          db.prepare("SELECT COUNT(*) c FROM procurement_receipts WHERE order_id=?1").bind(o.id).first(),
          db.prepare("SELECT COUNT(*) c FROM procurement_grns WHERE order_id=?1").bind(o.id).first()
        ]);
        if(n(invoiceCnt?.c)>0||n(grnCnt?.c)>0){const e=new Error("Нельзя отменить PO после создания GRN или приходной накладной.");e.status=409;throw e}
        next="CANCELLED"
      }
      await db.prepare("UPDATE procurement_orders SET status=?2,updated_at=?3,sent_at=?4,confirmed_at=?5 WHERE id=?1").bind(o.id,next,stamp,sent,confirmed).run();
      await log(c,action.replace("-order","").toUpperCase(),"PURCHASE_ORDER",o,before,{status:next,sentAt:sent,confirmedAt:confirmed});
      return json({success:true,id:o.id,status:next});
    }

    if(action==="create-grn"){
      const o=await orderRow(db,c.scope,clean(body?.id),c.serverScope);
      if(o.status==="CANCELLED"){const e=new Error("Отменённый PO нельзя принимать.");e.status=409;throw e}
      const progress=await physicalProgress(db,o.id),by=new Map(progress.orderLines.map(x=>[x.product_id,x]));
      const lines=normalizeLines(body?.lines,{allowZeroPrice:true}).map(x=>{
        const ol=by.get(x.productId);
        if(!ol)throw new Error("GRN содержит позицию вне PO.");
        const remaining=q(n(ol.confirmed_qty||ol.ordered_qty)-n(progress.received.get(x.productId)));
        if(!s.allowOverReceipt&&x.quantity>remaining+0.0005)throw new Error(`${ol.product_name}: принимаемое количество больше остатка PO (${remaining}).`);
        const poPrice=n(ol.unit_price);
        return{
          productId:x.productId,productName:x.productName||ol.product_name,unit:x.unit||ol.unit,quantity:x.quantity,
          packageSize:x.packageSize,packageCount:x.packageCount,containerId:x.containerId,packageName:x.packageName,
          vatPercent:n(ol.vat_percent),unitPrice:poPrice,total:money(x.packageCount*poPrice)
        };
      });
      const id=uid(),number=docNo("GRN"),total=money(lines.reduce((sum,x)=>sum+x.total,0)),documentDate=clean(body?.documentDate||stamp.slice(0,10));
      await db.prepare(`INSERT INTO procurement_grns(id,server_scope,order_id,number,status,document_date,supplier_id,supplier_name,warehouse_id,warehouse_name,total_amount,lines_json,comment,created_at,created_by,created_by_name)
        VALUES(?1,?2,?3,?4,'RECEIVED',?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`)
        .bind(id,c.serverScope,o.id,number,documentDate,o.supplier_id,o.supplier_name,o.warehouse_id,o.warehouse_name,total,JSON.stringify(lines),clean(body?.comment),stamp,userId,userName).run();

      for(const line of lines)progress.received.set(line.productId,n(progress.received.get(line.productId))+n(line.quantity));
      const completed=progress.orderLines.length>0&&progress.orderLines.every(l=>n(progress.received.get(l.product_id))>=n(l.confirmed_qty||l.ordered_qty)-0.0005);
      const next=completed?"COMPLETED":"PARTIALLY_RECEIVED";
      await db.prepare("UPDATE procurement_orders SET status=?2,updated_at=?3 WHERE id=?1").bind(o.id,next,stamp).run();
      await log(c,"RECEIVE","GOODS_RECEIPT_NOTE",o,{status:o.status},{status:next,grnId:id,grnNumber:number,totalAmount:total,lines});
      return json({success:true,id:o.id,grnId:id,grnNumber:number,status:next,totalAmount:total},201);
    }

    if(action==="link-invoice"){
      const o=await orderRow(db,c.scope,clean(body?.id),c.serverScope),grnId=clean(body?.grnId);
      if(!grnId)throw new Error("Выберите GRN для связи с накладной.");
      const grn=await db.prepare("SELECT * FROM procurement_grns WHERE id=?1 AND server_scope=?2 AND order_id=?3 LIMIT 1").bind(grnId,c.serverScope,o.id).first();
      if(!grn){const e=new Error("GRN не найден или относится к другому PO.");e.status=404;throw e}
      const documentNumber=clean(body?.iikoDocumentNumber);if(!documentNumber)throw new Error("Не указан номер накладной.");
      const duplicate=await db.prepare("SELECT id,order_id,grn_id,total_amount FROM procurement_receipts WHERE server_scope=?1 AND iiko_document_number=?2 LIMIT 1").bind(c.serverScope,documentNumber).first();
      if(duplicate){
        if(clean(duplicate.order_id)!==clean(o.id)){const e=new Error("Эта накладная уже связана с другим PO.");e.status=409;throw e}
        if(clean(duplicate.grn_id)&&clean(duplicate.grn_id)!==grnId){const e=new Error("Эта накладная уже связана с другим GRN.");e.status=409;throw e}
        if(clean(duplicate.grn_id)===grnId){
          return json({success:true,id:o.id,receiptId:duplicate.id,grnId,totalAmount:n(duplicate.total_amount),duplicate:true});
        }
        // Legacy invoice already registered without GRN. Do not report a
        // successful link without actually saving its grn_id.
        const occupied=await db.prepare("SELECT id FROM procurement_receipts WHERE server_scope=?1 AND grn_id=?2 LIMIT 1").bind(c.serverScope,grnId).first();
        if(occupied){const e=new Error("К этому GRN уже привязана другая накладная.");e.status=409;throw e}
        const updated=await db.prepare("UPDATE procurement_receipts SET grn_id=?2 WHERE id=?1 AND server_scope=?3 AND (grn_id IS NULL OR grn_id='')").bind(duplicate.id,grnId,c.serverScope).run();
        if(!n(updated?.meta?.changes)){const e=new Error("Привязка накладной изменена другим пользователем. Обновите список.");e.status=409;throw e}
        // Converting an old receipt to a GRN-linked invoice changes the
        // physical-progress source; keep the stored PO status in sync.
        const progress=await physicalProgress(db,o.id);
        const next=progress.completed?"COMPLETED":progress.hasAny?"PARTIALLY_RECEIVED":o.status;
        await db.prepare("UPDATE procurement_orders SET status=?2,updated_at=?3 WHERE id=?1").bind(o.id,next,stamp).run();
        await log(c,"LINK","PURCHASE_INVOICE",o,{receiptId:duplicate.id,grnId:""},{receiptId:duplicate.id,grnId,iikoDocumentNumber:documentNumber,legacyConversion:true,status:next});
        return json({success:true,id:o.id,receiptId:duplicate.id,grnId,totalAmount:n(duplicate.total_amount),duplicate:true,linked:true,status:next});
      }
      const grnInvoices=(await db.prepare("SELECT * FROM procurement_receipts WHERE server_scope=?1 AND grn_id=?2").bind(c.serverScope,grnId).all()).results||[];
      const lines=normalizeLines(body?.lines,{allowZeroPrice:true}).map(x=>({
        productId:x.productId,productName:x.productName,unit:x.unit,quantity:x.quantity,packageSize:x.packageSize,packageCount:x.packageCount,
        containerId:x.containerId,packageName:x.packageName,vatPercent:x.vatPercent,unitPrice:x.unitPrice,total:money(x.packageCount*x.unitPrice)
      }));
      if(grnInvoices.length){
        // A second invoice for one physical GRN is permitted only to document a
        // previously approved shortage; it must not create surplus stock.
        const plan=grnInvoices.find(x=>x.resolution_method==="ADDITIONAL_INVOICE"&&x.resolution_status==="IN_PROGRESS"&&x.variance_status==="APPROVED");
        if(!plan){const e=new Error("Дополнительная накладная возможна только после согласованного плана урегулирования.");e.status=409;throw e}
        const grnBy=new Map(parse(grn.lines_json,[]).map(x=>[clean(x.productId),n(x.quantity)]));
        const billed=new Map();
        for(const rec of grnInvoices)for(const x of parse(rec.lines_json,[]))billed.set(clean(x.productId),n(billed.get(clean(x.productId)))+n(x.quantity));
        for(const line of lines){
          const id=clean(line.productId),max=n(grnBy.get(id))-n(billed.get(id));
          if(!(max>0.0005)||line.quantity>max+0.0005){const e=new Error("Дополнительная накладная превышает недостающее количество по GRN для "+line.productName+". Осталось "+q(Math.max(0,max))+".");e.status=409;throw e}
        }
      }
      const id=uid(),total=money(lines.reduce((sum,x)=>sum+x.total,0));
      const variance=invoiceVariance(parse(grn.lines_json,[]),lines);
      const varianceStatus=grnInvoices.length?"NONE":variance.length?"PENDING":"NONE";
      await db.prepare(`INSERT INTO procurement_receipts(id,server_scope,order_id,grn_id,iiko_document_number,iiko_document_id,iiko_status,document_date,total_amount,lines_json,comment,created_at,created_by,created_by_name,variance_status)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`)
        .bind(id,c.serverScope,o.id,grnId,documentNumber,clean(body?.iikoDocumentId),clean(body?.iikoStatus||"NEW"),clean(body?.documentDate||stamp.slice(0,10)),total,JSON.stringify(lines),clean(body?.comment),stamp,userId,userName,varianceStatus).run();
      await log(c,"LINK","PURCHASE_INVOICE",o,null,{receiptId:id,grnId,iikoDocumentNumber:documentNumber,totalAmount:total,lines});
      return json({success:true,id:o.id,receiptId:id,grnId,totalAmount:total,varianceStatus},201);
    }

    if(action==="review-invoice-variance"){
      const receiptId=clean(body?.receiptId),decision=clean(body?.decision).toUpperCase(),reason=clean(body?.reason);
      if(!["APPROVED","REJECTED"].includes(decision)){const e=new Error("Укажите решение по расхождению.");e.status=400;throw e}
      if(reason.length<5){const e=new Error("Укажите причину решения (не менее 5 символов).");e.status=400;throw e}
      const receipt=await db.prepare("SELECT * FROM procurement_receipts WHERE id=?1 AND server_scope=?2 LIMIT 1").bind(receiptId,c.serverScope).first();
      if(!receipt){const e=new Error("Накладная не найдена.");e.status=404;throw e}
      const o=await orderRow(db,c.scope,receipt.order_id,c.serverScope);
      if(!clean(receipt.grn_id)){const e=new Error("Накладная не связана с GRN.");e.status=409;throw e}
      if(["PROCESSED","CLOSED"].includes(clean(receipt.iiko_status).toUpperCase())){const e=new Error("Накладная уже проведена. Решение через этот экран невозможно.");e.status=409;throw e}
      const grn=await db.prepare("SELECT lines_json FROM procurement_grns WHERE id=?1 AND server_scope=?2 AND order_id=?3 LIMIT 1").bind(receipt.grn_id,c.serverScope,o.id).first();
      if(!grn){const e=new Error("GRN для проверки не найден.");e.status=409;throw e}
      const variances=invoiceVariance(parse(grn.lines_json,[]),parse(receipt.lines_json,[]));
      if(!variances.length){const e=new Error("Расхождения уже нет. Обновите документы.");e.status=409;throw e}
      const before={status:receipt.variance_status,reason:receipt.variance_reason};
      await db.prepare("UPDATE procurement_receipts SET variance_status=?2,variance_reason=?3,variance_reviewed_by=?4,variance_reviewed_at=?5 WHERE id=?1 AND server_scope=?6").bind(receipt.id,decision,reason,userName,stamp,c.serverScope).run();
      await log(c,"REVIEW","PURCHASE_INVOICE_VARIANCE",o,before,{receiptId:receipt.id,invoiceNumber:receipt.iiko_document_number,decision,reason,variances,reviewedBy:userName,reviewedAt:stamp});
      return json({success:true,receiptId:receipt.id,status:decision,reviewedBy:userName,reviewedAt:stamp});
    }

    if(action==="plan-variance-resolution"){
      const receiptId=clean(body?.receiptId),method=clean(body?.method).toUpperCase(),note=clean(body?.note);
      if(!["CORRECT_INVOICE","ADDITIONAL_INVOICE","CORRECT_GRN"].includes(method)){const e=new Error("Выберите способ урегулирования.");e.status=400;throw e}
      if(note.length<5){const e=new Error("Укажите основание урегулирования (не менее 5 символов).");e.status=400;throw e}
      const rec=await db.prepare("SELECT * FROM procurement_receipts WHERE id=?1 AND server_scope=?2 LIMIT 1").bind(receiptId,c.serverScope).first();
      if(!rec){const e=new Error("Накладная не найдена.");e.status=404;throw e}
      const o=await orderRow(db,c.scope,rec.order_id,c.serverScope);
      if(rec.variance_status!=="APPROVED"){const e=new Error("Сначала согласуйте расхождение.");e.status=409;throw e}
      if(rec.resolution_status==="CLOSED"){const e=new Error("Расхождение уже закрыто.");e.status=409;throw e}
      if(method==="ADDITIONAL_INVOICE"){
        const grn=await db.prepare("SELECT lines_json FROM procurement_grns WHERE id=?1 AND order_id=?2 AND server_scope=?3 LIMIT 1").bind(rec.grn_id,o.id,c.serverScope).first();
        if(!grn){const e=new Error("GRN не найден.");e.status=409;throw e}
        const grnQ=new Map(parse(grn.lines_json,[]).map(x=>[clean(x.productId),n(x.quantity)]));
        const totalQ=new Map();
        const all=(await db.prepare("SELECT lines_json FROM procurement_receipts WHERE grn_id=?1 AND server_scope=?2").bind(rec.grn_id,c.serverScope).all()).results||[];
        for(const x of all)for(const l of parse(x.lines_json,[]))totalQ.set(clean(l.productId),n(totalQ.get(clean(l.productId)))+n(l.quantity));
        if(![...grnQ].some(([id,amount])=>amount>n(totalQ.get(id))+0.0005)||
           [...totalQ].some(([id,amount])=>amount>n(grnQ.get(id))+0.0005)){
          const e=new Error("Дополнительная накладная применима только к недостаче, а не к превышению.");e.status=409;throw e}
      }
      await db.prepare("UPDATE procurement_receipts SET resolution_method=?2,resolution_status='IN_PROGRESS',resolution_note=?3,resolution_by=?4,resolution_at=?5 WHERE id=?1 AND server_scope=?6").bind(rec.id,method,note,userName,stamp,c.serverScope).run();
      await log(c,"PLAN","PURCHASE_INVOICE_RESOLUTION",o,{receiptId:rec.id,method:rec.resolution_method||"",status:rec.resolution_status||"NONE"},{receiptId:rec.id,method,status:"IN_PROGRESS",note,by:userName});
      return json({success:true,receiptId:rec.id,method,status:"IN_PROGRESS"});
    }

    if(action==="verify-variance-resolution"){
      const rec=await db.prepare("SELECT * FROM procurement_receipts WHERE id=?1 AND server_scope=?2 LIMIT 1").bind(clean(body?.receiptId),c.serverScope).first();
      if(!rec){const e=new Error("Накладная не найдена.");e.status=404;throw e}
      const o=await orderRow(db,c.scope,rec.order_id,c.serverScope);
      if(rec.resolution_status==="CLOSED")return json({success:true,receiptId:rec.id,status:"CLOSED",duplicate:true});
      if(rec.resolution_status!=="IN_PROGRESS"||!rec.resolution_method){const e=new Error("Сначала укажите способ урегулирования.");e.status=409;throw e}
      const grn=await db.prepare("SELECT lines_json FROM procurement_grns WHERE id=?1 AND order_id=?2 AND server_scope=?3 LIMIT 1").bind(rec.grn_id,o.id,c.serverScope).first();
      if(!grn){const e=new Error("GRN не найден.");e.status=409;throw e}
      const all=(await db.prepare("SELECT lines_json,iiko_status FROM procurement_receipts WHERE grn_id=?1 AND server_scope=?2").bind(rec.grn_id,c.serverScope).all()).results||[];
      const received=new Map(parse(grn.lines_json,[]).map(x=>[clean(x.productId),n(x.quantity)]));
      const billed=new Map();
      for(const inv of all){
        if(!["PROCESSED","CLOSED"].includes(clean(inv.iiko_status).toUpperCase())){const e=new Error("Нельзя закрыть: не все накладные проведены в iiko. Сначала синхронизируйте статусы.");e.status=409;throw e}
        for(const l of parse(inv.lines_json,[]))billed.set(clean(l.productId),n(billed.get(clean(l.productId)))+n(l.quantity));
      }
      const ids=new Set([...received.keys(),...billed.keys()]);
      const mismatches=[...ids].filter(id=>Math.abs(n(received.get(id))-n(billed.get(id)))>0.0005);
      if(mismatches.length){const e=new Error("Расхождение нельзя закрыть: количество GRN и проведённых накладных не совпадает ("+mismatches.length+" поз.).");e.status=409;throw e}
      await db.prepare("UPDATE procurement_receipts SET resolution_status='CLOSED',resolution_at=?2,resolution_by=?3 WHERE id=?1 AND server_scope=?4 AND resolution_status='IN_PROGRESS'").bind(rec.id,stamp,userName,c.serverScope).run();
      await log(c,"CLOSE","PURCHASE_INVOICE_RESOLUTION",o,{receiptId:rec.id,status:"IN_PROGRESS"},{receiptId:rec.id,status:"CLOSED",method:rec.resolution_method,by:userName});
      return json({success:true,receiptId:rec.id,status:"CLOSED"});
    }

    if(action==="sync-receipt"){
      const documentNumber=clean(body?.iikoDocumentNumber);if(!documentNumber)throw new Error("Не указан номер накладной.");
      const receipt=await db.prepare("SELECT * FROM procurement_receipts WHERE server_scope=?1 AND iiko_document_number=?2 LIMIT 1").bind(c.serverScope,documentNumber).first();
      if(!receipt){const e=new Error("Связанная приёмка не найдена.");e.status=404;throw e}
      const o=await orderRow(db,c.scope,receipt.order_id,c.serverScope);
      const lines=normalizeLines(body?.lines,{allowZeroPrice:true}).map(x=>({productId:x.productId,productName:x.productName,unit:x.unit,quantity:x.quantity,packageSize:x.packageSize,packageCount:x.packageCount,containerId:x.containerId,packageName:x.packageName,vatPercent:x.vatPercent,unitPrice:x.unitPrice,total:money(x.packageCount*x.unitPrice)}));
      const total=money(lines.reduce((s,x)=>s+x.total,0));
      let varianceStatus="NONE",varianceReason="",reviewer="",reviewedAt="";
      if(clean(receipt.grn_id)){
        const grn=await db.prepare("SELECT lines_json FROM procurement_grns WHERE id=?1 AND order_id=?2 AND server_scope=?3 LIMIT 1").bind(receipt.grn_id,o.id,c.serverScope).first();
        const variance=invoiceVariance(parse(grn?.lines_json,[]),lines);
        if(variance.length){
          const original=parse(receipt.lines_json,[]);
          const unchanged=JSON.stringify(original.map(x=>[clean(x.productId),q(x.quantity),money(x.unitPrice)]).sort())===JSON.stringify(lines.map(x=>[clean(x.productId),q(x.quantity),money(x.unitPrice)]).sort());
          varianceStatus=unchanged&&clean(receipt.variance_status)==="APPROVED"?"APPROVED":"PENDING";
          if(varianceStatus==="APPROVED"){varianceReason=receipt.variance_reason||"";reviewer=receipt.variance_reviewed_by||"";reviewedAt=receipt.variance_reviewed_at||""}
        }
      }
      await db.prepare("UPDATE procurement_receipts SET iiko_status=?2,document_date=?3,total_amount=?4,lines_json=?5,comment=?6,variance_status=?7,variance_reason=?8,variance_reviewed_by=?9,variance_reviewed_at=?10 WHERE id=?1").bind(receipt.id,clean(body?.iikoStatus||receipt.iiko_status),clean(body?.documentDate||receipt.document_date),total,JSON.stringify(lines),clean(body?.comment||receipt.comment),varianceStatus,varianceReason,reviewer,reviewedAt).run();
      let next=o.status;
      if(!clean(receipt.grn_id)){
        const progress=await physicalProgress(db,o.id);
        next=progress.completed?"COMPLETED":progress.hasAny?"PARTIALLY_RECEIVED":(["CANCELLED"].includes(o.status)?o.status:"CONFIRMED");
        await db.prepare("UPDATE procurement_orders SET status=?2,updated_at=?3 WHERE id=?1").bind(o.id,next,stamp).run();
      }
      await log(c,"SYNC","PURCHASE_INVOICE",o,{status:o.status,receiptId:receipt.id},{status:next,receiptId:receipt.id,grnId:receipt.grn_id||"",iikoDocumentNumber:documentNumber,iikoStatus:clean(body?.iikoStatus),totalAmount:total,lines});
      return json({success:true,id:o.id,receiptId:receipt.id,grnId:receipt.grn_id||"",status:next,totalAmount:total});
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
      const lines=normalizeLines(body?.lines).map(x=>{const ol=by.get(x.productId);if(!ol)throw new Error("Приёмка содержит позицию вне PO.");const remaining=q(n(ol.confirmed_qty||ol.ordered_qty)-n(received.get(x.productId)));if(!s.allowOverReceipt&&x.quantity>remaining+0.0005)throw new Error(`${ol.product_name}: принимаемое количество больше остатка PO (${remaining}).`);return{productId:x.productId,productName:x.productName||ol.product_name,unit:x.unit||ol.unit,quantity:x.quantity,packageSize:x.packageSize,packageCount:x.packageCount,containerId:x.containerId,packageName:x.packageName,vatPercent:x.vatPercent,unitPrice:x.unitPrice,total:money(x.packageCount*x.unitPrice)}})
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
