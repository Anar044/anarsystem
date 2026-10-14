import { loadRequestIikoState, privateConnection, hasPrivateConnection } from "./user-state.js";
import { resolveRestaurantScope, restaurantDirectory, allowedDepartmentIds } from "./restaurant-scope.js";
import { hasPermission } from "../../access/_lib/access-control.js";

const clean = value => String(value ?? "").trim();
const unique = values => [...new Set((values || []).map(clean).filter(Boolean))];

function forbidden(message, code = "ACCESS_DENIED", status = 403) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

// The connection belongs to a workspace, not the logged-in Supabase user.
// Resolve the exact same workspace as /api/iiko/state; never fall back to a
// different organization's credentials when access or selection is ambiguous.
export async function resolveAssistantIiko(env, request, requestedIds = null) {
  const stored = await loadRequestIikoState(request, env);
  if (!stored) throw forbidden("Требуется авторизация.", "UNAUTHENTICATED", 401);
  if (stored.accessDenied || !stored.access?.allowed) {
    throw forbidden("Нет доступа к выбранной организации Smart Horeca.", stored.access?.reason || "WORKSPACE_ACCESS_DENIED");
  }
  if (!hasPermission(stored.access, "assistant.use")) {
    throw forbidden("Нет права на использование AI Smart Horeca Assistant.", "ASSISTANT_ACCESS_DENIED");
  }

  if (!stored.found || !hasPrivateConnection(stored.state)) {
    return { connected: false, connection: null, state: null, scope: null, access: stored.access };
  }

  // The private connection retains the original credentials, while restaurant
  // selection is calculated only from departments this member can see.
  const state = scopeStateForAssistant(stored.state, stored.access);
  const scopedSelection = resolveRestaurantScope({ state, request, strict: true });
  // The AI tool layer must compare member selection against the FULL server
  // directory. Otherwise an employee restricted to one restaurant appears to
  // have selected "all" and the OLAP Department filter is incorrectly omitted.
  const scope = {
    ...scopedSelection,
    allowedDepartmentIds: allowedDepartmentIds(stored.state),
    // Mobile strict mode can only narrow requests, never grant extra access.
    mobileStrict: request?.headers?.get("X-SH-Mobile-Strict-Scope") === "1"
  };
  const bodyIds = unique(Array.isArray(requestedIds) ? requestedIds : []);
  const selected = new Set(scope.selectedDepartmentIds || []);
  const outside = bodyIds.filter(departmentId => !selected.has(departmentId));
  if (outside.length) {
    throw forbidden("AI запрос содержит ресторан вне текущего выбора Smart Horeca.", "CHAIN_SCOPE_SELECTION_FORBIDDEN");
  }

  return {
    connected: true,
    connection: privateConnection(stored.state),
    state,
    scope,
    access: stored.access
  };
}

// This is a read-only scope projection: the saved server configuration in D1
// must not be edited or replaced with redacted credentials.
export function scopeStateForAssistant(state, access) {
  if (!state || access?.isOwner || access?.scope?.mode !== "SELECTED") return state;
  const directory = restaurantDirectory(state);
  const knownIds = new Set(directory.map(row => row.id));
  const assignedCodes = new Set(unique(access.scope.departmentCodes));
  const ids = unique([
    ...(access.scope.departmentIds || []),
    ...directory.filter(row => assignedCodes.has(row.code)).map(row => row.id)
  ]).filter(id => knownIds.has(id));
  if (!ids.length) throw forbidden("Нет разрешённых ресторанов для AI Assistant.", "ASSISTANT_SCOPE_EMPTY");
  const allowed = new Set(ids);
  const out = structuredClone(state);
  const scopedRows = rows => (Array.isArray(rows) ? rows : []).filter(row => allowed.has(clean(row?.id)));
  const project = target => {
    if (!target || typeof target !== "object") return;
    target.departmentIds = ids;
    target.departments = scopedRows(target.departments);
    target.organizations = scopedRows(target.organizations);
    if (!allowed.has(clean(target.organizationId))) delete target.organizationId;
    const groups = (Array.isArray(target.groups) ? target.groups : []).filter(row => allowed.has(clean(row?.departmentId)));
    target.groups = groups;
    const groupIds = new Set(groups.map(row => clean(row?.id)));
    const points = (Array.isArray(target.pointsOfSale) ? target.pointsOfSale : []).filter(row => groupIds.has(clean(row?.groupId)));
    target.pointsOfSale = points;
    const pointIds = new Set(points.map(row => clean(row?.id)));
    target.restaurantSections = (Array.isArray(target.restaurantSections) ? target.restaurantSections : [])
      .filter(row => groupIds.has(clean(row?.groupId)) || pointIds.has(clean(row?.pointOfSaleId)));
    target.hierarchy = (Array.isArray(target.hierarchy) ? target.hierarchy : []).filter(row =>
      allowed.has(clean(row?.id)) || allowed.has(clean(row?.departmentId)) ||
      groupIds.has(clean(row?.id)) || groupIds.has(clean(row?.groupId)));
  };
  project(out.identity);
  project(out.connection);
  return out;
}

const TOOL_PERMISSIONS = {
  search_products: ["inventory.nomenclature.view", "procurement.sourcing", "procurement.prices.view"],
  analyze_purchase_prices: ["procurement.prices.view", "procurement.analytics", "inventory.incoming.view"],
  get_supplier_balances: ["reports.supplier_balances", "finance.view", "procurement.analytics", "procurement.sourcing"],
  search_olap_fields: ["reports.olap"],
  run_olap_report: ["reports.olap"]
};
export function assistantToolAuthorized(access, name) {
  if (name === "list_smart_horeca_capabilities") return true;
  const permissions = TOOL_PERMISSIONS[name];
  if (!permissions) return false;
  if (!permissions.some(permission => hasPermission(access, permission))) return false;
  if (name === "analyze_purchase_prices" && !hasPermission(access, "sensitive.cost.view")) return false;
  return true;
}
