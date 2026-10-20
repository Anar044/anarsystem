import { getUser, loadPrivateIikoState, privateConnection, hasPrivateConnection } from "./iiko/_lib/user-state.js";
import { resolveRestaurantScope, cookieDepartmentIds } from "./iiko/_lib/restaurant-scope.js";
import { resolveAccessForUser, hasPermission, requirePermission } from "./access/_lib/access-control.js";
import { serverScopeFromConnection, logAuditEvent } from "./_lib/audit-log.js";

// Physical-location / batch traceability is a shadow ledger, NOT an iiko posting.
// An accepted GRN is the sole source of inbound quantities. All writes are scoped
// by selected workspace AND connected server, with restaurant/warehouse checks.
const HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};
const clean = x => String(x ?? "").trim();
const parse = (x, fallback = []) => { try { return JSON.parse(x || "null") ?? fallback; } catch { return fallback; } };
const quantity = x => { const v = Number(x); return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : NaN; };
const uuid = () => crypto.randomUUID();
const timestamp = () => new Date().toISOString();
const unique = a => [...new Set((a || []).map(clean).filter(Boolean))];
const fail = (message, status = 400, code = "") => Object.assign(new Error(message), { status, code });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: HEADERS });
let schemaPromise;

async function ensure(db) {
  if (!schemaPromise) schemaPromise = (async () => {
    const ready = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='proc_trace_moves'").first();
    if (ready) return;
    await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS proc_trace_locations (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, server_scope TEXT NOT NULL,
        warehouse_id TEXT NOT NULL, warehouse_name TEXT NOT NULL DEFAULT '',
        parent_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'CHILLER', active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, created_by TEXT NOT NULL,
        UNIQUE(workspace_id,server_scope,warehouse_id,parent_id,name)
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_trace_locations_scope ON proc_trace_locations(workspace_id,server_scope,warehouse_id)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS proc_trace_grn_items (
        workspace_id TEXT NOT NULL, server_scope TEXT NOT NULL,
        grn_id TEXT NOT NULL, product_id TEXT NOT NULL,
        accepted_qty REAL NOT NULL CHECK(accepted_qty>0),
        registered_qty REAL NOT NULL DEFAULT 0 CHECK(registered_qty>=0),
        PRIMARY KEY(workspace_id,server_scope,grn_id,product_id)
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS proc_trace_lots (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, server_scope TEXT NOT NULL,
        request_id TEXT NOT NULL, grn_id TEXT NOT NULL, order_id TEXT NOT NULL,
        warehouse_id TEXT NOT NULL, restaurant_ids_json TEXT NOT NULL DEFAULT '[]',
        supplier_id TEXT NOT NULL DEFAULT '', supplier_name TEXT NOT NULL DEFAULT '',
        product_id TEXT NOT NULL, product_name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT '',
        lot_code TEXT NOT NULL, produced_on TEXT NOT NULL DEFAULT '',
        expires_on TEXT NOT NULL DEFAULT '', received_qty REAL NOT NULL CHECK(received_qty>0),
        status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','HOLD')),
        note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL,
        UNIQUE(workspace_id,server_scope,request_id),
        UNIQUE(workspace_id,server_scope,grn_id,product_id,lot_code)
      )`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_trace_lots_scope ON proc_trace_lots(workspace_id,server_scope,created_at DESC)`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_trace_lots_grn ON proc_trace_lots(workspace_id,server_scope,grn_id,product_id)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS proc_trace_balances (
        lot_id TEXT NOT NULL, location_id TEXT NOT NULL,
        quantity REAL NOT NULL DEFAULT 0 CHECK(quantity>=0),
        PRIMARY KEY(lot_id,location_id)
      )`),
      db.prepare(`CREATE TABLE IF NOT EXISTS proc_trace_moves (
        id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, server_scope TEXT NOT NULL,
        request_id TEXT NOT NULL, lot_id TEXT NOT NULL,
        action TEXT NOT NULL CHECK(action IN ('RECEIVE','TRANSFER','ISSUE','WRITE_OFF','CONSUME','HOLD','RELEASE')),
        from_location_id TEXT NOT NULL DEFAULT '', to_location_id TEXT NOT NULL DEFAULT '',
        quantity REAL NOT NULL CHECK(quantity>=0),
        destination TEXT NOT NULL DEFAULT '', reference TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT '', actor_id TEXT NOT NULL,
        actor_name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
        UNIQUE(workspace_id,server_scope,request_id)
      )`),
      db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_trace_one_receipt ON proc_trace_moves(lot_id) WHERE action='RECEIVE'`),
      db.prepare(`CREATE INDEX IF NOT EXISTS idx_trace_moves_lot ON proc_trace_moves(workspace_id,server_scope,lot_id,created_at DESC)`),
      db.prepare(`CREATE TRIGGER IF NOT EXISTS trace_guard_new_lot BEFORE INSERT ON proc_trace_lots BEGIN
        UPDATE proc_trace_grn_items SET registered_qty=ROUND(registered_qty+NEW.received_qty,3)
        WHERE workspace_id=NEW.workspace_id AND server_scope=NEW.server_scope
          AND grn_id=NEW.grn_id AND product_id=NEW.product_id
          AND registered_qty+NEW.received_qty<=accepted_qty+0.00001;
        SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'LOT_EXCEEDS_GRN') END;
      END`),
      db.prepare(`CREATE TRIGGER IF NOT EXISTS trace_move_validate BEFORE INSERT ON proc_trace_moves BEGIN
        SELECT CASE WHEN NOT EXISTS(
          SELECT 1 FROM proc_trace_lots l WHERE l.id=NEW.lot_id
          AND l.workspace_id=NEW.workspace_id AND l.server_scope=NEW.server_scope
        ) THEN RAISE(ABORT,'LOT_SCOPE_MISMATCH') END;
        SELECT CASE WHEN
          (NEW.action IN ('RECEIVE','TRANSFER','ISSUE','WRITE_OFF','CONSUME') AND NEW.quantity<=0)
          OR (NEW.action IN ('HOLD','RELEASE') AND NEW.quantity!=0)
          THEN RAISE(ABORT,'INVALID_TRACE_QUANTITY') END;
        SELECT CASE WHEN NEW.action IN ('TRANSFER','ISSUE','CONSUME')
          AND (SELECT status FROM proc_trace_lots WHERE id=NEW.lot_id)!='ACTIVE'
          THEN RAISE(ABORT,'LOT_ON_HOLD') END;
        SELECT CASE WHEN NEW.action IN ('TRANSFER','ISSUE','CONSUME')
          AND COALESCE((SELECT expires_on FROM proc_trace_lots WHERE id=NEW.lot_id),'')!=''
          AND (SELECT expires_on FROM proc_trace_lots WHERE id=NEW.lot_id)<date('now')
          THEN RAISE(ABORT,'LOT_EXPIRED') END;
        SELECT CASE WHEN NEW.action='RECEIVE' AND (
          NEW.from_location_id!='' OR NEW.to_location_id='' OR
          NEW.quantity!=(SELECT received_qty FROM proc_trace_lots WHERE id=NEW.lot_id))
          THEN RAISE(ABORT,'BAD_RECEIPT') END;
        SELECT CASE WHEN NEW.action IN ('TRANSFER','ISSUE','WRITE_OFF','CONSUME')
          AND NEW.from_location_id='' THEN RAISE(ABORT,'SOURCE_REQUIRED') END;
        SELECT CASE WHEN NEW.action='TRANSFER'
          AND (NEW.to_location_id='' OR NEW.to_location_id=NEW.from_location_id)
          THEN RAISE(ABORT,'DESTINATION_REQUIRED') END;
        SELECT CASE WHEN NEW.action IN ('ISSUE','WRITE_OFF','CONSUME')
          AND NEW.to_location_id!='' THEN RAISE(ABORT,'BAD_DESTINATION') END;
        SELECT CASE WHEN NEW.action IN ('HOLD','RELEASE')
          AND (NEW.from_location_id!='' OR NEW.to_location_id!='')
          THEN RAISE(ABORT,'BAD_STATUS_EVENT') END;
        SELECT CASE WHEN NEW.from_location_id!='' AND NOT EXISTS (
          SELECT 1 FROM proc_trace_locations p JOIN proc_trace_lots l ON l.id=NEW.lot_id
          WHERE p.id=NEW.from_location_id AND p.workspace_id=l.workspace_id
          AND p.server_scope=l.server_scope AND p.warehouse_id=l.warehouse_id
        ) THEN RAISE(ABORT,'SOURCE_SCOPE_MISMATCH') END;
        SELECT CASE WHEN NEW.to_location_id!='' AND NOT EXISTS (
          SELECT 1 FROM proc_trace_locations p JOIN proc_trace_lots l ON l.id=NEW.lot_id
          WHERE p.id=NEW.to_location_id AND p.workspace_id=l.workspace_id
          AND p.server_scope=l.server_scope AND p.warehouse_id=l.warehouse_id AND p.active=1
        ) THEN RAISE(ABORT,'DESTINATION_SCOPE_MISMATCH') END;
      END`),
      db.prepare(`CREATE TRIGGER IF NOT EXISTS trace_apply_movement AFTER INSERT ON proc_trace_moves BEGIN
        UPDATE proc_trace_balances SET quantity=ROUND(quantity-NEW.quantity,3)
        WHERE NEW.action IN ('TRANSFER','ISSUE','WRITE_OFF','CONSUME')
          AND lot_id=NEW.lot_id AND location_id=NEW.from_location_id
          AND quantity+0.00001>=NEW.quantity;
        SELECT CASE WHEN NEW.action IN ('TRANSFER','ISSUE','WRITE_OFF','CONSUME')
          AND changes()!=1 THEN RAISE(ABORT,'INSUFFICIENT_LOT_BALANCE') END;
        INSERT INTO proc_trace_balances(lot_id,location_id,quantity)
          SELECT NEW.lot_id,NEW.to_location_id,NEW.quantity
          WHERE NEW.action IN ('RECEIVE','TRANSFER')
          ON CONFLICT(lot_id,location_id) DO UPDATE SET quantity=ROUND(quantity+excluded.quantity,3);
        UPDATE proc_trace_lots SET status='HOLD' WHERE id=NEW.lot_id AND status='ACTIVE' AND NEW.action='HOLD';
        SELECT CASE WHEN NEW.action='HOLD' AND changes()!=1 THEN RAISE(ABORT,'ALREADY_ON_HOLD') END;
        UPDATE proc_trace_lots SET status='ACTIVE' WHERE id=NEW.lot_id AND status='HOLD' AND NEW.action='RELEASE';
        SELECT CASE WHEN NEW.action='RELEASE' AND changes()!=1 THEN RAISE(ABORT,'NOT_ON_HOLD') END;
      END`)
    ]);
  })().catch(error => { schemaPromise = null; throw error; });
  return schemaPromise;
}

