import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../ai-documents.js",import.meta.url),"utf8");
const begin=source.indexOf("function validateDraftArithmetic(){");
const end=source.indexOf("function recalcTotal(){",begin);
const draftBegin=source.indexOf("function collectDraft(){");
const draftEnd=source.indexOf("async function importToIiko(",draftBegin);
assert.ok(begin>=0&&end>begin&&draftBegin>=0&&draftEnd>draftBegin);
const functions=source.slice(begin,end)+"\n"+source.slice(draftBegin,draftEnd);

function fixture({busy=true,uncertain=false,firstLineSum=24,total=60}={}){
  const entries=[
    {quantity:"2",price:"12",sum:String(firstLineSum),product:"p1",name:"Товар 1"},
    {quantity:"3",price:"12",sum:"36",product:"p2",name:"Товар 2"}
  ];
  const makeRow=(r,i)=>{
    const classes=new Set();
    return {
      dataset:{index:String(i)},
      classList:{
        add:x=>classes.add(x),
        remove:x=>classes.delete(x),
        contains:x=>classes.has(x)
      },
      querySelector(selector){
        if(selector===".source")return {textContent:r.name};
        const key=/data-f="([^"]+)"/.exec(selector)?.[1];
        return key ? {value:r[key]} : null;
      }
    };
  };
  const rows=entries.map(makeRow);
  const nodes={
    draftDeclaredTotal:{value:String(total)},
    saveDraftBtn:{disabled:false},saveProcessBtn:{disabled:false},
    arithmeticWarning:{hidden:true,innerHTML:""},
    draftSupplier:{value:"supplier"},
    draftStore:{value:"store"},
    draftNumber:{value:"INV-1"},
    draftDate:{value:"2026-10-29"},
    draftInvoice:{value:""},
    draftIncoming:{value:""},
    draftDue:{value:""},
  };
  const document={querySelectorAll(selector){
    if(selector===".aid-item")return rows;
    return [];
  }};
  const inputNumber=value=>{
    if(value===null||value===undefined||String(value).trim()==="")return null;
    const n=Number(value);return Number.isFinite(n)?n:null;
  };
  const moneyCents=v=>{
    const n=inputNumber(v);return n===null?null:Math.round(n*100);
  };
  const money=v=>Number(v||0).toLocaleString("ru-RU",{minimumFractionDigits:2,maximumFractionDigits:2});
  const current={id:"doc-1",status:"REVIEW"};
  const create=new Function("$","document","current","refs","saveBusy",
    "saveUncertainIds","inputNumber","moneyCents","money","esc","today","currentMatching",
    functions+"\nreturn {validateDraftArithmetic,collectDraft};");
  const validation=create(id=>nodes[id],document,current,
    {products:[{id:"p1",name:"Товар 1"},{id:"p2",name:"Товар 2"}]},
    busy,new Set(uncertain?["doc-1"]:[]),inputNumber,moneyCents,money,
    x=>String(x),()=> "2026-10-29",()=>({items:entries.map(x=>({sourceName:x.name}))}));
  return {...validation,nodes,rows};
}

test("Arithmetic remains valid while the UI displays saving; original validator unchanged",()=>{
  const h=fixture({busy:true});
  const result=h.validateDraftArithmetic();
  assert.equal(result.valid,true);
  assert.equal(result.issues.length,0);
  assert.equal(result.documentTotal,60);
  // Only arithmetic and imported status affect the original form buttons.
  assert.equal(h.nodes.saveDraftBtn.disabled,false);
  assert.equal(h.nodes.saveProcessBtn.disabled,false);
  const draft=h.collectDraft();
  assert.equal(draft.documentTotal,60);
  assert.equal(draft.items.length,2);
  assert.deepEqual(draft.items.map(x=>x.sum),[24,36]);
});

test("UI save state never alters original invoice arithmetic validation",()=>{
  const normal=fixture({busy:false});
  assert.equal(normal.validateDraftArithmetic().valid,true);
  assert.equal(normal.nodes.saveDraftBtn.disabled,false);
  const uncertain=fixture({busy:false,uncertain:true});
  assert.equal(uncertain.validateDraftArithmetic().valid,true);
  assert.equal(uncertain.nodes.saveDraftBtn.disabled,false);
  assert.equal(uncertain.collectDraft().items.length,2);
});

test("True row mismatch remains blocking and describes exact position",()=>{
  const h=fixture({busy:true,firstLineSum:12});
  const result=h.validateDraftArithmetic();
  assert.equal(result.valid,false);
  assert.ok(result.issues.some(x=>x.includes("Товар 1")));
  assert.equal(h.nodes.arithmeticWarning.hidden,false);
  assert.equal(h.nodes.saveDraftBtn.disabled,true);
  assert.throws(()=>h.collectDraft(),/Товар 1/);
});

test("True document-total mismatch remains blocking with actionable amount",()=>{
  const h=fixture({busy:false,total:80});
  const result=h.validateDraftArithmetic();
  assert.equal(result.valid,false);
  assert.ok(result.issues.some(x=>x.includes("Итого документа")));
  assert.equal(h.nodes.saveProcessBtn.disabled,true);
  assert.throws(()=>h.collectDraft(),/Итого документа/);
});
