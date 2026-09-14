import { syncReferences } from "./references.js";
import { getIikoAuth, iikoText } from "./_lib/iiko-client.js";

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

function xmlDecode(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function tag(block, name) {
  const source = String(block || "");
  const pattern = `<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`;
  const match = source.match(new RegExp(pattern, "i"));
  return match ? xmlDecode(match[1].trim()) : "";
}

function blocks(source, name) {
  const result = [];
  const pattern = `<${name}(?:\\s[^>]*)?>[\\s\\S]*?</${name}>`;
  const regex = new RegExp(pattern, "gi");
  const text = String(source || "");
  let match;
  while ((match = regex.exec(text))) {
    result.push(match[0]);
  }
  return result;
}

function number(value) {
  const normalized = String(value ?? "")
    .replace(/\s/g, "")
    .replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseItems(block) {
  return blocks(block, "item").map((itemBlock, index) => ({
    num: tag(itemBlock, "num") || String(index + 1),
    productId: tag(itemBlock, "productId") || tag(itemBlock, "product"),
    productArticle: tag(itemBlock, "productArticle"),
    storeId: tag(itemBlock, "storeId") || tag(itemBlock, "store"),
    storeCode: tag(itemBlock, "storeCode"),
    containerId: tag(itemBlock, "containerId"),
    containerCode: tag(itemBlock, "containerCode"),
    price: number(tag(itemBlock, "price")),
    priceWithoutVat: number(tag(itemBlock, "priceWithoutVat")),
    amount: number(tag(itemBlock, "amount")),
    sum: number(tag(itemBlock, "sum")),
    discountSum: number(tag(itemBlock, "discountSum")),
    vatPercent: number(tag(itemBlock, "vatPercent")),
    vatSum: number(tag(itemBlock, "vatSum"))
  }));
}

function parseDocuments(xml) {
  return blocks(xml, "document")
    .map((documentBlock, index) => {
      const items = parseItems(documentBlock);
      return {
        id: tag(documentBlock, "id") || null,
        documentNumber: tag(documentBlock, "documentNumber") || null,
        dateIncoming: tag(documentBlock, "dateIncoming") || null,
        status: tag(documentBlock, "status") || null,
        accountToCode: tag(documentBlock, "accountToCode") || null,
        revenueAccountCode: tag(documentBlock, "revenueAccountCode") || null,
        defaultStoreId:
          tag(documentBlock, "defaultStoreId") ||
          tag(documentBlock, "defaultStore") ||
          null,
        defaultStoreCode: tag(documentBlock, "defaultStoreCode") || null,
        counteragentId:
          tag(documentBlock, "counteragentId") ||
          tag(documentBlock, "counteragent") ||
          null,
        counteragentCode: tag(documentBlock, "counteragentCode") || null,
        comment: tag(documentBlock, "comment") || null,
        linkedOutgoingInvoiceId:
          tag(documentBlock, "linkedOutgoingInvoiceId") || null,
        sum: items.reduce((total, item) => total + (item.sum || 0), 0),
        itemsCount: items.length,
        items,
        rawIndex: index
      };
    })
    .filter((document) =>
      document.documentNumber || document.id || document.itemsCount
    );
}

function key(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\{+|\}+$/g, "")
    .toLowerCase();
}

function dateParts(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const parts = text.split("-");
    return { iso: text, d: parts[2], m: parts[1], y: parts[0] };
  }
  if (/^\d{2}\.\d{2}\.\d{4}$/.test(text)) {
    const parts = text.split(".");
    return {
      iso: `${parts[2]}-${parts[1]}-${parts[0]}`,
      d: parts[0],
      m: parts[1],
      y: parts[2]
    };
  }
  return null;
}

function dateFormats(value) {
  const parts = dateParts(value);
  return parts ? [String(value).trim(), `${parts.d}.${parts.m}.${parts.y}`] : [];
}

function dateKey(value) {
  return dateParts(value)?.iso || "";
}

