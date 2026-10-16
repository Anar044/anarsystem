import { mobileContext, response, errorResponse, MobileError } from "../_lib/context.js";
import { authorizedCashPlugins } from "./cash.js";

const DEFAULT_VPS = "http://68-233-120-197.nip.io";
const clean = value => String(value ?? "").trim();
const unwrap = value => {
  let current = value;
  for (let i=0; i<3 && typeof current==="string"; i++) {
    try { current = JSON.parse(current); } catch { break; }
  }
  return current;
};
const number = value => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
};
const scalar = value => {
  const v = unwrap(value);
  if (v === null || v === undefined || v === "") return null;
  if (["string","number","boolean"].includes(typeof v)) return String(v);
  if (Array.isArray(v)) {
    for (const item of v) {
      const result = scalar(item);
      if (result) return result;
    }
    return null;
  }
  for (const key of ["name","Name","fullName","FullName","title","Title",
    "value","Value","text","Text","typeName","TypeName"]) {
    const result = scalar(v[key]);
    if (result) return result;
  }
  return null;
};
const pick = (object, keys) => {
  if (!object || typeof object !== "object") return null;
  const entries = new Map(Object.entries(object).map(([key,value]) =>
    [key.toLowerCase(),value]));
  for (const key of keys) {
    const value = entries.get(key.toLowerCase());
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
};
const detailRoot = payload => {
  const value = unwrap(payload);
  if (!value || typeof value !== "object") return value;
  return unwrap(value.data ?? value.orderDetails ?? value.order ?? value);
};
const firstArray = (root, keys) => {
  const value = pick(root, keys);
  return Array.isArray(value) ? value : [];
};
function normalizePayment(item) {
  return {
    name: scalar(pick(item, ["name","typeName","paymentTypeName","paymentName",
      "paymentType","type","title"])) || "",
    amount: number(pick(item, ["value","sum","amount","resultSum"]))
  };
}
function normalizeItem(item) {
  const quantity = number(pick(item, ["amount","quantity","count","qty"]));
  const price = number(pick(item, ["price","unitPrice","itemPrice"]));
  const directAmount = number(pick(item, ["resultSum","sum","total","cost","lineSum"]));
  const modifiers = firstArray(item, ["modifiers"]).map(modifier => ({
    name: scalar(pick(modifier, ["name","title","productName"])) || "Добавка",
    quantity: number(pick(modifier, ["amount","quantity","count"])) ?? 1
  }));
  return {
    name: scalar(pick(item, ["name","productName","dishName","itemName","title"])) || "Без названия",
    quantity, price,
    amount: directAmount ?? (quantity !== null && price !== null ? quantity*price : null),
    status: scalar(pick(item, ["status","itemStatus"])) || null,
    modifiers
  };
}
export function normalizePosOrderDetail(payload, requested = {}) {
  const root = detailRoot(payload);
  if (!root || typeof root !== "object" || Array.isArray(root)) {
    throw new MobileError("CASH_ORDER_DETAILS_UNAVAILABLE",
      "Касса не вернула детализацию заказа.", 502);
  }
  const rawItems = firstArray(root, ["items","orderItems","products","dishes"]);
  const rawPayments = firstArray(root, ["payments","paymentItems","paymentTypes"]);
  const items = rawItems.map(normalizeItem);
  const payments = rawPayments.map(normalizePayment).filter(p => p.name);
  return {
    success: true,
    number: clean(pick(root, ["orderNum","number","orderNumber"]) ?? requested.orderNum),
    status: clean(pick(root, ["orderStatus","status"]) ?? requested.status),
    departmentId: clean(requested.departmentId),
    pluginId: clean(requested.pluginId),
    registerName: clean(requested.registerName),
    table: scalar(pick(root, ["tables","table","orderTables","tableName"])) ??
      clean(requested.table) || null,
    floor: scalar(pick(root, ["floor","hall","restaurantSectionName","floorName",
      "restaurantSection"])) ?? clean(requested.floor) || null,
    waiter: scalar(pick(root, ["waiter","waiterName","employeeName"])) ??
      clean(requested.waiter) || null,
    cashier: scalar(pick(root, ["cashier","cashierName","cashierFullName"])) ??
      clean(requested.cashier) || null,
    openedAt: clean(pick(root, ["openTime","orderOpenDate","openedAt","deliveryOpenTime"]) ??
      requested.openedAt) || null,
    billAt: clean(pick(root, ["billTime","orderBillTime","billAt"]) ??
      requested.billAt) || null,
    closedAt: clean(pick(root, ["closeTime","orderCloseTime","closedAt",
      "deliveryDeliveryCloseTime"]) ?? requested.closedAt) || null,
    amount: number(pick(root, ["revenue","orderExpectedRevenue","resultSum","orderSum"])) ??
      number(requested.amount),
    discountAmount: number(pick(root, ["discountAmount","discountSum","orderDiscountSum"])) ??
      number(requested.discountAmount),
    surchargeAmount: number(pick(root, ["surchargeAmount","increaseSum","orderSurchargeSum"])) ??
      number(requested.surchargeAmount),
    payments, items, itemsAvailable: items.length > 0,
    source: "SH POS Plugin", updatedAt: new Date().toISOString()
  };
}
async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 14000);
  try {
    const upstream = await fetch(url, {...options, signal:controller.signal,
      headers:{Accept:"application/json",...(options.headers||{})}});
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok || payload === null) throw new MobileError(
      "CASH_ORDER_SOURCE_FAILED","Не удалось получить данные заказа с кассы.",502);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}
