import { clean, iikoJson } from "./_lib/iiko-client.js";
import { getIikoSuppliers } from "./_lib/iiko-suppliers.js";
import { syncAiReferences } from "./references.js";
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

function productIdKey(v) {
  return String(v ?? "").trim().replace(/^\{+|\}+$/g, "").toLowerCase();
}
function numeric(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function productArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["products","items","result","data"]) {
    if (Array.isArray(payload[key])) return payload[key];
  }
  return [];
}
function normalizeContainers(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  const seen = new Set();
  for (const x of list) {
    if (!x || typeof x !== "object") continue;
    const id = productIdKey(x.id ?? x.uuid ?? x.containerId);
    const deleted = x.deleted === true || x.isDeleted === true;
    const count = numeric(x.count ?? x.quantity ?? x.actualUnitWeight, 0);
    if (deleted || !(count > 0)) continue;
    const identity = id || [
      String(x.num ?? x.lineNumber ?? ""),
      String(x.name ?? ""),
      String(count)
    ].join("|");
    if (!identity || seen.has(identity)) continue;
    seen.add(identity);
    out.push({
      id,
      num: String(x.num ?? x.lineNumber ?? "").trim(),
      name: String(x.name ?? x.title ?? "").trim(),
      count,
      minContainerWeight: numeric(x.minContainerWeight, 0),
      maxContainerWeight: numeric(x.maxContainerWeight, 0),
      containerWeight: numeric(x.containerWeight, 0),
      fullContainerWeight: numeric(x.fullContainerWeight, 0),
      useInFront: x.useInFront === true
    });
  }
  return out.sort((a,b) => a.count - b.count || a.name.localeCompare(b.name, "ru"));
}
function normalizeProductDetails(payload) {
  const map = new Map();
  for (const p of productArray(payload)) {
    if (!p || typeof p !== "object") continue;
    const id = productIdKey(p.id ?? p.uuid ?? p.entityId ?? p.productId);
    if (!id) continue;
    map.set(id, {
      id,
      name: String(p.name ?? p.title ?? "").trim(),
      num: String(p.num ?? p.code ?? "").trim(),
      mainUnit: productIdKey(p.mainUnit ?? p.mainUnitId ?? p.unit),
      unitWeight: numeric(p.unitWeight ?? p.weight, 0),
      containers: normalizeContainers(p.containers ?? p.containerDtos ?? p.packagings)
    });
  }
  return map;
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
      allowStale: true,
      requiredKeys: ["suppliers", "warehouses", "products"]
    });
    if (!refs) refs = await syncAiReferences(env, auth.serverUrl, auth.token);
    const maps = refs.maps || {};
    let productDetailsResult = { ok: false, status: 0, payload: null, text: "" };
    let productDetails = new Map();
    try {
      productDetailsResult = await iikoJson(
        connection,
        "/resto/api/v2/entities/products/list?includeDeleted=false",
        { timeoutMs: 60000 }
      );
      if (productDetailsResult.ok && productDetailsResult.payload) {
        productDetails = normalizeProductDetails(productDetailsResult.payload);
      }
    } catch (error) {
      productDetailsResult = { ok: false, status: 0, payload: null, text: "", error: String(error?.message || error) };
    }
    let supplierResult = null;
    let suppliers = rows(maps.suppliers);
    if (!suppliers.length) {
      supplierResult = await getIikoSuppliers(connection);
      suppliers = (supplierResult.rows || [])
        .map(x => ({ id: String(x.id || "").replace(/^\\{+|\\}+$/g, "").toLowerCase(), name: String(x.name || "") }))
        .filter(x => x.id && x.name)
        .sort((a, b) => a.name.localeCompare(b.name, "ru"));
    }

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
      products: rows(maps.products).map(p => {
        const detail = productDetails.get(productIdKey(p.id));
        return detail ? {
          ...p,
          num: detail.num,
          mainUnit: detail.mainUnit,
          unitWeight: detail.unitWeight,
          packagings: detail.containers
        } : {
          ...p,
          num: "",
          mainUnit: "",
          unitWeight: 0,
          packagings: []
        };
      }),
      counts: {
        suppliers: suppliers.length,
        warehouses: warehouseMap.size,
        products: maps.products?.size || 0,
        productsWithPackagings: [...productDetails.values()].filter(x => x.containers.length).length,
        packagings: [...productDetails.values()].reduce((s,x) => s + x.containers.length, 0)
      },
      diagnostics: {
        references: refs.diagnostics || null,
        productPackagings: {
          endpoint: "/resto/api/v2/entities/products/list?includeDeleted=false",
          status: productDetailsResult.status || 0,
          ok: productDetailsResult.ok === true,
          productsFound: productDetails.size,
          productsWithPackagings: [...productDetails.values()].filter(x => x.containers.length).length,
          packagingsFound: [...productDetails.values()].reduce((s,x) => s + x.containers.length, 0)
        },
        referenceCacheHit: refs.cacheHit === true,
        referenceCacheStale: refs.stale === true,
        referenceCacheAgeMs: refs.ageMs ?? null,
        supplierSource: {
          endpoint: "/resto/api/suppliers?revisionFrom=-1",
          status: supplierResult?.status ?? null,
          format: supplierResult?.format || (refs.cacheHit ? "d1-cache" : ""),
          recordsFound: supplierResult?.recordsFound ?? suppliers.length,
          namedRecords: supplierResult?.namedRecords ?? suppliers.length
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
        supplierAuthCacheHit: supplierResult?.authCacheHit === true,
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
