import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const html = read("ai-documents.html");
const css = read("ai-documents.css");
const original = read("ai-documents.js");

test("AI invoice save shows an accessible modal with explicit stages and success details", () => {
  assert.match(html,/id="saveOverlay"[\s\S]*role="dialog" aria-modal="true"/);
  assert.match(html,/id="saveModalTitle"/);
  assert.match(html,/id="saveServerStep"/);
  assert.match(html,/id="saveResultNumber"/);
  assert.match(html,/id="saveResultAmount"/);
  assert.match(html,/id="saveModalClose"/);
  assert.match(html,/ai-documents\.js\?v=20261029-clear-save-progress1/);
  assert.match(css,/\.aid-save-overlay\[hidden\]/);
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(original,/if\(saveBusy\)return;/);
  assert.match(original,/if\(current\.status==='IMPORTED'\)/);
});

function replaceBetween(source,start,end,replacement) {
  const a=source.indexOf(start),b=source.indexOf(end,a+start.length);
  assert.ok(a>=0 && b>a,start+" -> "+end);
  return source.slice(0,a)+replacement+"\n"+source.slice(b);
}
function fixture({response={success:true,validation:{documentNumber:"SH-2026-1029"}},
  networkError=null,markError=null,badDraft=false,slowResponse=null}={}) {
  const items=[0,1,2].map(i=>({
    dataset:{saveStep:String(i),state:"pending"},
    mark:{textContent:""},
    querySelector(){return this.mark}
  }));
  const overlay={hidden:true,dataset:{},dialog:{
    attributes:{},setAttribute(key,value){this.attributes[key]=value}
  },querySelector(){return this.dialog}};
  const steps={querySelectorAll(){return items}};
  const elements=new Map([["saveOverlay",overlay],["saveSteps",steps]]);
  for(const id of ["saveOutcomeIcon","saveModalTitle","saveModalSubtitle","saveServerStep",
    "saveResultDetails","saveResultNumber","saveResultState","saveResultAmount",
    "saveErrorDetail","saveModalHint","saveModalClose","reviewStatus","saveDraftBtn",
    "saveProcessBtn","providerState"]){
    elements.set(id,{textContent:"",innerHTML:"",hidden:false,disabled:false,className:"",
      focus(){this.focused=true}});
  }
  let source=original;
  source=replaceBetween(source,"async function token(){","async function aiGet(","async function token(){return 'token'}");
  source=replaceBetween(source,"async function aiGet(","async function aiPost(body)",
    "async function aiGet(){return {documents:[{id:'doc-1',status:'IMPORTED'}],providers:{openai:{configured:true},local:{configured:true}}}}");
  source=replaceBetween(source,"async function aiPost(body){","async function binding()",
    "async function aiPost(body){if(body.action==='markImported' && globalThis.__markError)throw new Error('DB unavailable');return {success:true}}");
  source=replaceBetween(source,"async function requireSingleRestaurant(){","async function loadRefs()",
    "async function requireSingleRestaurant(){return {connection:{ip:'192.0.2.1',port:'8080',login:'api'},departmentIds:['restaurant-1']}}");
  source=replaceBetween(source,"function renderList(){","function setUploadStatus(",
    "function renderList(){globalThis.__listRenders=(globalThis.__listRenders||0)+1}");
  source=replaceBetween(source,"function validateDraftArithmetic(){","function recalcTotal()",
    "function validateDraftArithmetic(){const blocked=saveBusy||saveUncertainIds.has(current?.id)||current?.status==='IMPORTED';$('saveDraftBtn').disabled=blocked;$('saveProcessBtn').disabled=blocked;return {valid:true}}");
  source=replaceBetween(source,"function collectDraft(){","async function importToIiko(",
    "function collectDraft(){if(globalThis.__badDraft)throw Error('Не выбран склад');return {documentNumber:'SH-2026-1029',documentTotal:60,items:[{amount:1,price:60}]}}");
  assert.ok(source.endsWith("})();"));
  source=source.slice(0,-5)+"globalThis.__api={importToIiko,setCurrent:d=>current=d,closeSaveDialog,getBusy:()=>saveBusy,isUncertain:id=>saveUncertainIds.has(id)};})();";
  const doc={readyState:"loading",getElementById:id=>{
    assert.ok(elements.has(id),"unknown element "+id);return elements.get(id);
  },addEventListener(){}};
  let sends=0;
  const fetchStub=async()=>{sends++;
    if(slowResponse)await slowResponse.promise;
    if(networkError)throw networkError;
    return {ok:response.success!==false,status:response.success===false?422:200,json:async()=>response};
  };
  const scope={document:doc,window:{SH_IikoContext:{}},fetch:fetchStub,
    console:{warn(){}},Date,Number,JSON,Error,Set,Map,Array,Object,String,URL,
    __badDraft:badDraft,__markError:markError};
  runInNewContext(source,scope);
  scope.__api.setCurrent({id:"doc-1",status:"REVIEW",result:{}});
  return {api:scope.__api,elements,items,overlay,get sends(){return sends}};
}

