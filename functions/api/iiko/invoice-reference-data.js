import { clean } from "./_lib/iiko-client.js";
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

    return json({
      success: true,
      suppliers,
      warehouses: rows(maps.warehouses),
      products: rows(maps.products),
      counts: {
        suppliers: suppliers.length,
        warehouses: maps.warehouses?.size || 0,
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
