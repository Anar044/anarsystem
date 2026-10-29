import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const guest=read("menu.html");
const editor=read("qr-menu.html");
const editorCss=read("qr-menu.css");
const script=guest.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script,"Public QR Menu must contain its existing client-side script");

test("Public menu JavaScript compiles and retains the read-only published API",()=>{
  assert.doesNotThrow(()=>new Function(script));
  assert.match(script,/fetch\('\/api\/qr-menu\/public\?id='\+encodeURIComponent\(id\),\{cache:'no-store'\}\)/);
  assert.match(script,/MENU_DATA=data\.menu\|\|\{\}/);
  assert.match(script,/DESIGN_DATA=applyDesign\(data\.design\)/);
  assert.match(script,/openDish\(el\.dataset\.dishId\)/);
  assert.doesNotMatch(script,/method\s*:\s*['"]POST['"]|\/api\/iiko\/document-action|\/api\/orders|\/api\/payment/);
});

test("QR Menu guest screens match mobile photo-first reference, without simulated checkout",()=>{
  assert.match(guest,/id="sh-qr-guest-reference-style"/);
  assert.match(guest,/id="heroPhoto"/);
  assert.match(guest,/id="spotlightName"/);
  assert.match(guest,/id="spotlightOpen"/);
  assert.match(guest,/id="catNav" aria-label="Категории меню"/);
  assert.match(guest,/id="menuSearchInput"/);
  assert.match(guest,/id="floatSearch"/);
  assert.match(guest,/id="floatMenu"/);
  assert.match(guest,/id="detailOverlay"/);
  assert.match(guest,/id="detailBack"/);
  assert.match(guest,/#content\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(guest,/@media\(max-width:720px\)/);
  assert.match(guest,/\.detail-card\{width:100%;height:100dvh/);
  assert.doesNotMatch(guest,/id="checkout"|id="payment"|id="submitOrder"/);
});

function guestHarness(){
  const code=script.slice(script.indexOf("function enhanceGuestView("),script.indexOf("async function load()"));
  assert.ok(code.startsWith("function enhanceGuestView("));
  const cls=()=>{const x=new Set();return{
    add:c=>x.add(c),remove:c=>x.delete(c),
    contains:c=>x.has(c),toggle:(c,force)=>{const val=force??!x.has(c);if(val)x.add(c);else x.delete(c);return val}
  }};
  const els=new Map();
  const el=id=>{if(!els.has(id))els.set(id,{
    id,hidden:false,value:"",textContent:"",classList:cls(),dataset:{},style:{},
    setAttribute(k,v){this[k]=v},focus(){this.focused=true},
    scrollIntoView(){this.scrolled=true},
    querySelectorAll(){return []},addEventListener(){}
  });return els.get(id)};
  const cards=[
    {textContent:"Чизкейк с ягодами",hidden:false,style:{},classList:cls(),dataset:{dishId:"1"},
      setAttribute(){},addEventListener(){},querySelector(s){return s===".name"?{textContent:"Чизкейк"}:null}},
    {textContent:"Свежие оливки",hidden:false,style:{},classList:cls(),dataset:{dishId:"2"},
      setAttribute(){},addEventListener(){},querySelector(s){return s===".name"?{textContent:"Оливки"}:null}}
  ];
  const doc={
    getElementById:el,
    querySelectorAll(q){
      if(q==="#content .dish")return cards;
      if(q==="#content .cat")return [];
      return [];
    },
    createElement(tag){return {tagName:tag,hidden:false,textContent:"",className:""}},
  };
  el("content").appendChild=x=>els.set(x.id,x);
  el("catNav").querySelectorAll=()=>[];
  let renderedImage=null,openedId=null;
  const functions=new Function("document","setImage","openDish",
    code+"\nreturn {enhanceGuestView};");
  const {enhanceGuestView}=functions(doc,(node,src,alt)=>{renderedImage={node,src,alt}},id=>{openedId=id});
  return{enhanceGuestView,el,cards,get image(){return renderedImage},get opened(){return openedId}};
}

test("Guest image preview uses configured cover, otherwise real dish photo",()=>{
  const h=guestHarness();
  const dishes=[
    {id:"1",name:"Чизкейк",price:1500,currency:"RUB",photo:"https://img.example/1.jpg"},
    {id:"2",name:"Оливки",price:500,currency:"RUB",photo:"https://img.example/2.jpg"}
  ];
  h.enhanceGuestView(dishes,{showPrices:true,hero:""});
  assert.equal(h.el("spotlight").classList.contains("visible"),true);
  assert.equal(h.el("spotlightName").textContent,"Чизкейк");
  assert.equal(h.el("spotlightPrice").textContent,"1500.00 RUB");
  assert.equal(h.image.src,dishes[0].photo);
  h.el("spotlightOpen").onclick();
  assert.equal(h.opened,"1");
  const configured=guestHarness();
  configured.enhanceGuestView(dishes,{showPrices:false,hero:"custom-cover.jpg"});
  assert.equal(configured.image,null);
  assert.equal(configured.el("spotlightPrice").hidden,true);
});

test("Search operates locally without API or document mutation",()=>{
  const h=guestHarness();
  h.enhanceGuestView([{id:"1",name:"Чизкейк",price:1},{id:"2",name:"Оливки",price:2}],{showPrices:true,hero:""});
  h.el("menuSearchButton").onclick();
  assert.equal(h.el("menuSearchWrap").classList.contains("show"),true);
  h.el("menuSearchInput").value="оливки";
  h.el("menuSearchInput").oninput();
  assert.equal(h.cards[0].hidden,true);
  assert.equal(h.cards[1].hidden,false);
  h.el("menuSearchButton").onclick();
  assert.equal(h.cards[0].hidden,false);
});

test("Editor phone preview reflects new guest card style, no editor data logic changed",()=>{
  assert.match(editor,/qr-menu\.css\?v=20261029-video-match-v2/);
  assert.match(editorCss,/\.phone-body\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(editorCss,/\.p-photo\{width:100%;height:auto;aspect-ratio:1\/1/);
  assert.match(editorCss,/\.p-cat\{grid-column:1\/-1/);
});
