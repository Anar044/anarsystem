import { clean, iikoJson } from "./_lib/iiko-client.js";
import { getIikoSuppliers } from "./_lib/iiko-suppliers.js";
import { syncReferences } from "./references.js";

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
    const [refs, supplierResult] = await Promise.all([
      syncReferences(env, auth.serverUrl, auth.token),
      getIikoSuppliers(connection)
    ]);
    const maps = refs.maps || {};
    const suppliers = (supplierResult.rows || [])
      .map(x => ({ id: String(x.id || "").replace(/^\\{+|\\}+$/g, "").toLowerCase(), name: String(x.name || "") }))
      .filter(x => x.id && x.name)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));

    const warehouseMap = new Map(maps.warehouses?.entries?.() || []);
    let balanceWarehouseResult = { map: new Map(), status: 0, ok: false, rawPreview: "" };
    if (warehouseMap.size <= 1) {
      balanceWarehouseResult = await balanceWarehouseMap(connection);
      for (const [id, name] of balanceWarehouseResult.map) {
        if (!warehouseMap.has(id)) warehouseMap.set(id, name);
      }
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
        }
      },
      meta: { authCacheHit: auth.cacheHit === true, supplierAuthCacheHit: supplierResult.authCacheHit === true }
    });
  } catch (error) {
    return json(
      { success: false, message: error?.message || "Ошибка загрузки справочников для накладной" },
      502
    );
  }
}
