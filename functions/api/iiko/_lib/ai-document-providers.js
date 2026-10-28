import { clean } from "./iiko-client.js";

const INVOICE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    documentType: { type: ["string", "null"] },
    supplierName: { type: ["string", "null"] },
    documentNumber: { type: ["string", "null"] },
    invoiceNumber: { type: ["string", "null"] },
    incomingNumber: { type: ["string", "null"] },
    date: { type: ["string", "null"] },
    dueDate: { type: ["string", "null"] },
    currency: { type: ["string", "null"] },
    total: { type: ["number", "null"] },
    vatTotal: { type: ["number", "null"] },
    confidence: { type: ["number", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          sourceName: { type: ["string", "null"] },
          article: { type: ["string", "null"] },
          quantity: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          unitPrice: { type: ["number", "null"] },
          total: { type: ["number", "null"] },
          vatPercent: { type: ["number", "null"] },
          confidence: { type: ["number", "null"] }
        },
        required: ["sourceName", "article", "quantity", "unit", "unitPrice", "total", "vatPercent", "confidence"]
      }
    }
  },
  required: [
    "documentType", "supplierName", "documentNumber", "invoiceNumber", "incomingNumber",
    "date", "dueDate", "currency", "total", "vatTotal", "confidence", "items"
  ]
};

const PROMPT = `Ты извлекаешь данные из документов закупки ресторана.
Определи тип документа и, если это приходная накладная/счёт поставщика, извлеки шапку и ВСЕ товарные строки таблицы.

Правила:
- ничего не придумывай;
- неизвестные значения возвращай null;
- даты по возможности YYYY-MM-DD;
- числа возвращай числами без валютных символов;
- sourceName сохраняй максимально близко к названию в документе;
- article — код/артикул строки, если он указан;
- quantity — количество товара в строке;
- unit — единица измерения;
- unitPrice — цена ЗА ОДНУ ЕДИНИЦУ;
- total — ИТОГОВАЯ СУММА КОНКРЕТНОЙ СТРОКИ;
- обязательно различай количество, цену за единицу и сумму строки;
- для азербайджанских документов: "Miqdar" обычно означает количество, "Qiymət, man" — цену/сумму в манатах, "Cəmi" — итог;
- если рядом есть две денежные колонки, используй арифметику quantity × unitPrice = total, чтобы понять, какая из них цена, а какая сумма строки;
- десятичную запятую интерпретируй как десятичную точку: 12,00 = 12.00;
- не объединяй разные товарные строки;
- проверь, что сумма строк по возможности совпадает с итогом документа;
- confidence от 0 до 1;
- если документ не является закупочным документом, documentType всё равно укажи, items оставь пустым.`;

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)));
  }
  return btoa(binary);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(`AI-провайдер не ответил за ${Math.ceil(timeoutMs / 1000)} секунд.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  for (const item of payload?.output || []) {
    for (const part of item?.content || []) {
      if (typeof part?.text === "string" && part.text.trim()) return part.text.trim();
    }
  }
  return "";
}

function parseJsonText(text) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error("AI не вернул результат.");
  try { return JSON.parse(raw); } catch {}
  const fenced = raw.match(/\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`/i);
  if (fenced) return JSON.parse(fenced[1]);
  const a = raw.indexOf("{"), b = raw.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(raw.slice(a, b + 1));
  throw new Error("AI вернул некорректный JSON.");
}

