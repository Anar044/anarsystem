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
 assert.match(source,/quote\.status==="REVISION_REQUESTED"/);
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
 assert.match(ui,/status:\s?'DRAFT'/m); // New RFQ is not auto-sent.
});
