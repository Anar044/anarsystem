import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const original = readFileSync(new URL("../functions/api/iiko/_lib/ai-document-providers.js", import.meta.url), "utf8");
const source = original.replace(/^import .*;\s*$/gm, "").replace(/^export /gm, "");
const good = {
  documentType: "incoming_invoice", supplierName: "Bravo MMC",
  date: "2026-10-28", total: 30, ocrDeclaredTotal: 30,
  totalSource: "OCR", confidence: 0.96,
  items: [
    {sourceName: "Milk", quantity: 2, unitPrice: 10, total: 20, confidence: 0.94},
    {sourceName: "Cheese", quantity: 1, unitPrice: 10, total: 10, confidence: 0.91}
  ]
};
const clone = value => JSON.parse(JSON.stringify(value));
const file = new Blob(["fake image"], {type: "image/png"});
file.name = "invoice.png";

function harness({localData = good, openaiData = good, localError = false,
  openaiError = false, localConfigured = true, openaiConfigured = true} = {}) {
  const calls = [];
  const fetchStub = async url => {
    if (url === "https://local.example.test/process") {
      calls.push("LOCAL");
      if (localError) throw new Error("Local OCR unavailable");
      return new Response(JSON.stringify({model: "paddleocr:PP-OCRv5/az+heuristic-v4",
        data: clone(localData), usage: {local: true, paidTokens: 0}}), {
        status: 200, headers: {"Content-Type": "application/json"}
      });
    }
    if (url === "https://api.openai.com/v1/responses") {
      calls.push("OPENAI");
      if (openaiError) return new Response(JSON.stringify({error: {message: "429 rate limit"}}), {status: 429});
      return new Response(JSON.stringify({
        output_text: JSON.stringify(openaiData), usage: {input_tokens: 500, output_tokens: 300},
        id: "resp-test"
      }), {status: 200});
    }
    throw new Error("Unexpected outbound request");
  };
  const scope = {FormData, Blob, Response, AbortController, setTimeout, clearTimeout,
    btoa, Uint8Array, fetch: fetchStub, clean: v => String(v ?? "").trim()};
  runInNewContext(source + "\nglobalThis.providerApi = {processPurchaseDocument, evaluateLocalDocumentQuality};", scope);
  const env = {LOCAL_DOCUMENT_AI_URL: localConfigured ? "https://local.example.test/process" : "",
    OPENAI_API_KEY: openaiConfigured ? "test-key" : ""};
  return {...scope.providerApi, calls, env};
}

test("AUTO uses ONLY free local OCR when lines, confidence and declared totals pass", async () => {
  const h = harness();
  const r = await h.processPurchaseDocument(h.env, file, "AUTO");
  assert.deepEqual(h.calls, ["LOCAL"]);
  assert.equal(r.provider, "LOCAL");
  assert.equal(r.usage.paidTokens, 0);
  assert.equal(r.usage.autoDecision.route, "LOCAL_ACCEPTED");
  assert.equal(r.usage.autoDecision.openaiAttempted, false);
});

test("AUTO escalates weak local OCR to paid provider exactly once", async () => {
  const weak = clone(good); weak.confidence = 0.65;
  const h = harness({localData: weak});
  const r = await h.processPurchaseDocument(h.env, file);
  assert.deepEqual(h.calls, ["LOCAL", "OPENAI"]);
  assert.equal(r.provider, "OPENAI");
  assert.equal(r.usage.input_tokens, 500);
  assert.equal(r.usage.autoDecision.route, "OPENAI_FALLBACK");
  assert.ok(Array.from(r.usage.autoDecision.reasons).includes("LOW_OCR_CONFIDENCE"));
});

test("AUTO escalates incomplete or mathematically incorrect rows and missing OCR totals", async () => {
  for (const modification of [
    x => { x.items[0].total = 22; },
    x => { x.items = []; },
    x => { x.totalSource = "CALCULATED"; x.ocrDeclaredTotal = null; },
    x => { x.total = 40; x.ocrDeclaredTotal = 40; },
    x => { x.date = null; }
  ]) {
    const weak = clone(good); modification(weak);
    const h = harness({localData: weak});
    const r = await h.processPurchaseDocument(h.env, file);
    assert.deepEqual(h.calls, ["LOCAL", "OPENAI"]);
    assert.equal(r.usage.autoDecision.route, "OPENAI_FALLBACK");
  }
});

test("AUTO with no OpenAI key preserves weak local output for mandatory manual review", async () => {
  const weak = clone(good); weak.items = [];
  const h = harness({localData: weak, openaiConfigured: false});
  const r = await h.processPurchaseDocument(h.env, file);
  assert.deepEqual(h.calls, ["LOCAL"]);
  assert.equal(r.provider, "LOCAL");
  assert.equal(r.usage.autoDecision.route, "LOCAL_REVIEW");
});

test("AUTO with paid provider outage preserves weak local draft and flags manual review", async () => {
  const weak = clone(good); weak.totalSource = "CALCULATED";
  const h = harness({localData: weak, openaiError: true});
  const r = await h.processPurchaseDocument(h.env, file);
  assert.deepEqual(h.calls, ["LOCAL", "OPENAI"]);
  assert.equal(r.provider, "LOCAL");
  assert.equal(r.usage.autoDecision.route, "LOCAL_REVIEW");
  assert.equal(r.usage.autoDecision.openaiFailed, true);
});

test("AUTO uses paid fallback for local transport errors, not on ordinary success", async () => {
  const h = harness({localError: true});
  const r = await h.processPurchaseDocument(h.env, file);
  assert.deepEqual(h.calls, ["LOCAL", "OPENAI"]);
  assert.equal(r.usage.autoDecision.localFailed, true);
  assert.deepEqual(Array.from(r.usage.autoDecision.reasons), ["LOCAL_UNAVAILABLE"]);
});

test("AUTO never silently bills when Local AI URL is not configured", async () => {
  const h = harness({localConfigured: false});
  await assert.rejects(h.processPurchaseDocument(h.env, file), /сначала настройте Local AI/);
  assert.deepEqual(h.calls, []);
});

test("manual LOCAL never triggers paid fallback; manual OPENAI bypasses Local by explicit choice", async () => {
  const weak = clone(good); weak.confidence = 0.1;
  const local = harness({localData: weak});
  const localResult = await local.processPurchaseDocument(local.env, file, "LOCAL");
  assert.deepEqual(local.calls, ["LOCAL"]);
  assert.equal(localResult.provider, "LOCAL");
  const paid = harness({localConfigured: false});
  const paidResult = await paid.processPurchaseDocument(paid.env, file, "OPENAI");
  assert.deepEqual(paid.calls, ["OPENAI"]);
  assert.equal(paidResult.provider, "OPENAI");
});

test("invalid values and missing row confidence are rejected without trusting average OCR confidence", () => {
  const h = harness();
  for (const mutation of [
    x => { x.items[0].confidence = null; },
    x => { x.items[0].quantity = -2; },
    x => { x.items[0].unitPrice = null; },
    x => { x.supplierName = ""; }
  ]) {
    const weak = clone(good); mutation(weak);
    assert.equal(h.evaluateLocalDocumentQuality(weak).accepted, false);
  }
});
