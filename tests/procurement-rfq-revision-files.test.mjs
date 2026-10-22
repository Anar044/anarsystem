import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../functions/api/procurement.js',import.meta.url),'utf-8');
const archive=readFileSync(new URL('../functions/api/procurement-attachments.js',import.meta.url),'utf-8');
const ui=readFileSync(new URL('../procurement.js',import.meta.url),'utf-8');
const css=readFileSync(new URL('../procurement.css',import.meta.url),'utf-8');

test('RFQ revision is authorized and creates a new RFQ without overwriting old quotes',()=>{
 assert.match(source, /"revise-rfq":"procurement.sourcing"/);
 const revision=source.split('if(action==="revise-rfq"){')[1].split('if(action==="create-rfq-link"){')[0];
 assert.match(revision,/await reqRow|assertAllowed\(old,c.scope\)/);
 assert.match(revision,/reason\.length<5/);
 assert.match(revision,/old\.requisition_status/);
 assert.match(revision,/procurement_orders/);
 assert.match(revision,/UPDATE procurement_rfqs SET status='CLOSED'/);
 assert.match(revision,/UPDATE procurement_quotes SET status='REVISION_REQUESTED'/);
 assert.match(revision,/INSERT INTO procurement_rfqs/);
 assert.match(revision,/INSERT INTO procurement_rfq_revisions/);
 assert.doesNotMatch(revision,/DELETE FROM procurement_quotes/);
 assert.match(source,/quote\?\.status==="REVISION_REQUESTED"/);
 assert.match(source,/priorQuotes:/);
 assert.match(source,/revisionReason:/);
});

