import { sha1 } from "./iiko-client.js";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

const TABLES = {
  suppliers: ["sh_iiko_suppliers", "supplier_id", "supplier_name"],
  warehouses: ["sh_iiko_warehouses", "warehouse_id", "warehouse_name"],
  products: ["sh_iiko_products", "product_id", "product_name"],
  groups: ["sh_iiko_product_groups", "group_id", "group_name"],
  categories: ["sh_iiko_product_categories", "category_id", "category_name"]
};

const cleanId = value => String(value ?? "")
  .trim()
  .replace(/^\{+|\}+$/g, "")
  .toLowerCase();

async function readTable(db, scope, table, idColumn, nameColumn) {
  try {
    const result = await db
      .prepare(`SELECT ${idColumn} id, ${nameColumn} name, updated_at FROM ${table} WHERE scope_id=?1`)
      .bind(scope)
      .all();
    const rows = Array.isArray(result.results) ? result.results : [];
    const map = new Map();
    let newestAt = 0;
    for (const row of rows) {
      const id = cleanId(row?.id);
      const name = String(row?.name ?? "").trim();
      if (id && name) map.set(id, name);
      const at = Date.parse(String(row?.updated_at || ""));
      if (Number.isFinite(at) && at > newestAt) newestAt = at;
    }
    return { map, newestAt };
  } catch (_) {
    return { map: new Map(), newestAt: 0 };
  }
}

export async function loadCachedReferenceMaps(env, serverUrl, neededSupplierIds = [], options = {}) {
  if (!env?.DB || !serverUrl) return null;

  const ttlMs = Number(options.ttlMs) > 0 ? Number(options.ttlMs) : DEFAULT_TTL_MS;
  const scope = await sha1(String(serverUrl).toLowerCase());
  const entries = await Promise.all(
    Object.entries(TABLES).map(async ([key, [table, idColumn, nameColumn]]) => [
      key,
      await readTable(env.DB, scope, table, idColumn, nameColumn)
    ])
  );

  const state = Object.fromEntries(entries);
  const cutoff = Date.now() - ttlMs;
  const required = ["suppliers", "warehouses", "products", "groups", "categories"];
  if (required.some(key => !state[key] || state[key].map.size === 0 || state[key].newestAt < cutoff)) {
    return null;
  }

  const needed = [...new Set(neededSupplierIds.map(cleanId).filter(Boolean))];
  if (needed.some(id => !state.suppliers.map.has(id))) return null;

  const newestValues = required.map(key => state[key].newestAt).filter(Boolean);
  const oldestRefresh = newestValues.length ? Math.min(...newestValues) : 0;

  return {
    maps: {
      suppliers: state.suppliers.map,
      warehouses: state.warehouses.map,
      products: state.products.map,
      groups: state.groups.map,
      categories: state.categories.map
    },
    cacheHit: true,
    scope,
    ageMs: oldestRefresh ? Math.max(0, Date.now() - oldestRefresh) : null,
    ttlMs
  };
}