function applyNames(documents, refs) {
  return documents.map((document) => {
    const counteragentName =
      refs.suppliers.get(key(document.counteragentId)) ||
      document.counteragentId ||
      "—";
    const storeName =
      refs.warehouses.get(key(document.defaultStoreId)) ||
      document.defaultStoreId ||
      "—";

    const items = (document.items || []).map((item) => ({
      ...item,
      productName:
        refs.products.get(key(item.productId)) || item.productId || "—",
      storeName:
        refs.warehouses.get(key(item.storeId || document.defaultStoreId)) ||
        item.storeId ||
        document.defaultStoreId ||
        "—"
    }));

    return { ...document, counteragentName, storeName, items };
  });
}

async function requestXml(connection, path) {
  return iikoText(connection, path, {
    headers: { Accept: "application/xml,text/xml,*/*" }
  });
}

async function getInvoices(connection, from, to, counteragentId) {
  const attempts = [];
  const fromFormats = dateFormats(from);
  const toFormats = dateFormats(to);

  for (const fromValue of fromFormats) {
    for (const toValue of toFormats) {
      const params = new URLSearchParams({
        from: fromValue,
        to: toValue
      });
      if (counteragentId) params.set("supplierId", counteragentId);

      const response = await requestXml(
        connection,
        `/resto/api/documents/export/outgoingInvoice?${params.toString()}`
      );
      const documents = response.ok ? parseDocuments(response.text) : [];
      attempts.push({
        from: fromValue,
        to: toValue,
        status: response.status,
        ok: response.ok,
        documents: documents.length
      });

      if (response.ok && documents.length) {
        return { docs: documents, attempts };
      }
    }
  }

  const params = new URLSearchParams();
  if (counteragentId) params.set("supplierId", counteragentId);
  const suffix = params.toString() ? `?${params.toString()}` : "";

  const fallback = await requestXml(
    connection,
    `/resto/api/documents/export/outgoingInvoice${suffix}`
  );
  const documents = fallback.ok ? parseDocuments(fallback.text) : [];
  const fromKey = dateKey(from);
  const toKey = dateKey(to);

  const filtered = documents.filter((document) => {
    const documentKey = dateKey(document.dateIncoming);
    if (!documentKey) return true;
    return (!fromKey || documentKey >= fromKey) &&
      (!toKey || documentKey <= toKey);
  });

  return {
    docs: filtered,
    attempts: [
      ...attempts,
      {
        fallback: true,
        status: fallback.status,
        ok: fallback.ok,
        documents: documents.length
      }
    ],
    serverDocuments: documents.length
  };
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { ...corsHeaders() }
  });
}

export async function onRequestPost(context) {
  try {
    const body = await context.request.json();
    const connection = {
      ip: String(body.ip || "").trim(),
      port: String(body.port || "").trim(),
      login: String(body.login || "").trim(),
      password: String(body.password || "")
    };

    if (!connection.ip || !connection.port || !connection.login || !connection.password) {
      return jsonResponse(
        {
          success: false,
          message: "Заполните IP, порт, логин и пароль SH Server"
        },
        400
      );
    }

    if (!dateParts(body.from) || !dateParts(body.to)) {
      return jsonResponse({ success: false, message: "Укажите период" }, 400);
    }

    if (dateKey(body.to) < dateKey(body.from)) {
      return jsonResponse(
        { success: false, message: "Дата «По» раньше даты «С»" },
        400
      );
    }

    const result = await getInvoices(
      connection,
      body.from,
      body.to,
      body.counteragentId
    );
    const auth = await getIikoAuth(connection);

    const needed = [
      ...new Set(
        result.docs
          .map((document) => key(document.counteragentId))
          .filter(Boolean)
      )
    ];

    const references = await syncReferences(
      context.env,
      auth.serverUrl,
      auth.token,
      needed
    ).catch((error) => ({
      maps: {
        suppliers: new Map(),
        warehouses: new Map(),
        products: new Map()
      },
      diagnostics: { error: String(error?.message || error) }
    }));

    const maps = references.maps || references;
    const documents = applyNames(result.docs, maps);

    return jsonResponse({
      success: true,
      count: documents.length,
      from: body.from,
      to: body.to,
      documents,
      referenceSource: "iiko-sync+d1",
      attempts: result.attempts,
      serverDocuments: result.serverDocuments || result.docs.length,
      meta: {
        sharedIikoClient: true,
        authCacheHit: auth.cacheHit === true
      }
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        message: error?.message || "Ошибка получения расходных накладных"
      },
      502
    );
  }
}
