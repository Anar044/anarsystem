import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const js=readFileSync(new URL("../ai-documents.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../ai-documents.html",import.meta.url),"utf8");
const css=readFileSync(new URL("../ai-documents.css",import.meta.url),"utf8");
function section(start,end){
  const a=js.indexOf(start),b=js.indexOf(end,a+start.length);
  assert.ok(a>=0&&b>a,"missing function boundaries: "+start+" -> "+end);
  return js.slice(a,b);
}
function fnv32(s){
  let h=2166136261;
  for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619)}
  return(h>>>0).toString(16).padStart(8,"0");
}
const arithmetic=section("function validateDraftArithmetic(){","function recalcTotal()");
const draft=section("function collectDraft(){","async function importToIiko(");
const originalImport=section("async function importToIiko(","function explainSaveError(");
const modal=section("function showSaveDialog(processed){","async function loadAll(");
const feedback=section("function explainSaveError(message){","function bindUpload(){");

test("the three original business operations are byte-for-byte unchanged",()=>{
  // Golden fingerprints are from main before UI-only work (commit c2a4e9b).
  assert.deepEqual([arithmetic.length,fnv32(arithmetic)],[2852,"0a53d285"]);
  assert.deepEqual([draft.length,fnv32(draft)],[1476,"b80fa40e"]);
  assert.deepEqual([originalImport.length,fnv32(originalImport)],[1812,"535ec86d"]);
  assert.match(originalImport,/const action=processed\?'save-and-process':'save'/);
  assert.match(originalImport,/\/api\/iiko\/document-action/);
  assert.match(originalImport,/action,document:documentData/);
  assert.match(originalImport,/action:'markImported'/);
  assert.doesNotMatch(originalImport,/saveDialogBusy|saveUncertainIds|saveBusy/);
});

test("UI adds an accessible modal without changing server contracts or document numbering",()=>{
  assert.match(html,/id="saveOverlay"[\s\S]*role="dialog" aria-modal="true"/);
  assert.match(html,/id="saveModalClose"/);
  assert.match(html,/ai-documents\.js\?v=20261029-save-ui-only1/);
  assert.match(css,/\.aid-save-overlay\[hidden\]/);
  assert.match(css,/@media\(max-width:520px\)/);
  assert.match(css,/prefers-reduced-motion/);
  assert.match(feedback,/await importToIiko\(processed\)/);
  assert.doesNotMatch(feedback,/\/api\/iiko\/document-action|\/api\/ai-documents|autoDocumentNumber\(/);
  assert.match(js,/\$\('saveDraftBtn'\)\.onclick=\(\)=>saveWithFeedback\(false\)/);
  assert.match(js,/\$\('saveProcessBtn'\)\.onclick=\(\)=>saveWithFeedback\(true\)/);
});

function fixture({error=null,slowPromise=null,number="SH-AI-9"}={}){
  const steps=[0,1,2].map(x=>({
    dataset:{saveStep:String(x),state:"pending"},
    mark:{textContent:""},
    querySelector(){return this.mark}
  }));
  const overlay={hidden:true,dataset:{},
    dialog:{attributes:{},setAttribute(key,val){this.attributes[key]=val}},
    querySelector(){return this.dialog}};
  const elements=new Map([["saveOverlay",overlay],["saveSteps",{querySelectorAll(){return steps}}]]);
  for(const id of ["saveOutcomeIcon","saveModalTitle","saveModalSubtitle","saveServerStep",
    "saveResultDetails","saveResultNumber","saveResultState","saveResultAmount",
    "saveErrorDetail","saveModalHint","saveModalClose","draftNumber","draftDeclaredTotal"]){
    elements.set(id,{textContent:"",innerHTML:"",hidden:false,value:"",focus(){this.focused=true}});
  }
  elements.get("draftNumber").value="1024";
  elements.get("draftDeclaredTotal").value="60";
  let calls=0;
  const importToIiko=async(processed)=>{
    calls++;
    if(slowPromise)await slowPromise;
    if(error)throw error;
  };
  const $=id=>{
    assert.ok(elements.has(id),"Missing UI element: "+id);
    return elements.get(id);
  };
  const money=n=>Number(n).toFixed(2);
  const inputNumber=v=>{
    if(v===null||v===undefined||String(v).trim()==="")return null;
    return Number(v);
  };
  const api=new Function("$","money","inputNumber","importToIiko",
    "let saveDialogBusy=false;let saveDialogStage=0;let current={id:'doc1',result:{imported:{documentNumber:'"+number+"'}}};\n"+
    modal+"\n"+feedback+"\nreturn {saveWithFeedback,closeSaveDialog,getBusy:()=>saveDialogBusy,explainSaveError};"
  )($,money,inputNumber,importToIiko);
  return{...api,overlay,elements,steps,get calls(){return calls}};
}

test("success confirmation is visual-only and reports server-confirmed document",async()=>{
  const h=fixture();
  await h.saveWithFeedback(false);
  assert.equal(h.calls,1);
  assert.equal(h.overlay.dataset.state,"success");
  assert.equal(h.elements.get("saveModalTitle").textContent,"Накладная успешно сохранена");
  assert.equal(h.elements.get("saveResultNumber").textContent,"SH-AI-9");
  assert.equal(h.elements.get("saveModalClose").hidden,false);
  h.closeSaveDialog();
  assert.equal(h.overlay.hidden,true);
});

test("save and process keeps the original processed option and success wording",async()=>{
  const h=fixture();
  await h.saveWithFeedback(true);
  assert.equal(h.calls,1);
  assert.equal(h.elements.get("saveModalTitle").textContent,"Накладная сохранена и проведена");
  assert.equal(h.elements.get("saveResultState").textContent,"Сохранена и проведена");
});

test("double-click cannot trigger simultaneous server requests in UI",async()=>{
  let resolve;
  const wait=new Promise(ok=>{resolve=ok});
  const h=fixture({slowPromise:wait});
  const first=h.saveWithFeedback(false);
  const second=h.saveWithFeedback(true);
  assert.equal(h.getBusy(),true);
  assert.equal(h.calls,1);
  h.closeSaveDialog();
  assert.equal(h.overlay.hidden,false);
  resolve();
  await Promise.all([first,second]);
  assert.equal(h.calls,1);
  assert.equal(h.overlay.dataset.state,"success");
});

test("existing processed invoice error is translated without changing number or retry rules",async()=>{
  const error=new Error("Changing processed or deleted document is not allowed: existing #1024 of 01.10.2026 00:00 is in status PROCESSED");
  const h=fixture({error});
  await h.saveWithFeedback(true);
  assert.equal(h.overlay.dataset.state,"error");
  assert.match(h.elements.get("saveErrorDetail").textContent,/Накладная №1024 от 01\.10\.2026 уже проведена/);
  assert.match(h.elements.get("saveErrorDetail").textContent,/Проверьте номер/);
  assert.equal(h.elements.get("draftNumber").value,"1024");
  assert.equal(h.calls,1);
  // An application-level duplicate status error must not alter business retry
  // behaviour; it is the source accounting server's responsibility to reject.
  await h.saveWithFeedback(true);
  assert.equal(h.calls,2);
});

test("validation errors from original save operation remain errors",async()=>{
  const h=fixture({error:new Error("Выберите склад.")});
  await h.saveWithFeedback(false);
  assert.equal(h.overlay.dataset.state,"error");
  assert.match(h.elements.get("saveErrorDetail").textContent,/Выберите склад/);
  assert.equal(h.elements.get("saveModalClose").hidden,false);
});