async function requestOrder(origin, body) {
  const payload = await fetchJson(origin + "/api/plugin/request", {
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify(body)
  });
  if (payload?.success === false && payload?.error) {
    throw new MobileError("CASH_ORDER_SOURCE_FAILED",
      "Касса не вернула детали выбранного заказа.",502);
  }
  return payload;
}
export async function onRequestGet({request,env}) {
  try {
    const url = new URL(request.url);
    const requested = {
      pluginId:clean(url.searchParams.get("pluginId")),
      orderNum:clean(url.searchParams.get("orderNum")),
      departmentId:clean(url.searchParams.get("departmentId")),
      status:clean(url.searchParams.get("status")),
      registerName:clean(url.searchParams.get("registerName")),
      table:clean(url.searchParams.get("table")),
      floor:clean(url.searchParams.get("floor")),
      waiter:clean(url.searchParams.get("waiter")),
      cashier:clean(url.searchParams.get("cashier")),
      openedAt:clean(url.searchParams.get("openedAt")),
      billAt:clean(url.searchParams.get("billAt")),
      closedAt:clean(url.searchParams.get("closedAt")),
      amount:url.searchParams.has("amount")?url.searchParams.get("amount"):null,
      discountAmount:url.searchParams.has("discountAmount")?url.searchParams.get("discountAmount"):null,
      surchargeAmount:url.searchParams.has("surchargeAmount")?url.searchParams.get("surchargeAmount"):null
    };
    if (!requested.pluginId || !requested.orderNum ||
        requested.orderNum.length > 120 || !requested.departmentId) {
      throw new MobileError("INVALID_CASH_ORDER",
        "Выберите заказ из списка подключённой кассы.",400);
    }
    const ctx = await mobileContext(request,env,{connectionRequired:true});
    if (!ctx.selectedIds.includes(requested.departmentId)) {
      throw new MobileError("CASH_ORDER_FORBIDDEN",
        "Нет доступа к ресторану выбранного заказа.",403);
    }
    const origin = String(env?.PLUGIN_VPS_API_URL || DEFAULT_VPS).replace(/\/+$/,"");
    const binding = new URL(origin + "/api/plugin/data");
    binding.searchParams.set("departmentIds",ctx.selectedIds.join(","));
    if (ctx.connection.ip && ctx.connection.port) {
      binding.searchParams.set("serverUrl",`http://${ctx.connection.ip}:${ctx.connection.port}`);
    }
    const pluginPayload = await fetchJson(binding.toString());
    const plugins = authorizedCashPlugins(pluginPayload,ctx.selectedIds);
    const plugin = plugins.find(p => p.id===requested.pluginId &&
      p.departmentId===requested.departmentId);
    if (!plugin) throw new MobileError("CASH_ORDER_FORBIDDEN",
      "Выбранная касса не относится к доступным ресторанам или сейчас не подключена.",403);
    const body = {
      pluginId:plugin.id,departmentIds:[plugin.departmentId],
      ...(ctx.connection.ip&&ctx.connection.port
        ?{serverUrl:`http://${ctx.connection.ip}:${ctx.connection.port}`}:{}),
      RequestDetail:requested.orderNum,requestDetail:requested.orderNum,
      orderNum:requested.orderNum,orderNumber:requested.orderNum
    };
    let best = null;
    let lastError = null;
    for (const action of ["Order","get_order"]) {
      try {
        const raw = await requestOrder(origin,{...body,action});
        const details = normalizePosOrderDetail(raw, {
          ...requested,registerName:plugin.name
        });
        if (details.itemsAvailable) return response(details);
        if (!best) best = details;
      } catch (error) {
        lastError = error;
      }
    }
    if (best) return response(best);
    throw new MobileError("CASH_ORDER_DETAILS_UNAVAILABLE",
      lastError instanceof MobileError
        ? lastError.message
        : "Не удалось загрузить полную информацию о заказе.",502);
  } catch (error) {
    return errorResponse(error);
  }
}
