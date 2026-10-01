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
Определи тип документа и, если это приходная накладная/счёт поставщика, извлеки шапку и все товарные строки.
Правила:
- ничего не придумывай;
- неизвестные значения возвращай null;
- даты по возможности YYYY-MM-DD;
- числа возвращай числами без валютных символов;
- sourceName сохраняй максимально близко к названию в документе;
- confidence от 0 до 1;
- не объединяй разные товарные строки;
- если документ не является закупочным документом, documentType всё равно укажи, items оставь пустым.`;

function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(bytes.length, i + chunk)));
  }
  return btoa(binary);
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

async function openAiProvider(env, file) {
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

  const response = await fetch("https://api.openai.com/v1/responses", {
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
  });

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

function localDocumentEndpoint(value) {
  const raw = clean(value);
  if (!raw) return "";
  const trimmed = raw.replace(/\/+$/, "");
  if (/\/process$/i.test(trimmed)) return trimmed;
  return trimmed + "/process";
}

async function localProvider(env, file) {
  const url = localDocumentEndpoint(env.LOCAL_DOCUMENT_AI_URL);
  if (!url) throw new Error("LOCAL_DOCUMENT_AI_URL не настроен.");
  const form = new FormData();
  form.set("file", file, file.name || "document");
  form.set("prompt", PROMPT);
  form.set("schema", JSON.stringify(INVOICE_SCHEMA));
  const headers = {};
  const token = clean(env.LOCAL_DOCUMENT_AI_TOKEN);
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(url, { method: "POST", headers, body: form });
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

export async function processPurchaseDocument(env, file, requestedProvider = "AUTO") {
  const provider = clean(requestedProvider || "AUTO").toUpperCase();
  const status = aiProviderStatus(env);

  if (provider === "OPENAI") return openAiProvider(env, file);
  if (provider === "LOCAL") return localProvider(env, file);
  if (provider !== "AUTO") throw new Error("Неизвестный AI-провайдер.");

  if (status.local.configured) {
    try { return await localProvider(env, file); } catch (localError) {
      if (!status.openai.configured) throw localError;
    }
  }
  if (status.openai.configured) return openAiProvider(env, file);
  throw new Error("AI-провайдер не настроен. Настройте Local AI или OPENAI_API_KEY.");
}
