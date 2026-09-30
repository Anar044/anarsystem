import { clean, iikoText } from "./_lib/iiko-client.js";

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
function value(name, v) {
  return !name || v === undefined || v === null || v === "" ? "" : `<${name}>${esc(v)}</${name}>`;
}
function asNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function normalizeIncomingDocument(input = {}) {
  const d = { ...input };
  const items = Array.isArray(d.items) ? d.items : [];
  d.status = clean(d.status || "NEW").toUpperCase();
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
      sum
    };
  });
  return d;
}
function validateIncoming(d) {
  const errors = [];
  if (!clean(d.dateIncoming)) errors.push("Укажите дату накладной.");
  if (!clean(d.supplierId || d.supplier)) errors.push("Выберите поставщика.");
  if (!clean(d.defaultStore || d.defaultStoreId || d.storeId)) errors.push("Выберите склад.");
  if (!Array.isArray(d.items) || !d.items.length) errors.push("Добавьте хотя бы одну позицию.");
  (d.items || []).forEach((item, index) => {
    const label = `Строка ${index + 1}`;
    if (!clean(item.productId || item.product)) errors.push(`${label}: не выбран товар.`);
    if (!(Number(item.amount) > 0)) errors.push(`${label}: количество должно быть больше 0.`);
    if (!(Number(item.price) >= 0)) errors.push(`${label}: цена не может быть отрицательной.`);
  });
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
    if (!["save", "unprocess"].includes(action)) {
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

    let document = body.document || {};
    if (type === "incoming" && action === "save") {
      document = normalizeIncomingDocument(document);
      const errors = validateIncoming(document);
      if (errors.length) {
        return jsonResponse({ success: false, message: errors[0], errors }, 400);
      }
    }

    const xml = buildXml(type, document);
    const docType = type === "incoming" ? "incomingInvoice" : "outgoingInvoice";
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
    const validationFailed = action === "save" && isFalse(validation.valid);
    const success = result.ok && !validationFailed;

    if (!success) {
      const message =
        validation.errorMessage ||
        validation.additionalInfo ||
        (validationFailed ? "iiko отклонил документ" : `iiko Server вернул HTTP ${result.status}`);
      return jsonResponse(
        {
          success: false,
          action,
          type,
          status: result.status,
          validation,
          rawResponse: result.text.slice(0, 12000),
          message,
          meta: { authCacheHit: Boolean(result.auth?.cacheHit) }
        },
        validationFailed ? 422 : 502
      );
    }

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
          : type === "incoming"
            ? "Приходная накладная создана в iiko BackOffice"
            : "Документ сохранён в iiko BackOffice",
      meta: { authCacheHit: Boolean(result.auth?.cacheHit) }
    });
  } catch (error) {
    return jsonResponse(
      { success: false, message: error?.message || "Ошибка операции с документом" },
      502
    );
  }
}
