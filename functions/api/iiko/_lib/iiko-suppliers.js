import { clean, iikoJson, iikoText } from "./iiko-client.js";

function scalar(value) {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value).trim();
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = scalar(item);
      if (result) return result;
    }
    return "";
  }
  if (typeof value === "object") {
    for (const key of [
      "value", "Value", "text", "Text", "name", "Name",
      "companyName", "fullName", "shortName", "title",
      "id", "Id", "uuid", "UUID", "guid", "GUID", "code", "Code"
    ]) {
      if (value[key] != null) {
        const result = scalar(value[key]);
        if (result) return result;
      }
    }
  }
  return "";
}

function objectId(value) {
  if (value == null) return "";
  if (typeof value !== "object") return clean(value);
  for (const key of [
    "id", "Id", "ID", "uuid", "UUID", "guid", "GUID",
    "supplierId", "supplierID", "counteragentId", "counteragentID"
  ]) {
    if (value[key] != null) {
      const result = clean(value[key]);
      if (result) return result;
    }
  }
  return "";
}

function objectName(value) {
  if (value == null) return "";
  if (typeof value !== "object") return clean(value);
  for (const key of [
    "name", "Name", "companyName", "company", "fullName",
    "shortName", "title", "text", "Text"
  ]) {
    if (value[key] != null) {
      const result = scalar(value[key]);
      if (result) return result;
    }
  }
  return "";
}

function arrays(payload, out = []) {
  if (payload == null) return out;
  if (Array.isArray(payload)) {
    out.push(payload);
    return out;
  }
  if (typeof payload !== "object") return out;
  for (const key of [
    "employees", "suppliers", "items", "data", "rows", "results",
    "response", "employee", "supplier", "contractor", "counteragent"
  ]) {
    if (payload[key] != null) arrays(payload[key], out);
  }
  return out;
}

function list(payload) {
  const found = arrays(payload);
  return found.length ? found.reduce((all, part) => all.concat(part), []) : [];
}

function xmlDecode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function xmlTag(block, name) {
  const re = new RegExp(
    `<(?:(?:[A-Za-z0-9_.-]+):)?${name}\\b[^>]*>([\\s\\S]*?)</(?:(?:[A-Za-z0-9_.-]+):)?${name}>`,
    "i"
  );
  const match = String(block || "").match(re);
  return match ? xmlDecode(match[1].replace(/<[^>]*>/g, "")) : "";
}

function parseXmlSuppliers(text) {
  const out = [];
  for (const tag of ["employee", "supplier", "contractor", "counteragent"]) {
    const re = new RegExp(
      `<(?:(?:[A-Za-z0-9_.-]+):)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:(?:[A-Za-z0-9_.-]+):)?${tag}>`,
      "gi"
    );
    let match;
    while ((match = re.exec(String(text || "")))) {
      const block = match[1];
      const id = xmlTag(block, "id") || xmlTag(block, "uuid") || xmlTag(block, "guid");
      const name = xmlTag(block, "name") || xmlTag(block, "companyName") || xmlTag(block, "fullName");
      if (id) {
        out.push({
          id,
          name,
          code: xmlTag(block, "code"),
          phone: xmlTag(block, "phone") || xmlTag(block, "cellPhone")
        });
      }
    }
  }
  return out;
}

function normalizeSupplier(value) {
  if (value == null) return null;
  const id = objectId(value);
  if (!id) return null;
  return {
    id,
    name: objectName(value),
    code: scalar(value.code ?? value.Code ?? value.num ?? value.number),
    phone: scalar(value.phone ?? value.Phone ?? value.cellPhone ?? value.mobilePhone)
  };
}

function dedupe(rows) {
  const result = [];
  const seen = new Set();
  for (const row of rows || []) {
    const id = clean(row?.id).replace(/^\{+|\}+$/g, "").toLowerCase();
    const name = clean(row?.name);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    result.push({ ...row, id, name });
  }
  return result;
}

export async function getIikoSuppliers(connection) {
  const path = "/resto/api/suppliers?revisionFrom=-1";
  const jsonResult = await iikoJson(connection, path, {
    headers: { Accept: "application/json,text/json,*/*" }
  });

  let rows = list(jsonResult.payload).map(normalizeSupplier).filter(Boolean);
  let format = jsonResult.payload ? "json" : "text";
  let preview = jsonResult.text.slice(0, 1500);

  const named = rows.filter(x => clean(x.name)).length;
  if (jsonResult.ok && named === 0) {
    const xmlResult = await iikoText(connection, path, {
      headers: { Accept: "application/xml,text/xml,*/*" }
    });
    if (xmlResult.ok) {
      const parsed = parseXmlSuppliers(xmlResult.text);
      if (parsed.length) {
        rows = parsed;
        format = "xml";
        preview = xmlResult.text.slice(0, 1500);
      }
    }
  }

  rows = dedupe(rows);

  return {
    rows,
    status: jsonResult.status,
    format,
    rawLength: jsonResult.text.length,
    recordsFound: rows.length,
    namedRecords: rows.filter(x => clean(x.name)).length,
    preview,
    authCacheHit: Boolean(jsonResult.auth?.cacheHit)
  };
}
