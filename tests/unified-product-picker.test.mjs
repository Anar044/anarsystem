import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const pages={
 "nakladnye.html":"nakladnye-write.js",
 "rashodnye-nakladnye.html":"rashodnye-nakladnye.js",
 "internal-orders.html":"internal-orders.js",
 "procurement.html":"procurement.js",
 "ai-documents.html":"ai-documents.js",
 "nomenclature.html":"nomenclature.js"
};
test("all product-creating document sections load the common picker before their editor code",()=>{
 for(const [page,script] of Object.entries(pages)){
   const html=src(page);
   const widget=html.indexOf('sh-product-picker.js');
   const editor=html.indexOf(script);
   assert.ok(widget>0&&editor>widget,page+" must include product picker before "+script);
 }
});
test("product selection edits only presentation while original form value and change events remain authoritative",()=>{
 const widget=src("sh-product-picker.js");
 assert.match(widget,/root\.SHProductPicker=\{attach\}/);
 assert.match(widget,/original\.value=value/);
 assert.match(widget,/dispatchEvent\(new Event\("change"/);
 assert.match(widget,/original\.required=wasRequired/);
 assert.match(widget,/original\.style\.display=originalDisplay/);
 assert.match(widget,/chosenId=item\.id/);
 assert.match(widget,/onSelect/);
 assert.match(widget,/ArrowDown/);
 assert.match(widget,/Escape/);
 assert.match(widget,/pointerdown/);
 assert.match(widget,/slice\(0,40\)/);
 assert.doesNotMatch(widget,/fetch\(/);
 assert.doesNotMatch(widget,/\/api\/iiko/);
});
test("existing document forms keep their quantity/pack/sum fields but have readable product search",()=>{
 const incoming=src("nakladnye-write.js");
 const internal=src("internal-orders.js");
 const external=src("procurement.js");
 const outgoing=src("rashodnye-nakladnye.js");
 const ai=src("ai-documents.js");
 const chart=src("nomenclature.js");
 const chartSecondary=src("nomenclature-chart-editor.js");
 for(const [name,s] of Object.entries({incoming,internal,external,outgoing,ai,chart,chartSecondary}))
   assert.match(s,/SHProductPicker\?\.attach/,name);
 assert.match(incoming,/data-f="packageChoice"/);
 assert.match(incoming,/data-f="vatPercent"/);
 assert.match(internal,/data-f="packaging"/);
 assert.match(internal,/packageCount/);
 assert.match(external,/canViewProcurementPrices/);
 assert.match(external,/proc-pr-no-prices/);
 assert.match(outgoing,/data-f="productId"/);
 assert.match(outgoing,/loadOutgoingProducts/);
 assert.match(ai,/rememberAlias\(row\)/);
 assert.match(chart,/data-ci="productId"/);
});
test("only reference data comes from the server; raw IDs are never shown as the common picker's label",()=>{
 const widget=src("sh-product-picker.js");
 assert.match(widget,/search\.value=textFor\(item\)/);
 assert.match(widget,/x\.name\+\(x\.code/);
 assert.match(widget,/getProducts/);
 assert.doesNotMatch(widget,/search\.value\s*=\s*item\.id/);
});
