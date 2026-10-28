import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
test("every HTML module shares exactly one versionless navigation script URL", () => {
  const htmlPages = readdirSync(root).filter(path => path.endsWith(".html"));
  let references = 0;
  for (const page of htmlPages) {
    const html = readFileSync(new URL(page, root), "utf8");
    const sources = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']*documents-nav\.js[^"']*)["']/gi)].map(x => x[1]);
    for (const url of sources) {
      references++;
      assert.equal(url, "/documents-nav.js", page + " must not use a separate cache key");
    }
  }
  assert.ok(references >= 36, "all existing protected module references should be checked");
  const headers = readFileSync(new URL("_headers", root), "utf8");
  assert.match(headers, /\/documents-nav\.js\s+Cache-Control: no-cache/);
});
