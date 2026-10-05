import { clean, iikoText } from "./_lib/iiko-client.js";
import { resolveStoreScope } from "./_lib/store-scope.js";
import { logAuditEvent } from "../_lib/audit-log.js";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Content-Type": "application/json; charset=utf-8"
  };
}
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(), "Cache-Control": "no-store" }
  });
}
function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function nullish(v) {
  if (v === undefined || v === null) return "";
  const s = String(v).trim();
  return ["", "null", "undefined", "nil", "none"].includes(s.toLowerCase()) ? "" : s;
}
function value(name, v) {
  const normalized = nullish(v);
  return !name || !normalized ? "" : `<${name}>${esc(normalized)}</${name}>`;
}
function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function moneyCents(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}
function moneyText(value) {
  return (Math.round(Number(value || 0) * 100) / 100).toFixed(2).replace(".", ",");
}
function normalizeIncomingDocument(input = {}) {
  const d = { ...input };
  const items = Array.isArray(d.items) ? d.items : [];
  [
    "id","conception","conceptionCode","comment","documentNumber","dateIncoming",
    "invoice","defaultStore","defaultStoreId","storeId","supplierId","supplier",
    "dueDate","incomingDate","incomingDocumentNumber","transportInvoiceNumber",
    "employeeId","employeePassToAccount","linkedOutgoingInvoiceId","distributionAlgorithm"
  ].forEach(k => {
    const v = nullish(d[k]);
    if (v) d[k] = v;
    else delete d[k];
  });
  const documentStore = clean(d.defaultStore || d.defaultStoreId || d.storeId);
  if (clean(d.status)) d.status = clean(d.status).toUpperCase();
  else delete d.status;
  d.items = items.map((item, index) => {
    const amount = asNumber(item.amount ?? item.actualAmount, 0);
    const price = asNumber(item.price, 0);
    const sum = Number.isFinite(Number(item.sum)) ? Number(item.sum) : amount * price;
    return {
      ...item,
      num: item.num ?? index + 1,
      amount,
      actualAmount: Number.isFinite(Number(item.actualAmount)) ? Number(item.actualAmount) : amount,
      price,
      sum,
      store: clean(item.store || item.storeId) || documentStore
    };
  });
  return d;
}
function auditDocumentSnapshot(input = {}, fallback = null) {
  const d = input && typeof input === "object" ? input : {};
  const old = fallback && typeof fallback === "object" ? fallback : {};
  const valueOrOld = (keys) => {
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(d, key) && d[key] !== undefined) return d[key];
    }
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(old, key) && old[key] !== undefined) return old[key];
    }
    return "";
  };
  const inItems = Array.isArray(d.items) ? d.items : [];
  const oldItems = Array.isArray(old.items) ? old.items : [];
  const count = Math.max(inItems.length, oldItems.length);
  const items = [];
  for (let index = 0; index < count; index++) {
    const item = inItems[index] && typeof inItems[index] === "object" ? inItems[index] : {};
    const prev = oldItems[index] && typeof oldItems[index] === "object" ? oldItems[index] : {};
    const pick = (keys, fallbackValue = "") => {
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(item, key) && item[key] !== undefined) return item[key];
      }
      for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(prev, key) && prev[key] !== undefined) return prev[key];
      }
      return fallbackValue;
    };
    items.push({
      productId: clean(pick(["productId","product"])),
      amount: Number(pick(["actualAmount","amount"],0)),
      price: Number(pick(["price"],0)),
      sum: Number(pick(["sum"],0)),
      vatPercent: pick(["vatPercent","ndsPercent"],null)
    });
  }
  return {
    id: clean(valueOrOld(["id"])),
    documentNumber: clean(valueOrOld(["documentNumber"])),
    dateIncoming: clean(valueOrOld(["dateIncoming","incomingDate"])),
    supplierId: clean(valueOrOld(["supplierId","supplier"])),
    defaultStore: clean(valueOrOld(["defaultStore","defaultStoreId","storeId"])),
    invoice: clean(valueOrOld(["invoice"])),
    incomingDocumentNumber: clean(valueOrOld(["incomingDocumentNumber"])),
    dueDate: clean(valueOrOld(["dueDate"])),
    transportInvoiceNumber: clean(valueOrOld(["transportInvoiceNumber"])),
    comment: clean(valueOrOld(["comment"])),
    status: clean(valueOrOld(["status"])),
    items
  };
}
function validateIncoming(d) {
  const errors = [];
  if (!clean(d.documentNumber)) errors.push("Не удалось сформировать номер накладной.");
  if (!clean(d.dateIncoming)) errors.push("Укажите дату накладной.");
  if (!clean(d.supplierId || d.supplier)) errors.push("Выберите поставщика.");
  if (!clean(d.defaultStore || d.defaultStoreId || d.storeId)) errors.push("Выберите склад.");
  if (!Array.isArray(d.items) || !d.items.length) errors.push("Добавьте хотя бы одну позицию.");
  let expectedDocumentCents = 0;
  let rowSumCents = 0;
  let arithmeticComplete = true;

  (d.items || []).forEach((item, index) => {
    const label = "Строка " + (index + 1);
    if (!clean(item.productId || item.product)) errors.push(label + ": не выбран товар.");
    if (!(Number(item.amount) > 0)) errors.push(label + ": количество должно быть больше 0.");
    if (!(Number(item.price) >= 0)) errors.push(label + ": цена не может быть отрицательной.");

    const amount = Number(item.amount);
    const price = Number(item.price);
    const sourceSumCents = moneyCents(item.sum);
    if (!Number.isFinite(amount) || !Number.isFinite(price) || sourceSumCents === null) {
      arithmeticComplete = false;
      return;
    }

    const expectedCents = Math.round(amount * price * 100);
    expectedDocumentCents += expectedCents;
    rowSumCents += sourceSumCents;

    if (sourceSumCents !== expectedCents) {
      errors.push(
        label + ": количество × цена = " + moneyText(expectedCents / 100) +
        ", но сумма строки = " + moneyText(sourceSumCents / 100) + ". Исправьте расхождение."
      );
    }
  });

  const declaredCents = moneyCents(d.documentTotal ?? d.declaredTotal ?? d.sourceDocumentTotal);
  if (declaredCents !== null && arithmeticComplete) {
    if (declaredCents !== expectedDocumentCents) {
      errors.push(
        "Итого документа = " + moneyText(declaredCents / 100) +
        ", а расчёт по количеству и цене = " + moneyText(expectedDocumentCents / 100) + "."
      );
    }
    if (declaredCents !== rowSumCents) {
      errors.push(
        "Итого документа = " + moneyText(declaredCents / 100) +
        ", а сумма строк = " + moneyText(rowSumCents / 100) + "."
      );
    }
  }
  return errors;
}
function itemXml(x, type, i) {
  if (type === "incoming") {
    return `<item>${value("isAdditionalExpense", x.isAdditionalExpense)}${value("amount", x.amount)}${value("supplierProduct", x.supplierProduct)}${value("supplierProductArticle", x.supplierProductArticle)}${value("product", x.productId ?? x.product)}${value("productArticle", x.productArticle)}${value("producer", x.producer)}${value("num", x.num ?? i + 1)}${value("containerId", x.containerId)}${value("amountUnit", x.amountUnit)}${value("actualUnitWeight", x.actualUnitWeight)}${value("sum", x.sum)}${value("discountSum", x.discountSum)}${value("vatPercent", x.vatPercent ?? x.ndsPercent)}${value("vatSum", x.vatSum)}${value("priceUnit", x.priceUnit)}${value("price", x.price)}${value("priceWithoutVat", x.priceWithoutVat)}${value("code", x.code)}${value("store", x.store || x.storeId)}${value("customsDeclarationNumber", x.customsDeclarationNumber)}${value("actualAmount", x.actualAmount)}</item>`;
  }
  return `<item>${value("productId", x.productId ?? x.product)}${value("productArticle", x.productArticle)}${value("storeId", x.storeId)}${value("storeCode", x.storeCode)}${value("containerId", x.containerId)}${value("containerCode", x.containerCode)}${value("price", x.price)}${value("priceWithoutVat", x.priceWithoutVat)}${value("amount", x.amount)}${value("sum", x.sum)}${value("discountSum", x.discountSum)}${value("vatPercent", x.vatPercent)}${value("vatSum", x.vatSum)}</item>`;
}
function buildXml(type, d) {
  const incoming = type === "incoming";
  const items = Array.isArray(d.items) ? d.items.map((x, i) => itemXml(x, type, i)).join("") : "";
  const fields = incoming
    ? [
        value("id", d.id),
        value("conception", d.conception),
        value("conceptionCode", d.conceptionCode),
        value("comment", d.comment),
        value("documentNumber", d.documentNumber),
        value("dateIncoming", d.dateIncoming),
        value("invoice", d.invoice),
        value("defaultStore", d.defaultStore || d.defaultStoreId || d.storeId),
        value("supplier", d.supplierId || d.supplier),
        value("dueDate", d.dueDate),
        value("incomingDate", d.incomingDate),
        value("useDefaultDocumentTime", d.useDefaultDocumentTime),
        value("status", d.status),
        value("incomingDocumentNumber", d.incomingDocumentNumber),
        value("employeePassToAccount", d.employeeId || d.employeePassToAccount),
        value("transportInvoiceNumber", d.transportInvoiceNumber),
        value("linkedOutgoingInvoiceId", d.linkedOutgoingInvoiceId),
        value("distributionAlgorithm", d.distributionAlgorithm)
      ]
    : [
        value("id", d.id),
        value("documentNumber", d.documentNumber),
        value("dateIncoming", d.dateIncoming),
        value("useDefaultDocumentTime", d.useDefaultDocumentTime),
        value("status", d.status),
        value("accountToCode", d.accountToCode),
        value("revenueAccountCode", d.revenueAccountCode),
        value("defaultStoreId", d.defaultStoreId || d.storeId),
        value("defaultStoreCode", d.defaultStoreCode),
        value("counteragentId", d.counteragentId || d.counteragent),
        value("counteragentCode", d.counteragentCode),
        value("conceptionId", d.conceptionId),
        value("conceptionCode", d.conceptionCode),
        value("comment", d.comment),
        value("linkedOutgoingInvoiceId", d.linkedOutgoingInvoiceId)
      ];
  return incoming
    ? `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><document><items>${items}</items>${fields.join("")}</document>`
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><document>${fields.join("")}<items>${items}</items></document>`;
}
function decodeXml(v) {
  return String(v ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
function parseValidation(text) {
  const pick = name => {
    const m = String(text || "").match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
    return m ? decodeXml(m[1].trim()) : null;
  };
  return {
    valid: pick("valid"),
    warning: pick("warning"),
    documentNumber: pick("documentNumber"),
    otherSuggestedNumber: pick("otherSuggestedNumber"),
    errorMessage: pick("errorMessage"),
    additionalInfo: pick("additionalInfo")
  };
}
function isFalse(value) {
  return ["false", "0", "no"].includes(clean(value).toLowerCase());
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: { ...corsHeaders() } });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const type = clean(body.type).toLowerCase();
    const action = clean(body.action || "save").toLowerCase();
    if (!["incoming", "outgoing"].includes(type)) {
      return jsonResponse({ success: false, message: "Неизвестный тип документа" }, 400);
    }
    if (!["save", "save-and-process", "process", "unprocess"].includes(action)) {
      return jsonResponse({ success: false, message: "Неизвестная операция с документом" }, 400);
    }

    const raw = body.connection || body;
    const connection = {
      ip: clean(raw.ip),
      port: clean(raw.port),
      login: clean(raw.login),
      password: String(raw.password || "")
    };
    if (!connection.ip || !connection.port || !connection.login || !connection.password) {
      return jsonResponse({ success: false, message: "Не найдено подключение к iiko Server" }, 400);
    }

    const originalDocument = body.document && typeof body.document==="object" ? body.document : {};
    const auditBefore = body.auditBefore && typeof body.auditBefore==="object" ? body.auditBefore : null;
    let document = originalDocument;
    const departmentIds=Array.isArray(body.departmentIds)?body.departmentIds.map(String).filter(Boolean):[];
    const allowedIds=Array.isArray(body?.chainScope?.allowedDepartmentIds)?body.chainScope.allowedDepartmentIds.map(String).filter(Boolean):[];
    const subsetRequested=String(body?.chainScope?.mode||"").toUpperCase()==="CHAIN"&&departmentIds.length>0&&allowedIds.length>departmentIds.length;
    if(subsetRequested){
      const storeScope=await resolveStoreScope(connection,departmentIds);
      if(!storeScope.resolved||!storeScope.storeIds.length){
        return jsonResponse({success:false,code:"DOCUMENT_ACTION_SCOPE_UNAVAILABLE",message:"Не удалось определить склады выбранного подразделения. Операция отменена.",meta:{departmentIds,storeScope:storeScope?.diagnostics||null}},409);
      }
      const storeKey=v=>String(v??"").trim().replace(/^\{+|\}+$/g,"").toLowerCase();
      const wanted=new Set(storeScope.storeIds.map(storeKey));
      const documentStores=[
        document.defaultStore,document.defaultStoreId,document.storeId,
        ...(Array.isArray(document.items)?document.items.flatMap(item=>[item?.store,item?.storeId]):[])
      ].map(storeKey).filter(Boolean);
      if(!documentStores.length){
        return jsonResponse({success:false,code:"DOCUMENT_STORE_REQUIRED_FOR_CHAIN",message:"Для CHAIN нужно определить склад документа перед выполнением операции."},409);
      }
      const outside=documentStores.filter(id=>!wanted.has(id));
      if(outside.length){
        return jsonResponse({success:false,code:"DOCUMENT_STORE_FORBIDDEN",message:"Документ относится к складу другого подразделения.",meta:{departmentIds,storeIds:storeScope.storeIds,documentStoreIds:documentStores}},403);
      }
    }
    if (type === "incoming") {
      document = normalizeIncomingDocument(document);

      if (["save", "save-and-process", "process"].includes(action)) {
        if (["save-and-process", "process"].includes(action)) document.status = "PROCESSED";
        else delete document.status;

        const errors = validateIncoming(document);
        if (errors.length) {
          return jsonResponse({ success: false, message: errors[0], errors }, 400);
        }
      }
    }

    const xml = buildXml(type, document);
    const docType = type === "incoming" ? "incomingInvoice" : "outgoingInvoice";

    // iikoOffice 2023 does not expose a separate /process endpoint for
    // incoming invoices. Processing is done by importing the same document
    // with status=PROCESSED. Unprocessing has its own endpoint.
    const path =
      action === "unprocess"
        ? `/resto/api/documents/unprocess/${docType}`
        : `/resto/api/documents/import/${docType}`;

    const result = await iikoText(connection, path, {
      method: "POST",
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        Accept: "application/xml,text/xml,*/*"
      },
      body: xml
    });

    const validation = parseValidation(result.text);
    const validationFailed = ["save", "save-and-process", "process"].includes(action) && isFalse(validation.valid);
    const success = result.ok && !validationFailed;

    if (!success) {
      const plainServerMessage = String(result.text || "")
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 700);
      const message =
        validation.errorMessage ||
        validation.additionalInfo ||
        plainServerMessage ||
        (validationFailed ? "iiko отклонил документ" : `iiko Server вернул HTTP ${result.status}`);

      return jsonResponse({
        success: false,
        action,
        type,
        status: result.status,
        validation,
        rawResponse: result.text.slice(0, 12000),
        message,
        meta: { authCacheHit: Boolean(result.auth?.cacheHit) }
      }, validationFailed ? 422 : 502);
    }

    const documentNumber = clean(
      validation.documentNumber ||
      validation.otherSuggestedNumber ||
      document.documentNumber ||
      originalDocument.documentNumber
    );
    const auditAfter = action === "unprocess"
      ? { ...document, status: "NEW" }
      : { ...document };
    const inferredBefore = auditBefore || (
      action === "process"
        ? { ...originalDocument, status: clean(originalDocument.status || "NEW") }
        : action === "unprocess"
          ? { ...originalDocument, status: clean(originalDocument.status || "PROCESSED") }
          : null
    );
    const auditAction = action === "save"
      ? (inferredBefore ? "UPDATE" : "CREATE")
      : action === "save-and-process"
        ? (inferredBefore ? "UPDATE_AND_PROCESS" : "CREATE_AND_PROCESS")
        : action === "process"
          ? "PROCESS"
          : "UNPROCESS";
    const audit = await logAuditEvent({
      request: context.request,
      env: context.env,
      connection,
      action: auditAction,
      entityType: type === "incoming" ? "INCOMING_INVOICE" : "OUTGOING_INVOICE",
      entityId: clean(document.id || originalDocument.id || documentNumber),
      entityLabel: `${type === "incoming" ? "Приходная накладная" : "Расходная накладная"} №${documentNumber || "—"}`,
      documentNumber,
      before: inferredBefore ? auditDocumentSnapshot(inferredBefore) : null,
      after: auditDocumentSnapshot(auditAfter, inferredBefore),
      restaurantIds: departmentIds,
      restaurantNames: Array.isArray(body?.chainScope?.selectedDepartmentNames) ? body.chainScope.selectedDepartmentNames : [],
      metadata: {
        documentType: type,
        requestedAction: action,
        serverStatus: result.status,
        validation
      }
    });

    return jsonResponse({
      success: true,
      action,
      type,
      status: result.status,
      validation,
      rawResponse: result.text.slice(0, 12000),
      message:
        action === "unprocess"
          ? "Документ распроведён"
          : ["save-and-process", "process"].includes(action)
            ? "Приходная накладная проведена в iiko BackOffice"
            : type === "incoming"
              ? "Приходная накладная сохранена в iiko BackOffice"
              : "Документ сохранён в iiko BackOffice",
      meta: {
        processed: ["save-and-process", "process"].includes(action),
        authCacheHit: Boolean(result.auth?.cacheHit),
        auditLogged: audit.logged === true,
        auditChanges: audit.changes || 0
      }
    });
  } catch (error) {
    return jsonResponse(
      { success: false, message: error?.message || "Ошибка операции с документом" },
      502
    );
  }
}
