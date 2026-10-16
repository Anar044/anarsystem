import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { loadPosSnapshots, savePosSnapshots } from "../_lib/cash-snapshots.js";

// Uses the SAME read-only realtime POS plugin feed as /cash/index.html.
// Every plugin is verified against the authenticated workspace's selected
// department IDs. Never forward user-supplied plugin IDs or server addresses.
const VPS_API = "http://68-233-120-197.nip.io";
const str = value => String(value ?? "").trim();
const number = value => {
  const raw = first(value);
  if (raw === null || raw === undefined || raw === "") return null;
  const cleaned = String(raw).replace(/\s/g, "").replace(",", ".")
    .replace(/[^0-9+\-.]/g, "");
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};
const unwrap = value => {
  if (typeof value === "string") {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
};
const first = value => {
  const root = unwrap(value);
  if (root === null || root === undefined || root === "") return null;
  if (Array.isArray(root)) {
    for (const item of root) {
      const result = first(item);
      if (result !== null && result !== "") return result;
    }
    return null;
  }
  if (typeof root === "object") {
    for (const key of ["name","Name","value","Value","sum","Sum",
      "amount","Amount","typeName","TypeName","type","Type"]) {
      if (root[key] !== undefined && root[key] !== null && root[key] !== "") {
        const result = first(root[key]);
        if (result !== null && result !== "") return result;
      }
    }
    return null;
  }
  return root;
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
      const hall = str(section?.restaurantSectionName ?? section?.name);
      const entries = [
        ...(Array.isArray(section.orders)
          ? section.orders.map(row => ({row, source:"order"})) : []),
        ...(Array.isArray(section.deliveries)
          ? section.deliveries.map(row => ({row, source:"delivery"})) : []),
        ...(Array.isArray(section.reserves)
          ? section.reserves.map(v => v?.reserveOrder)
            .filter(Boolean).map(row => ({row, source:"reserve"})) : [])
      ];
      for (const entry of entries) {
        const row = entry.row;
        const id = str(row?.orderNum ?? row?.number);
        if (!id) continue;
        const rawAmount = number(row.orderExpectedRevenue ??
          row.revenue ?? row.resultSum ?? row.orderSum);
        const rawPayments = row.payments ?? row.Payments ??
          row.paymentItems ?? row.PaymentItems;
        const payments = Array.isArray(rawPayments) ? rawPayments.map(p => ({
          name: str(p?.name ?? p?.Name ?? p?.typeName ?? p?.TypeName ??
            p?.paymentTypeName ?? p?.PaymentTypeName ?? p?.type ?? p?.Type),
          amount: number(p?.value ?? p?.Value ?? p?.sum ?? p?.Sum ??
            p?.amount ?? p?.Amount)
        })).filter(p => p.name) : [];
        rows.push({
          number: id, status: status(row), amount: rawAmount,
          table: str(row.orderTables ?? row.tables),
          floor: str(row.floor ?? row.restaurantSectionName ??
            row.__sectionName ?? hall),
          waiter: str(row.waiter ?? row.waiterName),
          cashier: str(row.cashier ?? row.cashierName),
          openedAt: str(row.orderOpenDate ?? row.openTime ?? row.deliveryOpenTime),
          billAt: str(row.orderBillTime ?? row.billTime ??
            row.orderBillDate ?? row.billDate),
          closedAt: str(row.orderCloseTime ?? row.closeTime ??
            row.deliveryDeliveryCloseTime),
          discountAmount: number(row.discountAmount ?? row.discountSum ??
            row.DiscountSum ?? row.orderDiscountSum),
          surchargeAmount: number(row.surchargeAmount ?? row.increaseSum ??
            row.IncreaseSum ?? row.orderSurchargeSum),
          payments, source: entry.source
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
export function cashFeedSnapshot(plugins,settled,selectedIds,history=[],{
  feedAvailable=true,seenAt=new Date().toISOString()
}={}) {
  // The caller must supply only verified, authorized plugins/snapshots.
  if(plugins.length!==settled.length)throw new MobileError(
    "CASH_SNAPSHOT_INVALID","Неверное количество ответов касс.",502);
  const selected=new Set(selectedIds.map(str));
  const online=settled.flatMap((result,i)=>result.status==="fulfilled"
    ?[{...result.value,online:true,status:"ONLINE",snapshot:false,
      lastSeenAt:seenAt}]:[]);
  const liveIds=new Set(online.map(r=>r.id));
  const validSnapshots=(history||[]).filter(item =>
    item?.id && selected.has(str(item.departmentId)));
  const offline=validSnapshots.filter(item=>!liveIds.has(item.id))
    .map(item=>({...item,online:false,status:"OFFLINE",snapshot:true}));
  const offlineIds=new Set(offline.map(r=>r.id));
  const failures=settled.flatMap((result,i)=>result.status==="rejected" &&
    !offlineIds.has(plugins[i].id) ? [{
      id:plugins[i].id,name:plugins[i].name,
      departmentId:plugins[i].departmentId,online:false,status:"UNAVAILABLE"
    }]:[]);
  if(!online.length&&!offline.length&&settled.length)
    throw new MobileError("CASH_ALL_UNAVAILABLE",
      "Не удалось получить заказы ни от одной кассы.",502);
  const represented=new Set([...plugins,...offline].map(p=>p.departmentId));
  const missingDepartmentIds=selectedIds.filter(id=>!represented.has(id));
  const partial=!feedAvailable||failures.length>0||
    missingDepartmentIds.length>0||offline.length>0;
  const availableTotals=online.length
    ?totals(online.flatMap(r=>r.orders)):null;
  // Never aggregate last-seen offline snapshots into live totals.
  return {
    success:true,source:"SH POS Plugin",
    registers:[...online,...offline],totals:partial?null:availableTotals,
    availableTotals,totalsCoverage:partial?"ONLINE_REGISTERS_ONLY":"ALL_SELECTED_RESTAURANTS",
    count:online.length,onlineCount:online.length,offlineCount:offline.length,
    partial,feedAvailable,
    unavailableRegisters:failures,missingDepartmentIds,
    expectedRegisterCount:plugins.length,
    currency:"AZN",selectedDepartmentIds:selectedIds,
    updatedAt:seenAt
  };
}
async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9500);
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
export async function onRequestGet({request,env}) {
  try {
    const ctx=await mobileContext(request,env,{connectionRequired:true});
    const workspaceId=str(ctx.access.workspace.id);
    const historical=await loadPosSnapshots(env.DB,workspaceId,ctx.selectedIds)
      .catch(()=>[]);
    const conn=ctx.connection;
    const url=new URL(VPS_API+"/api/plugin/data");
    url.searchParams.set("departmentIds",ctx.selectedIds.join(","));
    if(conn.ip&&conn.port)
      url.searchParams.set("serverUrl",`http://${conn.ip}:${conn.port}`);
    let plugins=[],feedAvailable=true;
    try {
      plugins=authorizedCashPlugins(await fetchJson(url),ctx.selectedIds);
    } catch (e) {
      if(!historical.length) throw e;
      feedAvailable=false;
    }
    if(plugins.length>12)throw new MobileError("CASH_TOO_MANY",
      "Слишком много одновременно подключённых касс.",409);
    const result=await Promise.allSettled(plugins.map(async plugin=>{
      const data=await fetchJson(VPS_API+"/api/plugin/request",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"get_orders",
          pluginId:plugin.id,departmentIds:[plugin.departmentId],
          ...(conn.ip&&conn.port
            ?{serverUrl:`http://${conn.ip}:${conn.port}`}:{})})
      });
      const orders=normalizePosOrders(data).map(order=>({
        ...order,pluginId:plugin.id,departmentId:plugin.departmentId,
        registerName:plugin.name
      }));
      return {...plugin,orders,totals:totals(orders)};
    }));
    const seenAt=new Date().toISOString();
    const online=result.flatMap(entry=>
      entry.status==="fulfilled"?[entry.value]:[]);
    if(online.length) await savePosSnapshots(env.DB,workspaceId,online,seenAt)
      .catch(()=>{}); // Do not hide real-time data if snapshot storage is down.
    return response(cashFeedSnapshot(plugins,result,ctx.selectedIds,
      historical,{feedAvailable,seenAt}));
  } catch(error) { return errorResponse(error); }
}
