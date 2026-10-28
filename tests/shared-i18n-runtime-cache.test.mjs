import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
const root = new URL("../", import.meta.url);
test("all localized HTML screens reuse one locale runtime asset URL",()=>{
  let n=0;
  for (const page of readdirSync(root).filter(x=>x.endsWith(".html"))) {
    const html=readFileSync(new URL(page,root),"utf8");
    const src=[...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']*sh-i18n\.js[^"']*)["']/gi)].map(x=>x[1]);
    assert.ok(src.length<=1,page+" must load locale runtime at most once");
    for(const value of src){ n++; assert.equal(value,"/sh-i18n.js",page+" must use the common cache key"); }
    const catalog=html.indexOf("sh-i18n-catalog.js");
    const engine=html.indexOf('/sh-i18n.js');
    if(catalog>=0&&engine>=0) assert.ok(catalog<engine,page+" must load the dictionary first");
  }
  assert.ok(n>=40,"must cover current protected and translated screens");
  const headers=readFileSync(new URL("_headers",root),"utf8");
  assert.match(headers,/\/sh-i18n\.js\s+Cache-Control: no-cache, max-age=0, must-revalidate/);
});