function scopedByAccess(state, request, access) {
  const base = resolveRestaurantScope({ state, request, strict: true });
  if (access.isOwner || access.scope?.mode !== "SELECTED") return base;
  const ids = new Set((access.scope.departmentIds || []).map(clean));
  const codes = new Set((access.scope.departmentCodes || []).map(clean));
  const permitted = (base.allRestaurants || []).filter(r => ids.has(clean(r.id)) || codes.has(clean(r.code)));
  const allowed = unique(permitted.map(r => r.id));
  if (!allowed.length) throw fail("Нет доступных подразделений.", 403);
  const requested = cookieDepartmentIds(request);
  if (requested.some(id => !allowed.includes(id))) throw fail("Подразделение не разрешено.", 403);
  return resolveRestaurantScope({ state, requestedIds: requested.length ? requested : allowed, strict: true });
}
async function context(request, env) {
  if (!env.DB) throw fail("Не настроена база D1.", 503);
  const auth = await getUser(request, env);
  if (!auth) throw fail("Необходима авторизация.", 401);
  const access = await resolveAccessForUser(env.DB, auth.user, { request, claimInvite: true });
  if (!access.allowed) throw fail("Доступ запрещён.", 403);
  if (!hasPermission(access, "procurement.receive") && !hasPermission(access, "inventory.stock.view") &&
      !hasPermission(access, "procurement.settings.manage"))
    throw fail("Недостаточно прав на просмотр партий.", 403);
  const stored = await loadPrivateIikoState(env.DB, access.storageUserId || access.ownerUserId, env);
  if (!stored?.found || !hasPrivateConnection(stored.state)) throw fail("Smart Horeca Server не подключён.", 409);
  const connection = privateConnection(stored.state);
  const server = await serverScopeFromConnection(connection);
  const workspace = clean(access.workspace?.id);
  if (!server || !workspace) throw fail("Не определён контур организации.", 403);
  const scope = scopedByAccess(stored.state, request, access);
  await ensure(env.DB);
  return { db: env.DB, auth, access, connection, workspace, server, scope };
}
function documentAllowed(c, order) {
  if (!order) return false;
  const departments = unique(parse(order.restaurant_ids_json));
  const selected = new Set((c.scope.selectedDepartmentIds || []).map(clean));
  if (c.scope.isChain && (!departments.length || !departments.every(id => selected.has(id)))) return false;
  if (!c.scope.isChain && departments.length && !departments.every(id => selected.has(id))) return false;
  const warehouseIds = unique(c.access.scope?.warehouseIds || []);
  return !warehouseIds.length || warehouseIds.includes(clean(order.warehouse_id));
}
async function ordersFor(c) {
  const r = await c.db.prepare(`SELECT id,number,restaurant_ids_json,warehouse_id,warehouse_name
    FROM procurement_orders WHERE server_scope=?1 ORDER BY created_at DESC LIMIT 3000`).bind(c.server).all();
  return (r.results || []).filter(o => documentAllowed(c, o));
}
function locationAvailable(location, c, warehouses) {
  return location.workspace_id === c.workspace && location.server_scope === c.server &&
    warehouses.has(clean(location.warehouse_id));
}
async function locationRow(c, id, warehouse) {
  const row = await c.db.prepare(`SELECT * FROM proc_trace_locations
    WHERE id=?1 AND workspace_id=?2 AND server_scope=?3 LIMIT 1`)
    .bind(id, c.workspace, c.server).first();
  if (!row || (warehouse && row.warehouse_id !== warehouse)) throw fail("Место хранения недоступно.", 403);
  return row;
}
async function lotAndOrder(c, lotId) {
  const lot = await c.db.prepare(`SELECT * FROM proc_trace_lots
    WHERE id=?1 AND workspace_id=?2 AND server_scope=?3 LIMIT 1`)
    .bind(lotId, c.workspace, c.server).first();
  if (!lot) throw fail("Партия не найдена.", 404);
  const order = await c.db.prepare(`SELECT id,restaurant_ids_json,warehouse_id
    FROM procurement_orders WHERE id=?1 AND server_scope=?2 LIMIT 1`)
    .bind(lot.order_id, c.server).first();
  if (!documentAllowed(c, order) || order.warehouse_id !== lot.warehouse_id)
    throw fail("Нет доступа к партии этого склада.", 403);
  return lot;
}
function validDate(s) {
  return !s || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")));
}
function requestId(body) {
  const id = clean(body.requestId);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw fail("Некорректный ключ операции. Обновите страницу.");
  return id;
}
async function audit(c, action, entityId, label, metadata) {
  await logAuditEvent({
    request: c.request, env: c.env, connection: c.connection,
    action, entityType: "PROCUREMENT_TRACE_LOT", entityId, entityLabel: label,
    before: null, after: metadata, metadata
  });
}
export async function onRequestOptions() { return new Response(null, { status: 204, headers: HEADERS }); }

