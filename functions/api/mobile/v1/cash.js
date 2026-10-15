import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";

// Uses the SAME read-only realtime POS plugin feed as /cash/index.html.
// Every plugin is verified against the authenticated workspace's selected
// department IDs. Never forward user-supplied plugin IDs or server addresses.
const VPS_API = "http://68-233-120-197.nip.io";
const str = value => String(value ?? "").trim();
const number = value => {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(String(value).replace(/\\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};
const unwrap = value => {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
};
const collection = value => {
  const root = unwrap(value);
  if (Array.isArray(root)) return root;
  for (const key of ["plugins", "data", "items"]) {
    if (Array.isArray(root?.[key])) return root[key];
  }
  return null;
};
export function authorizedCashPlugins(payload, selectedIds) {
  const rows = collection(payload);
  if (!rows) throw new MobileError("CASH_PLUGIN_FEED_INVALID",
    "Список подключённых касс получен в неверном формате.", 502);
  const selected = new Set(selectedIds.map(str));
  const seen = new Set();
  return rows.map(r => (r?.data && typeof r.data === "object")
      ? {...r, ...r.data} : r)
    .filter(r => {
      const id = str(r?.pluginId), dept = str(r?.departmentId);
      if (!id || !selected.has(dept) || r.online !== true || seen.has(id)) return false;
      seen.add(id);
      return true;
    }).map(r => ({
      id: str(r.pluginId), departmentId: str(r.departmentId),
      name: str(r.groupName || r.pluginName || "Касса"),
      pluginName: str(r.pluginName), groupName: str(r.groupName),
      online: true
    }));
}
const status = row => {
  const t = str(row.orderStatus ?? row.deliveryOrderStatus ?? row.status).toLowerCase();
  if (/deleted|cancelled|canceled|отмен|удал/.test(t)) return "OTHER";
  if (["closed", "paid", "закрыт", "закрыто"].includes(t)
      || row.orderCloseTime || row.closeTime) return "CLOSED";
  if (["new", "bill", "open", "opened", "открыт", "открыто", "новый"].includes(t))
    return "OPEN";
  return "OTHER";
};
export function normalizePosOrders(payload) {
  const root = unwrap(unwrap(payload)?.data ?? payload);
  if (!root || typeof root !== "object" || !Array.isArray(root.terminalsGroups)) {
    throw new MobileError("CASH_ORDERS_FORMAT_UNAVAILABLE",
      "Касса вернула неожиданный формат заказов.", 502);
  }
  const rows = [];
  for (const group of root.terminalsGroups) {
    for (const section of (Array.isArray(group?.restaurantSections)
      ? group.restaurantSections : [])) {
      for (const row of [
        ...(Array.isArray(section.orders) ? section.orders : []),
        ...(Array.isArray(section.deliveries) ? section.deliveries : []),
        ...(Array.isArray(section.reserves)
          ? section.reserves.map(v => v?.reserveOrder).filter(Boolean) : [])
      ]) {
        const id = str(row?.orderNum ?? row?.number);
        if (!id) continue;
        const rawAmount = number(row.orderExpectedRevenue ??
          row.revenue ?? row.resultSum ?? row.orderSum);
        rows.push({
          number: id, status: status(row), amount: rawAmount,
          table: str(row.orderTables ?? row.tables),
          floor: str(row.floor ?? row.restaurantSectionName ?? section.restaurantSectionName),
          waiter: str(row.waiter),
          openedAt: str(row.orderOpenDate ?? row.openTime ?? row.deliveryOpenTime)
        });
      }
    }
  }
  const seen = new Set();
  return rows.filter(row => {
    if (seen.has(row.number)) return false;
    seen.add(row.number);
    return true;
  });
}
const totals = orders => {
  const out = { closedOrders: 0, openOrders: 0, otherOrders: 0,
    closedSum: 0, openSum: 0, totalOrders: orders.length,
    amountComplete: true };
  for (const order of orders) {
    if (order.status === "CLOSED") {
      out.closedOrders++;
      if (order.amount === null) out.amountComplete = false;
      else out.closedSum += order.amount;
    } else if (order.status === "OPEN") {
      out.openOrders++;
      if (order.amount === null) out.amountComplete = false;
      else out.openSum += order.amount;
    } else out.otherOrders++;
  }
  return {...out, expectedSum: out.amountComplete
    ? out.closedSum + out.openSum : null};
};
export function cashFeedSnapshot(plugins, settled, selectedIds) {
  // The caller must supply only verified, authorized plugins.
  if(plugins.length!==settled.length)throw new MobileError(
    "CASH_SNAPSHOT_INVALID","Неверное количество ответов касс.",502);
  const failed=settled.map((r,i)=>r.status==="rejected"?{
    name:plugins[i].name,departmentId:plugins[i].departmentId,
    online:false,status:"UNAVAILABLE"
  }:null).filter(Boolean);
  if(failed.length===settled.length&&settled.length)
    throw new MobileError("CASH_ALL_UNAVAILABLE",
      "Не удалось получить заказы ни от одной кассы.",502);
  const registers=settled.filter(r=>r.status==="fulfilled").map(r=>r.value);
  const represented=new Set(plugins.map(p=>p.departmentId));
  const missingDepartmentIds=selectedIds.filter(id=>!represented.has(id));
  // One restaurant may have no online POS plugin, even though its SH OLAP
  // sales are valid. Never label online-only POS amounts as CHAIN totals.
  const partial=failed.length>0 || missingDepartmentIds.length>0;
  const all=registers.flatMap(r=>r.orders);
  return {success:true,source:"SH POS Plugin",
    registers,totals:partial?null:totals(all),
    count:registers.length,partial,
    unavailableRegisters:failed,missingDepartmentIds,
    expectedRegisterCount:plugins.length,
    currency:"AZN",selectedDepartmentIds:selectedIds,
    updatedAt:new Date().toISOString()};
}
async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    const result = await fetch(url, {...options, signal: controller.signal,
      headers: {"Accept": "application/json", ...(options.headers || {})}});
    if (!result.ok) throw new MobileError("CASH_VPS_UPSTREAM",
      "Сервис касс временно недоступен.", 502);
    const data = await result.json().catch(() => null);
    if (data === null || data?.success === false) {
      throw new MobileError("CASH_VPS_BAD_RESPONSE",
        "Сервис касс вернул ошибку.", 502);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}
export async function onRequestGet({request, env}) {
  try {
    const ctx = await mobileContext(request, env, {connectionRequired: true});
    const conn = ctx.connection;
    const url = new URL(VPS_API + "/api/plugin/data");
    url.searchParams.set("departmentIds", ctx.selectedIds.join(","));
    if (conn.ip && conn.port) {
      url.searchParams.set("serverUrl", `http://${conn.ip}:${conn.port}`);
    }
    const plugins = authorizedCashPlugins(await fetchJson(url), ctx.selectedIds);
    if (plugins.length > 12) throw new MobileError("CASH_TOO_MANY",
      "Слишком много одновременно подключённых касс.", 409);
    const result = await Promise.allSettled(plugins.map(async plugin => {
      const data = await fetchJson(VPS_API + "/api/plugin/request", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({action: "get_orders",
          pluginId: plugin.id, departmentIds: [plugin.departmentId],
          ...(conn.ip && conn.port
            ? {serverUrl: `http://${conn.ip}:${conn.port}`} : {})})
      });
      const orders = normalizePosOrders(data);
      return {...plugin, orders, totals: totals(orders)};
    }));
    return response(cashFeedSnapshot(plugins,result,ctx.selectedIds));
  } catch (error) { return errorResponse(error); }
}
