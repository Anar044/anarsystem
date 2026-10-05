import { clean, iikoJson } from "./_lib/iiko-client.js";
import { getIikoSuppliers } from "./_lib/iiko-suppliers.js";
import { syncReferences } from "./references.js";
import { loadCachedReferenceMaps } from "./_lib/reference-cache.js";
import { resolveStoreScope } from "./_lib/store-scope.js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8"
  };
}
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Cache-Control": "no-store" }
  });
}
function rows(map) {
  return [...(map?.entries?.() || [])]
    .map(([id, name]) => ({ id: String(id || ""), name: String(name || "") }))
    .filter(x => x.id && x.name)
    .sort((a, b) => a.name.localeCompare(b.name, "ru"));
}

function warehouseKey(v) {
  return String(v ?? "").trim().replace(/^\{+|\}+$/g, "").toLowerCase();
}
function collectBalanceWarehouses(payload) {
  const map = new Map();
  const add = (id, name) => {
    const key = warehouseKey(id);
    const label = String(name ?? "").trim();
    if (key && label && !map.has(key)) map.set(key, label);
  };
  const walk = value => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    const store = value.store ?? value.storeId ?? value.warehouse ?? value.warehouseId;
    const storeName = value.storeName ?? value.warehouseName;
    if (store && typeof store === "object") {
      add(
        store.id ?? store.uuid ?? store.entityId ?? store.storeId ?? store.warehouseId,
        store.name ?? store.title ?? store.description ?? storeName
      );
    } else if (store) {
      add(store, storeName);
    }
    Object.values(value).forEach(x => {
      if (x && typeof x === "object") walk(x);
    });
  };
  walk(payload);
  return map;
}
async function balanceWarehouseMap(connection) {
  const timestamp = new Date().toISOString().slice(0, 19);
  const result = await iikoJson(
    connection,
    "/resto/api/v2/reports/balance/stores?timestamp=" + encodeURIComponent(timestamp),
    { timeoutMs: 60000 }
  );
  return {
    map: result.ok && result.payload ? collectBalanceWarehouses(result.payload) : new Map(),
    status: result.status,
    ok: result.ok,
    rawPreview: String(result.text || "").slice(0, 500)
  };
}

