import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const guest=read("menu.html"),css=read("qr-menu-reference-v2.css"),js=read("qr-menu-reference-v2.js");
const editor=read("qr-menu.html"),editorJs=read("qr-menu.js");
const editorCss=read("qr-menu.css"),preview=read("qr-menu-preview-reference-v2.js");
const inline=guest.match(/<script>\n([\s\S]*?)\n<\/script>/)?.[1];

test("QR Menu reference video is implemented only in guest/editor visual assets",()=>{
  assert.ok(inline);
  assert.doesNotThrow(()=>new Function(inline));
  assert.doesNotThrow(()=>new Function(js));
  assert.doesNotThrow(()=>new Function(preview));
  assert.match(guest,/qr-menu-reference-v2\.css\?v=20261029-video-match-v2/);
  assert.match(guest,/qr-menu-reference-v2\.js\?v=20261029-video-match-v2/);
  assert.match(editor,/qr-menu-preview-reference-v2\.js\?v=20261029-video-match-v2/);
  assert.match(editor,/qr-menu\.css\?v=20261029-video-match-v2/);
  assert.match(editorJs,/SHQRMenuPreviewVideo\?\.refresh\?\.\(state\)/);
});
test("Public menu matches video composition: photo hero, centered name, chips, 2-column grid, immersive detail, floating basket",()=>{
  for(const rule of [
    /\.hero\{height:clamp\(/,
    /\.spotlight\.visible\{display:flex!important;flex-direction:column/,
    /\.cat-nav\{position:sticky/,
    /#content\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/,
    /\.shqr-fav\[aria-pressed=true\]/,
    /\.shqr-add\{right:8px;bottom:8px/,
    /\.guest-float\{display:flex!important/,
    /\.detail-card\{width:min\(480px,100%\)!important;height:100dvh/,
    /\.shqr-qty output\{/,
    /\.shqr-detail-select\{/,
    /\.shqr-basket-overlay\[hidden\]/
  ])assert.match(css,rule);
  assert.match(guest,/id="detailPhoto"/);
  assert.match(guest,/id="heroPhoto"/);
  assert.match(guest,/id="catNav"/);
  assert.match(inline,/window\.SHQRReference\?\.onLoaded\?\.\(dishes,DESIGN_DATA\)/);
  assert.match(inline,/window\.SHQRReference\?\.onDishOpen\?\.\(x,d\)/);
});
test("Selected dishes remain client-side only: never place orders, change prices, or persist customer choices",()=>{
  assert.doesNotMatch(js,/\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage|indexedDB|\/api\/|payments|submitOrder/);
  assert.match(js,/Заказ не отправляется на кассу/);
  assert.match(js,/const selected=new Map\(\),favorites=new Set\(\)/);
  assert.match(inline,/fetch\('\/api\/qr-menu\/public\?id='\+encodeURIComponent\(id\),\{cache:'no-store'\}\)/);
  assert.match(inline,/MENU_DATA=data\.menu\|\|\{\}/);
  assert.match(inline,/DESIGN_DATA=applyDesign\(data\.design\)/);
  assert.doesNotMatch(inline,/method:\s*['"]POST['"]/);
});
test("Preview uses actual configured hero or published dish photo, without unrelated network images",()=>{
  assert.match(preview,/d\.hero\|\|feature\?\.photo\|\|""/);
  assert.match(preview,/nav\.replaceChildren\(\)/);
  assert.match(preview,/window\.SHQRMenuPreviewVideo=\{refresh\}/);
  assert.match(editorCss,/\.phone-top\{background:#fff!important/);
  assert.match(editorCss,/\.shqr-preview-categories\{/);
  assert.match(editorCss,/\.shqr-preview-dock\{/);
  assert.doesNotMatch(preview,/\bfetch\s*\(|XMLHttpRequest|\/api\/|localStorage|setItem\(/);
});
test("Guest reference JS can bootstrap in a read-only sandbox without issuing requests",()=>{
  const listeners={};
  const document={
    addEventListener(name,handler){listeners[name]=handler},
    getElementById(){return null},
    querySelector(){return null},
    querySelectorAll(){return[]},
    body:{classList:{toggle(){}},append(){}}
  };
  const window={};
  const sandbox={window,document,Map,Set,String,Number,Intl};
  assert.doesNotThrow(()=>runInNewContext(js,sandbox));
  assert.equal(typeof window.SHQRReference?.onLoaded,"function");
  assert.equal(typeof window.SHQRReference?.onDishOpen,"function");
  assert.equal(typeof window.SHQRReference?.onDishClose,"function");
  assert.doesNotThrow(()=>window.SHQRReference.onLoaded([],{showPrices:true}));
});
