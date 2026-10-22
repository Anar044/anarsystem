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
 const to=ui.indexOf('\\nfunction recalcReceipt(){',from);
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
 assert.match(row,/12\.50 ₼/);
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