async function openAiProvider(env, file, timeoutMs = 90000) {
  const key = clean(env.OPENAI_API_KEY);
  if (!key) throw new Error("OPENAI_API_KEY не настроен.");
  const model = clean(env.OPENAI_DOCUMENT_MODEL) || "gpt-5.6-luna";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = bytesToBase64(bytes);
  const contentType = clean(file.type) || "application/octet-stream";
  const isImage = contentType.startsWith("image/");

  const filePart = isImage
    ? { type: "input_image", image_url: `data:${contentType};base64,${base64}`, detail: "high" }
    : { type: "input_file", filename: file.name || "document.pdf", file_data: `data:${contentType};base64,${base64}` };

  const response = await fetchWithTimeout("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [{ role: "user", content: [{ type: "input_text", text: PROMPT }, filePart] }],
      text: {
        format: {
          type: "json_schema",
          name: "smart_horeca_purchase_document",
          strict: true,
          schema: INVOICE_SCHEMA
        }
      }
    })
  }, timeoutMs);

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI HTTP ${response.status}`;
    throw new Error(message);
  }
  const text = extractOutputText(payload);
  return {
    provider: "OPENAI",
    model,
    data: parseJsonText(text),
    usage: payload?.usage || null,
    providerResponseId: payload?.id || null
  };
}

async function localProvider(env, file, timeoutMs = 105000) {
  const url = clean(env.LOCAL_DOCUMENT_AI_URL);
  if (!url) throw new Error("LOCAL_DOCUMENT_AI_URL не настроен.");
  const form = new FormData();
  form.set("file", file, file.name || "document");
  form.set("prompt", PROMPT);
  form.set("schema", JSON.stringify(INVOICE_SCHEMA));
  const headers = {};
  const token = clean(env.LOCAL_DOCUMENT_AI_TOKEN);
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetchWithTimeout(url, { method: "POST", headers, body: form }, timeoutMs);
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Local AI HTTP ${response.status}`);
  const data = payload?.data || payload?.document || payload;
  if (!data || typeof data !== "object") throw new Error("Local AI вернул пустой результат.");
  return {
    provider: "LOCAL",
    model: clean(payload?.model) || "local",
    data,
    usage: payload?.usage || null,
    providerResponseId: payload?.id || null
  };
}

export function aiProviderStatus(env = {}) {
  return {
    openai: {
      configured: Boolean(clean(env.OPENAI_API_KEY)),
      model: clean(env.OPENAI_DOCUMENT_MODEL) || "gpt-5.6-luna"
    },
    local: {
      configured: Boolean(clean(env.LOCAL_DOCUMENT_AI_URL)),
      urlConfigured: Boolean(clean(env.LOCAL_DOCUMENT_AI_URL))
    }
  };
}

// Quality checks are deterministic and run on the server: never use OCR's
// confidence score alone as proof that all invoice rows were extracted.
// Missing/incorrect rows, headers and totals escalate to External AI.
function numeric(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function approxMoney(a, b) {
  return Math.abs(a - b) <= Math.max(0.10, Math.abs(b) * 0.01);
}
export function evaluateLocalDocumentQuality(data) {
  const reasons = [];
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { accepted: false, reasons: ["INVALID_DOCUMENT"], itemCount: 0, confidence: null };
  }
  const confidence = numeric(data.confidence);
  if (confidence === null || confidence < 0.80 || confidence > 1) reasons.push("LOW_OCR_CONFIDENCE");
  if (String(data.supplierName || "").trim().length < 3) reasons.push("SUPPLIER_MISSING");
  const date = String(data.date || "");
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(date + "T00:00:00Z") : null;
  if (!parsedDate || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    reasons.push("DOCUMENT_DATE_MISSING");
  }
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) reasons.push("NO_PRODUCT_ROWS");
  let sum = 0;
  for (const item of items) {
    const quantity = numeric(item?.quantity), price = numeric(item?.unitPrice), total = numeric(item?.total);
    const lineConfidence = numeric(item?.confidence);
    if (String(item?.sourceName || "").trim().length < 2 || quantity === null || quantity <= 0 ||
        price === null || price < 0 || total === null || total < 0) {
      reasons.push("INCOMPLETE_PRODUCT_ROW");
      continue;
    }
    if (lineConfidence === null || lineConfidence < 0.72 || lineConfidence > 1) reasons.push("LOW_ROW_CONFIDENCE");
    if (!approxMoney(quantity * price, total)) reasons.push("ROW_TOTAL_MISMATCH");
    sum += total;
  }
  const declared = numeric(data.total);
  if (declared === null || declared <= 0) reasons.push("DOCUMENT_TOTAL_MISSING");
  else if (items.length && !approxMoney(sum, declared)) reasons.push("DOCUMENT_TOTAL_MISMATCH");
  // Our local heuristic may fill 'total' from the *same extracted rows*;
  // that cannot prove no rows were missed. New local OCR responses include
  // the independently read total from the physical document.
  const ocrDeclared = numeric(data.ocrDeclaredTotal);
  // Legacy Local services that do not report an independently seen
  // total cannot prove the table is complete; escalate conservatively.
  if (data.totalSource !== "OCR") reasons.push("DOCUMENT_TOTAL_NOT_VERIFIED");
  if (data.totalSource === "OCR" &&
      (ocrDeclared === null || declared === null || !approxMoney(ocrDeclared, declared))) {
    reasons.push("OCR_TOTAL_MISMATCH");
  }
  const uniqueReasons = [...new Set(reasons)];
  return { accepted: uniqueReasons.length === 0, reasons: uniqueReasons,
    itemCount: items.length, confidence, total: declared };
}
function withAutoDecision(result, decision) {
  const usage = result.usage && typeof result.usage === "object" && !Array.isArray(result.usage)
    ? result.usage : {};
  return {...result, usage: {...usage, autoDecision: decision}};
}