export async function onRequestGet({ request, env }) {
  try {
    const c = await context(request, env);
    const orders = await ordersFor(c), orderIds = new Set(orders.map(o => o.id));
    const warehouseMap = new Map();
    for (const o of orders) if (clean(o.warehouse_id))
      warehouseMap.set(o.warehouse_id, { id: o.warehouse_id, name: o.warehouse_name || o.warehouse_id });
    const warehouses = new Set(warehouseMap.keys());
    const [loc, lots, grns, balance, moves, counted] = await Promise.all([
      c.db.prepare(`SELECT * FROM proc_trace_locations WHERE workspace_id=?1 AND server_scope=?2 ORDER BY warehouse_name,name`)
        .bind(c.workspace,c.server).all(),
      c.db.prepare(`SELECT * FROM proc_trace_lots WHERE workspace_id=?1 AND server_scope=?2 ORDER BY created_at DESC LIMIT 800`)
        .bind(c.workspace,c.server).all(),
      c.db.prepare(`SELECT * FROM procurement_grns WHERE server_scope=?1 ORDER BY created_at DESC LIMIT 1500`)
        .bind(c.server).all(),
      c.db.prepare(`SELECT b.* FROM proc_trace_balances b JOIN proc_trace_lots l ON l.id=b.lot_id
        WHERE l.workspace_id=?1 AND l.server_scope=?2`).bind(c.workspace,c.server).all(),
      c.db.prepare(`SELECT * FROM proc_trace_moves WHERE workspace_id=?1 AND server_scope=?2
        ORDER BY created_at DESC LIMIT 1500`).bind(c.workspace,c.server).all(),
      c.db.prepare(`SELECT * FROM proc_trace_grn_items WHERE workspace_id=?1 AND server_scope=?2`)
        .bind(c.workspace,c.server).all()
    ]);
    const availableLots = (lots.results || []).filter(x => orderIds.has(x.order_id) && warehouses.has(x.warehouse_id));
    const visibleLotIds = new Set(availableLots.map(x => x.id));
    const locs = (loc.results || []).filter(x => locationAvailable(x,c,warehouses));
    const balances = (balance.results || []).filter(x => visibleLotIds.has(x.lot_id));
    const countMap = new Map((counted.results || []).map(x => [x.grn_id+"|"+x.product_id, x.registered_qty]));
    const receipts = [];
    for (const g of grns.results || []) {
      if (!orderIds.has(g.order_id) || !warehouses.has(g.warehouse_id)) continue;
      const lines = new Map();
      for (const item of parse(g.lines_json)) {
        const pid = clean(item.productId), qty = quantity(item.quantity);
        if (!pid || !Number.isFinite(qty) || qty <= 0) continue;
        const previous = lines.get(pid);
        lines.set(pid, { productId: pid, productName: clean(item.productName) || pid,
          unit: clean(item.unit), quantity: Math.round(((previous?.quantity || 0) + qty) * 1000) / 1000 });
      }
      for (const line of lines.values()) {
        const registered = countMap.get(g.id+"|"+line.productId) || 0;
        receipts.push({ grnId: g.id, grnNumber: g.number, orderId: g.order_id,
          supplierName: g.supplier_name, supplierId: g.supplier_id, warehouseId: g.warehouse_id,
          warehouseName: g.warehouse_name, documentDate: g.document_date,
          ...line, registered, remaining: Math.max(0, Math.round((line.quantity - registered)*1000)/1000) });
      }
    }
    const locationNames = new Map(locs.map(x => [x.id,x.name]));
    return json({ success: true, canManage: hasPermission(c.access,"procurement.receive"),
      canConfigure: hasPermission(c.access,"procurement.settings.manage"),
      canRelease: hasPermission(c.access,"procurement.approve") || hasPermission(c.access,"procurement.settings.manage"),
      warehouses: [...warehouseMap.values()], locations: locs.map(x => ({
        id:x.id, warehouseId:x.warehouse_id,warehouseName:x.warehouse_name,
        parentId:x.parent_id, name:x.name,kind:x.kind,active:!!x.active
      })), receipts,
      lots: availableLots.map(x => ({
        id:x.id,grnId:x.grn_id,orderId:x.order_id,warehouseId:x.warehouse_id,
        supplierName:x.supplier_name, supplierId:x.supplier_id,productId:x.product_id,
        productName:x.product_name,unit:x.unit,lotCode:x.lot_code,
        producedOn:x.produced_on,expiresOn:x.expires_on,
        receivedQty:x.received_qty,status:x.status,note:x.note,createdAt:x.created_at,
        balances:balances.filter(b => b.lot_id===x.id).map(b=>({
          locationId:b.location_id,locationName:locationNames.get(b.location_id)||b.location_id,quantity:b.quantity
        })),
        remaining:Math.round(balances.filter(b=>b.lot_id===x.id).reduce((a,b)=>a+b.quantity,0)*1000)/1000
      })),
      movements:(moves.results || []).filter(x => visibleLotIds.has(x.lot_id)).map(x => ({
        id:x.id,lotId:x.lot_id,action:x.action,fromId:x.from_location_id,toId:x.to_location_id,
        quantity:x.quantity,destination:x.destination,reference:x.reference,reason:x.reason,
        actor:x.actor_name||x.actor_id,at:x.created_at
      }))
    });
  } catch(error) {
    return json({success:false,message:error?.message||String(error),code:error?.code||""},error?.status||500);
  }
}