function balanceWarehouseIds(payload) {
  const ids = new Set();
  const add = value => {
    const id = warehouseKey(value);
    if (id) ids.add(id);
  };
  const walk = value => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    const store = value.store ?? value.storeId ?? value.warehouse ?? value.warehouseId;
    if (store && typeof store === "object") {
      add(store.id ?? store.uuid ?? store.entityId ?? store.storeId ?? store.warehouseId);
    } else if (store) add(store);
    Object.values(value).forEach(x => {
      if (x && typeof x === "object") walk(x);
    });
  };
  walk(payload);
  return ids;
}
function accountStoreData(payload, wantedIds = []) {
  const wanted = new Set((wantedIds || []).map(warehouseKey).filter(Boolean));
  const exact = new Map();
  const explicitStores = new Map();
  const add = value => {
    if (!value || typeof value !== "object") return;
    const id = warehouseKey(value.id ?? value.uuid ?? value.entityId ?? value.accountId);
    const name = String(value.name ?? value.title ?? value.description ?? value.fullName ?? "").trim();
    const marker = String(
      value.storeOrAccount ?? value.StoreOrAccount ?? value.kind ?? value.entityKind ?? ""
    ).trim().toUpperCase();
    if (id && name && wanted.has(id) && !exact.has(id)) exact.set(id, name);
    if (id && name && marker === "STORE" && !explicitStores.has(id)) explicitStores.set(id, name);
  };
  const walk = value => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!value || typeof value !== "object") return;
    add(value);
    Object.values(value).forEach(x => {
      if (x && typeof x === "object") walk(x);
    });
  };
  walk(payload);
  return { exact, explicitStores };
}
async function accountWarehouseMap(connection, wantedIds = []) {
  const result = await iikoJson(
    connection,
    "/resto/api/v2/entities/list?rootType=Account&includeDeleted=false",
    { timeoutMs: 60000 }
  );
  const data = result.ok && result.payload
    ? accountStoreData(result.payload, wantedIds)
    : { exact: new Map(), explicitStores: new Map() };
  return {
    ...data,
    status: result.status,
    ok: result.ok
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const raw = body?.connection || body || {};
    const connection = {
      ip: clean(raw.ip),
      port: clean(raw.port),
      login: clean(raw.login),
      password: String(raw.password || "")
    };
    if (!connection.ip || !connection.port || !connection.login || !connection.password) {
      return json({ success: false, message: "Не найдено подключение к iiko Server" }, 400);
    }

    const authModule = await import("./_lib/iiko-client.js");
    const auth = await authModule.getIikoAuth(connection);
    let refs = await loadCachedReferenceMaps(env, auth.serverUrl, [], {
      ttlMs: 6 * 60 * 60 * 1000,
      requiredKeys: ["suppliers", "warehouses", "products"]
    });
    if (!refs) refs = await syncReferences(env, auth.serverUrl, auth.token);
    const supplierResult = await getIikoSuppliers(connection);
    const maps = refs.maps || {};
    const suppliers = (supplierResult.rows || [])
      .map(x => ({ id: String(x.id || "").replace(/^\\{+|\\}+$/g, "").toLowerCase(), name: String(x.name || "") }))
      .filter(x => x.id && x.name)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));

    let warehouseMap = new Map(maps.warehouses?.entries?.() || []);
    const departmentIds=Array.isArray(body.departmentIds)?body.departmentIds.map(String).filter(Boolean):[];
    const allowedIds=Array.isArray(body?.chainScope?.allowedDepartmentIds)?body.chainScope.allowedDepartmentIds.map(String).filter(Boolean):[];
    const subsetRequested=String(body?.chainScope?.mode||"").toUpperCase()==="CHAIN"&&departmentIds.length>0&&allowedIds.length>departmentIds.length;
    let storeScope=null;
    if(subsetRequested){
      storeScope=await resolveStoreScope(connection,departmentIds);
      if(!storeScope.resolved||!storeScope.storeIds.length){
        return json({success:false,code:"INVOICE_REFERENCE_SCOPE_UNAVAILABLE",message:"Не удалось определить склады выбранного подразделения.",meta:{departmentIds,storeScope:storeScope?.diagnostics||null}},409);
      }
      const wanted=new Set(storeScope.storeIds.map(warehouseKey));
      warehouseMap=new Map([...warehouseMap.entries()].filter(([id])=>wanted.has(warehouseKey(id))));
    }
    let balanceWarehouseResult = { map: new Map(), status: 0, ok: false, rawPreview: "", payload: null };
    let accountWarehouseResult = { exact: new Map(), explicitStores: new Map(), status: 0, ok: false };

    if (warehouseMap.size <= 1) {
      const timestamp = new Date().toISOString().slice(0, 19);
      const balanceRaw = await iikoJson(
        connection,
        "/resto/api/v2/reports/balance/stores?timestamp=" + encodeURIComponent(timestamp),
        { timeoutMs: 60000 }
      );
      balanceWarehouseResult = {
        map: balanceRaw.ok && balanceRaw.payload ? collectBalanceWarehouses(balanceRaw.payload) : new Map(),
        status: balanceRaw.status,
        ok: balanceRaw.ok,
        rawPreview: String(balanceRaw.text || "").slice(0, 500),
        payload: balanceRaw.payload
      };
      for (const [id, name] of balanceWarehouseResult.map) {
        if (!warehouseMap.has(id)) warehouseMap.set(id, name);
      }

      const balanceIds = balanceWarehouseResult.payload ? [...balanceWarehouseIds(balanceWarehouseResult.payload)] : [];
      accountWarehouseResult = await accountWarehouseMap(connection, balanceIds);
      for (const [id, name] of accountWarehouseResult.exact) {
        if (!warehouseMap.has(id)) warehouseMap.set(id, name);
      }
      for (const [id, name] of accountWarehouseResult.explicitStores) {
        if (!warehouseMap.has(id)) warehouseMap.set(id, name);
      }
    }

    if(subsetRequested&&storeScope?.storeIds?.length){
      const wanted=new Set(storeScope.storeIds.map(warehouseKey));
      warehouseMap=new Map([...warehouseMap.entries()].filter(([id])=>wanted.has(warehouseKey(id))));
    }

    return json({
      success: true,
      suppliers,
      warehouses: rows(warehouseMap),
      products: rows(maps.products),
      counts: {
        suppliers: suppliers.length,
        warehouses: warehouseMap.size,
        products: maps.products?.size || 0
      },
      diagnostics: {
        references: refs.diagnostics || null,
        referenceCacheHit: refs.cacheHit === true,
        supplierSource: {
          endpoint: "/resto/api/suppliers?revisionFrom=-1",
          status: supplierResult.status,
          format: supplierResult.format,
          recordsFound: supplierResult.recordsFound,
          namedRecords: supplierResult.namedRecords
        },
        warehouseBalanceFallback: {
          endpoint: "/resto/api/v2/reports/balance/stores",
          status: balanceWarehouseResult.status,
          ok: balanceWarehouseResult.ok,
          recordsFound: balanceWarehouseResult.map.size,
          names: [...balanceWarehouseResult.map.values()]
        },
        warehouseAccountFallback: {
          endpoint: "/resto/api/v2/entities/list?rootType=Account",
          status: accountWarehouseResult.status,
          ok: accountWarehouseResult.ok,
          exactResolved: accountWarehouseResult.exact.size,
          explicitStores: accountWarehouseResult.explicitStores.size,
          names: [...new Set([...accountWarehouseResult.exact.values(), ...accountWarehouseResult.explicitStores.values()])]
        }
      },
      meta: {
        authCacheHit: auth.cacheHit === true,
        supplierAuthCacheHit: supplierResult.authCacheHit === true,
        departmentIds,
        departmentScopeApplied: subsetRequested,
        storeIds: storeScope?.storeIds || []
      }
    });
  } catch (error) {
    return json(
      { success: false, message: error?.message || "Ошибка загрузки справочников для накладной" },
      502
    );
  }
}
