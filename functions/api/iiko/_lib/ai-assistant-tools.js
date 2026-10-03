import { clean, getIikoAuth, getOlapFields, iikoJson, iikoText } from "./iiko-client.js";
import { syncReferences } from "../references.js";
import { getIikoSuppliers } from "./iiko-suppliers.js";
import { resolveStoreScope } from "./store-scope.js";

const MAX_INVOICE_ROWS = 1200;

function xmlDecode(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
function tag(block, name) {
  const match = String(block || "").match(
    new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i")
  );
  return match ? xmlDecode(match[1].trim()) : "";
}
function blocks(source, name) {
  const out = [];
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`, "gi");
  let match;
  while ((match = re.exec(String(source || "")))) out.push(match[0]);
  return out;
}
function num(value) {
  const parsed = Number(String(value ?? "").replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}
function key(value) {
  return String(value ?? "").trim().replace(/^\{+|\}+$/g, "").toLowerCase();
}
function isoDate(value) {
  const text = String(value || "").trim().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : "";
}
function dateVariants(value) {
  const iso = isoDate(value);
  if (!iso) return [];
  const [y, m, d] = iso.split("-");
  return [iso, `${d}.${m}.${y}`];
}
function parseItems(block) {
  return blocks(block, "item").map((item, index) => ({
    num: tag(item, "num") || String(index + 1),
    productId: key(tag(item, "product") || tag(item, "productId")),
    productArticle: tag(item, "productArticle"),
    quantity: num(tag(item, "amount") || tag(item, "actualAmount")),
    unit: tag(item, "amountUnit"),
    price: num(tag(item, "price")),
    priceWithoutVat: num(tag(item, "priceWithoutVat")),
    sum: num(tag(item, "sum")),
    vatPercent: num(tag(item, "vatPercent") || tag(item, "ndsPercent")),
    storeId: key(tag(item, "store") || tag(item, "storeId"))
  }));
}
function parseInvoices(xml) {
  let docs = blocks(xml, "document");
  if (!docs.length) docs = blocks(xml, "incomingInvoice");
  if (!docs.length) docs = blocks(xml, "incomingInvoiceDocument");
  return docs.map(block => ({
    id: tag(block, "id") || null,
    documentNumber: tag(block, "documentNumber") || tag(block, "number") || null,
    date: isoDate(tag(block, "dateIncoming") || tag(block, "date") || tag(block, "incomingDate")),
    supplierId: key(tag(block, "supplier") || tag(block, "supplierId")),
    storeId: key(tag(block, "defaultStore") || tag(block, "store") || tag(block, "storeId")),
    status: tag(block, "status") || null,
    items: parseItems(block)
  })).filter(doc => doc.date || doc.documentNumber || doc.items.length);
}
function normalizeText(value) {
  const map = {
    а:"a",б:"b",в:"v",г:"g",д:"d",е:"e",ё:"e",ж:"zh",з:"z",и:"i",й:"y",к:"k",л:"l",м:"m",
    н:"n",о:"o",п:"p",р:"r",с:"s",т:"t",у:"u",ф:"f",х:"h",ц:"c",ч:"ch",ш:"sh",щ:"sh",
    ы:"y",э:"e",ю:"yu",я:"ya",ь:"",ъ:"",
    ə:"e",ı:"i",ö:"o",ü:"u",ğ:"g",ç:"c",ş:"s"
  };
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split("")
    .map(char => map[char] ?? char)
    .join("")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function stemToken(token) {
  let value = String(token || "");
  if (value.length > 5 && /y$/.test(value)) value = value.slice(0, -1);
  if (value.length > 6 && /(lar|ler)$/.test(value)) value = value.slice(0, -3);
  return value;
}
function similarity(query, value) {
  const q = normalizeText(query);
  const v = normalizeText(value);
  if (!q || !v) return 0;
  if (v === q) return 1;
  if (v.includes(q) || q.includes(v)) return 0.92;
  const qt = q.split(" ").filter(Boolean).map(stemToken);
  const vt = v.split(" ").filter(Boolean).map(stemToken);
  let hits = 0;
  for (const a of qt) {
    if (vt.some(b => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a))))) hits++;
  }
  return hits / Math.max(1, new Set([...qt, ...vt]).size);
}
function mapRows(map) {
  return [...(map?.entries?.() || [])].map(([id, name]) => ({ id: key(id), name: clean(name) }));
}
async function references(env, connection) {
  const auth = await getIikoAuth(connection);
  const [synced, suppliersResult] = await Promise.all([
    syncReferences(env, auth.serverUrl, auth.token),
    getIikoSuppliers(connection)
  ]);
  const maps = synced.maps || {};
  const suppliers = new Map(
    (suppliersResult.rows || []).map(row => [key(row.id), clean(row.name)]).filter(row => row[0] && row[1])
  );
  return {
    products: mapRows(maps.products),
    warehouses: mapRows(maps.warehouses),
    suppliers: suppliers.size ? mapRows(suppliers) : mapRows(maps.suppliers)
  };
}
async function loadInvoices(connection, from, to) {
  const attempts = [];
  const froms = dateVariants(from);
  const tos = dateVariants(to);
  for (const f of froms) {
    for (const t of tos) {
      const params = new URLSearchParams({ from: f, to: t });
      const result = await iikoText(
        connection,
        `/resto/api/documents/export/incomingInvoice?${params.toString()}`,
        { headers: { Accept: "application/xml,text/xml,*/*" }, timeoutMs: 60000 }
      );
      const documents = result.ok ? parseInvoices(result.text) : [];
      attempts.push({ from: f, to: t, status: result.status, count: documents.length });
      if (documents.length) return { documents, attempts };
    }
  }
  const fallback = await iikoText(
    connection,
    "/resto/api/documents/export/incomingInvoice",
    { headers: { Accept: "application/xml,text/xml,*/*" }, timeoutMs: 60000 }
  );
  let documents = fallback.ok ? parseInvoices(fallback.text) : [];
  const fromIso = isoDate(from);
  const toIso = isoDate(to);
  if (fromIso && toIso) documents = documents.filter(doc => !doc.date || (doc.date >= fromIso && doc.date <= toIso));
  attempts.push({ from: "all", to: "all", status: fallback.status, count: documents.length });
  return { documents, attempts };
}
function defaultRange(days = 365) {
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(1, days) * 86400000);
  return {
    from: start.toISOString().slice(0, 10),
    to: end.toISOString().slice(0, 10)
  };
}
function matchProducts(products, query, limit = 20) {
  return products
    .map(product => ({ ...product, score: similarity(query, product.name) }))
    .filter(product => product.score >= 0.18)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ru"))
    .slice(0, Math.min(50, Math.max(1, Number(limit) || 20)));
}
function priceChanges(rows) {
  const sorted = [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const changes = [];
  let previous = null;
  for (const row of sorted) {
    if (!Number.isFinite(row.price)) continue;
    if (previous == null || Math.abs(row.price - previous) > 0.0001) {
      changes.push({ date: row.date, price: row.price, invoice: row.documentNumber || null });
      previous = row.price;
    }
  }
  return changes;
}
function groupPurchases(rows) {
  const map = new Map();
  for (const row of rows) {
    const groupKey = `${row.supplierId}|${row.productId}`;
    if (!map.has(groupKey)) map.set(groupKey, {
      supplierId: row.supplierId,
      supplierName: row.supplierName,
      productId: row.productId,
      productName: row.productName,
      purchases: []
    });
    map.get(groupKey).purchases.push(row);
  }
  return [...map.values()].map(group => {
    const prices = group.purchases.map(x => x.price).filter(Number.isFinite);
    const quantities = group.purchases.map(x => x.quantity).filter(Number.isFinite);
    const last = [...group.purchases].sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
    return {
      supplierId: group.supplierId,
      supplierName: group.supplierName,
      productId: group.productId,
      productName: group.productName,
      purchaseCount: group.purchases.length,
      totalQuantity: Number(quantities.reduce((sum, value) => sum + value, 0).toFixed(4)),
      minPrice: prices.length ? Math.min(...prices) : null,
      maxPrice: prices.length ? Math.max(...prices) : null,
      lastPrice: Number.isFinite(last?.price) ? last.price : null,
      lastDate: last?.date || null,
      priceChanges: priceChanges(group.purchases)
    };
  }).sort((a, b) => String(a.productName).localeCompare(String(b.productName), "ru") || String(a.supplierName).localeCompare(String(b.supplierName), "ru"));
}
function deepList(payload) {
  const out = [];
  const walk = value => {
    if (Array.isArray(value)) { out.push(...value); value.forEach(walk); return; }
    if (!value || typeof value !== "object") return;
    Object.values(value).forEach(walk);
  };
  walk(payload);
  return out;
}
function objectId(value) {
  if (value == null) return "";
  if (typeof value !== "object") return key(value);
  for (const name of ["id","Id","ID","uuid","UUID","guid","GUID","supplierId","supplierID","counteragentId","counteragentID","accountId"]) {
    if (value[name] != null) {
      const found = key(value[name]);
      if (found) return found;
    }
  }
  return "";
}
function scalar(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value).trim();
  if (Array.isArray(value)) {
    for (const item of value) { const found = scalar(item); if (found) return found; }
    return "";
  }
  if (typeof value === "object") {
    for (const name of ["value","text","name","Name","title","id","uuid","guid","code"]) {
      if (value[name] != null) { const found = scalar(value[name]); if (found) return found; }
    }
  }
  return "";
}
function aiBalanceDepartmentId(row){
  for(const value of [row?.departmentId,row?.departmentID,row?.department?.id,row?.organizationId,row?.restaurantId,row?.organization?.id,row?.restaurant?.id]){
    const id=clean(value);if(id)return id;
  }
  return "";
}
async function supplierBalances(connection, timestamp, departmentIds=[], strictSubset=false) {
  const supplierResult = await getIikoSuppliers(connection);
  const [accountsResult, balancesResult] = await Promise.all([
    iikoJson(connection, "/resto/api/v2/entities/accounts/list?includeDeleted=false&revisionFrom=-1", { timeoutMs: 60000 }),
    iikoJson(connection, (()=>{const q=new URLSearchParams({timestamp});for(const id of departmentIds)q.append("department",id);return "/resto/api/v2/reports/balance/counteragents?"+q.toString()})(), { timeoutMs: 60000 })
  ]);
  if (!accountsResult.ok) throw new Error("iiko accounts HTTP " + accountsResult.status);
  if (!balancesResult.ok) throw new Error("iiko supplier balance HTTP " + balancesResult.status);

  const accounts = new Map();
  for (const row of deepList(accountsResult.payload)) {
    if (!row || typeof row !== "object") continue;
    const id = objectId(row);
    const type = clean(row.type ?? row.Type);
    if (id && type) accounts.set(id, type);
  }
  const suppliers = new Map((supplierResult.rows || []).map(row => [key(row.id), clean(row.name)]).filter(x => x[0] && x[1]));
  const balanceRows=deepList(balancesResult.payload).filter(row=>row&&typeof row==="object"&&(row.counteragent!=null||row.counteragentId!=null));
  const detectedDepartmentIds=[...new Set(balanceRows.map(aiBalanceDepartmentId).filter(Boolean))];
  if(strictSubset&&balanceRows.length&&!detectedDepartmentIds.length){
    throw new Error("SH Server не вернул подразделение в балансе поставщиков. AI не будет смешивать взаиморасчёты разных ресторанов.");
  }
  const wantedDepartments=new Set(departmentIds);
  const scopedBalanceRows=departmentIds.length&&detectedDepartmentIds.length?balanceRows.filter(row=>wantedDepartments.has(aiBalanceDepartmentId(row))):balanceRows;
  const sums = new Map();
  for (const row of scopedBalanceRows) {
    if (!row || typeof row !== "object") continue;
    const supplierId = objectId(row.counteragent) || key(scalar(row.counteragent));
    const accountId = objectId(row.account) || key(scalar(row.account ?? row.accountId));
    const amount = Number(row.sum ?? row.balance ?? row.amount ?? 0);
    if (!supplierId || !Number.isFinite(amount)) continue;
    const type = accounts.get(accountId);
    if (!sums.has(supplierId)) sums.set(supplierId, { advance: 0, debt: 0 });
    const target = sums.get(supplierId);
    if (type === "ACCOUNTS_PAYABLE") target.debt += amount;
    else if (type === "CURRENT_ASSET" || type === "OTHER_CURRENT_ASSET") target.advance += amount;
  }
  const rows = [...new Set([...suppliers.keys(), ...sums.keys()])].map(id => {
    const amount = sums.get(id) || { advance: 0, debt: 0 };
    return {
      supplierId: id,
      supplierName: suppliers.get(id) || id,
      advance: Number(amount.advance.toFixed(4)),
      debt: Number(amount.debt.toFixed(4)),
      total: Number((amount.advance + amount.debt).toFixed(4))
    };
  }).sort((a,b)=>String(a.supplierName).localeCompare(String(b.supplierName),"ru"));
  return { timestamp, rows, departmentIds, detectedDepartmentIds };
}

function compactForAi(value, depth = 0) {
  if (depth > 8) return "[depth limit]";
  if (Array.isArray(value)) {
    const limited = value.slice(0, 250).map(item => compactForAi(item, depth + 1));
    if (value.length > 250) limited.push({ _truncated: true, _remaining: value.length - 250 });
    return limited;
  }
  if (!value || typeof value !== "object") return value;
  const out = {};
  const entries = Object.entries(value).slice(0, 120);
  for (const [name, child] of entries) out[name] = compactForAi(child, depth + 1);
  if (Object.keys(value).length > entries.length) out._truncatedKeys = Object.keys(value).length - entries.length;
  return out;
}

function olapFieldRows(raw) {
  const out = [];
  const seen = new Set();
  const add = (name, meta = {}) => {
    const technicalName = clean(name);
    if (!technicalName || seen.has(technicalName.toLowerCase())) return;
    seen.add(technicalName.toLowerCase());
    out.push({
      technicalName,
      title: clean(meta.title || meta.caption || meta.label || meta.displayName || meta.name || technicalName),
      type: clean(meta.type || meta.dataType || meta.kind || "unknown"),
      aggregationAllowed: meta.aggregationAllowed === true || meta.isMeasure === true || meta.measure === true
    });
  };
  if (Array.isArray(raw)) raw.forEach(item => typeof item === "string" ? add(item) : add(item?.technicalName || item?.field || item?.key || item?.name, item));
  else if (raw && typeof raw === "object") {
    for (const name of ["fields", "columns", "dimensions", "measures"]) {
      if (!Array.isArray(raw[name])) continue;
      raw[name].forEach(item => typeof item === "string" ? add(item) : add(item?.technicalName || item?.field || item?.key || item?.name, item));
    }
    for (const [name, meta] of Object.entries(raw)) {
      if (["fields", "columns", "dimensions", "measures", "data", "items"].includes(name)) continue;
      if (meta && typeof meta === "object" && !Array.isArray(meta)) add(name, meta);
    }
  }
  return out;
}

export const assistantToolDefinitions = [
  {
    type: "function",
    name: "list_smart_horeca_capabilities",
    description: "Показывает, какие данные и отчёты SmartHoreca доступны AI-ассистенту.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    strict: true
  },
  {
    type: "function",
    name: "search_products",
    description: "Ищет товары/сырьё в номенклатуре SmartHoreca/iiko по названию. Используй перед анализом закупок, если название неоднозначно.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Название или часть названия товара, например помидор." },
        limit: { type: "integer", minimum: 1, maximum: 50 }
      },
      required: ["query", "limit"],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "analyze_purchase_prices",
    description: "Анализирует приходные накладные за период: у каких поставщиков закупался товар, цены и изменения цен. Подходит для вопросов о закупках, поставщиках и динамике закупочной цены.",
    parameters: {
      type: "object",
      properties: {
        product_query: { type: "string", description: "Название товара или группы похожих товаров." },
        from: { type: "string", description: "Начало периода YYYY-MM-DD." },
        to: { type: "string", description: "Конец периода YYYY-MM-DD." },
        supplier_query: { type: "string", description: "Необязательный фильтр по поставщику; пустая строка если фильтр не нужен." }
      },
      required: ["product_query", "from", "to", "supplier_query"],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "get_supplier_balances",
    description: "Возвращает баланс взаиморасчётов с поставщиками на указанную дату. Используй для вопросов о задолженности и авансах поставщикам.",
    parameters: {
      type: "object",
      properties: {
        timestamp: { type: "string", description: "Дата и время в формате YYYY-MM-DDTHH:mm:ss." },
        supplier_query: { type: "string", description: "Фильтр по названию поставщика или пустая строка." }
      },
      required: ["timestamp", "supplier_query"],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "search_olap_fields",
    description: "Ищет доступные поля OLAP iiko по человеческому запросу. Используй перед run_olap_report, если технические имена полей неизвестны.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        report_type: { type: "string", enum: ["SALES"] },
        limit: { type: "integer", minimum: 1, maximum: 40 }
      },
      required: ["query", "report_type", "limit"],
      additionalProperties: false
    },
    strict: true
  },
  {
    type: "function",
    name: "run_olap_report",
    description: "Выполняет OLAP-отчёт iiko по уже известным техническим полям. Используй для продаж, касс, блюд, сотрудников, скидок и других данных OLAP.",
    parameters: {
      type: "object",
      properties: {
        report_type: { type: "string", enum: ["SALES"] },
        rows: { type: "array", items: { type: "string" } },
        columns: { type: "array", items: { type: "string" } },
        measures: { type: "array", items: { type: "string" } },
        from: { type: "string", description: "YYYY-MM-DD или пустая строка." },
        to: { type: "string", description: "YYYY-MM-DD или пустая строка." },
        filters: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              operator: { type: "string", enum: ["include", "exclude"] },
              values: { type: "array", items: { type: ["string", "number", "boolean"] } }
            },
            required: ["field", "operator", "values"],
            additionalProperties: false
          }
        }
      },
      required: ["report_type", "rows", "columns", "measures", "from", "to", "filters"],
      additionalProperties: false
    },
    strict: true
  }
];

export async function executeAssistantTool(name, args, context) {
  const { env, connection, scope } = context;
  const selectedDepartmentIds=Array.isArray(scope?.selectedDepartmentIds)?scope.selectedDepartmentIds:[];
  const allowedDepartmentIds=Array.isArray(scope?.allowedDepartmentIds)?scope.allowedDepartmentIds:[];
  const subsetChainScope=scope?.isChain===true && selectedDepartmentIds.length>0 && selectedDepartmentIds.length<allowedDepartmentIds.length;
  const effectiveDepartmentIds=subsetChainScope?selectedDepartmentIds:[];

  if (name === "list_smart_horeca_capabilities") {
    return {
      readOnly: true,
      dataSources: [
        { key: "purchases", title: "Приходные накладные", supports: ["поставщики", "товары", "закупочные цены", "динамика цены", "количество закупок"] },
        { key: "nomenclature", title: "Номенклатура", supports: ["поиск товаров и сырья"] },
        { key: "olap_sales", title: "OLAP продажи", supports: ["продажи", "кассы", "блюда", "заказы", "скидки", "сотрудники", "себестоимость и другие доступные поля"] },
        { key: "supplier_balances", title: "Баланс по поставщикам", supports: ["задолженность", "авансы", "взаиморасчёты"] },
        { key: "stock", title: "Остатки и движение товара", status: "page_available_tool_pending" },
        { key: "food_cost", title: "Фудкост и отклонения", status: "page_available_tool_pending" },
        { key: "labor_cost", title: "Лаборкост и производительность", status: "page_available_tool_pending" },
        { key: "pnl", title: "Прибыли и убытки", status: "page_available_tool_pending" }
      ],
      note: "Инструменты расширяются без изменения интерфейса чата."
    };
  }

  if (name === "search_products") {
    const refs = await references(env, connection);
    const matches = matchProducts(refs.products, args.query, args.limit);
    return { query: args.query, count: matches.length, products: matches };
  }

  if (name === "analyze_purchase_prices") {
    const refs = await references(env, connection);
    const range = {
      ...defaultRange(365),
      from: isoDate(args.from) || defaultRange(365).from,
      to: isoDate(args.to) || defaultRange(365).to
    };
    const matchedProducts = matchProducts(refs.products, args.product_query, 30);
    const productIds = new Set(matchedProducts.filter(x => x.score >= 0.35).map(x => x.id));
    if (!productIds.size && matchedProducts[0]) productIds.add(matchedProducts[0].id);

    const loaded = await loadInvoices(connection, range.from, range.to);
    if(subsetChainScope){
      const storeScope=await resolveStoreScope(connection,selectedDepartmentIds);
      if(!storeScope.resolved||!storeScope.storeIds.length){
        return {error:"Не удалось определить склады выбранного ресторана. AI не будет смешивать закупки разных подразделений.",code:"CHAIN_SCOPE_STORE_UNAVAILABLE",departmentIds:selectedDepartmentIds};
      }
      const wantedStores=new Set(storeScope.storeIds.map(key));
      loaded.documents=loaded.documents.filter(doc=>{
        const stores=[doc.storeId,...(Array.isArray(doc.items)?doc.items.map(item=>item.storeId):[])].map(key).filter(Boolean);
        return stores.some(id=>wantedStores.has(id));
      });
    }
    const supplierMap = new Map(refs.suppliers.map(x => [x.id, x.name]));
    const productMap = new Map(refs.products.map(x => [x.id, x.name]));
    const supplierQuery = normalizeText(args.supplier_query);
    const rows = [];

    for (const doc of loaded.documents) {
      const supplierName = supplierMap.get(doc.supplierId) || doc.supplierId || "—";
      if (supplierQuery && similarity(supplierQuery, supplierName) < 0.35) continue;
      for (const item of doc.items) {
        if (!productIds.has(item.productId)) continue;
        rows.push({
          date: doc.date,
          documentNumber: doc.documentNumber,
          supplierId: doc.supplierId,
          supplierName,
          productId: item.productId,
          productName: productMap.get(item.productId) || item.productArticle || item.productId,
          quantity: item.quantity,
          unit: item.unit || null,
          price: item.price,
          sum: item.sum
        });
        if (rows.length >= MAX_INVOICE_ROWS) break;
      }
      if (rows.length >= MAX_INVOICE_ROWS) break;
    }

    const grouped = groupPurchases(rows);
    const supplierSummary = new Map();
    for (const item of grouped) {
      if (!supplierSummary.has(item.supplierId)) supplierSummary.set(item.supplierId, {
        supplierId: item.supplierId,
        supplierName: item.supplierName,
        products: [],
        minObservedPrice: null,
        maxObservedPrice: null,
        lastObservedDate: null
      });
      const supplier = supplierSummary.get(item.supplierId);
      supplier.products.push(item);
      const values = [item.minPrice, item.maxPrice].filter(Number.isFinite);
      if (values.length) {
        const min = Math.min(...values), max = Math.max(...values);
        supplier.minObservedPrice = supplier.minObservedPrice == null ? min : Math.min(supplier.minObservedPrice, min);
        supplier.maxObservedPrice = supplier.maxObservedPrice == null ? max : Math.max(supplier.maxObservedPrice, max);
      }
      if (!supplier.lastObservedDate || String(item.lastDate) > supplier.lastObservedDate) supplier.lastObservedDate = item.lastDate;
    }

    return {
      query: args.product_query,
      period: range,
      matchedProducts: matchedProducts.slice(0, 15),
      invoiceCountScanned: loaded.documents.length,
      matchedPurchaseRows: rows.length,
      suppliers: [...supplierSummary.values()].sort((a, b) => String(a.supplierName).localeCompare(String(b.supplierName), "ru")),
      truncated: rows.length >= MAX_INVOICE_ROWS
    };
  }

  if (name === "get_supplier_balances") {
    const date = clean(args.timestamp) || (new Date().toISOString().slice(0, 10) + "T23:59:59");
    let result;
    try{
      result = await supplierBalances(connection, date, effectiveDepartmentIds, subsetChainScope);
    }catch(error){
      return {error:String(error?.message||error),code:"CHAIN_SCOPE_UNAVAILABLE_SUPPLIER_BALANCE",departmentIds:selectedDepartmentIds};
    }
    const query = clean(args.supplier_query);
    const rows = query
      ? result.rows.filter(row => similarity(query, row.supplierName) >= 0.25)
      : result.rows;
    const totals = rows.reduce((acc,row)=>({
      advance: acc.advance + Number(row.advance || 0),
      debt: acc.debt + Number(row.debt || 0),
      total: acc.total + Number(row.total || 0)
    }), { advance: 0, debt: 0, total: 0 });
    return {
      timestamp: result.timestamp,
      count: rows.length,
      rows: rows.slice(0, 200),
      totals: {
        advance: Number(totals.advance.toFixed(4)),
        debt: Number(totals.debt.toFixed(4)),
        total: Number(totals.total.toFixed(4))
      }
    };
  }

  if (name === "search_olap_fields") {
    const metadata = await getOlapFields(connection, clean(args.report_type || "SALES").toUpperCase());
    const fields = olapFieldRows(metadata.raw || metadata.fields);
    const matches = fields
      .map(field => ({
        ...field,
        score: Math.max(similarity(args.query, field.title), similarity(args.query, field.technicalName))
      }))
      .filter(field => field.score >= 0.12)
      .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title, "ru"))
      .slice(0, Math.min(40, Math.max(1, Number(args.limit) || 20)));
    return { query: args.query, reportType: args.report_type, count: matches.length, fields: matches };
  }

  if (name === "run_olap_report") {
    const reportType = clean(args.report_type || "SALES").toUpperCase();
    const metadata = await getOlapFields(connection, reportType);
    const available = new Set(olapFieldRows(metadata.raw || metadata.fields).map(x => x.technicalName));
    const rows = (args.rows || []).filter(x => available.has(x));
    const columns = (args.columns || []).filter(x => available.has(x));
    const measures = (args.measures || []).filter(x => available.has(x));
    const filters = {};

    for (const filter of args.filters || []) {
      if (!available.has(filter.field)) continue;
      filters[filter.field] = {
        filterType: filter.operator === "exclude" ? "ExcludeValues" : "IncludeValues",
        values: Array.isArray(filter.values) ? filter.values : []
      };
    }
    const from = isoDate(args.from), to = isoDate(args.to || args.from);
    if (from && to && available.has("OpenDate.Typed")) {
      filters["OpenDate.Typed"] = {
        filterType: "DateRange",
        periodType: "CUSTOM",
        from,
        to,
        includeLow: true,
        includeHigh: true
      };
    }
    if(effectiveDepartmentIds.length){
      const departmentField=["Department.Id","DepartmentId","Department.ID"].find(name=>available.has(name));
      if(!departmentField){
        return {success:false,code:"CHAIN_SCOPE_FIELD_MISSING",message:"OLAP не отдаёт Department.Id — нельзя безопасно ограничить AI отчёт выбранным рестораном.",departmentIds:selectedDepartmentIds};
      }
      filters[departmentField]={filterType:"IncludeValues",values:[...effectiveDepartmentIds]};
    }
    const request = {
      reportType,
      buildSummary: true,
      groupByRowFields: rows,
      groupByColFields: columns,
      aggregateFields: measures,
      filters
    };
    if (!rows.length && !columns.length && !measures.length) {
      return { success: false, message: "После проверки полей отчёт оказался пустым.", rejected: { rows: args.rows, columns: args.columns, measures: args.measures } };
    }
    const result = await iikoJson(connection, "/resto/api/v2/reports/olap", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
      timeoutMs: 60000
    });
    if (!result.ok) {
      return { success: false, status: result.status, message: result.text.slice(0, 1200), request };
    }
    return { success: true, request, departmentIds:selectedDepartmentIds, effectiveDepartmentIds, departmentScopeApplied:effectiveDepartmentIds.length>0, report: compactForAi(result.payload) };
  }

  throw new Error(`Неизвестный инструмент AI: ${name}`);
}
