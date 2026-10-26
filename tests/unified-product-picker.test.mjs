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

test("search popup is mounted on document.body to escape clipped procurement/internal/invoice modals",()=>{
 const widget=src("sh-product-picker.js");
 assert.match(widget,/document\.body\.appendChild\(list\)/);
 assert.match(widget,/\.sh-pick-list\{position:fixed/);
 assert.match(widget,/z-index:2147483000/);
 assert.match(widget,/positionPopup/);
 assert.match(widget,/window\.addEventListener\("scroll",positionPopup,true\)/);
 assert.match(widget,/const openUp=below<150&&above>below/);
 assert.match(widget,/Math\.min\(264/);
 assert.match(widget,/list\.remove\(\)/);
 assert.doesNotMatch(widget,/wrap\.append\(search,list\)/);
 for(const page of ["nakladnye.html","procurement.html","internal-orders.html"]){
   assert.match(src(page),/sh-product-picker\.js\?v=20261026-popup-1/);
 }
});
test("document modal sizes allow one-row product and package editing at desktop widths",()=>{
 const procurement=src("procurement.css");
 const internal=src("internal-orders.css");
 const incoming=src("nakladnye-write.js");
 assert.match(procurement,/\.proc-modal\{width:min\(1280px,98vw\)/);
 assert.match(internal,/\.io-modal-dialog\{position:relative;width:min\(1250px,100%\)/);
 assert.match(incoming,/\.inc-dialog\{width:min\(1380px,98vw\)/);
});