test('archive requires workspace, server, restaurant scope and document permissions on list/upload/download',()=>{
 assert.match(archive,/workspace_id TEXT NOT NULL,server_scope TEXT NOT NULL/);
 assert.match(archive,/resolveAccessForUser/);
 assert.match(archive,/serverScopeFromConnection/);
 assert.match(archive,/selectedDepartmentIds/);
 assert.match(archive,/hasPermission\(c.access/);
 assert.match(archive,/await validateDocument\(c,meta.entity_type,meta.entity_id\)/);
 assert.match(archive,/await validateDocument\(c,type,entityId\)/);
 assert.match(archive,/await validateDocument\(c,type,entityId,true\)/);
 assert.match(archive,/WHERE id=\?1 AND workspace_id=\?2 AND server_scope=\?3/);
 assert.match(archive,/WHERE workspace_id=\?1 AND server_scope=\?2 AND entity_type=\?3 AND entity_id=\?4/);
});

test('archive validates real file formats and caps file and tenant quota',()=>{
 assert.match(archive,/const LIMIT_BYTES=6\*1024\*1024/);
 assert.match(archive,/QUOTA_BYTES=96\*1024\*1024/);
 assert.match(archive,/checkSignature\(bytes,ext\)/);
 assert.match(archive,/mimeByExt/);
 assert.match(archive,/crypto\.subtle\.digest\("SHA-256"/);
 assert.match(archive,/SELECT COUNT\(\*\) AS count/);
 assert.match(archive,/await c\.db\.batch\(ops\)/);
 assert.match(archive,/Content-Disposition/);
 assert.match(archive,/Cache-Control":"private, no-store"/);
});

test('UI supports RFQ return, multi-stage attachments and large receiving dialog without accounting changes',()=>{
 for(const text of [
   'openRfqRevisionModal','data-rfq-revise','data-revision-supplier',
   'Файлы RFQ','Прайс-лист','Старый прайс','Файлы PO',
   'Файлы приёмки','attachmentButton(\'INVOICE\'','openProcurementAttachments',
   'FormData','data-proc-file-open','proc-modal-wide'
 ])assert.ok(ui.includes(text),text);
 assert.match(css,/\.proc-modal-backdrop \.proc-modal\.proc-modal-wide/);
 assert.match(css,/\.proc-file-list/);
 assert.match(ui,/body instanceof FormData/);
 assert.match(source,/VALUES\(\?1,\?2,\?3,\?4,'DRAFT'/); // New RFQ is not auto-sent.
});

test('GRN receiving renders each item in a single table row without losing required fields',()=>{
 const from=ui.indexOf('function receiptLineHtml(l){');
 const to=ui.indexOf('function recalcReceipt(){',from);
 assert.ok(from>0&&to>from,'receipt row builder must exist');
 const builder=new Function('num','esc','money','packagingChoiceHtml','vatOptions',
   ui.slice(from,to)+';return receiptLineHtml;');
 const render=builder((x,d=0)=>Number(x??d)||d,
   x=>String(x??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
   x=>Number(x).toFixed(2)+' ₼',()=>'<option value="__base__">Основная единица</option>',
   ()=>'<option value="0">0%</option>');
 const row=render({productId:'test-product',productName:'Говядина',remainingQty:10,
   packageSize:2.5,unitPrice:5,unit:'кг',vatPercent:0});
 assert.match(row,/data-receipt-line/);
 assert.match(row,/proc-receipt-row/);
 assert.match(row,/proc-receipt-product/);
 assert.match(row,/Говядина/);
 for(const field of ['packageChoice','packageSize','packageCount','quantity','vatPercent',
   'price','locationId','lotCode','expiresOn','containerId','packageName','unit']){
   assert.ok(row.includes('data-f="'+field+'"'),'Missing field '+field);
 }
 assert.match(row,/20\.00 ₼/);
 assert.match(row,/aria-label="Годен до/);
 assert.match(ui,/class="proc-receipt-scroll"/);
 assert.match(ui,/class="proc-receipt-grid-head"/);
 assert.match(ui,/lines\.map\(receiptLineHtml\)/);
 assert.match(css,/\.proc-modal-wide \.proc-edit-row\.proc-pack-row\[data-receipt-line\]/);
 assert.match(css,/grid-template-columns:var\(--receipt-columns\)/);
 assert.match(css,/\.proc-receipt-scroll\{[^}]*overflow-x:auto/s);
 assert.match(css,/\.proc-receipt-product\{[^}]*position:sticky/s);
});

test('GRN accounting still reads the exact original controls',()=>{
 const lines=ui.split('function formLines(){')[1]?.split('async function ensureGrn(')[0];
 assert.ok(lines,'Receipt document serializer must still exist');
 for(const field of ['packageSize','packageCount','vatPercent','price','containerId',
   'packageName','unit','locationId','lotCode','expiresOn']){
   assert.ok(lines.includes('[data-f="'+field+'"]'),'Document serializer missing '+field);
 }
 assert.match(ui,/\['packageSize','packageCount','price'\]\.forEach/);
 assert.match(ui,/applyPackagingChoice\(row\);recalcReceipt\(\)/);
});

test('PR document layout stays one-line and requester still sees no pricing inputs',()=>{
 const from=ui.indexOf('function prLineHtml(line={}){');
 const to=ui.indexOf('\nfunction bindEditRows(',from);
 assert.ok(from>=0&&to>from);
 const builder=new Function('key','productName','unitFor','canViewProcurementPrices',
   'num','esc','productLabel','packagingChoiceHtml','vatOptions','money',
   ui.slice(from,to)+';return prLineHtml;');
 const base=[String,()=> 'Помидоры',()=> 'кг'];
 const rest=[(x,d=0)=>Number(x??d)||d,String,(pid,name)=>name||pid,
   ()=>'<option>Осн. ед.</option>',()=>'<option>0%</option>',x=>Number(x).toFixed(2)+' ₼'];
 const withCosts=builder(...base,()=>true,...rest)({
   productId:'tomato',productName:'Помидоры',unit:'кг',quantity:8,
   packageSize:2,packageCount:4,expectedPrice:6,vatPercent:0
 });
 const requester=builder(...base,()=>false,...rest)({
   productId:'tomato',productName:'Помидоры',unit:'кг',quantity:8,
   packageSize:2,packageCount:4,expectedPrice:6,vatPercent:0
 });
 assert.match(withCosts,/proc-compact-pr-row/);
 assert.match(withCosts,/data-f="price"/);
 assert.match(withCosts,/data-f="vatPercent"/);
 assert.match(withCosts,/class="line-total"/);
 assert.match(withCosts,/data-f="product"/);
 assert.match(withCosts,/class="remove"/);
 assert.match(requester,/proc-pr-no-prices/);
 assert.doesNotMatch(requester,/data-f="price"/);
 assert.doesNotMatch(requester,/data-f="vatPercent"/);
 assert.doesNotMatch(requester,/class="line-total"/);
 assert.match(ui,/documentTableHead\(canViewProcurementPrices\(\)\?/);
 assert.match(ui,/id="proc-pr-lines"/);
 assert.match(ui,/id="proc-pr-add-line"/);
});
test('supplier quote price editor preserves exact payload input fields and per-line total',()=>{
 const from=ui.indexOf('function quoteLineHtml(l,supplierId){');
 const to=ui.indexOf('\nfunction recalcQuote()',from);
 assert.ok(from>=0&&to>from);
 const fn=new Function('historyPrice','num','esc','vatOptions','money',
   ui.slice(from,to)+';return quoteLineHtml;')(
   ()=>null,(v,d=0)=>Number(v??d)||d,String,()=>'<option>0%</option>',
   x=>Number(x).toFixed(2)+' ₼'
 );
 const row=fn({productId:'cheese',productName:'Сыр',packageSize:2.5,packageCount:4,
   quantity:10,unit:'кг',expectedPrice:7,vatPercent:0},'supplier');
 assert.match(row,/proc-compact-quote-row/);
 for(const field of ['packageSize','packageCount','vatPercent','price','containerId','packageName','unit']){
   assert.ok(row.includes('data-f="'+field+'"'),'Missing field '+field);
 }
 assert.match(row,/28\.00 ₼/);
 assert.match(ui,/documentTableHead\(\['Товар','Фасовка','Упаковок','НДС','Цена \/ упак\.','Сумма'\]\)/);
 assert.match(ui,/id="proc-quote-lines"/);
});
test('invoice, linked PO and allocation are compact while maintaining action selectors',()=>{
 assert.match(ui,/proc-invoice-compact-table/);
 assert.match(ui,/proc-compact-invoice-row/);
 assert.match(ui,/documentTableHead\(\['Товар','Фасовка','Упаковок','Итого','НДС','Цена \/ упак\.','Сумма'\]\)/);
 for(const f of ['packageCount','quantity','vatPercent','price']){
   assert.ok(ui.includes('[data-f="'+f+'"]'),f);
 }
 for(const name of ['data-inv-grn-line','proc-inv-save','proc-inv-post','proc-split-grid-head',
   'data-split-qty','proc-split-save','proc-link-match-row']){
   assert.ok(ui.includes(name),name);
 }
 assert.match(css,/\.proc-modal-wide \.proc-pr-compact-table \.proc-compact-grid/);
 assert.match(css,/\.proc-modal-wide \.proc-quote-compact-table \.proc-compact-grid/);
 assert.match(css,/\.proc-modal-wide \.proc-invoice-compact-table \.proc-compact-grid/);
 assert.match(css,/\.proc-modal-wide \.proc-compact-grid-head/);
 assert.match(css,/\.proc-modal-wide \.proc-split-grid-head/);
 assert.match(css,/\.proc-modal-wide \.proc-compact-scroll/);
});

test('Product input labels hide technical IDs, but preserve exact iiko product identity',()=>{
 const from=ui.indexOf('function buildProductDisplayLabels(){');
 const end=ui.indexOf('function productRef(',from);
 assert.ok(from>=0&&end>from,'Product display label registry must exist');
 const state={refs:{products:[
   {id:'abcdef12-3456-7890-aaaa-111111111111',name:'Döner',num:'100'},
   {id:'abcdef12-3456-7890-aaaa-222222222222',name:'Pendir ağ',num:'210'},
   {id:'abcdef12-3456-7890-aaaa-333333333333',name:'Pendir ağ',num:'211'},
   {id:'abcdef12-3456-7890-aaaa-444444444444',name:'Yumurta',num:''},
   {id:'abcdef12-3456-7890-aaaa-555555555555',name:'Yumurta',num:''}
 ]},productById:new Map(),productDisplayLabels:new Map(),productLabelToId:new Map()};
 const key=v=>String(v||'').trim().replace(/[{}]/g,'').toLowerCase();
 state.productById=new Map(state.refs.products.map(p=>[key(p.id),p]));
 const create=new Function('state','key',
   ui.slice(from,end)+';return{buildProductDisplayLabels,productLabel};');
 const {buildProductDisplayLabels,productLabel}=create(state,key);
 buildProductDisplayLabels();
 assert.equal(productLabel(state.refs.products[0].id),'Döner');
 assert.equal(productLabel(state.refs.products[1].id),'Pendir ağ · арт. 210');
 assert.equal(productLabel(state.refs.products[2].id),'Pendir ağ · арт. 211');
 const codes=state.refs.products.map(p=>productLabel(p.id));
 assert.equal(new Set(codes).size,5,'duplicate product names must remain selectable');
 for(const p of state.refs.products){
   const display=productLabel(p.id);
   assert.ok(!display.includes('abcdef12'),'Technical ID leaked in '+display);
   assert.ok(!display.includes(p.id.slice(-6)),'Technical ID suffix leaked in '+display);
   assert.equal(state.productLabelToId.get(display),key(p.id));
 }
 assert.match(codes[3],/Yumurta · вариант/);
 assert.match(codes[4],/Yumurta · вариант/);
 assert.notEqual(codes[3],codes[4]);
 assert.equal(productLabel('unknown-id'),'Номенклатура недоступна');
});
test('Typed product changes cannot silently keep the old product ID',()=>{
 const body=ui.split('function collectPrLines(){')[1]?.split('function openPrModal(',1)[0];
 assert.ok(body);
 assert.match(body,/productLabel\(bound\)===label\?bound:key\(resolveProductLabel\(label\)\)/);
 assert.match(ui,/function productOptions\(\)\{return state\.refs\.products\.map\(p=>'<option value="/);
 assert.doesNotMatch(ui,/id\.slice\(-6\)/);
});