export async function onRequestPost({ request, env }) {
  try {
    const c = await context(request, env); c.request = request; c.env = env;
    const body = await request.json().catch(()=>({}));
    const action = clean(body.action).toUpperCase();
    const reqId = requestId(body);
    const orders = await ordersFor(c);
    const warehouseMap = new Map(orders.filter(o=>clean(o.warehouse_id))
      .map(o=>[o.warehouse_id,o.warehouse_name || o.warehouse_id]));
    if (action === "CREATE_LOCATION") {
      requirePermission(c.access,"procurement.settings.manage");
      const warehouseId=clean(body.warehouseId), name=clean(body.name),kind=clean(body.kind||"CHILLER");
      if (!warehouseMap.has(warehouseId)) throw fail("Склад не принадлежит доступным подразделениям.",403);
      if (!name || name.length>100 || !["CHILLER","FREEZER","SHELF","ROOM","KITCHEN","OTHER"].includes(kind))
        throw fail("Проверьте название и тип места хранения.");
      const parentId=clean(body.parentId);
      if (parentId) { const parent=await locationRow(c,parentId,warehouseId);
        if(!parent.active)throw fail("Родительское место неактивно."); }
      const id=uuid(),at=timestamp();
      await c.db.prepare(`INSERT INTO proc_trace_locations(
        id,workspace_id,server_scope,warehouse_id,warehouse_name,parent_id,name,kind,created_at,created_by
      ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`)
        .bind(id,c.workspace,c.server,warehouseId,warehouseMap.get(warehouseId),parentId,name,kind,at,c.auth.user.id).run();
      await audit(c,"CREATE_LOCATION",id,name,{warehouseId,kind,parentId});
      return json({success:true,id},201);
    }
    if (action === "REGISTER_LOT") {
      requirePermission(c.access,"procurement.receive");
      const grnId=clean(body.grnId),productId=clean(body.productId),locationId=clean(body.locationId);
      const qty=quantity(body.quantity),code=clean(body.lotCode)||"SH-"+uuid().slice(0,8).toUpperCase();
      const produced=clean(body.producedOn),expires=clean(body.expiresOn),note=clean(body.note);
      if (!(qty>0) || !productId || !grnId || code.length>80 || note.length>500)
        throw fail("Укажите GRN, товар, номер партии и положительное количество.");
      if (!validDate(produced) || !validDate(expires) || (produced && expires && produced>expires))
        throw fail("Некорректная дата изготовления или срок годности.");
      const grn=await c.db.prepare(`SELECT g.*,o.restaurant_ids_json FROM procurement_grns g
        JOIN procurement_orders o ON o.id=g.order_id AND o.server_scope=g.server_scope
        WHERE g.id=?1 AND g.server_scope=?2 LIMIT 1`).bind(grnId,c.server).first();
      if (!grn || !documentAllowed(c,grn) || !warehouseMap.has(grn.warehouse_id))
        throw fail("Недоступная физическая приёмка GRN.",403);
      const loc=await locationRow(c,locationId,grn.warehouse_id);
      if (!loc.active) throw fail("Место хранения отключено.");
      const lines=parse(grn.lines_json).filter(x=>clean(x.productId)===productId);
      const accepted=quantity(lines.reduce((a,x)=>a+Number(x.quantity||0),0));
      if (!(accepted>0)) throw fail("Этот товар отсутствует в GRN.");
      const id=uuid(),at=timestamp(),line=lines[0];
      await c.db.batch([
        c.db.prepare(`INSERT INTO proc_trace_grn_items(workspace_id,server_scope,grn_id,product_id,accepted_qty)
          VALUES(?1,?2,?3,?4,?5) ON CONFLICT(workspace_id,server_scope,grn_id,product_id) DO NOTHING`)
          .bind(c.workspace,c.server,grnId,productId,accepted),
        c.db.prepare(`INSERT INTO proc_trace_lots(
          id,workspace_id,server_scope,request_id,grn_id,order_id,warehouse_id,restaurant_ids_json,
          supplier_id,supplier_name,product_id,product_name,unit,lot_code,produced_on,expires_on,
          received_qty,note,created_at,created_by)
          VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20)`)
          .bind(id,c.workspace,c.server,reqId,grnId,grn.order_id,grn.warehouse_id,
            grn.restaurant_ids_json||"[]",grn.supplier_id,grn.supplier_name,productId,
            clean(line.productName)||productId,clean(line.unit),code,produced,expires,qty,note,at,c.auth.user.id),
        c.db.prepare(`INSERT INTO proc_trace_moves(
          id,workspace_id,server_scope,request_id,lot_id,action,to_location_id,quantity,
          reference,actor_id,actor_name,created_at
        ) VALUES(?1,?2,?3,?4,?5,'RECEIVE',?6,?7,?8,?9,?10,?11)`)
          .bind(uuid(),c.workspace,c.server,reqId+":receive",id,locationId,qty,clean(grn.number),
            c.auth.user.id,clean(c.access.displayName)||clean(c.auth.user.email),at)
      ]);
      await audit(c,"RECEIVE_LOT",id,code,{grnId,productId,locationId,qty,supplier:grn.supplier_name});
      return json({success:true,id,lotCode:code},201);
    }
    if (action === "MOVE") {
      requirePermission(c.access,"procurement.receive");
      const lot=await lotAndOrder(c,clean(body.lotId));
      const movement=clean(body.movement).toUpperCase(),from=clean(body.fromId),to=clean(body.toId);
      const amount=quantity(body.quantity),reason=clean(body.reason),destination=clean(body.destination),ref=clean(body.reference);
      if (!["TRANSFER","ISSUE","WRITE_OFF","CONSUME"].includes(movement)) throw fail("Неизвестный вид движения.");
      if (!(amount>0) || !from) throw fail("Нужно указать положительное количество и место выдачи.");
      if (movement==="TRANSFER"&&!to) throw fail("Выберите место назначения.");
      if (movement!=="TRANSFER"&&to) throw fail("Для выдачи и списания место назначения не используется.");
      if (movement==="WRITE_OFF"&&!reason) throw fail("Укажите причину списания.");
      if (["ISSUE","CONSUME"].includes(movement)&&!destination) throw fail("Укажите получателя или кухню.");
      await c.db.prepare(`INSERT INTO proc_trace_moves(
        id,workspace_id,server_scope,request_id,lot_id,action,from_location_id,to_location_id,
        quantity,destination,reference,reason,actor_id,actor_name,created_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`)
        .bind(uuid(),c.workspace,c.server,reqId,lot.id,movement,from,to,amount,destination,ref,
          reason,c.auth.user.id,clean(c.access.displayName)||clean(c.auth.user.email),timestamp()).run();
      await audit(c,movement,lot.id,lot.lot_code,{from,to,amount,destination,ref,reason});
      return json({success:true},201);
    }
    if (action === "SET_HOLD") {
      const status=clean(body.status).toUpperCase();
      if (!["HOLD","ACTIVE"].includes(status)) throw fail("Неизвестный статус партии.");
      if (status==="ACTIVE") {
        if (!hasPermission(c.access,"procurement.approve") &&
            !hasPermission(c.access,"procurement.settings.manage")) throw fail("Снять карантин может только согласующий.",403);
      } else requirePermission(c.access,"procurement.receive");
      const lot=await lotAndOrder(c,clean(body.lotId));
      const reason=clean(body.reason);
      if (reason.length<4) throw fail("Укажите обоснование изменения статуса (минимум 4 символа).");
      const operation=status==="HOLD"?"HOLD":"RELEASE";
      await c.db.prepare(`INSERT INTO proc_trace_moves(
        id,workspace_id,server_scope,request_id,lot_id,action,quantity,reason,
        actor_id,actor_name,created_at
      ) VALUES(?1,?2,?3,?4,?5,?6,0,?7,?8,?9,?10)`)
        .bind(uuid(),c.workspace,c.server,reqId,lot.id,operation,reason,c.auth.user.id,
          clean(c.access.displayName)||clean(c.auth.user.email),timestamp()).run();
      await audit(c,operation,lot.id,lot.lot_code,{reason});
      return json({success:true},201);
    }
    throw fail("Неизвестное действие.",403);
  } catch(error) {
    const text=String(error?.message||error);
    const messages = {
      LOT_EXCEEDS_GRN:"Количество превышает оставшееся по физической приёмке GRN.",
      INSUFFICIENT_LOT_BALANCE:"Недостаточно остатка партии в выбранном месте.",
      LOT_ON_HOLD:"Партия на карантине: выдача и перемещения запрещены.",
      LOT_EXPIRED:"Срок годности партии истёк. Разрешены карантин и списание.",
      DESTINATION_SCOPE_MISMATCH:"Место назначения не относится к складу партии.",
      SOURCE_SCOPE_MISMATCH:"Исходное место не относится к складу партии.",
      ALREADY_ON_HOLD:"Партия уже на карантине.",
      NOT_ON_HOLD:"Партия не находится на карантине.",
      UNIQUE:"Такая партия или операция уже зарегистрирована."
    };
    const code = Object.keys(messages).find(x=>text.includes(x));
    return json({success:false,message:code?messages[code]:text,code:code||error?.code||""},
      error?.status||(code?409:500));
  }
}