export async function processPurchaseDocument(env, file, requestedProvider = "AUTO") {
  const provider = clean(requestedProvider || "AUTO").toUpperCase();
  const status = aiProviderStatus(env);

  // Explicit provider choices remain explicit. A forced Local scan cannot
  // silently spend API credit, nor can forced OpenAI route through Local.
  if (provider === "OPENAI") return openAiProvider(env, file);
  if (provider === "LOCAL") return localProvider(env, file, 105000);
  if (provider !== "AUTO") throw new Error("Неизвестный AI-провайдер.");

  // AUTO always attempts free Local OCR before any paid provider call.
  // Fail closed when Local is not set up, rather than silently billing for
  // every document. The user can deliberately choose External AI instead.
  if (!status.local.configured) {
    throw new Error("Для режима Auto сначала настройте Local AI (LOCAL_DOCUMENT_AI_URL) либо вручную выберите External AI.");
  }
  let local = null, localError = false;
  try {
    // The browser has a 120s process timeout. Bound both sequential steps.
    local = await localProvider(env, file, 50000);
  } catch (_) {
    localError = true;
  }
  const quality = local ? evaluateLocalDocumentQuality(local.data) : null;
  if (quality?.accepted) {
    return withAutoDecision(local, {mode: "AUTO", route: "LOCAL_ACCEPTED",
      localAttempted: true, openaiAttempted: false, quality});
  }
  const reasons = quality?.reasons || ["LOCAL_UNAVAILABLE"];
  if (!status.openai.configured) {
    if (local) return withAutoDecision(local, {mode: "AUTO", route: "LOCAL_REVIEW",
      localAttempted: true, openaiAttempted: false, quality});
    throw new Error("Local AI недоступен, а OpenAI не настроен. Повторите распознавание позже.");
  }
  try {
    // Paid escalation ONLY for real Local failures or rejected quality.
    const external = await openAiProvider(env, file, 60000);
    return withAutoDecision(external, {mode: "AUTO", route: "OPENAI_FALLBACK",
      localAttempted: true, openaiAttempted: true,
      reasons, localConfidence: quality?.confidence ?? null, localItemCount: quality?.itemCount ?? 0,
      localFailed: localError});
  } catch (error) {
    // Don't discard an extracted (but weak) draft if the paid provider has
    // a rate limit/outage. Keep it for human review with a warning.
    if (local) return withAutoDecision(local, {mode: "AUTO", route: "LOCAL_REVIEW",
      localAttempted: true, openaiAttempted: true, openaiFailed: true, quality});
    throw error;
  }
}