test("Successful save has server-confirmed number and a clear receipt; no duplicate operation", async () => {
  const h=fixture();
  await h.api.importToIiko(false);
  assert.equal(h.sends,1);
  assert.equal(h.overlay.dataset.state,"success");
  assert.equal(h.elements.get("saveModalTitle").textContent,"Накладная успешно сохранена");
  assert.equal(h.elements.get("saveResultNumber").textContent,"SH-2026-1029");
  assert.equal(h.elements.get("saveResultAmount").textContent,"60,00 ₼");
  assert.equal(h.elements.get("saveModalClose").hidden,false);
  assert.equal(h.overlay.dialog.attributes["aria-busy"],"false");
  assert.ok(h.items.every(i=>i.dataset.state==="done"));
  await h.api.importToIiko(false);
  assert.equal(h.sends,1);
  h.api.closeSaveDialog();
  assert.equal(h.overlay.hidden,true);
});
test("Save and process preserves distinct success label",async()=>{
  const h=fixture();await h.api.importToIiko(true);
  assert.equal(h.elements.get("saveModalTitle").textContent,"Накладная сохранена и проведена");
  assert.equal(h.elements.get("saveResultState").textContent,"Сохранена и проведена");
});
test("Concurrent clicks cannot submit more than one invoice while server is working",async()=>{
  let resolve;
  const promise=new Promise(r=>{resolve=r});
  const h=fixture({slowResponse:{promise}});
  const first=h.api.importToIiko(false);
  await Promise.resolve();await Promise.resolve();await Promise.resolve();
  const second=h.api.importToIiko(true);
  assert.equal(h.api.getBusy(),true);
  assert.equal(h.overlay.dataset.state,"busy");
  assert.equal(h.elements.get("saveModalClose").hidden,true);
  h.api.closeSaveDialog();
  assert.equal(h.overlay.hidden,false);
  resolve();
  await Promise.all([first,second]);
  assert.equal(h.sends,1);
  assert.equal(h.overlay.dataset.state,"success");
});
test("Partial save error clearly warns, blocks blind re-submit and does not say success",async()=>{
  const h=fixture({response:{success:false,saved:true,stage:"process",message:"not processed",validation:{documentNumber:"INV-456"}}});
  await h.api.importToIiko(true);
  assert.equal(h.overlay.dataset.state,"warning");
  assert.match(h.elements.get("saveModalSubtitle").textContent,/Накладная создана, но провести её не удалось/);
  assert.equal(h.elements.get("saveResultNumber").textContent,"INV-456");
  assert.equal(h.api.isUncertain("doc-1"),true);
  await h.api.importToIiko(true);
  assert.equal(h.sends,1);
});
test("Network ambiguity and markImported errors never silently authorize a second creation",async()=>{
  for(const setup of [{networkError:new TypeError("Failed to fetch")},{markError:true}]){
    const h=fixture(setup);
    await h.api.importToIiko(false);
    assert.equal(h.overlay.dataset.state,"warning");
    assert.equal(h.api.isUncertain("doc-1"),true);
    await h.api.importToIiko(false);
    assert.equal(h.sends,1);
  }
});
test("Validation errors explain failure without making a server call",async()=>{
  const h=fixture({badDraft:true});
  await h.api.importToIiko(false);
  assert.equal(h.sends,0);
  assert.equal(h.overlay.dataset.state,"error");
  assert.match(h.elements.get("saveErrorDetail").textContent,/Не выбран склад/);
  assert.equal(h.elements.get("saveModalClose").hidden,false);
});
